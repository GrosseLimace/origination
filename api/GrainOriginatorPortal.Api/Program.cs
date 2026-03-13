// Azure namespaces
using Azure.Identity;

// Microsoft namespaces
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.Identity.Web;

// Polly namespaces
using Polly;

// Rate limiting
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

// Project namespaces
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Api.Interfaces;

var builder = WebApplication.CreateBuilder(args);

// =============================================================================
// Development: Override the ActiveDirectoryDefault SQL auth provider to use
// AzureCliCredential directly. DefaultAzureCredential probes the Azure IMDS
// endpoint (169.254.169.254) for ManagedIdentity, which times out (~1 s) in
// local dev. AzureCliCredential skips all of that — it just calls
// `az account get-access-token` and caches the result.
// =============================================================================
if (builder.Environment.IsDevelopment())
{
    SqlAuthenticationProvider.SetProvider(
        SqlAuthenticationMethod.ActiveDirectoryDefault,
        new AzureCliSqlAuthProvider());
}

// =============================================================================
// Service Configuration
// =============================================================================

// Register global exception handler — returns ApiErrorResponse per error-handling-standards.md §2
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddProblemDetails();

// =============================================================================
// AUTHENTICATION / AUTHORIZATION — security-guide.md §4.1
// Validates Azure AD JWT bearer tokens on every request.
// Configuration in appsettings.json "AzureAd" section.
// =============================================================================
builder.Services.AddMicrosoftIdentityWebApiAuthentication(builder.Configuration);
builder.Services.AddAuthorization();
builder.Services.AddScoped<IUserEntitlementService, UserEntitlementService>();

// Hook JWT bearer events to log token validation failures per security-guide.md §8.1.
// OnAuthenticationFailed fires when the token is present but invalid (bad signature,
// expired, wrong audience, etc.). This is more specific than SecurityAuditMiddleware's
// generic 401 log — it captures the exact validation error reason.
builder.Services.Configure<Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerOptions>(
    Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerDefaults.AuthenticationScheme,
    options =>
    {
        options.Events ??= new Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents();

        var previousOnFailed = options.Events.OnAuthenticationFailed;
        options.Events.OnAuthenticationFailed = async context =>
        {
            var logger = context.HttpContext.RequestServices
                .GetRequiredService<ILogger<Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerHandler>>();
            var traceId = context.HttpContext.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
                ?? context.HttpContext.TraceIdentifier;

            logger.LogWarning(
                "JWT validation failed [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {ExceptionType} — {Message}",
                traceId, "JWT_VALIDATION_FAILED", "Security",
                context.Exception.GetType().Name, context.Exception.Message);

            if (previousOnFailed is not null)
                await previousOnFailed(context);
        };
    });

// Required for IHttpContextAccessor in SqlDataService (traceId propagation to service-layer logs)
builder.Services.AddHttpContextAccessor();

// Add MVC controllers for REST API endpoints
// Configure JSON to serialize enums as strings instead of numbers
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        // Ensure all properties are included, even null values
        options.JsonSerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never;
        // Reject unknown fields in request bodies — security-guide.md §4.1 serialization hardening.
        // Prevents mass assignment and forces clients to send only known properties.
        options.JsonSerializerOptions.UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow;
    });

// Enable OpenAPI/Swagger for API documentation (available at /openapi/v1.json)
builder.Services.AddOpenApi();

// Bounded in-memory cache for geocode results (M-12: replaces unbounded ConcurrentDictionary)
builder.Services.AddMemoryCache(options => options.SizeLimit = 5000);

builder.Services.AddHttpContextAccessor();

