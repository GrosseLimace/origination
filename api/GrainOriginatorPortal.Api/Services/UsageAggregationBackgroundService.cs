using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Background service that runs periodic aggregation jobs:
/// 1. Daily user activity aggregation (UserActivityDaily)
/// 2. Daily feature usage aggregation (FeatureUsageDaily)
/// 3. Weekly login aggregation (WeeklyLoginAggregate)
/// 4. Trade unit snapshot refresh (UserTradeUnitSnapshot)
/// 5. Retention cleanup (90-day delete on raw tables)
/// Runs every hour; full daily run triggers for the previous day's data. The DB work lives in
/// IUsageRepository — this service only schedules and logs.
/// </summary>
public class UsageAggregationBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<UsageAggregationBackgroundService> _logger;
    private static readonly TimeSpan RunInterval = TimeSpan.FromHours(1);
    private const int RetentionDays = 90;

    public UsageAggregationBackgroundService(
        IServiceScopeFactory scopeFactory,
        ILogger<UsageAggregationBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("UsageAggregationBackgroundService started");

        // Wait 30 seconds on startup to let the app stabilize
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);

        // Run snapshot immediately on startup
        await RefreshTradeUnitSnapshotAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var yesterday = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));

                await RunInScopeAsync((repo, ct) => repo.AggregateUserActivityDailyAsync(yesterday, ct), stoppingToken);
                await RunInScopeAsync((repo, ct) => repo.AggregateFeatureUsageDailyAsync(yesterday, ct), stoppingToken);

                // Weekly aggregation: run if yesterday was Sunday (end of week)
                if (yesterday.DayOfWeek == DayOfWeek.Sunday)
                {
                    var weekStart = yesterday.AddDays(-6); // Monday
                    await RunInScopeAsync((repo, ct) => repo.AggregateWeeklyLoginsAsync(weekStart, ct), stoppingToken);
                }

                await RefreshTradeUnitSnapshotAsync(stoppingToken);
                await CleanupRetentionAsync(stoppingToken);

                _logger.LogInformation("Aggregation cycle completed for {Date}", yesterday);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during aggregation cycle");
            }

            await Task.Delay(RunInterval, stoppingToken);
        }

        _logger.LogInformation("UsageAggregationBackgroundService stopped");
    }

    private async Task RunInScopeAsync(Func<IUsageRepository, CancellationToken, Task> work, CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IUsageRepository>();
        await work(repo, cancellationToken);
    }

    private async Task RefreshTradeUnitSnapshotAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var repo = scope.ServiceProvider.GetRequiredService<IUsageRepository>();
            var (unique, raw) = await repo.RefreshTradeUnitSnapshotAsync(cancellationToken);
            _logger.LogInformation("Refreshed trade unit snapshot with {Count} unique entries (from {Raw} raw)", unique, raw);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to refresh trade unit snapshot");
        }
    }

    private async Task CleanupRetentionAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IUsageRepository>();
        var (deletedActivities, deletedClicks) = await repo.CleanupUsageRetentionAsync(RetentionDays, cancellationToken);

        if (deletedActivities > 0 || deletedClicks > 0)
        {
            _logger.LogInformation("Retention cleanup: deleted {Activities} activities and {Clicks} click events older than {Days} days",
                deletedActivities, deletedClicks, RetentionDays);
        }
    }
}
