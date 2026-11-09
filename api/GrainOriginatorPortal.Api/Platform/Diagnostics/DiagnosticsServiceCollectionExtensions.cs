namespace GrainOriginatorPortal.Api.Platform.Diagnostics;

/// <summary>
/// Registers the admin-tooling services behind <c>DiagnosticsController</c>. Each is scoped because it
/// holds request-scoped DbContexts or repositories; the only cross-request state (the "one background
/// geocode at a time" flag) is a static inside <see cref="ElevatorCacheDiagnosticsService"/>. The CTRM probes
/// (<see cref="ICtrmDiagnosticsService"/>) are registered by the Contracts module, which implements them.
/// </summary>
public static class DiagnosticsServiceCollectionExtensions
{
    public static IServiceCollection AddDiagnosticsServices(this IServiceCollection services)
    {
        services.AddScoped<ISchemaDiagnosticsService, SchemaDiagnosticsService>();
        services.AddScoped<ICommoditySeedService, CommoditySeedService>();
        services.AddScoped<IElevatorCacheDiagnosticsService, ElevatorCacheDiagnosticsService>();
        services.AddScoped<IUsageRollupBackfillService, UsageRollupBackfillService>();
        services.AddScoped<IAppAccessDiagnosticsService, AppAccessDiagnosticsService>();
        return services;
    }
}