// Configure Entity Framework Core with SQL Server and Managed Identity
// - Uses connection string from appsettings.json or Azure App Settings
// - Authentication via DefaultAzureCredential (Azure CLI locally, Managed Identity in Azure)
// - Retry logic handles transient network failures (5 attempts, 30 second max delay)
builder.Services.AddDbContext<OriginationDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("ODSConnection");

    options.UseSqlServer(connectionString, sqlOptions =>
    {
        // Enable retry on transient failures (required for Azure SQL)
        sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(30),
            errorNumbersToAdd: null);

        // Set command timeout to 2 minutes for large ODS queries
        sqlOptions.CommandTimeout(120);
    });

    // Enable detailed errors in development (compile-time guard prevents accidental use in Release builds)
#if DEBUG
    if (builder.Environment.IsDevelopment())
    {
        options.EnableSensitiveDataLogging();
        options.EnableDetailedErrors();
    }
#endif
});

// Configure ApplicationDbContext for app-owned tables in the Origination database
// (Notes, and eventually TradeUnits once that table is created)
builder.Services.AddDbContext<ApplicationDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("OriginationConnection");

    options.UseSqlServer(connectionString, sqlOptions =>
    {
        sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(30),
            errorNumbersToAdd: null);
        sqlOptions.MigrationsHistoryTable("__EFMigrationsHistory", "dbo");
    });

#if DEBUG
    if (builder.Environment.IsDevelopment())
    {
        options.EnableSensitiveDataLogging();
        options.EnableDetailedErrors();
    }
#endif
});

// Configure EntitlementsDbContext for read-only access to the Entitlements database
// Used to resolve user-specific trade unit assignments via vw_UserTradeUnitAccess
builder.Services.AddDbContext<EntitlementsDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("EntitlementsConnection");

    options.UseSqlServer(connectionString, sqlOptions =>
    {
        sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(30),
            errorNumbersToAdd: null);
    });

#if DEBUG
    if (builder.Environment.IsDevelopment())
    {
        options.EnableSensitiveDataLogging();
        options.EnableDetailedErrors();
    }
#endif
});

// =============================================================================
// DATA SERVICE REGISTRATION
// Currently using direct SQL connection (SqlDataService).
// When APIM is ready, follow these steps to switch:
//
//   STEP 1 - Add APIM config to appsettings.json:
//     "Apim": {
//       "BaseUrl": "https://<your-apim-instance>.azure-api.net",
//       "SubscriptionKey": "<your-subscription-key>"
//     }
//
//   STEP 2 - Register the APIM HTTP client (replace the AddScoped line below):
//     builder.Services.AddHttpClient<IDataService, ApimDataService>(client =>
//     {
//         client.BaseAddress = new Uri(builder.Configuration["Apim:BaseUrl"]!);
//         client.DefaultRequestHeaders.Add("Ocp-Apim-Subscription-Key", builder.Configuration["Apim:SubscriptionKey"]);
//     });
//
//   STEP 3 - Remove or comment out the DbContext registration above (no longer needed)
//
//   STEP 4 - Fill in the APIM endpoint URLs in ApimDataService.cs
// =============================================================================

// CURRENT: Direct SQL connection via Entity Framework Core
// TO SWITCH TO APIM: See instructions above
builder.Services.AddScoped<IDataService, SqlDataService>();

// OPTIONAL: Keep MockDataService for testing/comparison
// Uncomment to use mock data instead of database:
// builder.Services.AddSingleton<IDataService, MockDataService>();

// Configure CORS — allowed origins come from configuration so they can be overridden
// per environment via Azure App Service settings without code changes.
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngular", policy =>
    {
        var origins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>()
            ?? new[] { "http://localhost:4200" };
        policy.WithOrigins(origins)
              .WithHeaders("Content-Type", "Authorization")
              .WithMethods("GET", "POST", "PUT", "DELETE");
    });
});

// =============================================================================
// HTTP CLIENTS
// Nominatim geocoding client — BaseAddress set here so controllers use relative URLs.
// Resilience pipeline: retry with exponential backoff + circuit breaker per §6.
// CorrelationIdOutboundHandler propagates X-Correlation-Id to all outbound calls (§8).
// =============================================================================

// Register the outbound correlation handler so the DI container can create it
builder.Services.AddTransient<CorrelationIdOutboundHandler>();

