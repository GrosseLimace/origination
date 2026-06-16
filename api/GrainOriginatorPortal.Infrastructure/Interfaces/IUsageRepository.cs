using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Read access to the usage-tracking tables (UserActivity, UserSession, UserClickEvent,
/// FeatureUsageDaily, UserTradeUnitSnapshot) plus the customer/contract/query-library lookups the
/// usage dashboard needs to resolve ids to names. Aggregations stay in SQL where the original
/// controller had them; methods return small projection records that the service maps to DTOs.
/// </summary>
public interface IUsageRepository
{
    // ── Identity / snapshot ──
    Task<List<string>> GetSnapshotUserIdsAsync(IReadOnlyCollection<string>? tradeUnitCodes, CancellationToken cancellationToken);
    Task<List<UserDisplayName>> GetDisplayNamesAsync(IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);

    // ── Activities ──
    Task<List<string>> GetActiveUserIdsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserActivityDay>> GetActivityDayUserPairsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserLastActivity>> GetLastActivityByUserAsync(DateTime? fromUtc, DateTime? toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserCount>> GetNotesCreatedCountsByUserAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken);
    Task<List<FeatureCount>> GetNotesCreatedCountsByFeatureAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserActivityBreakdown>> GetActivityBreakdownByUserAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<DateTime?> GetLastActivityForUserAsync(string userId, CancellationToken cancellationToken);
    Task<List<UserActivityRow>> GetActivitiesForUserAsync(string userId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken);

    // ── Sessions ──
    Task<List<int>> GetSessionDurationsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserSessionStats>> GetSessionStatsByUserAsync(DateTime? fromUtc, DateTime? toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserLoginTime>> GetSessionLoginTimesAsync(DateTime sinceUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<int>> GetSessionDurationsForUserAsync(string userId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken);

    // ── Click events ──
    Task<List<UserCount>> GetContactCountsByUserAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken);
    Task<List<ScreenEnterEvent>> GetScreenEnterEventsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<FeatureSubFeatureCount>> GetInteractionCountsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, string? screen, CancellationToken cancellationToken);
    Task<List<ClickBreakdownRow>> GetClickBreakdownRowsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserClickRow>> GetClicksForUserAsync(string userId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken);
    Task<List<TargetCount>> GetLibraryQueryUsageAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<QuerySearchGapRow>> GetQuerySearchGapsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);

    // ── Daily aggregates ──
    Task<List<FeatureCount>> GetFeatureSessionTotalsAsync(DateOnly fromDate, DateOnly toDate, CancellationToken cancellationToken);

    // ── Name lookups ──
    Task<Dictionary<string, string>> GetQueryLibraryNamesAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken);
    Task<CustomerNameSnapshot?> GetCustomerNameAsync(long customerId, CancellationToken cancellationToken);
    Task<Dictionary<string, string>> GetCustomerDisplayNamesAsync(IReadOnlyCollection<long> ids, CancellationToken cancellationToken);
    Task<Dictionary<string, string>> GetContractDisplayNamesAsync(IReadOnlyCollection<long> ids, CancellationToken cancellationToken);

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

    /// <summary>Upserts the per-user weekly login rollup (WeeklyLoginAggregate) for the given week.</summary>
    Task AggregateWeeklyLoginsAsync(DateOnly weekStart, CancellationToken cancellationToken);

    /// <summary>Rebuilds dbo.UserTradeUnitSnapshot from the Entitlements DB. Returns (unique entries written, raw rows read).</summary>
    Task<(int Unique, int Raw)> RefreshTradeUnitSnapshotAsync(CancellationToken cancellationToken);

    /// <summary>Deletes raw UserActivity/UserClickEvent rows older than the retention window. Returns (activities, clicks) deleted.</summary>
    Task<(int Activities, int Clicks)> CleanupUsageRetentionAsync(int retentionDays, CancellationToken cancellationToken);
}
