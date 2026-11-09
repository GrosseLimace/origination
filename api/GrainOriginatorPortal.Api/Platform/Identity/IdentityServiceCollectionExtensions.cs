// Azure namespaces
using Azure.Identity;

// Microsoft namespaces
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.Identity.Web;

// Polly namespaces
using Polly;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Middleware;

namespace GrainOriginatorPortal.Api.Platform.Identity;

public static class IdentityServiceCollectionExtensions
{
    /// <summary>
    /// Sign-in: Entra ID bearer tokens on every request (security-guide.md §4.1, configured by the "AzureAd"
    /// section), the authorization services, and the signed-in user's request context and trade-unit entitlements.
    /// </summary>
    public static IServiceCollection AddSignIn(this IServiceCollection services, IConfiguration configuration)
    {
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
        services.AddMicrosoftIdentityWebApiAuthentication(configuration)
            .EnableTokenAcquisitionToCallDownstreamApi()
            // In-memory is right for this: tokens are per-user and short-lived, a cold instance simply
            // re-exchanges, and a distributed cache would be new infrastructure for no correctness gain.
            .AddInMemoryTokenCaches();
        // Every endpoint needs a signed-in user (MapControllers().RequireAuthorization() in Program.cs). An
        // endpoint that needs more names a permission with [RequirePermission]; AddAccess registers a policy per
        // permission. No policy names a role.
        services.AddAuthorization();
        // Audit authorization denials where the framework decides them. The authorization middleware
        // short-circuits on a failed [Authorize] without calling the rest of the pipeline, so
        // SecurityAuditMiddleware (which reads the final status code downstream) never saw the ordinary
        // 401/403s it exists to log. This handler logs and then delegates to the default behaviour.
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, AuthorizationAuditResultHandler>();

        services.AddScoped<IUserEntitlementService, UserEntitlementService>();

        // Hook JWT bearer events to log token validation failures per security-guide.md §8.1.
        // OnAuthenticationFailed fires when the token is present but invalid (bad signature,
        // expired, wrong audience, etc.). This is more specific than SecurityAuditMiddleware's
        // generic 401 log — it captures the exact validation error reason.
        services.Configure<JwtBearerOptions>(
            JwtBearerDefaults.AuthenticationScheme,
            options =>
            {
                options.Events ??= new JwtBearerEvents();

                var previousOnFailed = options.Events.OnAuthenticationFailed;
                options.Events.OnAuthenticationFailed = async context =>
                {
                    var logger = context.HttpContext.RequestServices
                        .GetRequiredService<ILogger<JwtBearerHandler>>();
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
        services.PostConfigure<JwtBearerOptions>(
            JwtBearerDefaults.AuthenticationScheme,
            options =>
            {
                var clientId = configuration["AzureAd:ClientId"];
                if (!string.IsNullOrEmpty(clientId))
                {
                    options.TokenValidationParameters.ValidAudiences =
                    [
                        clientId,
                        $"api://{clientId}"
                    ];
                }
            });

        // Request-scoped helpers (current-user + trace id) read from HttpContext.
        services.AddScoped<IRequestContextService, RequestContextService>();

        return services;
    }

    /// <summary>
    /// The Microsoft Graph directory as the app itself sees it: the Graph client and its "graph" HttpClient, and
    /// the cached set of people who can sign in to the app. Needs <c>CorrelationIdOutboundHandler</c>, which
    /// AddPlatform registers.
    /// </summary>
    public static IServiceCollection AddDirectory(this IServiceCollection services)
    {
        // Graph directory client (app-access spike) — singleton so the cached Graph token is shared.
        // Credential split mirrors the Key Vault bootstrap at the top of Program.cs: managed identity
        // on App Service, the developer's own credential locally (skip the IMDS probe).
        services.AddSingleton<IGraphDirectoryClient>(sp =>
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
        services.AddSingleton<IAppAccessService, AppAccessService>();

        // Microsoft Graph (app-access spike): same resilience shape as nominatim, but only 2 retries —
        // when the NSG blocks graph.microsoft.com egress every attempt fails by timeout, and the
        // diagnostic should answer quickly. Auth is per-request bearer from GraphDirectoryClient
        // (token failures must surface as TokenFailure, not be retried by this pipeline).
        services.AddHttpClient("graph", client =>
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

        return services;
    }
}