builder.Services.AddHttpClient("nominatim", client =>
{
    client.BaseAddress = new Uri("https://nominatim.openstreetmap.org/");
    client.DefaultRequestHeaders.Add("User-Agent", "GrainOriginatorPortal/1.0");
    client.Timeout = TimeSpan.FromSeconds(10);
})
.AddHttpMessageHandler<CorrelationIdOutboundHandler>()
.AddResilienceHandler("nominatim", pipeline =>
{
    // Retry: up to 3 attempts with exponential backoff + jitter (§6.2)
    pipeline.AddRetry(new HttpRetryStrategyOptions
    {
        MaxRetryAttempts = 3,
        Delay = TimeSpan.FromMilliseconds(500),
        BackoffType = DelayBackoffType.Exponential,
        UseJitter = true,
        MaxDelay = TimeSpan.FromSeconds(30),
        // Only retry on transient network/timeout failures — not 4xx
        ShouldHandle = args => ValueTask.FromResult(
            args.Outcome.Exception is HttpRequestException ||
            args.Outcome.Exception is TaskCanceledException)
    });

    // Circuit breaker: opens after 50% failure rate over 5+ requests in 30s window (§6.3)
    pipeline.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
    {
        FailureRatio = 0.5,
        SamplingDuration = TimeSpan.FromSeconds(30),
        MinimumThroughput = 5,
        BreakDuration = TimeSpan.FromSeconds(30)
    });
});

// =============================================================================
// RATE LIMITING — security-guide.md §4.1 (CWE-770)
// Fixed-window limiter: 300 requests per minute per authenticated user (or IP for anonymous).
// =============================================================================
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        RateLimitPartition.GetFixedWindowLimiter(
            ctx.User?.Identity?.Name ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 300,
                Window = TimeSpan.FromMinutes(1)
            }));
});

// =============================================================================
// HEALTH CHECKS (§8 — /health/live and /health/ready)
// =============================================================================
builder.Services.AddHealthChecks()
    .AddDbContextCheck<OriginationDbContext>("origination_db", tags: ["ready"])
    .AddDbContextCheck<ApplicationDbContext>("application_db", tags: ["ready"]);

var app = builder.Build();

// =============================================================================
// Development: Warm up all three DB connections in parallel at startup.
// Token acquisition and connection pool setup happen here (hidden in startup time)
// rather than on the first user request, which would feel slow.
// =============================================================================
if (app.Environment.IsDevelopment())
{
    _ = Task.Run(async () =>
    {
        try
        {
            using var scope = app.Services.CreateScope();
            var odsDb = scope.ServiceProvider.GetRequiredService<OriginationDbContext>();
            var appDb = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var entDb = scope.ServiceProvider.GetRequiredService<EntitlementsDbContext>();
            await Task.WhenAll(
                odsDb.Database.OpenConnectionAsync(),
                appDb.Database.OpenConnectionAsync(),
                entDb.Database.OpenConnectionAsync()
            );
            app.Logger.LogInformation("DB connections warmed up successfully.");

            // Sync commodities from ODS at startup so GET /api/commodities is fast
            var dataService = scope.ServiceProvider.GetRequiredService<IDataService>();
            if (dataService is SqlDataService sqlDataService)
            {
                await sqlDataService.SyncCommoditiesAsync();
            }
        }
        catch (Exception ex)
        {
            app.Logger.LogWarning(ex, "DB warm-up failed — first request will be slower.");
        }
    });
}

// =============================================================================
// Database Initialization (Development Only)
// =============================================================================

// Apply pending migrations automatically in development
// NOTE: In production, migrations should be applied via deployment pipeline
// DISABLED: Only reading existing tables, not creating new ones
/*
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<OriginationDbContext>();

    try
    {
        // Apply any pending migrations
        dbContext.Database.Migrate();
        app.Logger.LogInformation("Database migrations applied successfully");
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Error applying database migrations");
        // Continue startup even if migration fails (allows debugging)
    }
}
*/

