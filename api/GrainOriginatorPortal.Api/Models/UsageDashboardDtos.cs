namespace GrainOriginatorPortal.Api.Models;

public record UsageDashboardSummaryDto
{
    public double AdoptionRate { get; set; }
    public double AvgLoginsPerWeek { get; set; }
    public double AvgSessionMinutes { get; set; }
    public int TotalUsers { get; set; }
    // Recency tiers (current snapshot): Active used today · Light Usage within 7 days · Dormant longer · Never logged in.
    public int ActiveUsers { get; set; }
    public int LightUsageUsers { get; set; }
    public int DormantUsers { get; set; }
    public int NeverUsers { get; set; }
    public int NeedsAttentionCount { get; set; }
}

public record UsageDashboardUserDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int LoginCount { get; set; }
    public DateTime? LastActive { get; set; }
    public double AvgSessionMinutes { get; set; }
    // Active / Light Usage / Dormant / Never (recency snapshot).
    public string Status { get; set; } = string.Empty;
    public int CustomersContacted { get; set; }
    public int NotesCreated { get; set; }
}

public record DailyActiveDto
{
    public string Date { get; set; } = string.Empty;
    public int UniqueUserCount { get; set; }
}

public record FeatureSessionsDto
{
    public string FeatureCode { get; set; } = string.Empty;
    public string FeatureLabel { get; set; } = string.Empty;
    /// <summary>Time spent on this screen, in minutes.</summary>
    public int ScreenMinutes { get; set; }
    public List<SubFeatureSessionDto> SubFeatures { get; set; } = [];
}

public record SubFeatureSessionDto
{
    public string SubFeatureCode { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    /// <summary>Number of times this sub-feature was used — a count of events, not a duration.</summary>
    public int InteractionCount { get; set; }
}

public record WeeklyTrendDto
{
    public string WeekStart { get; set; } = string.Empty;
    /// <summary>Distinct users with at least one session that week.</summary>
    public int ActiveUsers { get; set; }
    public int TotalSessions { get; set; }
}

public record ActivityBreakdownDto
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

public record UnderusedFeatureDto
{
    public string FeatureCode { get; set; } = string.Empty;
    public string FeatureName { get; set; } = string.Empty;
    /// <summary>Distinct users who touched the feature in the window — the adoption measure the
    /// panel is actually ranking on.</summary>
    public int UniqueUsers { get; set; }
}

/// <summary>A row of dbo.UsageDashboardExcludedUsers, for the admin management panel.</summary>
public record ExcludedUserDto
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public string? Reason { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

/// <summary>A person who can sign in to the app (member of the Entra access group), for the
/// exclusion picker. <see cref="UserId"/> is the short name (UPN before '@') — the exclusion key.</summary>
public record AccessUserDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
}

/// <summary>The access-group roster for the exclusion picker. <see cref="Available"/> is false when
/// the group can't be read (Graph not configured/blocked) — the client then falls back to free-text
/// entry so exclusions can still be managed.</summary>
public record AccessUsersDto
{
    public bool Available { get; set; }
    public List<AccessUserDto> Users { get; set; } = [];
}

/// <summary>An active manager (has ≥1 active report in vw_UserManagerLookup) for the dashboard's
/// manager filter. <see cref="UserId"/> is the short name (UPN before '@'). Unlike
/// <see cref="AccessUsersDto"/> there is no Available flag: a TradeUnitPreferences outage fails
/// closed as a 503, because silently widening "Manager: X" to the whole org would misrepresent
/// the data, while the exclusion picker merely degrades to free-text entry.</summary>
public record UsageManagerDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int DirectReports { get; set; }

    /// <summary>Everyone under this manager at any depth, excluding the manager. Directory count —
    /// may include users who never appear on the dashboard (no app access).</summary>
    public int TotalReports { get; set; }
}

/// <summary>Whether the caller is on the exclusion-manager allowlist — the client uses this to show
/// or hide the exclusion gear. The endpoints enforce the same check server-side regardless.</summary>
public record ExclusionPermissionsDto
{
    public bool CanManage { get; set; }
}

public record QueryLibraryUsageDto
{
    public string QueryText { get; set; } = string.Empty;
    public int TimesUsed { get; set; }
}

