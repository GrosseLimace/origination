namespace GrainOriginatorPortal.Infrastructure.Abstractions;

// Small query-result projection shapes for the usage-dashboard aggregations. These are neither EF
// entities nor wire DTOs — they're the materialized output of the repository's GROUP BY queries,
// which the IUsageDashboardService maps onto the Api response DTOs.

public record UserDisplayName(string UserId, string? DisplayName);
public record UserLastActivity(string UserId, DateTime LastActive);
public record UserActivityDay(string UserId, DateTime Date);
public record UserSessionStats(string UserId, int LoginCount, double AvgDuration);
public record UserLoginTime(string UserId, DateTime LoginTime);
public record UserCount(string UserId, int Count);
public record FeatureCount(string FeatureCode, int Count);
public record UserActivityBreakdown(string UserId, int NotesTaken, int PlantingIntentionsAdded);
public record ScreenEnterEvent(string UserId, string FeatureCode, DateTime Timestamp);
public record FeatureSubFeatureCount(string FeatureCode, string? SubFeatureCode, int Count);
public record UserClickRow(string EventType, string FeatureCode, string? SubFeatureCode, string? TargetId, DateTime Timestamp);
public record UserActivityRow(string? SubFeatureCode, string? HttpMethod);
public record TargetCount(string TargetId, int Count);
public record QuerySearchGapRow(string SearchText, int TimesSearched);
public record CustomerNameSnapshot(long CustomerId, string Name, string? ScoularId);

/// <summary>Per-user interaction pivot for the activity-breakdown table, aggregated in SQL.
/// Profiles/contracts are distinct-by-target (opening the same producer 5 times = 1 viewed).</summary>
public record UserClickBreakdown(
    string UserId,
    int ProfilesViewed,
    int ContractsViewed,
    int CallsEmails,
    int ListsBuilt,
    int ProducerDetails);

/// <summary>A single day's count — used for the daily-active-users series.</summary>
public record DailyCount(DateOnly Date, int Count);

/// <summary>Per-week totals for the login-trend chart, from the weekly rollup.</summary>
public record WeeklyRollup(DateOnly WeekStart, int ActiveUsers, int SessionCount);

/// <summary>Minutes on screen per feature, from the per-user daily rollup.</summary>
public record FeatureScreenTime(string FeatureCode, double Minutes);

/// <summary>One (feature, user) pair. Returned rather than a count so the caller can union pairs
/// from several sources without double-counting a user who appears in more than one.</summary>
public record FeatureUser(string FeatureCode, string UserId);

/// <summary>A row of dbo.UsageDashboardExcludedUsers, for the admin management panel.</summary>
public record ExcludedUserRow(int Id, string UserId, string? Reason, string CreatedBy, DateTime CreatedAt);
