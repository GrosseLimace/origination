// Azure namespaces
using Azure.Extensions.AspNetCore.Configuration.Secrets;
using Azure.Identity;

// Microsoft namespaces
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.Identity.Web;
using Microsoft.AspNetCore.Mvc;

// Polly namespaces
using Polly;
using Polly.Timeout;

// Rate limiting
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

// Project namespaces
using GrainOriginatorPortal.Infrastructure;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Json;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Api.Models.Responses;

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
// EnableTokenAcquisitionToCallDownstreamApi turns this API into a confidential client so it can
// exchange the caller's token for a Graph token FOR THAT SAME USER (on-behalf-of). Required by IT
// Security 2026-09-15: delegated Graph permissions live on the API registration, never the SPA,
// because their reconciler rebuilds SPA permission lists from a template and would silently drop
// anything added by hand. The permission boundary is identical either way — the user's own calendar,
// the teams they are already in — because the user's identity flows through the exchange.
//
// HOW THE API AUTHENTICATES TO ENTRA is configuration, not code: "AzureAd:ClientCredentials". The
// intent is the secretless route (a federated credential backed by the App Service managed identity),
// but a secret or certificate would drop into the same section without touching anything here.
builder.Services.AddMicrosoftIdentityWebApiAuthentication(builder.Configuration)
    .EnableTokenAcquisitionToCallDownstreamApi()
    // In-memory is right for this: tokens are per-user and short-lived, a cold instance simply
    // re-exchanges, and a distributed cache would be new infrastructure for no correctness gain.
    .AddInMemoryTokenCaches();
builder.Services.AddAuthorization(options =>
{
    // RequireRole honors the identity's RoleClaimType so it works whether the
    // JWT middleware surfaced the claim as `roles` (Microsoft.Identity.Web default)
    // or as `ClaimTypes.Role` (mapped). Both paths resolve to the same "Admin" check.
    options.AddPolicy("AdminOnly", policy =>
        policy.RequireRole("Admin"));

    // BarChart ingestion: the data pipeline's managed identity holding the pre-existing
    // application-only app role, or an Admin so the feed can be exercised and re-run by hand.
    // RequireRole is OR across the listed roles.
    options.AddPolicy("BarchartIngest", policy =>
        policy.RequireRole("Origination.Application", "Admin"));

    // Usage-dashboard read surface: Super Users group membership, surfaced as the Admin role.
    // Equivalent to AdminOnly today; kept as its own named policy so the read surface stays distinct
    // from exclusion administration (a convention test pins that split), and so how much of the org
    // a viewer sees can keep changing without touching who may open it.
    options.AddPolicy(GrainOriginatorPortal.Api.Authorization.UsageDashboardAccess.PolicyName, policy =>
        policy.RequireAssertion(ctx =>
            GrainOriginatorPortal.Api.Authorization.UsageDashboardAccess.CanView(ctx.User)));
});
// Audit authorization denials where the framework decides them. The authorization middleware
// short-circuits on a failed [Authorize] without calling the rest of the pipeline, so
// SecurityAuditMiddleware (which reads the final status code downstream) never saw the ordinary
// 401/403s it exists to log. This handler logs and then delegates to the default behaviour.
builder.Services.AddSingleton<
    Microsoft.AspNetCore.Authorization.IAuthorizationMiddlewareResultHandler,
    AuthorizationAuditResultHandler>();

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

// Keeps the trade-unit-wide CTRM caches warm for recently-used producer sets, so Build-a-List prompts
// never pay for a cache that expired between uses. No-op unless Ctrm:Source is 'ctrm'.
builder.Services.AddHostedService<CtrmKeepWarmService>();

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