public record QuerySearchGapDto
{
    public string SearchText { get; set; } = string.Empty;
    public int TimesSearched { get; set; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-user drill-down DTOs (UsageDashboardController.GetUserDetail)
// ─────────────────────────────────────────────────────────────────────────────

public record UserUsageDetailDto
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
    public DailyRecapEngagementDto DailyRecap { get; set; } = new();
    public List<ScreenTimeDto> TimePerScreen { get; set; } = [];
    public List<RecentActivityDto> RecentActivity { get; set; } = [];
}

public record UserDailyActivityDto
{
    public string Date { get; set; } = string.Empty;
    public int EventCount { get; set; }
    public double ScreenMinutes { get; set; }
}

public record CustomerEngagementDto
{
    public int ProfilesViewed { get; set; }
    public int ContractsExpanded { get; set; }
    public int CallsClicked { get; set; }
    public int EmailsClicked { get; set; }
    public int NotesCreated { get; set; }
    public int NotesEdited { get; set; }
    public int NotesDeleted { get; set; }
    /// <summary>Pin and unpin combined — the interesting signal is that pinning is used at all.</summary>
    public int NotesPinned { get; set; }
    public int MentionsUsed { get; set; }
    public int PlantingIntentionsAdded { get; set; }
    public int ProducerDetailsEdited { get; set; }
    public int TicketDropdownOpens { get; set; }
    public int StorageDropdownOpens { get; set; }
    public int PlantingTabClicks { get; set; }
    /// <summary>The single producer this user interacted with most in the window. Null if no customer-targeted events. </summary>
    public TopProducerDto? TopProducer { get; set; }
}

public record TopProducerDto
{
    public long CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string? ScoularId { get; set; }
    public int InteractionCount { get; set; }
}

public record BuildListEngagementDto
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

public record TopLibraryQueryDto
{
    public string QueryName { get; set; } = string.Empty;
    public int TimesUsed { get; set; }
}

public record InsightsEngagementDto
{
    public int UnconfirmedContractsClicks { get; set; }
    public int SpotLoadsClicks { get; set; }
    public int UnshippedBushelsClicks { get; set; }
    public int OtherCategoryClicks { get; set; }
}

public record BidSheetEngagementDto
{
    public int LocationsAdded { get; set; }
    public int LocationsDeleted { get; set; }
    public int LocationsSelected { get; set; }
    public int CommoditiesAdded { get; set; }
    public int BidsChanged { get; set; }
    public int EditBidsOpens { get; set; }
    public int ReferenceSet { get; set; }
    /// <summary>The single location whose bids were edited the most in the window. Null if no bids-changed events have a location attached.</summary>
    public TopBidLocationDto? MostEditedLocation { get; set; }
    /// <summary>Top edited locations sorted desc by edit count. Up to 5 entries.</summary>
    public List<TopBidLocationDto> TopEditedLocations { get; set; } = [];
}

public record TopBidLocationDto
{
    public string LocationName { get; set; } = string.Empty;
    public int EditCount { get; set; }
}

public record PlantingDashEngagementDto
{
    public int ByCropTabClicks { get; set; }
    public int ProducersTabClicks { get; set; }
    public int HarvestContractsTabClicks { get; set; }
    public int ProducerRowClicks { get; set; }
    public int SeasonTargetsSaved { get; set; }
}

public record DailyRecapEngagementDto
{
    public int GroupsCreated { get; set; }
    public int GroupsUpdated { get; set; }
    public int GroupsDeleted { get; set; }
    /// <summary>Enable and disable combined.</summary>
    public int EnableToggles { get; set; }
    public int ScreenVisits { get; set; }
}

public record ScreenTimeDto
{
    public string FeatureCode { get; set; } = string.Empty;
    public string FeatureLabel { get; set; } = string.Empty;
    public int Minutes { get; set; }
}

public record RecentActivityDto
{
    public DateTime Timestamp { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string FeatureCode { get; set; } = string.Empty;
    public string? SubFeatureCode { get; set; }
    public string? TargetId { get; set; }
    /// <summary>Resolved display string for TargetId (e.g., customer name + code, library prompt name). Null when no resolution applies.</summary>
    public string? TargetName { get; set; }
}
