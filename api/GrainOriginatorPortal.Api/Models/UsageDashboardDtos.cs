namespace GrainOriginatorPortal.Api.Models;

public class UsageDashboardSummaryDto
{
    public double AdoptionRate { get; set; }
    public double AvgLoginsPerWeek { get; set; }
    public double AvgSessionMinutes { get; set; }
    public int TotalUsers { get; set; }
    public int ActiveUsers { get; set; }
    public int NeedsAttentionCount { get; set; }
}

public class UsageDashboardUserDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int LoginCount { get; set; }
    public DateTime? LastActive { get; set; }
    public double AvgSessionMinutes { get; set; }
    public string Status { get; set; } = string.Empty;
    public int CustomersContacted { get; set; }
    public int NotesCreated { get; set; }
}

public class DailyActiveDto
{
    public string Date { get; set; } = string.Empty;
    public int UniqueUserCount { get; set; }
}

public class FeatureSessionsDto
{
    public string FeatureCode { get; set; } = string.Empty;
    public string FeatureLabel { get; set; } = string.Empty;
    public int SessionCount { get; set; }
    public List<SubFeatureSessionDto> SubFeatures { get; set; } = [];
}

public class SubFeatureSessionDto
{
    public string SubFeatureCode { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public int SessionCount { get; set; }
}

public class WeeklyTrendDto
{
    public string WeekStart { get; set; } = string.Empty;
    public int TotalLogins { get; set; }
    public int TotalSessions { get; set; }
}

public class ActivityBreakdownDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int ProfilesViewed { get; set; }
    public int ContractsViewed { get; set; }
    public int NotesTaken { get; set; }
    public int CallsEmails { get; set; }
    public int ListsBuilt { get; set; }
    public int PlantingIntentionsAdded { get; set; }
    public int ProducerDetails { get; set; }
}

public class UsageDashboardInactiveUserDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int? DaysSinceLastLogin { get; set; }
    public string Status { get; set; } = string.Empty;
    public double AvgSessionMinutes { get; set; }
    public int LoginCount { get; set; }
}

public class UnderusedFeatureDto
{
    public string FeatureName { get; set; } = string.Empty;
    public int SessionCount { get; set; }
}

public class QueryLibraryUsageDto
{
    public string QueryText { get; set; } = string.Empty;
    public int TimesUsed { get; set; }
}

public class QuerySearchGapDto
{
    public string SearchText { get; set; } = string.Empty;
    public int TimesSearched { get; set; }
}

public class ClickEventRequest
{
    public string EventType { get; set; } = string.Empty;
    public string FeatureCode { get; set; } = string.Empty;
    public string? SubFeatureCode { get; set; }
    public string? TargetId { get; set; }
}
