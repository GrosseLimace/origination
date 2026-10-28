using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Admin usage-dashboard read models — adoption summary, per-user tables, daily/weekly
/// trends, feature/activity breakdowns, query-library usage, and the per-user drill-down.
/// All aggregation lives here; the controller is a thin pass-through.
/// <para>
/// Date windows are calendar dates in UTC: a request for <c>from</c>..<c>to</c> covers
/// <c>[from 00:00Z, to+1day 00:00Z)</c>, so <c>from == to</c> is a single full day. Using
/// <see cref="DateOnly"/> rather than <see cref="DateTime"/> keeps the boundary independent of the
/// server's local timezone.
/// </para><para>
/// <c>managerId</c> (a short name from <see cref="GetManagersAsync"/>) narrows the user universe
/// to that manager's entire org subtree, manager included; null is the whole organisation. It is
/// the dashboard's only filter — the dashboard is organised by reporting line, not by trade unit.
/// Unknown ids yield empty results; a TradeUnitPreferences outage while a manager filter is
/// active surfaces as a 503.
/// </para></summary>
public interface IUsageDashboardService
{
    Task<UsageDashboardSummaryDto> GetSummaryAsync(DateOnly from, DateOnly to, string? managerId, CancellationToken cancellationToken);
    Task<List<UsageDashboardUserDto>> GetUsersAsync(DateOnly from, DateOnly to, string? managerId, string? status, CancellationToken cancellationToken);
    Task<List<DailyActiveDto>> GetDailyActiveAsync(DateOnly from, DateOnly to, string? managerId, CancellationToken cancellationToken);
    Task<List<FeatureSessionsDto>> GetFeatureSessionsAsync(DateOnly from, DateOnly to, string? managerId, string? screen, CancellationToken cancellationToken);

    /// <summary>Login trend for the most recent <paramref name="weeks"/> calendar weeks (Monday-start).
    /// Deliberately independent of the dashboard's date filter — it is a trend view, not a window view.</summary>
    Task<List<WeeklyTrendDto>> GetWeeklyTrendAsync(string? managerId, int weeks, CancellationToken cancellationToken);

    Task<List<ActivityBreakdownDto>> GetActivityBreakdownAsync(DateOnly from, DateOnly to, string? managerId, CancellationToken cancellationToken);

    Task<List<UnderusedFeatureDto>> GetUnderusedFeaturesAsync(DateOnly from, DateOnly to, string? managerId, CancellationToken cancellationToken);
    Task<List<QueryLibraryUsageDto>> GetQueryLibraryUsageAsync(DateOnly from, DateOnly to, string? managerId, CancellationToken cancellationToken);
    Task<List<QuerySearchGapDto>> GetQuerySearchGapsAsync(DateOnly from, DateOnly to, string? managerId, CancellationToken cancellationToken);

    /// <summary>Active managers for the manager filter, name-sorted with report counts.
    /// 503 when the TradeUnitPreferences DB is unreachable (fail closed; see <see cref="UsageManagerDto"/>).</summary>
    Task<List<UsageManagerDto>> GetManagersAsync(CancellationToken cancellationToken);

    /// <summary>Per-user drill-down. Returns null when the user is not in the dashboard's user universe.</summary>
    Task<UserUsageDetailDto?> GetUserDetailAsync(string userId, DateOnly from, DateOnly to, CancellationToken cancellationToken);

    // ── Excluded-users administration ──

    /// <summary>The people who can sign in to the app (Entra access-group members) for the exclusion
    /// picker. Available=false when the group can't be read, so the client falls back to free-text.</summary>
    Task<AccessUsersDto> GetAccessUsersAsync(CancellationToken cancellationToken);

    Task<List<ExcludedUserDto>> GetExcludedUsersAsync(CancellationToken cancellationToken);

    /// <summary>Adds an exclusion, normalizing the id to its short name. Returns null when the user
    /// is already excluded.</summary>
    Task<ExcludedUserDto?> AddExcludedUserAsync(string userId, string? reason, string createdBy, CancellationToken cancellationToken);

    /// <summary>Removes an exclusion by id. Returns false when no such row exists.</summary>
    Task<bool> RemoveExcludedUserAsync(int id, CancellationToken cancellationToken);
}
