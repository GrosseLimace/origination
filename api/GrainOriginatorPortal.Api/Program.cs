// Azure namespaces
using Azure.Extensions.AspNetCore.Configuration.Secrets;
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
using GrainOriginatorPortal.Infrastructure;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Json;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// Suppress the "Server: Kestrel" response header so we don't advertise the server
// technology to clients (avoids unnecessary info disclosure / fingerprinting).
builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);

// =============================================================================
// KEY VAULT — load secrets into configuration before anything else reads it.
// On App Service, use ManagedIdentityCredential directly (avoids DefaultAzureCredential
// cycling through ~8 providers, which adds ~60-120s to cold start on Linux).
// Locally, use DefaultAzureCredential without ManagedIdentity (avoids IMDS timeout).
// KeyVaultUri is pre-configured as an App Setting in all deployed environments.
// =============================================================================
var keyVaultUri = builder.Configuration["KeyVaultUri"];
if (!string.IsNullOrEmpty(keyVaultUri))
{
    var isAppService = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"));
    Azure.Core.TokenCredential kvCredential = isAppService
        ? new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned)
        : new DefaultAzureCredential(new DefaultAzureCredentialOptions
            { ExcludeManagedIdentityCredential = true });

    try
    {
        builder.Configuration.AddAzureKeyVault(new Uri(keyVaultUri), kvCredential);
    }
    catch (Exception ex) when (!isAppService)
    {
        // On App Service, Key Vault is always accessible via Managed Identity — don't swallow.
        // Locally, a developer may not yet have Key Vault access (pending Developer Access
        // package approval). Warn and continue — no secrets are required to run locally.
        Console.Error.WriteLine($"[WARNING] Key Vault unavailable locally ({ex.GetType().Name}: {ex.Message}). " +
            "Request the Developer Access package at myaccess.microsoft.com if you need secrets.");
    }
}

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
builder.Services.AddAuthorization(options =>
{
    // RequireRole honors the identity's RoleClaimType so it works whether the
    // JWT middleware surfaced the claim as `roles` (Microsoft.Identity.Web default)
    // or as `ClaimTypes.Role` (mapped). Both paths resolve to the same "Admin" check.
    options.AddPolicy("AdminOnly", policy =>
        policy.RequireRole("Admin"));
});
builder.Services.AddScoped<IUserEntitlementService, UserEntitlementService>();

// Usage tracking: bounded in-memory channel + background batch writer
builder.Services.AddSingleton(System.Threading.Channels.Channel.CreateBounded<GrainOriginatorPortal.Api.Middleware.UserActivityRecord>(
    new System.Threading.Channels.BoundedChannelOptions(10_000)
    { FullMode = System.Threading.Channels.BoundedChannelFullMode.DropWrite }));
builder.Services.AddSingleton(System.Threading.Channels.Channel.CreateBounded<GrainOriginatorPortal.Api.Middleware.UserClickEventRecord>(
    new System.Threading.Channels.BoundedChannelOptions(5_000)
    { FullMode = System.Threading.Channels.BoundedChannelFullMode.DropWrite }));
builder.Services.AddHostedService<UsageTrackingBackgroundService>();
builder.Services.AddHostedService<UsageAggregationBackgroundService>();

// Customer sync — periodic upsert from ODS vw_CustomerTradeUnits into the
// app DB's normalized Customer + CustomerTradeUnit tables. The logic class
// is also injected directly by DiagnosticsController so the dev-only manual
// trigger endpoint shares the same code path.
builder.Services.AddSingleton<CustomerSyncService>();
builder.Services.AddHostedService<CustomerSyncBackgroundService>();

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

