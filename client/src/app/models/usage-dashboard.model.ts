export interface UsageDashboardSummary {
  adoptionRate: number;
  avgLoginsPerWeek: number;
  avgSessionMinutes: number;
  totalUsers: number;
  activeUsers: number;
  needsAttentionCount: number;
}

export interface UsageDashboardUser {
  userId: string;
  displayName: string;
  loginCount: number;
  lastActive: string | null;
  avgSessionMinutes: number;
  status: 'Active' | 'Inactive' | 'Never Logged In';
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
  sessionCount: number;
  subFeatures: SubFeatureSessions[];
}

export interface SubFeatureSessions {
  subFeatureCode: string;
  label: string;
  sessionCount: number;
}

export interface WeeklyTrend {
  weekStart: string;
  totalLogins: number;
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

export interface UsageDashboardInactiveUser {
  userId: string;
  displayName: string;
  daysSinceLastLogin: number | null;
  status: 'Inactive' | 'Never Logged In';
  avgSessionMinutes: number;
  loginCount: number;
}

export interface UnderusedFeature {
  featureName: string;
  sessionCount: number;
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
  status: 'Active' | 'Inactive' | 'Never Logged In';
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