// Make [ApiController]'s automatic model-validation failures use the app's own error envelope.
//
// Every controller here carries [ApiController], which short-circuits a data-annotation failure
// into the framework's RFC7807 ValidationProblemDetails *before* GlobalExceptionHandler or our own
// ValidationException ever run. That is the single most common validation failure across the whole
// write surface, and it was the one shape the Angular client can't read — so the identical
// conceptual error produced two different bodies depending on whether it was caught by an
// annotation or thrown by hand. One factory, and every controller agrees.
builder.Services.Configure<ApiBehaviorOptions>(options =>
{
    options.InvalidModelStateResponseFactory = context =>
    {
        var http = context.HttpContext;
        var traceId = http.Items[CorrelationIdMiddleware.ItemsKey]?.ToString() ?? http.TraceIdentifier;

        // Field-level detail, same shape a thrown ValidationException produces.
        var details = context.ModelState
            .Where(kvp => kvp.Value?.Errors.Count > 0)
            .SelectMany(kvp => kvp.Value!.Errors.Select(e => new ApiErrorDetail
            {
                Field = kvp.Key,
                // ErrorMessage is empty when the failure came from a binding/parse exception;
                // don't leak the exception text to the caller, which may name internal types.
                Message = string.IsNullOrWhiteSpace(e.ErrorMessage)
                    ? "The value provided is not valid for this field."
                    : e.ErrorMessage,
                Code = "VALIDATION_INVALID_FIELD",
            }))
            .ToList();

        http.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("GrainOriginatorPortal.Api.ModelValidation")
            .LogWarning(
                "Validation error [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {FieldCount} field(s) failed on {Method} {Path}",
                traceId, "VALIDATION_ERROR", "Validation", details.Count,
                http.Request.Method, http.Request.Path.Value);

        return new BadRequestObjectResult(new ApiErrorResponse
        {
            Error = new ApiErrorBody
            {
                Code = "VALIDATION_ERROR",
                Message = "One or more fields failed validation.",
                Details = details,
                TraceId = traceId,
                Timestamp = DateTime.UtcNow.ToString("O"),
                Instance = http.Request.Path.Value,
            }
        });
    };
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
builder.Services.AddScoped<IDpContractService, DpContractService>();
builder.Services.AddScoped<ISavedListService, SavedListService>();
builder.Services.AddScoped<IProducerDetailsService, ProducerDetailsService>();
builder.Services.AddScoped<IPlantingIntentionService, PlantingIntentionService>();
builder.Services.AddScoped<INoteService, NoteService>();
builder.Services.AddScoped<IReminderService, ReminderService>();
builder.Services.AddScoped<IOutlookCalendarService, OutlookCalendarService>();
builder.Services.AddScoped<ITicketService, TicketService>();
builder.Services.AddScoped<IContractService, ContractService>();
builder.Services.AddScoped<IDashboardService, DashboardService>();
builder.Services.AddScoped<ICustomerService, CustomerService>();
builder.Services.AddScoped<IBidSheetService, BidSheetService>();
builder.Services.AddScoped<IBarchartIngestService, BarchartIngestService>();
builder.Services.AddScoped<IUserPreferenceService, UserPreferenceService>();
builder.Services.AddScoped<IUserTradeUnitService, UserTradeUnitService>();
builder.Services.AddScoped<ITradeUnitService, TradeUnitService>();
// Singleton so the Nominatim rate-limiter + last-call timestamp are shared across requests.
builder.Services.AddSingleton<IGeocodeService, GeocodeService>();
builder.Services.AddScoped<IUsageDashboardService, UsageDashboardService>();
// Scoped (not singleton like IAppAccessService) because it reads through the scoped
// IUsageRepository/DbContext; the directory itself is shared via IMemoryCache.
builder.Services.AddScoped<IManagerDirectoryService, ManagerDirectoryService>();
// Generation stamp that lets an excluded-user edit invalidate the (scoped) dashboard service's
// cached user universes process-wide. Singleton by necessity — see the type's remarks.
builder.Services.AddSingleton<UsageUniverseCacheState>();
builder.Services.AddScoped<IDailyRecapGroupService, DailyRecapGroupService>();
builder.Services.AddScoped<ITeamsChannelService, TeamsChannelService>();
builder.Services.AddScoped<ITeamsDirectoryService, TeamsDirectoryService>();

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

// CTRM GraphQL client (DB2Connector.GraphQL spike) — singleton so the cached token is shared.
// Unlike Graph, this API is not an Azure first-party resource: it needs client credentials
// against its own app registration, so this is the one place in the app using a
// ClientSecretCredential. The secret comes from Key Vault as 'Ctrm--ClientSecret' (Key Vault
// maps '--' to ':'); when any piece is missing the credential stays null and the client reports
// NotConfigured. That is a FAILED read, not a fallback: with Ctrm:Source=ctrm the contract and ticket
// screens show a load error. Rolling back to ODS is the setting Ctrm__Source=ods.
// Longer term the cleaner shape is an app-role grant to the App Service managed identity, which
// would remove the secret entirely and match how Graph is done above.
builder.Services.AddSingleton<GrainOriginatorPortal.Infrastructure.Ctrm.ICtrmGraphQlClient>(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var tenantId = config.GetValue<string>("Ctrm:TenantId")?.Trim();
    var clientId = config.GetValue<string>("Ctrm:ClientId")?.Trim();
    var clientSecret = config.GetValue<string>("Ctrm:ClientSecret")?.Trim();

    Azure.Core.TokenCredential? ctrmCredential =
        !string.IsNullOrEmpty(tenantId) && !string.IsNullOrEmpty(clientId) && !string.IsNullOrEmpty(clientSecret)
            ? new ClientSecretCredential(tenantId, clientId, clientSecret)
            : null;

    return new GrainOriginatorPortal.Api.Services.Ctrm.CtrmGraphQlClient(
        ctrmCredential,
        sp.GetRequiredService<IHttpClientFactory>(),
        config,
        sp.GetRequiredService<ILogger<GrainOriginatorPortal.Api.Services.Ctrm.CtrmGraphQlClient>>());
});

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
            args.Outcome.Exception is TaskCanceledException ||
            args.Outcome.Exception is TimeoutRejectedException)
    });

    // Circuit breaker: opens after 50% failure rate over 5+ requests in 30s window (§6.3)
    pipeline.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
    {
        FailureRatio = 0.5,
        SamplingDuration = TimeSpan.FromSeconds(30),
        MinimumThroughput = 5,
        BreakDuration = TimeSpan.FromSeconds(30)
    });

    // Per ATTEMPT. Innermost so each retry gets its own clock. Sized to the slowest legitimate request
    // we have measured - a 500-row contract page with pricing lines at ~12s, or a customerIds crop-year
    // page at ~8-20s - with headroom, and well under the server's own 30s HC0045 limit so we give up
    // at the same point it does rather than after it.
    pipeline.AddTimeout(TimeSpan.FromSeconds(30));
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

