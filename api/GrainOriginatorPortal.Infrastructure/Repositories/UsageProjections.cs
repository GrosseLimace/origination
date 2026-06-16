namespace GrainOriginatorPortal.Infrastructure.Repositories;

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
public record ClickBreakdownRow(string UserId, string EventType, string FeatureCode, string? SubFeatureCode, string? TargetId);
public record UserClickRow(string EventType, string FeatureCode, string? SubFeatureCode, string? TargetId, DateTime Timestamp);
public record UserActivityRow(string? SubFeatureCode, string? HttpMethod);
public record TargetCount(string TargetId, int Count);
public record QuerySearchGapRow(string SearchText, int TimesSearched);
public record CustomerNameSnapshot(long CustomerId, string Name, string? ScoularId);
