using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Platform.Telemetry;
using GrainOriginatorPortal.Infrastructure.Platform.Telemetry.Interfaces;

namespace GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics.Interfaces;

/// <summary>
/// Read access to the usage-tracking tables (UserActivity, UserSession, UserClickEvent,
/// UserActivityDaily, FeatureUsageDaily, UserFeatureUsageDaily, WeeklyLoginAggregate,
/// UserTradeUnitSnapshot), the excluded users and the manager directory, for the usage dashboard.
/// Aggregations stay in SQL; methods return small projection records that the service maps to DTOs.
/// The tracking service and the rollup jobs write these tables through <see cref="IUsageTelemetryRepository"/>.
/// <para>
/// Methods named <c>…FromRollupAsync</c> read the pre-aggregated daily/weekly tables and cover
/// closed days only; the service pairs each with its raw-table counterpart for the current day.
/// </para>
/// </summary>
public interface IUsageRepository
{
    // ── Identity / snapshot ──

    /// <summary>Every user id in the entitlements snapshot (dbo.UserTradeUnitSnapshot). Only the
    /// fallback universe, used when the Entra app-access set cannot be read.</summary>
    Task<List<string>> GetSnapshotUserIdsAsync(CancellationToken cancellationToken);

    /// <summary>Short user names (UPN before the '@') kept OUT of the usage dashboard, from
    /// dbo.UsageDashboardExcludedUsers.</summary>
    Task<List<string>> GetExcludedUserIdsAsync(CancellationToken cancellationToken);

    Task<List<UserDisplayName>> GetDisplayNamesAsync(IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);

    /// <summary>All rows of TradeUnitPreferences dbo.vw_UserManagerLookup (~1,150; one per user).
    /// The caller caches the list and computes subtrees in memory — the two databases can't be
    /// joined in SQL. SqlExceptions propagate for the service layer to map.</summary>
    Task<List<UserManagerRow>> GetUserManagerLookupAsync(CancellationToken cancellationToken);

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

    Task<List<DailyCount>> GetDailyActiveCountsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<UserSessionStats>> GetSessionStatsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<FeatureScreenTime>> GetFeatureScreenTimeFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<FeatureSubFeatureCount>> GetInteractionCountsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, string? screen, CancellationToken cancellationToken);
    Task<List<FeatureUser>> GetFeatureUsersFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
    Task<List<WeeklyRollup>> GetWeeklyLoginRollupAsync(DateOnly sinceWeekStart, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken);
}
