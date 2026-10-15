using System.Threading.RateLimiting;
using GrainOriginatorPortal.Mobile.Auditing;
using GrainOriginatorPortal.Mobile.Authorization;
using GrainOriginatorPortal.Mobile.Filters;
using GrainOriginatorPortal.Mobile.Idempotency;
using GrainOriginatorPortal.Mobile.Storage;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace GrainOriginatorPortal.Mobile;

/// <summary>
/// One call from the host wires the whole mobile surface: options, the two authorization policies,
/// the desktop-access convention, the per-user rate-limit partition, extra JWT audiences, and the
/// scoped services the controllers need. The host still owns <c>AddControllers().AddApplicationPart(...)</c>.
/// </summary>
public static class MobileServiceCollectionExtensions
{
    public static IServiceCollection AddMobileSurface(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<MobileOptions>()
            .Bind(configuration.GetSection(MobileOptions.SectionName))
            .Validate(o => o.RateLimitPermitPerMinute > 0, "Mobile:RateLimitPermitPerMinute must be positive.")
            .ValidateOnStart();

        services.AddScoped<IAuditScope, AuditScope>();
        services.AddScoped<MobileAuditActionFilter>();
        services.AddSingleton<IIdempotencyStore, MemoryIdempotencyStore>();
        services.AddScoped<ITradeUnitStorageLookup, TradeUnitStorageLookup>();

        // Authorization policies. AddAuthorization in the host also configures AuthorizationOptions;
        // both Configure calls apply, so this is additive.
        services.AddOptions<AuthorizationOptions>()
            .Configure<IOptions<MobileOptions>>((options, mobile) =>
            {
                options.AddPolicy(MobileAccess.PolicyName, policy =>
                    policy.RequireAuthenticatedUser()
                          .RequireAssertion(ctx => MobileAccess.CanAccessMobileSurface(ctx.User, mobile.Value)));

                options.AddPolicy(MobileAccess.DesktopPolicyName, policy =>
                    policy.RequireAuthenticatedUser()
                          .RequireAssertion(ctx => MobileAccess.CanAccessDesktopSurface(ctx.User, mobile.Value)));
            });

        // Every non-mobile controller gets DesktopAccess on top of its own [Authorize].
        services.Configure<MvcOptions>(options => options.Conventions.Add(new DesktopAccessConvention()));

        // Per-user sliding window on api/mobile/v1. APIM's rate-limit-by-key is the primary control;
        // this is defence in depth and the only limit that applies in Dev (no APIM there).
        services.AddOptions<RateLimiterOptions>()
            .Configure<IOptions<MobileOptions>>((options, mobile) =>
            {
                options.AddPolicy(MobileAccess.RateLimitPolicyName, context =>
                    RateLimitPartition.GetSlidingWindowLimiter(
                        MobileAccess.GetObjectId(context.User)
                            ?? context.Connection.RemoteIpAddress?.ToString()
                            ?? "anonymous",
                        _ => new SlidingWindowRateLimiterOptions
                        {
                            PermitLimit = mobile.Value.RateLimitPermitPerMinute,
                            Window = TimeSpan.FromMinutes(1),
                            SegmentsPerWindow = 6,
                            QueueLimit = 0,
                        }));
            });

        // If Data Integrations forwards a token whose audience is APIM-owned rather than ours, the
        // configured extra audiences are accepted in addition to the host's own. Runs after the
        // host's PostConfigure because it is registered later.
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .PostConfigure<IOptions<MobileOptions>>((options, mobile) =>
            {
                var extra = mobile.Value.AdditionalAudiences.Where(a => !string.IsNullOrWhiteSpace(a)).ToArray();
                if (extra.Length == 0) return;

                var existing = options.TokenValidationParameters.ValidAudiences ?? [];
                options.TokenValidationParameters.ValidAudiences = existing.Concat(extra).Distinct().ToList();
            });

        services.AddSingleton<IStartupFilter, MobileStartupDiagnostics>();

        return services;
    }

    /// <summary>Logs the effective mobile configuration once at startup so a mis-set environment is visible immediately.</summary>
    private sealed class MobileStartupDiagnostics : IStartupFilter
    {
        private readonly IOptions<MobileOptions> _options;
        private readonly ILogger<MobileStartupDiagnostics> _logger;

        public MobileStartupDiagnostics(IOptions<MobileOptions> options, ILogger<MobileStartupDiagnostics> logger)
        {
            _options = options;
            _logger = logger;
        }

        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
        {
            var o = _options.Value;

            if (!o.SharedSignIn && o.RequiredScopes.Any(s => s.StartsWith("Origination.Application.", StringComparison.OrdinalIgnoreCase)))
            {
                // The desktop scope as the "mobile" scope without SharedSignIn makes every desktop token a mobile token,
                // which DesktopAccess then refuses: the whole desktop app would 403.
                _logger.LogError(
                    "Mobile:RequiredScopes is the desktop scope but Mobile:SharedSignIn is off, so DesktopAccess will refuse every desktop token. Turn SharedSignIn on, or use a separate mobile scope. [{ErrorCode}]",
                    "MOBILE_SCOPE_MISCONFIGURED");
            }

            if (o.RequiredScopes.Length == 0)
            {
                _logger.LogWarning(
                    "Mobile surface is DISABLED: Mobile:RequiredScopes is empty, so no token can satisfy the {Policy} policy. [{ErrorCode}]",
                    MobileAccess.PolicyName, "MOBILE_NOT_CONFIGURED");
            }
            else if (o.AllowedClientAppIds.Length == 0)
            {
                _logger.LogWarning(
                    "Mobile surface accepts any client carrying scopes [{Scopes}]: Mobile:AllowedClientAppIds is empty. Set it once the mobile app registrations exist. [{ErrorCode}]",
                    string.Join(", ", o.RequiredScopes), "MOBILE_CLIENT_CHECK_SKIPPED");
            }
            else
            {
                _logger.LogInformation(
                    "Mobile surface enabled: scopes [{Scopes}], clients [{Clients}], {Permits}/min per user, sign-in {SignIn}.",
                    string.Join(", ", o.RequiredScopes), string.Join(", ", o.AllowedClientAppIds), o.RateLimitPermitPerMinute,
                    o.SharedSignIn ? "shared with the desktop (Grain Vision model)" : "separate mobile registration");
            }

            return next;
        }
    }
}
