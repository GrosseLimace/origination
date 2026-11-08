using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics.Interfaces;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Writes to the usage-tracking tables: the request and click events the tracking service records, the sessions they
/// extend, the daily and weekly rollups, the entitlements snapshot, and retention. The usage dashboard reads these
/// tables through <see cref="IUsageRepository"/>.
/// </summary>
public interface IUsageTelemetryRepository
{
    // ── Writes (usage-tracking background service) ──

    /// <summary>Persists a batch of user-activity + click-event rows in a single SaveChanges.</summary>
    Task AddActivitiesAndClicksAsync(IReadOnlyList<UserActivity> activities, IReadOnlyList<UserClickEvent> clicks, CancellationToken cancellationToken);

    /// <summary>For each user in the batch, extends their most-recent open session (within
    /// <paramref name="sessionGap"/>) or starts a new one. DB is the source of truth.</summary>
    Task ApplyActivitySessionsAsync(IReadOnlyList<UserActivity> activities, TimeSpan sessionGap, CancellationToken cancellationToken);

    // ── Aggregation jobs (usage-aggregation background service) ──

    /// <summary>Upserts the per-user daily activity rollup (UserActivityDaily) for the given date.</summary>
    Task AggregateUserActivityDailyAsync(DateOnly date, CancellationToken cancellationToken);

    /// <summary>Upserts the per-feature daily usage rollup (FeatureUsageDaily) for the given date.</summary>
    Task AggregateFeatureUsageDailyAsync(DateOnly date, CancellationToken cancellationToken);

    /// <summary>Upserts the per-user-per-feature daily rollup (UserFeatureUsageDaily) for the given date.</summary>
    Task AggregateUserFeatureUsageDailyAsync(DateOnly date, CancellationToken cancellationToken);

    /// <summary>Upserts the per-user weekly login rollup (WeeklyLoginAggregate) for the given week.</summary>
    Task AggregateWeeklyLoginsAsync(DateOnly weekStart, CancellationToken cancellationToken);

    /// <summary>Rebuilds dbo.UserTradeUnitSnapshot from the TradeUnitPreferences DB. Returns (unique entries written, raw rows read).</summary>
    Task<(int Unique, int Raw)> RefreshTradeUnitSnapshotAsync(CancellationToken cancellationToken);

    /// <summary>Deletes raw UserActivity/UserClickEvent rows older than the retention window, in
    /// batches. Returns (activities, clicks) deleted.</summary>
    Task<(int Activities, int Clicks)> CleanupUsageRetentionAsync(int retentionDays, CancellationToken cancellationToken);

    /// <summary>Deletes rollup rows older than the (much longer) rollup retention window, in
    /// batches. Returns the total rows deleted across the rollup tables.</summary>
    Task<int> CleanupRollupRetentionAsync(int rollupRetentionDays, CancellationToken cancellationToken);
}
