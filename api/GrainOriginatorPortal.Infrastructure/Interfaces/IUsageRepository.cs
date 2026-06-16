using GrainOriginatorPortal.Infrastructure.Repositories;

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
}
