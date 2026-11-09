// Microsoft namespaces
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics.Interfaces;
using GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics.Repositories;

namespace GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics;

/// <summary>
/// The Usage Analytics module's repository: the usage dashboard's reads of the tracking tables Platform writes, the
/// manager directory, and the excluded users. <c>AddUsageAnalyticsModule</c> in the Api calls this.
/// </summary>
public static class UsageAnalyticsInfrastructure
{
    public static IServiceCollection AddUsageAnalyticsInfrastructure(this IServiceCollection services)
    {
        services.AddScoped<IUsageRepository, UsageRepository>();
        return services;
    }
}
