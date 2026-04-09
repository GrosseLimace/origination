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

export interface ExampleQueryUsage {
  queryText: string;
  timesUsed: number;
}

export interface ClickEventRequest {
  eventType: string;
  featureCode: string;
  subFeatureCode?: string;
  targetId?: string;
}
