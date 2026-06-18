using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Admin usage-dashboard read models — adoption summary, per-user tables, daily/weekly
/// trends, feature/activity breakdowns, inactivity, query-library usage, and the per-user drill-down.
/// All aggregation lives here; the controller is a thin pass-through.</summary>
public interface IUsageDashboardService
{
    Task<UsageDashboardSummaryDto> GetSummaryAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken);
    Task<List<UsageDashboardUserDto>> GetUsersAsync(DateTime from, DateTime to, string? tradeUnitKey, string? status, CancellationToken cancellationToken);
    Task<List<DailyActiveDto>> GetDailyActiveAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken);
    Task<List<FeatureSessionsDto>> GetFeatureSessionsAsync(DateTime from, DateTime to, string? tradeUnitKey, string? screen, CancellationToken cancellationToken);
    Task<List<WeeklyTrendDto>> GetWeeklyTrendAsync(string? tradeUnitKey, CancellationToken cancellationToken);
    Task<List<ActivityBreakdownDto>> GetActivityBreakdownAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken);
    Task<List<UsageDashboardInactiveUserDto>> GetInactiveUsersAsync(DateTime from, DateTime to, string? tradeUnitKey, int daysThreshold, CancellationToken cancellationToken);
    Task<List<UnderusedFeatureDto>> GetUnderusedFeaturesAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken);
    Task<List<QueryLibraryUsageDto>> GetQueryLibraryUsageAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken);
    Task<List<QuerySearchGapDto>> GetQuerySearchGapsAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken);

    /// <summary>Per-user drill-down. Returns null when the user is not in the allowed (TU-filtered) set.</summary>
    Task<UserUsageDetailDto?> GetUserDetailAsync(string userId, DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken);
}