// Accept both bare-GUID and api://-prefixed audience forms.
// Azure AD v2 tokens carry aud = {clientId} (bare GUID). Infra pre-configures
// AzureAd__Audience = api://{clientId} on every App Service. When an explicit
// Audience is set, Microsoft.Identity.Web uses it as the sole ValidAudience,
// causing IDX10214 if the token carries the other form. PostConfigure runs
// after all Configure registrations (including Microsoft.Identity.Web) so this
// override wins regardless of what App Settings or appsettings.*.json contain.
builder.Services.PostConfigure<Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerOptions>(
    Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerDefaults.AuthenticationScheme,
    options =>
    {
        var clientId = builder.Configuration["AzureAd:ClientId"];
        if (!string.IsNullOrEmpty(clientId))
        {
            options.TokenValidationParameters.ValidAudiences =
            [
                clientId,
                $"api://{clientId}"
            ];
        }
    });

// Required for IHttpContextAccessor in SqlDataService (traceId propagation to service-layer logs)
builder.Services.AddHttpContextAccessor();

// Add MVC controllers for REST API endpoints
// Configure JSON to serialize enums as strings instead of numbers
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        // All persisted DateTimes are UTC (DateTime.UtcNow on write). EF Core reads them back as
        // Kind=Unspecified, which makes the default writer emit ISO strings without a 'Z' suffix —
        // browsers then parse those as local time and shift the displayed clock by the user's TZ
        // offset. These converters normalize every DateTime to UTC on the wire.
        options.JsonSerializerOptions.Converters.Add(new UtcDateTimeJsonConverter());
        options.JsonSerializerOptions.Converters.Add(new NullableUtcDateTimeJsonConverter());
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

// Entity Framework Core DbContexts (ODS, Application, Entitlements) are registered by the
// Infrastructure layer. Connection strings come from appsettings / Azure App Settings; auth via
// DefaultAzureCredential; retry logic handles transient Azure SQL failures.
builder.Services.AddInfrastructure(builder.Configuration, builder.Environment.IsDevelopment());

// =============================================================================
// SERVICE REGISTRATION
// Controllers depend on per-domain Api services; those depend on Infrastructure
// repositories (registered via AddInfrastructure). The old IDataService/SqlDataService
// god-service has been fully decomposed and removed.
// =============================================================================

// Request-scoped helpers (current-user + trace id) read from HttpContext.
builder.Services.AddScoped<IRequestContextService, RequestContextService>();

// Per-domain services (Api layer) — controllers depend on these.
builder.Services.AddScoped<IQueryLibraryService, QueryLibraryService>();
builder.Services.AddScoped<ICommodityService, CommodityService>();
builder.Services.AddScoped<IStoredGrainService, StoredGrainService>();
builder.Services.AddScoped<ISavedListService, SavedListService>();
builder.Services.AddScoped<IProducerDetailsService, ProducerDetailsService>();
builder.Services.AddScoped<IFarmService, FarmService>();
builder.Services.AddScoped<IPlantingIntentionService, PlantingIntentionService>();
builder.Services.AddScoped<INoteService, NoteService>();
builder.Services.AddScoped<ITicketService, TicketService>();
builder.Services.AddScoped<IContractService, ContractService>();
builder.Services.AddScoped<IDashboardService, DashboardService>();
builder.Services.AddScoped<ICustomerService, CustomerService>();
builder.Services.AddScoped<IBidSheetService, BidSheetService>();
builder.Services.AddScoped<IUserPreferenceService, UserPreferenceService>();
builder.Services.AddScoped<IUserTradeUnitService, UserTradeUnitService>();
builder.Services.AddScoped<ITradeUnitService, TradeUnitService>();
// Singleton so the Nominatim rate-limiter + last-call timestamp are shared across requests.
builder.Services.AddSingleton<IGeocodeService, GeocodeService>();
builder.Services.AddScoped<IUsageDashboardService, UsageDashboardService>();
// Generation stamp that lets an excluded-user edit invalidate the (scoped) dashboard service's
// cached user universes process-wide. Singleton by necessity — see the type's remarks.
builder.Services.AddSingleton<UsageUniverseCacheState>();
builder.Services.AddScoped<IDailyRecapGroupService, DailyRecapGroupService>();

