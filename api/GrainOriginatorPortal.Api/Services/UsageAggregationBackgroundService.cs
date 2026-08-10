using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Runs the usage-dashboard's periodic aggregation jobs: the daily rollups (UserActivityDaily,
/// FeatureUsageDaily, UserFeatureUsageDaily), the weekly login rollup, the entitlements snapshot
/// refresh, and retention cleanup. The DB work lives in IUsageRepository — this service only
/// schedules and logs.
/// <para>
/// The loop ticks hourly so a day's rollup lands soon after midnight and a failed attempt gets
/// retried within the hour, but each job tracks what it has already done: a day is aggregated once
/// (plus a re-run on the following tick to pick up anything the tracker flushed late), the snapshot
/// refreshes every few hours, and cleanup runs daily.
/// </para>
/// </summary>
public class UsageAggregationBackgroundService : BackgroundService
{
    private static readonly TimeSpan RunInterval = TimeSpan.FromHours(1);
    private static readonly TimeSpan SnapshotRefreshInterval = TimeSpan.FromHours(6);
    private static readonly TimeSpan CleanupInterval = TimeSpan.FromHours(24);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(30);

    /// <summary>Raw event tables. Long enough for the drill-downs, short enough to stay small.</summary>
    private const int RawRetentionDays = 90;

    /// <summary>Rollups are the only history past the raw window, so they're kept far longer.</summary>
    private const int RollupRetentionDays = 400;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<UsageAggregationBackgroundService> _logger;

    private DateOnly? _lastAggregatedDate;
    private DateTime _lastSnapshotRefreshUtc = DateTime.MinValue;
    private DateTime _lastCleanupUtc = DateTime.MinValue;

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

        // Let the app stabilize before touching the DB.
        await Task.Delay(StartupDelay, stoppingToken);

        // The dashboard's user universe comes from this snapshot, so seed it before serving.
        await RefreshTradeUnitSnapshotAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunCycleAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // Swallow and retry next tick — one bad cycle shouldn't kill the service.
                _logger.LogError(ex, "Error during aggregation cycle");
            }

            try
            {
                await Task.Delay(RunInterval, stoppingToken);
            }
            catch (OperationCanceledException) { break; }
        }

        _logger.LogInformation("UsageAggregationBackgroundService stopped");
    }

    private async Task RunCycleAsync(CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var yesterday = DateOnly.FromDateTime(now.AddDays(-1));

        // Aggregate a day once rather than every hour. The one exception is the first tick after
        // the date rolls over: the tracking service flushes on a 5-second timer, so a handful of
        // late-arriving rows can land after the first pass — re-running the previous day one extra
        // time picks those up. Aggregation is a full recompute, so re-running is safe.
        if (_lastAggregatedDate != yesterday)
        {
            await AggregateDayAsync(yesterday, cancellationToken);
            _lastAggregatedDate = yesterday;

            // Weekly rollup closes out on Monday, once the final day of the week is aggregated.
            if (yesterday.DayOfWeek == DayOfWeek.Sunday)
            {
                var weekStart = yesterday.AddDays(-6);
                await RunInScopeAsync((repo, ct) => repo.AggregateWeeklyLoginsAsync(weekStart, ct), cancellationToken);
                _logger.LogInformation("Aggregated weekly logins for week starting {WeekStart}", weekStart);
            }

            _logger.LogInformation("Aggregation cycle completed for {Date}", yesterday);
        }

        if (now - _lastSnapshotRefreshUtc >= SnapshotRefreshInterval)
            await RefreshTradeUnitSnapshotAsync(cancellationToken);

        if (now - _lastCleanupUtc >= CleanupInterval)
            await CleanupRetentionAsync(cancellationToken);
    }

    private async Task AggregateDayAsync(DateOnly date, CancellationToken cancellationToken)
    {
        await RunInScopeAsync((repo, ct) => repo.AggregateUserActivityDailyAsync(date, ct), cancellationToken);
        await RunInScopeAsync((repo, ct) => repo.AggregateFeatureUsageDailyAsync(date, ct), cancellationToken);
        await RunInScopeAsync((repo, ct) => repo.AggregateUserFeatureUsageDailyAsync(date, ct), cancellationToken);
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
            _lastSnapshotRefreshUtc = DateTime.UtcNow;
            _logger.LogInformation("Refreshed trade unit snapshot with {Count} unique entries (from {Raw} raw)", unique, raw);
        }
        catch (Exception ex)
        {
            // Leave _lastSnapshotRefreshUtc alone so the next tick retries instead of waiting hours.
            _logger.LogWarning(ex, "Failed to refresh trade unit snapshot");
        }
    }

    private async Task CleanupRetentionAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IUsageRepository>();

        var (deletedActivities, deletedClicks) = await repo.CleanupUsageRetentionAsync(RawRetentionDays, cancellationToken);
        var deletedRollups = await repo.CleanupRollupRetentionAsync(RollupRetentionDays, cancellationToken);
        _lastCleanupUtc = DateTime.UtcNow;

        if (deletedActivities > 0 || deletedClicks > 0 || deletedRollups > 0)
        {
            _logger.LogInformation(
                "Retention cleanup: deleted {Activities} activities and {Clicks} click events older than {RawDays} days, "
                + "plus {Rollups} rollup rows older than {RollupDays} days",
                deletedActivities, deletedClicks, RawRetentionDays, deletedRollups, RollupRetentionDays);
        }
    }
}