// CTRM GraphQL: BaseAddress is the FULL endpoint URL (single POST target, no relative paths), so
// it comes from config rather than being hard-coded — each environment points at its own gateway.
// Timeout is 30s rather than 10s because a cold contract-snapshot page has been measured at ~3.4s
// and the API is an on-prem node behind APIM, not an Azure-local service.
builder.Services.AddHttpClient(GrainOriginatorPortal.Api.Services.Ctrm.CtrmGraphQlClient.HttpClientName, client =>
{
    var uri = builder.Configuration.GetValue<string>("Ctrm:GraphQlUri")?.Trim();
    if (!string.IsNullOrEmpty(uri))
        client.BaseAddress = new Uri(uri);
    // The OVERALL budget for one logical call, retries included. The per-attempt limit is the AddTimeout
    // strategy in the pipeline below. These used to be one 30-second number, which meant a slow-but-fine
    // attempt was retried inside a budget it had already spent - the retries could not succeed, and the
    // producer screen saw "Timed out reaching the CTRM gateway" under load. 3 attempts x 45s + backoff.
    client.Timeout = TimeSpan.FromSeconds(150);
})
.AddHttpMessageHandler<CorrelationIdOutboundHandler>()
.AddResilienceHandler("ctrm", pipeline =>
{
    pipeline.AddRetry(new HttpRetryStrategyOptions
    {
        MaxRetryAttempts = 2,
        Delay = TimeSpan.FromMilliseconds(500),
        BackoffType = DelayBackoffType.Exponential,
        UseJitter = true,
        MaxDelay = TimeSpan.FromSeconds(10),
        // Exceptions only — never status codes. This API answers HTTP 500 for caller-input
        // validation failures, so retrying on status would triple the cost of a bad query and
        // still fail. A 401 likewise has to reach CtrmGraphQlClient unretried to be reported
        // as Unauthorized.
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

    // PER-ATTEMPT limit, innermost so it wraps the individual request rather than the retry sequence.
    // There was none: the comment on client.Timeout above claimed one but nothing enforced it, so a single
    // hung attempt could hold a request for the whole 110-second client budget.
    //
    // 45 seconds, well clear of the server's own 30-second limit, on purpose. The server answers its
    // timeout as a GraphQL error (HC0045, HTTP 400) that CtrmServerTimeoutRetry handles deliberately,
    // and the circuit breaker above ignores a 400 by design. But that answer does not arrive AT 30
    // seconds: measured 2026-09-29 it landed at 31.5 s on the PROD gateway and 36 s on the nonprod one.
    // At the previous 35 s this timeout fired first on the slow days, which turned every server-side
    // timeout into a TimeoutRejectedException - which the breaker DOES count. One trade-unit walk of
    // sixteen batches on a cold gateway tripped it, and for the next 30 s every producer click got
    // EgressBlocked although the gateway was answering single reads in under a second. 45 s lets the
    // HC0045 through as the 400 it is, with its correlation id, and leaves the breaker for the real
    // outage it exists for: connection failures, 5xx, and an attempt with no answer at all in 45 s.
    //
    // TimeoutRejectedException is deliberately NOT in the retry ShouldHandle above: a hung attempt should
    // fail fast to EgressBlocked, which names the remediation, rather than being retried twice more.
    pipeline.AddTimeout(TimeSpan.FromSeconds(45));
});

// A second Graph client for the ONE call that must never be re-sent: creating an Outlook calendar
// event. POST /me/events is non-idempotent and has no idempotency key, so when Graph accepts the
// event but the response is lost — a client timeout, a reset, a gateway 504 raised after the event
// was already written — a retry produces a SECOND event on the user's calendar. The shared "graph"
// client above retries on exactly those failures (HttpRequestException / TaskCanceledException,
// which is what its 10s timeout surfaces as), so a single create could land three events.
//
// This is the same hazard the Instant Share Note workflow hit with Graph sendMail, where the default
// policy mailed up to five copies of one note; that was fixed with retryPolicy: none. Reads and the
// idempotent calendar calls (PATCH the window, DELETE the event) keep using "graph" and its retry.
//
// The circuit breaker is kept: it fails fast, it does not re-send.
builder.Services.AddHttpClient("graph-no-retry", client =>
{
    client.BaseAddress = new Uri("https://graph.microsoft.com/v1.0/");
    client.Timeout = TimeSpan.FromSeconds(10);
})
.AddHttpMessageHandler<CorrelationIdOutboundHandler>()
.AddResilienceHandler("graph-no-retry", pipeline =>
{
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

    // The limiter writes its own rejection, so it never passes through GlobalExceptionHandler —
    // which left the app's only real 429 with an empty body and no Retry-After, and made the
    // handler's own 429 branch dead code. Emit the standard error envelope here instead.
    options.OnRejected = async (context, cancellationToken) =>
    {
        var http = context.HttpContext;
        var traceId = http.Items[CorrelationIdMiddleware.ItemsKey]?.ToString() ?? http.TraceIdentifier;

        var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var window)
            ? (int)window.TotalSeconds
            : 30;
        http.Response.Headers.RetryAfter = retryAfter.ToString();

        http.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("GrainOriginatorPortal.Api.RateLimiting")
            .LogWarning(
                "Rate limit exceeded [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {Method} {Path} → 429",
                traceId, "RATE_LIMIT_EXCEEDED", "Security", http.Request.Method, http.Request.Path.Value);

        await http.Response.WriteAsJsonAsync(new ApiErrorResponse
        {
            Error = new ApiErrorBody
            {
                Code = "RATE_LIMIT_EXCEEDED",
                Message = "Too many requests. Please wait a moment and try again.",
                TraceId = traceId,
                Timestamp = DateTime.UtcNow.ToString("O"),
                Instance = http.Request.Path.Value
            }
        }, cancellationToken);
    };
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

// Record which build is serving, so App Insights can tie a request or an error back to an exact
// commit and workflow run. Stamped by CI via Directory.Build.props; reads "local" on a dev box.
app.Logger.LogInformation(
    "Origination API starting. Release {ReleaseVersion}, build {CommitSha} (#{BuildNumber}), environment {Environment}.",
    GrainOriginatorPortal.Api.Controllers.WhatsNewController.Releases.Value.FirstOrDefault()?.Version ?? "none",
    BuildInfo.CommitSha,
    BuildInfo.BuildNumber,
    app.Environment.EnvironmentName);

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
            var entDb = scope.ServiceProvider.GetRequiredService<TradeUnitPreferencesDbContext>();
            await Task.WhenAll(
                odsDb.Database.OpenConnectionAsync(),
                appDb.Database.OpenConnectionAsync(),
                entDb.Database.OpenConnectionAsync()
            );
            app.Logger.LogInformation("DB connections warmed up successfully.");

            // No commodity sync runs here, and there is no longer one to run. dbo.Commodities is
            // hand-curated (Code/Name/Category plus Tier1/Tier2/Tier3/BaseUOM, none of which a scan of
            // ODS contracts could supply), so the repository's ODS-scanning SyncAsync was never wired to
            // anything and has been removed. The Dev-only POST /api/diagnostics/commodities/seed endpoint
            // remains for a one-time backfill; it has always carried its own query rather than calling
            // that method.
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

// Reports which source (ODS or CTRM) actually served each response's contract and ticket data, as
// X-Data-Source* headers visible in the browser's Network tab. The two sources are mapped to look
// identical in the response body, so without this there is no way to confirm from the client which
// one you are looking at. Non-production only — diagnostic detail with no place in a prod response.
if (!app.Environment.IsProduction())
    app.UseMiddleware<CtrmProvenanceMiddleware>();

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
