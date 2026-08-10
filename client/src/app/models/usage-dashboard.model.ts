/** Recency tiers (current snapshot): Active used today · Light Usage within 7 days · Dormant longer · Never logged in. */
export type UsageStatus = 'Active' | 'Light Usage' | 'Dormant' | 'Never';

export interface UsageDashboardSummary {
  adoptionRate: number;
  avgLoginsPerWeek: number;
  avgSessionMinutes: number;
  totalUsers: number;
  activeUsers: number;
  lightUsageUsers: number;
  dormantUsers: number;
  neverUsers: number;
  needsAttentionCount: number;
}

export interface UsageDashboardUser {
  userId: string;
  displayName: string;
  loginCount: number;
  lastActive: string | null;
  avgSessionMinutes: number;
  status: UsageStatus;
  customersContacted: number;
  notesCreated: number;
}

export interface DailyActive {
  date: string;
  uniqueUserCount: number;
}

export interface FeatureSessions {
  featureCode: string;
  featureLabel: string;
  /** Time spent on this screen, in minutes. */
  screenMinutes: number;
  subFeatures: SubFeatureSessions[];
}

export interface SubFeatureSessions {
  subFeatureCode: string;
  label: string;
  /** Number of times the sub-feature was used — a count of events, not a duration. */
  interactionCount: number;
}

export interface WeeklyTrend {
  weekStart: string;
  /** Distinct users with at least one session that week. */
  activeUsers: number;
  totalSessions: number;
}

export interface ActivityBreakdown {
  userId: string;
  displayName: string;
  profilesViewed: number;
  contractsViewed: number;
  notesTaken: number;
  callsEmails: number;
  listsBuilt: number;
  plantingIntentionsAdded: number;
  producerDetails: number;
}

export interface UnderusedFeature {
  featureCode: string;
  featureName: string;
  /** Distinct users who touched the feature in the window. */
  uniqueUsers: number;
}

/** A row of the usage-dashboard exclusion list (accounts hidden from every view). */
export interface ExcludedUser {
  id: number;
  userId: string;
  displayName: string | null;
  reason: string | null;
  createdBy: string;
  createdAt: string;
}

/** A person with app access (Entra access-group member), for the exclusion picker. */
export interface AccessUser {
  userId: string;      // short name (UPN before '@') — the exclusion key
  displayName: string;
}

/** The access-group roster for the exclusion picker. `available` is false when the group can't be
 *  read (Graph not configured/blocked) — the panel then falls back to free-text entry. */
export interface AccessUsers {
  available: boolean;
  users: AccessUser[];
}

/** Whether the signed-in user may manage the exclusion list (server-enforced allowlist). */
export interface ExclusionPermissions {
  canManage: boolean;
}

export interface QueryLibraryUsage {
  queryText: string;
  timesUsed: number;
}

export interface QuerySearchGap {
  searchText: string;
  timesSearched: number;
}

export interface ClickEventRequest {
  eventType: string;
  featureCode: string;
  subFeatureCode?: string;
  targetId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-user drill-down (UsageDashboardController.GetUserDetail)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserUsageDetail {
  userId: string;
  displayName: string;
  /** Same recency tier the dashboard list shows — both come from the shared backend classifier. */
  status: UsageStatus;
  lastActive: string | null;
  loginCount: number;
  avgSessionMinutes: number;
  totalAppMinutes: number;
  customersContactedCount: number;

  dailyActivity: UserDailyActivity[];
  customers: CustomerEngagement;
  buildList: BuildListEngagement;
  insights: InsightsEngagement;
  bidSheet: BidSheetEngagement;
  plantingDashboard: PlantingDashEngagement;
  dailyRecap: DailyRecapEngagement;
  timePerScreen: ScreenTime[];
  recentActivity: RecentActivity[];
}

export interface UserDailyActivity {
  date: string;
  eventCount: number;
  screenMinutes: number;
}

export interface CustomerEngagement {
  profilesViewed: number;
  contractsExpanded: number;
  callsClicked: number;
  emailsClicked: number;
  notesCreated: number;
  notesEdited: number;
  notesDeleted: number;
  /** Pin and unpin combined. */
  notesPinned: number;
  mentionsUsed: number;
  plantingIntentionsAdded: number;
  producerDetailsEdited: number;
  ticketDropdownOpens: number;
  storageDropdownOpens: number;
  plantingTabClicks: number;
  topProducer: TopProducer | null;
}

export interface TopProducer {
  customerId: number;
  customerName: string;
  scoularId: string | null;
  interactionCount: number;
}

export interface BuildListEngagement {
  listsSaved: number;
  listsLoaded: number;
  listsDeleted: number;
  libraryPromptsClicked: number;
  librarySearchNoMatch: number;
  queryRequestsSubmitted: number;
  membersAdded: number;
  membersExcluded: number;
  refineFiltersOpens: number;
  manageMembersOpens: number;
  topLibraryQueries: TopLibraryQuery[];
}

export interface TopLibraryQuery {
  queryName: string;
  timesUsed: number;
}

export interface InsightsEngagement {
  unconfirmedContractsClicks: number;
  spotLoadsClicks: number;
  unshippedBushelsClicks: number;
  otherCategoryClicks: number;
  /** Searches run on the Unshipped Bushels page (any of its three search boxes). */
  unshippedSearches: number;
  unshippedGroupsExpanded: number;
}

export interface BidSheetEngagement {
  locationsAdded: number;
  locationsDeleted: number;
  locationsSelected: number;
  commoditiesAdded: number;
  bidsChanged: number;
  editBidsOpens: number;
  referenceSet: number;
  mostEditedLocation: TopBidLocation | null;
  topEditedLocations: TopBidLocation[];
}

export interface TopBidLocation {
  locationName: string;
  editCount: number;
}

export interface PlantingDashEngagement {
  byCropTabClicks: number;
  producersTabClicks: number;
  harvestContractsTabClicks: number;
  producerRowClicks: number;
  seasonTargetsSaved: number;
}

export interface DailyRecapEngagement {
  groupsCreated: number;
  groupsUpdated: number;
  groupsDeleted: number;
  /** Enable and disable combined. */
  enableToggles: number;
  screenVisits: number;
}

export interface ScreenTime {
  featureCode: string;
  featureLabel: string;
  minutes: number;
}

export interface RecentActivity {
  timestamp: string;
  eventType: string;
  featureCode: string;
  subFeatureCode: string | null;
  targetId: string | null;
  /** Resolved display string for targetId (e.g., customer name + code, library prompt name). Null when no resolution applies. */
  targetName: string | null;
}
