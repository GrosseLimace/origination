using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Read access to the usage-tracking tables (UserActivity, UserSession, UserClickEvent,
/// UserActivityDaily, FeatureUsageDaily, UserFeatureUsageDaily, WeeklyLoginAggregate,
/// UserTradeUnitSnapshot) plus the customer/contract/query-library lookups the usage dashboard needs
/// to resolve ids to names. Aggregations stay in SQL; methods return small projection records that
/// the service maps to DTOs.
/// <para>
/// Methods named <c>…FromRollupAsync</c> read the pre-aggregated daily/weekly tables and cover
/// closed days only; the service pairs each with its raw-table counterpart for the current day.
/// </para>
/// </summary>
public interface IUsageRepository
{
    // ── Identity / snapshot ──
    Task<List<string>> GetSnapshotUserIdsAsync(IReadOnlyCollection<string>? tradeUnitCodes, CancellationToken cancellationToken);

    /// <summary>Short user names (UPN before the '@') kept OUT of the usage dashboard, from
    /// dbo.UsageDashboardExcludedUsers.</summary>
    Task<List<string>> GetExcludedUserIdsAsync(CancellationToken cancellationToken);
    Task<List<UserDisplayName>> GetDisplayNamesAsync(IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);

    // ── Excluded-users administration ──
    Task<List<ExcludedUserRow>> GetExcludedUsersAsync(CancellationToken cancellationToken);

    /// <summary>Adds an exclusion. Returns null when the user is already excluded (case-insensitive).</summary>
    Task<ExcludedUserRow?> AddExcludedUserAsync(string userId, string? reason, string createdBy, CancellationToken cancellationToken);

    /// <summary>Removes an exclusion by id. Returns false when no such row exists.</summary>
    Task<bool> RemoveExcludedUserAsync(int id, CancellationToken cancellationToken);

    // ── Activities ──
    Task<List<string>> GetActiveUserIdsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<DailyCount>> GetDailyActiveCountsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);

    /// <summary>Each user's most-recent activity across the full retained history — raw rows (recent,
    /// precise) unioned with the long-retention daily rollup — so status can tell a long-dormant user
    /// (logged in months ago) apart from one who never logged in. Window-independent.</summary>
    Task<List<UserLastActivity>> GetLastActiveByUserAsync(IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);

    /// <summary>Per user, the count of DISTINCT days with activity in the raw window (for active-days/week).</summary>
    Task<List<UserCount>> GetActiveDayCountsByUserAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserCount>> GetNotesCreatedCountsByUserAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<FeatureCount>> GetNotesCreatedCountsByFeatureAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserActivityBreakdown>> GetActivityBreakdownByUserAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserActivityRow>> GetActivitiesForUserAsync(string userId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken);

    // ── Sessions ──
    Task<List<UserSessionStats>> GetSessionStatsByUserAsync(DateTime? fromUtc, DateTime? toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserLoginTime>> GetSessionLoginTimesAsync(DateTime sinceUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<int>> GetSessionDurationsForUserAsync(string userId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken);

    // ── Click events ──
    Task<List<UserCount>> GetContactCountsByUserAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<ScreenEnterEvent>> GetScreenEnterEventsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<FeatureSubFeatureCount>> GetInteractionCountsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, string? screen, CancellationToken cancellationToken);
    Task<List<UserClickBreakdown>> GetClickBreakdownByUserAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);

    /// <summary>Distinct (feature, user) pairs from the raw tables. Covers both API activity and
    /// click events, so click-only features (the calculators hit no endpoint) are represented.</summary>
    Task<List<FeatureUser>> GetFeatureUsersAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserClickRow>> GetClicksForUserAsync(string userId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken);
    Task<List<TargetCount>> GetLibraryQueryUsageAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<QuerySearchGapRow>> GetQuerySearchGapsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);

    // ── Rollup reads (closed days) ──
    Task<List<string>> GetActiveUserIdsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);

    /// <summary>Per user, the count of active days (one rollup row = one active day) in the closed-day
    /// range — the rollup half of active-days/week.</summary>
    Task<List<UserCount>> GetActiveDayCountsByUserFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<DailyCount>> GetDailyActiveCountsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserSessionStats>> GetSessionStatsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<FeatureScreenTime>> GetFeatureScreenTimeFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<FeatureSubFeatureCount>> GetInteractionCountsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, string? screen, CancellationToken cancellationToken);
    Task<List<FeatureUser>> GetFeatureUsersFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<WeeklyRollup>> GetWeeklyLoginRollupAsync(DateOnly sinceWeekStart, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);

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

    /// <summary>Upserts the per-user-per-feature daily rollup (UserFeatureUsageDaily) for the given date.</summary>
    Task AggregateUserFeatureUsageDailyAsync(DateOnly date, CancellationToken cancellationToken);

    /// <summary>Upserts the per-user weekly login rollup (WeeklyLoginAggregate) for the given week.</summary>
    Task AggregateWeeklyLoginsAsync(DateOnly weekStart, CancellationToken cancellationToken);

    /// <summary>Rebuilds dbo.UserTradeUnitSnapshot from the Entitlements DB. Returns (unique entries written, raw rows read).</summary>
    Task<(int Unique, int Raw)> RefreshTradeUnitSnapshotAsync(CancellationToken cancellationToken);

    /// <summary>Deletes raw UserActivity/UserClickEvent rows older than the retention window, in
    /// batches. Returns (activities, clicks) deleted.</summary>
    Task<(int Activities, int Clicks)> CleanupUsageRetentionAsync(int retentionDays, CancellationToken cancellationToken);

    /// <summary>Deletes rollup rows older than the (much longer) rollup retention window, in
    /// batches. Returns the total rows deleted across the rollup tables.</summary>
    Task<int> CleanupRollupRetentionAsync(int rollupRetentionDays, CancellationToken cancellationToken);
}
