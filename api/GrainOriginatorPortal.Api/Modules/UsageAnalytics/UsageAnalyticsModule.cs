// Project namespaces
using GrainOriginatorPortal.Api.Modules.UsageAnalytics.Services;
using GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics;

namespace GrainOriginatorPortal.Api.Modules.UsageAnalytics;

/// <summary>
/// The Usage Analytics module: the usage dashboard and the accounts kept out of it. It reads what Platform's usage
/// tracking records, and names the customers, contracts and query-library prompts people used through the
/// Customers, Contracts and Lists modules. Its controllers are found by MVC; this registers what they depend on.
/// </summary>
public static class UsageAnalyticsModule
{
    public static IServiceCollection AddUsageAnalyticsModule(this IServiceCollection services)
    {
        services.AddUsageAnalyticsInfrastructure();

        services.AddScoped<IUsageDashboardService, UsageDashboardService>();
        // Scoped (not singleton like IAppAccessService) because it reads through the scoped
        // IUsageRepository/DbContext; the directory itself is shared via IMemoryCache.
        services.AddScoped<IManagerDirectoryService, ManagerDirectoryService>();
        // Generation stamp that lets an excluded-user edit invalidate the (scoped) dashboard service's
        // cached user universes process-wide. Singleton by necessity — see the type's remarks.
        services.AddSingleton<UsageUniverseCacheState>();
        return services;
    }
}
