// Project namespaces
using GrainOriginatorPortal.Api.Services.Diagnostics;

// Deliberately the parent namespace (not .Diagnostics): Program.cs already imports
// GrainOriginatorPortal.Api.Services, so the registration is the one line
// builder.Services.AddDiagnosticsServices(); with no new using. Same idea as
// Infrastructure/DependencyInjection.cs living in the root Infrastructure namespace.
namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Registers the admin-tooling services behind <c>DiagnosticsController</c>. Each is scoped because it
/// holds request-scoped DbContexts or repositories; the only cross-request state (the "one background
/// geocode at a time" flag) is a static inside <see cref="ElevatorCacheDiagnosticsService"/>.
/// </summary>
public static class DiagnosticsServiceCollectionExtensions
{
    public static IServiceCollection AddDiagnosticsServices(this IServiceCollection services)
    {
        services.AddScoped<ISchemaDiagnosticsService, SchemaDiagnosticsService>();
        services.AddScoped<ICtrmDiagnosticsService, CtrmDiagnosticsService>();
        services.AddScoped<ICommoditySeedService, CommoditySeedService>();
        services.AddScoped<IElevatorCacheDiagnosticsService, ElevatorCacheDiagnosticsService>();
        services.AddScoped<IUsageRollupBackfillService, UsageRollupBackfillService>();
        services.AddScoped<IAppAccessDiagnosticsService, AppAccessDiagnosticsService>();
        return services;
    }
}
