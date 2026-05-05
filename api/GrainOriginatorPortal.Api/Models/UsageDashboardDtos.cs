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

// ─────────────────────────────────────────────────────────────────────────────
// Per-user drill-down DTOs (UsageDashboardController.GetUserDetail)
// ─────────────────────────────────────────────────────────────────────────────

public class UserUsageDetailDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime? LastActive { get; set; }
    public int LoginCount { get; set; }
    public double AvgSessionMinutes { get; set; }
    public double TotalAppMinutes { get; set; }
    public int CustomersContactedCount { get; set; }

    public List<UserDailyActivityDto> DailyActivity { get; set; } = [];
    public CustomerEngagementDto Customers { get; set; } = new();
    public BuildListEngagementDto BuildList { get; set; } = new();
    public InsightsEngagementDto Insights { get; set; } = new();
    public BidSheetEngagementDto BidSheet { get; set; } = new();
    public PlantingDashEngagementDto PlantingDashboard { get; set; } = new();
    public List<ScreenTimeDto> TimePerScreen { get; set; } = [];
    public List<RecentActivityDto> RecentActivity { get; set; } = [];
}

public class UserDailyActivityDto
{
    public string Date { get; set; } = string.Empty;
    public int EventCount { get; set; }
    public double ScreenMinutes { get; set; }
}

public class CustomerEngagementDto
{
    public int ProfilesViewed { get; set; }
    public int ContractsExpanded { get; set; }
    public int CallsClicked { get; set; }
    public int EmailsClicked { get; set; }
    public int NotesCreated { get; set; }
    public int PlantingIntentionsAdded { get; set; }
    public int ProducerDetailsEdited { get; set; }
    public int TicketDropdownOpens { get; set; }
    public int StorageDropdownOpens { get; set; }
    public int PlantingTabClicks { get; set; }
}

public class BuildListEngagementDto
{
    public int ListsSaved { get; set; }
    public int ListsLoaded { get; set; }
    public int ListsDeleted { get; set; }
    public int LibraryPromptsClicked { get; set; }
    public int LibrarySearchNoMatch { get; set; }
    public int QueryRequestsSubmitted { get; set; }
    public int MembersAdded { get; set; }
    public int MembersExcluded { get; set; }
    public int RefineFiltersOpens { get; set; }
    public int ManageMembersOpens { get; set; }
    public List<TopLibraryQueryDto> TopLibraryQueries { get; set; } = [];
}

public class TopLibraryQueryDto
{
    public string QueryName { get; set; } = string.Empty;
    public int TimesUsed { get; set; }
}

public class InsightsEngagementDto
{
    public int UnconfirmedContractsClicks { get; set; }
    public int SpotLoadsClicks { get; set; }
    public int UnshippedBushelsClicks { get; set; }
    public int OtherCategoryClicks { get; set; }
}

public class BidSheetEngagementDto
{
    public int LocationsAdded { get; set; }
    public int LocationsDeleted { get; set; }
    public int LocationsSelected { get; set; }
    public int CommoditiesAdded { get; set; }
    public int BidsChanged { get; set; }
    public int EditBidsOpens { get; set; }
    public int ReferenceSet { get; set; }
}

public class PlantingDashEngagementDto
{
    public int ByCropTabClicks { get; set; }
    public int ProducersTabClicks { get; set; }
    public int HarvestContractsTabClicks { get; set; }
    public int ProducerRowClicks { get; set; }
    public int SeasonTargetsSaved { get; set; }
}

public class ScreenTimeDto
{
    public string FeatureCode { get; set; } = string.Empty;
    public string FeatureLabel { get; set; } = string.Empty;
    public int Minutes { get; set; }
}

public class RecentActivityDto
{
    public DateTime Timestamp { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string FeatureCode { get; set; } = string.Empty;
    public string? SubFeatureCode { get; set; }
    public string? TargetId { get; set; }
}
