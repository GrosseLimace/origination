// System namespaces
using System.Threading.Channels;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Middleware;

namespace GrainOriginatorPortal.Api.Platform.Telemetry;

public static class TelemetryServiceCollectionExtensions
{
    /// <summary>
    /// Usage tracking (the request and click channels and the jobs that write and roll them up) and the browser's
    /// Application Insights settings.
    /// </summary>
    public static IServiceCollection AddUsageTelemetry(this IServiceCollection services, IConfiguration configuration)
    {
        // Usage tracking: bounded in-memory channel + background batch writer
        services.AddSingleton(Channel.CreateBounded<UserActivityRecord>(
            new BoundedChannelOptions(10_000)
            { FullMode = BoundedChannelFullMode.DropWrite }));
        services.AddSingleton(Channel.CreateBounded<UserClickEventRecord>(
            new BoundedChannelOptions(5_000)
            { FullMode = BoundedChannelFullMode.DropWrite }));
        services.AddHostedService<UsageTrackingBackgroundService>();
        services.AddHostedService<UsageAggregationBackgroundService>();

        // Read once: the connection string and the switch are app settings, which restart the app when changed.
        services.AddSingleton(ClientTelemetrySettings.From(configuration));

        return services;
    }
}
