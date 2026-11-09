import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { RecentActivity, UserDailyActivity, UserUsageDetail } from '@models';

import { UserUsageDetailComponent } from './user-usage-detail.component';

/**
 * The per-user drill-down fetches one UserUsageDetail and derives everything the template shows
 * from it: the recent-activity rows are partitioned by featureCode so each tab lists only its own
 * events, the daily chart needs a max for its bar scale, and "X of Y days active" is a count over
 * the window. None of that was covered; these tests pin the derivations down with concrete
 * fixtures built from the real model types so a model change breaks compilation here.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

function activity(over: Partial<RecentActivity> = {}): RecentActivity {
  return {
    timestamp: '2026-10-13T14:00:00Z',
    eventType: 'interaction',
    featureCode: 'customers',
    subFeatureCode: null,
    targetId: null,
    targetName: null,
    ...over,
  };
}

function day(date: string, eventCount: number, screenMinutes = 0): UserDailyActivity {
  return { date, eventCount, screenMinutes };
}

function makeDetail(over: Partial<UserUsageDetail> = {}): UserUsageDetail {
  return {
    userId: 'CEgr',
    displayName: 'Caden Egr',
    status: 'Active',
    lastActive: '2026-10-13T14:00:00Z',
    loginCount: 12,
    avgSessionMinutes: 9,
    totalAppMinutes: 108,
    customersContactedCount: 4,
    dailyActivity: [],
    customers: {
      profilesViewed: 0, contractsExpanded: 0, callsClicked: 0, emailsClicked: 0,
      notesCreated: 0, notesEdited: 0, notesDeleted: 0, notesPinned: 0, mentionsUsed: 0,
      plantingIntentionsAdded: 0, producerDetailsEdited: 0, ticketDropdownOpens: 0,
      storageDropdownOpens: 0, plantingTabClicks: 0, topProducer: null,
    },
    buildList: {
      listsSaved: 0, listsLoaded: 0, listsDeleted: 0, libraryPromptsClicked: 0,
      librarySearchNoMatch: 0, queryRequestsSubmitted: 0, membersAdded: 0, membersExcluded: 0,
      refineFiltersOpens: 0, manageMembersOpens: 0, topLibraryQueries: [],
    },
    insights: {
      unconfirmedContractsClicks: 0, spotLoadsClicks: 0, unshippedBushelsClicks: 0,
      otherCategoryClicks: 0, unshippedSearches: 0, unshippedGroupsExpanded: 0,
    },
    bidSheet: {
      locationsAdded: 0, locationsDeleted: 0, locationsSelected: 0, commoditiesAdded: 0,
      bidsChanged: 0, editBidsOpens: 0, referenceSet: 0, mostEditedLocation: null,
      topEditedLocations: [],
    },
    plantingDashboard: {
      byCropTabClicks: 0, producersTabClicks: 0, harvestContractsTabClicks: 0,
      producerRowClicks: 0, seasonTargetsSaved: 0,
    },
    dailyRecap: {
      groupsCreated: 0, groupsUpdated: 0, groupsDeleted: 0, enableToggles: 0, screenVisits: 0,
    },
    timePerScreen: [],
    recentActivity: [],
    ...over,
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface RouteStub {
  userId?: string;
  from?: string;
  to?: string;
}

interface Harness {
  component: UserUsageDetailComponent;
  getUserUsageDetail: ReturnType<typeof vi.fn<(userId: string, from: string, to: string) => Observable<UserUsageDetail>>>;
  navigate: ReturnType<typeof vi.fn<(commands: unknown[], extras?: unknown) => Promise<boolean>>>;
  toasts: { message: string; type: string }[];
}

function configure(detail$: Observable<UserUsageDetail>, route: RouteStub = { userId: 'CEgr' }): Harness {
  const getUserUsageDetail = vi.fn<(userId: string, from: string, to: string) => Observable<UserUsageDetail>>(() => detail$);
  const navigate = vi.fn<(commands: unknown[], extras?: unknown) => Promise<boolean>>(() => Promise.resolve(true));
  const toasts: { message: string; type: string }[] = [];

  const { userId, ...query } = route;
  const queryParams: Record<string, string> = {};
  if (query.from) queryParams['from'] = query.from;
  if (query.to) queryParams['to'] = query.to;

  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { getUserUsageDetail } },
      { provide: ToastService, useValue: { show: (message: string, type = 'info') => toasts.push({ message, type }) } },
      { provide: Router, useValue: { navigate } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap(userId ? { userId } : {})),
          queryParamMap: of(convertToParamMap(queryParams)),
        },
      },
    ],
  });
  // happy-dom + JIT can't fetch templateUrl, and the table children carry their own templateUrls.
  TestBed.overrideComponent(UserUsageDetailComponent, {
    set: { template: '', templateUrl: undefined, imports: [] },
  });

  const fixture = TestBed.createComponent(UserUsageDetailComponent);
  // The fetch effect runs on the first change-detection pass.
  fixture.detectChanges();
  return { component: fixture.componentInstance, getUserUsageDetail, navigate, toasts };
}

// ── Loading ─────────────────────────────────────────────────────────────────

describe('UserUsageDetailComponent — loading', () => {
  it('fetches the detail once for the routed user, seeded with the parent dashboard\'s date range', () => {
    const detail = makeDetail();
    const { component, getUserUsageDetail } = configure(of(detail), {
      userId: 'KCanning', from: '2026-09-01', to: '2026-09-30',
    });

    expect(getUserUsageDetail).toHaveBeenCalledTimes(1);
    expect(getUserUsageDetail).toHaveBeenCalledWith('KCanning', '2026-09-01', '2026-09-30');
    expect(component.userId()).toBe('KCanning');
    expect(component.detail()).toBe(detail);
    expect(component.loading()).toBe(false);
  });

  it('does not fetch when the route carries no userId', () => {
    const { component, getUserUsageDetail } = configure(of(makeDetail()), {});

    expect(getUserUsageDetail).not.toHaveBeenCalled();
    expect(component.detail()).toBeNull();
  });

  it('toasts an error, clears loading and leaves detail empty when the API fails', () => {
    const { component, toasts } = configure(throwError(() => new Error('boom')));

    expect(toasts).toEqual([{ message: 'Failed to load user detail', type: 'error' }]);
    expect(component.loading()).toBe(false);
    expect(component.detail()).toBeNull();
    // Every derivation must tolerate the failed load rather than throw.
    expect(component.recentActivityByFeature().size).toBe(0);
    expect(component.currentTabRecentActivity()).toEqual([]);
    expect(component.maxDaily()).toBe(1);
    expect(component.maxScreenMinutes()).toBe(1);
    expect(component.activeDays()).toBe(0);
    expect(component.windowDays()).toBe(0);
    expect(component.dailyActivitySlice()).toEqual([]);
  });
});

// ── Activity partitioning + tabs ────────────────────────────────────────────

describe('UserUsageDetailComponent — activity partitioning and tabs', () => {
  const viewedFarm = activity({ eventType: 'screen_enter', featureCode: 'customers', timestamp: '2026-10-13T09:00:00Z' });
  const listSaved  = activity({ eventType: 'interaction', featureCode: 'build-a-list', subFeatureCode: 'list-save', timestamp: '2026-10-13T09:05:00Z' });
  const calledFarm = activity({ eventType: 'call_click', featureCode: 'customers', targetId: '42', targetName: 'Smith Farms', timestamp: '2026-10-13T09:10:00Z' });
  const bidChanged = activity({ eventType: 'interaction', featureCode: 'bidsheet', subFeatureCode: 'bid-change', timestamp: '2026-10-13T09:15:00Z' });
  const usageView  = activity({ eventType: 'screen_enter', featureCode: 'usage-dashboard', timestamp: '2026-10-13T09:20:00Z' });

  let component: UserUsageDetailComponent;

  beforeEach(() => {
    ({ component } = configure(of(makeDetail({
      recentActivity: [viewedFarm, listSaved, calledFarm, bidChanged, usageView],
    }))));
  });

  it('partitions recent activity by featureCode, keeping each feature\'s rows in their original order', () => {
    const byFeature = component.recentActivityByFeature();

    expect([...byFeature.keys()]).toEqual(['customers', 'build-a-list', 'bidsheet', 'usage-dashboard']);
    expect(byFeature.get('customers')).toEqual([viewedFarm, calledFarm]);
    expect(byFeature.get('build-a-list')).toEqual([listSaved]);
    expect(byFeature.get('bidsheet')).toEqual([bidChanged]);
    // A feature with no tab still gets its own bucket; it simply never renders.
    expect(byFeature.get('usage-dashboard')).toEqual([usageView]);
  });

  it('opens on the Producer Page tab and shows only that feature\'s events', () => {
    expect(component.activeTab()).toBe('producer-page');
    expect(component.activeTabLabel()).toBe('Producer Page');
    expect(component.currentTabRecentActivity()).toEqual([viewedFarm, calledFarm]);
  });

  it('switching tabs swaps the visible events and the section title', () => {
    component.setActiveTab('build-a-list');
    expect(component.activeTabLabel()).toBe('Build a List');
    expect(component.currentTabRecentActivity()).toEqual([listSaved]);

    component.setActiveTab('bidsheet');
    expect(component.activeTabLabel()).toBe('Bid Sheet');
    expect(component.currentTabRecentActivity()).toEqual([bidChanged]);
  });

  it('a tab whose feature saw no events lists nothing rather than leaking another feature\'s rows', () => {
    component.setActiveTab('insights');
    expect(component.activeTabLabel()).toBe('Actionable Insights');
    expect(component.currentTabRecentActivity()).toEqual([]);

    component.setActiveTab('daily-recap');
    expect(component.currentTabRecentActivity()).toEqual([]);
  });

  it('every tab maps to a distinct feature code the backend emits', () => {
    const codes = component.tabs.map(t => t.featureCode);
    expect(codes).toEqual(['customers', 'build-a-list', 'insights', 'bidsheet', 'dashboard', 'daily-recap']);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('highlights only the active tab', () => {
    component.setActiveTab('dashboard');

    expect(component.getTabClass('dashboard')).toContain('bg-scoular-green-accessible');
    expect(component.getTabClass('producer-page')).not.toContain('bg-scoular-green-accessible');
    expect(component.getTabClass('producer-page')).toContain('text-gray-600');
  });
});

// ── Daily activity + screen-time derivations ────────────────────────────────

describe('UserUsageDetailComponent — daily activity and screen time', () => {
  it('counts only days with at least one event as active, out of the whole window', () => {
    const { component } = configure(of(makeDetail({
      dailyActivity: [
        day('2026-10-09', 3), day('2026-10-10', 0), day('2026-10-11', 7),
        day('2026-10-12', 0), day('2026-10-13', 1),
      ],
    })));

    expect(component.activeDays()).toBe(3);
    expect(component.windowDays()).toBe(5);
    expect(component.maxDaily()).toBe(7);
  });

  it('floors the chart scales at 1 so an all-zero window never divides by zero', () => {
    const { component } = configure(of(makeDetail({
      dailyActivity: [day('2026-10-12', 0), day('2026-10-13', 0)],
      timePerScreen: [{ featureCode: 'customers', featureLabel: 'Producer Page', minutes: 0 }],
    })));

    expect(component.maxDaily()).toBe(1);
    expect(component.maxScreenMinutes()).toBe(1);
    expect(component.activeDays()).toBe(0);
    expect(component.windowDays()).toBe(2);
  });

  it('scales screen time to the busiest screen', () => {
    const { component } = configure(of(makeDetail({
      timePerScreen: [
        { featureCode: 'customers', featureLabel: 'Producer Page', minutes: 42 },
        { featureCode: 'bidsheet', featureLabel: 'Bid Sheet', minutes: 97 },
        { featureCode: 'insights', featureLabel: 'Actionable Insights', minutes: 5 },
      ],
    })));

    expect(component.maxScreenMinutes()).toBe(97);
  });

  it('charts only the most recent 30 days of a longer window, oldest first', () => {
    const days = Array.from({ length: 45 }, (_, i) =>
      day(`2026-08-${`${i + 1}`.padStart(2, '0')}`, i + 1));
    const { component } = configure(of(makeDetail({ dailyActivity: days })));

    const slice = component.dailyActivitySlice();
    expect(slice).toHaveLength(30);
    expect(slice[0]).toEqual(days[15]);
    expect(slice[29]).toEqual(days[44]);
    // The window metrics still cover the whole range, not just the charted slice.
    expect(component.windowDays()).toBe(45);
    expect(component.activeDays()).toBe(45);
    expect(component.maxDaily()).toBe(45);
  });
});

// ── Date range ──────────────────────────────────────────────────────────────

describe('UserUsageDetailComponent — date range', () => {
  beforeEach(() => {
    // Only Date is faked: the TestBed scheduler must keep the real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to an inclusive 30-day window ending today', () => {
    const { component, getUserUsageDetail } = configure(of(makeDetail()));

    expect(component.activeRange()).toBe('30d');
    expect(component.dateFrom()).toBe('2026-09-14');
    expect(component.dateTo()).toBe('2026-10-13');
    expect(getUserUsageDetail).toHaveBeenCalledWith('CEgr', '2026-09-14', '2026-10-13');
  });

  it('a 7-day preset starts six days back and refetches for the new window', () => {
    const { component, getUserUsageDetail } = configure(of(makeDetail()));
    component.customRangeOpen.set(true);

    component.setRange('7d');
    TestBed.tick();

    expect(component.activeRange()).toBe('7d');
    expect(component.customRangeOpen()).toBe(false);
    expect(component.dateFrom()).toBe('2026-10-07');
    expect(component.dateTo()).toBe('2026-10-13');
    expect(getUserUsageDetail).toHaveBeenCalledTimes(2);
    expect(getUserUsageDetail).toHaveBeenLastCalledWith('CEgr', '2026-10-07', '2026-10-13');
  });

  it('editing either custom bound marks the range custom and refetches', () => {
    const { component, getUserUsageDetail } = configure(of(makeDetail()));

    component.onCustomDateChange('from', '2026-10-01');
    TestBed.tick();
    expect(component.activeRange()).toBe('custom');
    expect(getUserUsageDetail).toHaveBeenLastCalledWith('CEgr', '2026-10-01', '2026-10-13');

    component.onCustomDateChange('to', '2026-10-05');
    TestBed.tick();
    expect(getUserUsageDetail).toHaveBeenLastCalledWith('CEgr', '2026-10-01', '2026-10-05');
    expect(getUserUsageDetail).toHaveBeenCalledTimes(3);
  });

  it('going back hands the current window to the dashboard so the list keeps the same range', () => {
    const { component, navigate } = configure(of(makeDetail()), {
      userId: 'CEgr', from: '2026-09-01', to: '2026-09-30',
    });

    component.goBack();

    expect(navigate).toHaveBeenCalledWith(['/usage-dashboard'], {
      queryParams: { from: '2026-09-01', to: '2026-09-30' },
    });
  });
});

// ── Row labels ──────────────────────────────────────────────────────────────

describe('UserUsageDetailComponent — recent-activity row labels', () => {
  let component: UserUsageDetailComponent;

  beforeEach(() => {
    ({ component } = configure(of(makeDetail())));
  });

  it('prefers the sub-feature when the event has one', () => {
    expect(component.formatAction('note-create', 'interaction', 'customers')).toBe('Note Create');
    expect(component.formatAction('list-save', 'screen_enter', 'build-a-list')).toBe('List Save');
  });

  it('describes bare navigation and contact clicks by event type', () => {
    expect(component.formatAction(null, 'screen_enter', 'customers')).toBe('Viewed Producer Page');
    expect(component.formatAction(null, 'screen_enter', 'dashboard')).toBe('Viewed Planting Intention Dashboard');
    expect(component.formatAction(null, 'call_click', 'customers')).toBe('Called Producer');
    expect(component.formatAction(null, 'email_click', 'customers')).toBe('Emailed Producer');
    expect(component.formatAction(null, 'interaction', 'customers')).toBe('Interaction');
    // Unknown event types are title-cased rather than shown raw.
    expect(component.formatAction(null, 'list_export', 'build-a-list')).toBe('List Export');
  });

  it('shows a dash for a missing sub-feature and flags unresolved numeric ids', () => {
    expect(component.formatSubFeature(null)).toBe('—');
    expect(component.formatSubFeature('bid-change')).toBe('Bid Change');

    expect(component.isNumericId('12345')).toBe(true);
    expect(component.isNumericId('Smith Farms (12345)')).toBe(false);
    expect(component.isNumericId('')).toBe(false);
  });
});