// =============================================================================
// Middleware Pipeline Configuration
// =============================================================================

// Enable OpenAPI endpoint in development for API testing/documentation
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Global exception handling — must be first in the middleware pipeline
app.UseExceptionHandler();

// Security response headers — X-Content-Type-Options, X-Frame-Options, CSP, HSTS, etc.
// security-guide.md §4.1
app.UseMiddleware<SecurityHeadersMiddleware>();

// Correlation ID — generate/propagate X-Correlation-Id on every request (§8)
app.UseMiddleware<CorrelationIdMiddleware>();

// Apply CORS policy to allow Angular frontend requests
// MUST come before UseHttpsRedirection to handle preflight requests correctly
app.UseCors("AllowAngular");

// Rate limiting — reject excessive requests before they hit auth/controllers (§4.1 CWE-770)
app.UseRateLimiter();

// Redirect HTTP requests to HTTPS for security
app.UseHttpsRedirection();

// Serve Angular static assets (CSS, JS, images) from wwwroot
// Must come before UseAuthentication so static files don't require a token
app.UseStaticFiles();

// Authentication + authorization — must come after CORS and before MapControllers
app.UseAuthentication();
app.UseAuthorization();

// Request context — sets ServiceName, Operation, TraceId, UserId in log scope.
// MUST run AFTER UseAuthentication() so context.User is populated with JWT claims
// and UserId resolves to the actual user (not "anonymous").
app.UseMiddleware<RequestContextMiddleware>();

// Security audit logging — logs 401 and 403 outcomes per security-guide.md §8.1.
// Must run after UseAuthorization so the response status code is already finalized.
app.UseMiddleware<SecurityAuditMiddleware>();

// Map controller routes and require a valid Azure AD bearer token on every endpoint.
// Health check and OpenAPI endpoints are mapped separately and are not covered here.
app.MapControllers().RequireAuthorization();

// =============================================================================
// HEALTH CHECK ENDPOINTS (§8 — liveness + readiness probes)
// /health/live  — process is running (no dependency checks)
// /health/ready — process + DB connections are ready
// =============================================================================
app.MapHealthChecks("/health/live", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    Predicate = _ => false  // exclude all checks — liveness only verifies the process is up
});

app.MapHealthChecks("/health/ready", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
    ResultStatusCodes =
    {
        [HealthStatus.Healthy]   = StatusCodes.Status200OK,
        [HealthStatus.Degraded]  = StatusCodes.Status200OK,
        [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable
    }
});

// SPA fallback — return index.html for any route not matched by a controller
// This enables Angular client-side routing (/dashboard, /build-list, etc.)
app.MapFallbackToFile("index.html");

// Start the application
app.Run();

/// <summary>
/// Replaces DefaultAzureCredential with a version that skips ManagedIdentityCredential
/// for local development. DefaultAzureCredential probes the Azure IMDS endpoint
/// (169.254.169.254) which times out ~1 s per connection on a dev workstation.
/// Excluding it lets the chain reach SharedTokenCacheCredential (which works with
/// cached az login / Visual Studio tokens) without the IMDS delay.
/// </summary>
internal sealed class AzureCliSqlAuthProvider : SqlAuthenticationProvider
{
    private static readonly DefaultAzureCredential _credential = new(
        new DefaultAzureCredentialOptions { ExcludeManagedIdentityCredential = true });
    private static readonly string[] _scopes = ["https://database.windows.net/.default"];

    public override async Task<SqlAuthenticationToken> AcquireTokenAsync(SqlAuthenticationParameters parameters)
    {
        var result = await _credential.GetTokenAsync(new Azure.Core.TokenRequestContext(_scopes));
        return new SqlAuthenticationToken(result.Token, result.ExpiresOn);
    }

    public override bool IsSupported(SqlAuthenticationMethod authenticationMethod)
        => authenticationMethod == SqlAuthenticationMethod.ActiveDirectoryDefault;
}