// Graph directory client (app-access spike) — singleton so the cached Graph token is shared.
// Credential split mirrors the Key Vault bootstrap at the top of this file: managed identity
// on App Service, the developer's own credential locally (skip the IMDS probe).
builder.Services.AddSingleton<IGraphDirectoryClient>(sp =>
{
    var isAppService = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"));
    Azure.Core.TokenCredential graphCredential = isAppService
        ? new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned)
        : new DefaultAzureCredential(new DefaultAzureCredentialOptions
            { ExcludeManagedIdentityCredential = true });
    return new GraphDirectoryClient(
        graphCredential,
        sp.GetRequiredService<IHttpClientFactory>(),
        sp.GetRequiredService<ILogger<GraphDirectoryClient>>());
});
// Cached "who can sign in to the app" set (fail-open) — consumed by the usage dashboard
// user universe and the daily-digest People picker. Singleton so all requests share the cache.
builder.Services.AddSingleton<IAppAccessService, AppAccessService>();

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

// Microsoft Graph (app-access spike): same resilience shape as nominatim, but only 2 retries —
// when the NSG blocks graph.microsoft.com egress every attempt fails by timeout, and the
// diagnostic should answer quickly. Auth is per-request bearer from GraphDirectoryClient
// (token failures must surface as TokenFailure, not be retried by this pipeline).
builder.Services.AddHttpClient("graph", client =>
{
    client.BaseAddress = new Uri("https://graph.microsoft.com/v1.0/");
    client.Timeout = TimeSpan.FromSeconds(10);
})
.AddHttpMessageHandler<CorrelationIdOutboundHandler>()
.AddResilienceHandler("graph", pipeline =>
{
    pipeline.AddRetry(new HttpRetryStrategyOptions
    {
        MaxRetryAttempts = 2,
        Delay = TimeSpan.FromMilliseconds(500),
        BackoffType = DelayBackoffType.Exponential,
        UseJitter = true,
        MaxDelay = TimeSpan.FromSeconds(10),
        // Only retry on transient network/timeout failures — never 4xx (a 403 must
        // reach GraphDirectoryClient unretried so it reports PermissionMissing).
        ShouldHandle = args => ValueTask.FromResult(
            args.Outcome.Exception is HttpRequestException ||
            args.Outcome.Exception is TaskCanceledException)
    });

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
                PermitLimit = 1000,
                Window = TimeSpan.FromMinutes(1)
            }));
});

// =============================================================================
// RESPONSE COMPRESSION — gzip JSON responses (5-10x smaller over the wire).
// Especially benefits large payloads like GET /api/customers.
// =============================================================================
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
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

            // SyncCommoditiesAsync deliberately NOT called here. dbo.Commodities is hand-curated
            // (Code/Name/Category plus Tier1/Tier2/Tier3/BaseUOM which the ODS sync doesn't know
            // about), so we don't want the startup to scan the 2M-row vw_CurrentTickets view on
            // every dev restart just to confirm there's nothing new to add. The method is still
            // callable on demand via the diagnostics endpoint if a one-time backfill is needed.
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

// NOTE: ApplicationDbContext migrations are applied via the deployment pipeline, not at startup.
// Run manually: dotnet ef database update --project api/GrainOriginatorPortal.Api

// =============================================================================
// Middleware Pipeline Configuration
// =============================================================================

// Enable OpenAPI endpoint in development for API testing/documentation
// RequireAuthorization ensures a valid Azure AD token is needed to access the spec
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().RequireAuthorization();
}

// Response compression — gzip large JSON payloads. Must be before any middleware that writes response bodies.
app.UseResponseCompression();

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

// Usage tracking — records every authenticated API request for the usage dashboard.
// Runs after auth so UserId is resolved. Non-blocking: writes to a bounded channel.
app.UseMiddleware<UsageTrackingMiddleware>();

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
