import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { signal } from '@angular/core';

import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { UserRolesService } from '@core/services/user-roles.service';
import { UsageDashboardUser, UsageManager } from '@models';

import { UsageDashboardComponent } from './usage-dashboard.component';

/**
 * Guards the dashboard's fetch orchestration. The component previously called
 * loadFeatureSessions/loadInactive/getUsageWeeklyTrend from *both* loadData and their own effects,
 * so every mount and every filter change issued those requests twice.
 */

function manager(over: Partial<UsageManager> = {}): UsageManager {
  return { userId: 'KCanning', displayName: 'Kyle Canning', directReports: 13, totalReports: 45, ...over };
}

/** Records how many times each ApiService method was called, and the managerId each data call sent. */
function makeApiStub(roster: UsageManager[] = []) {
  const calls: Record<string, number> = {};
  const managerIds: Record<string, (string | undefined)[]> = {};
  const count = (name: string, managerId?: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
    (managerIds[name] ??= []).push(managerId);
  };

  return {
    calls,
    managerIds,
    // Held open so `loading` can be asserted mid-flight.
    underusedSubject: new Subject<never[]>(),
    /** Swap to make the roster fail or change between calls. */
    managers$: of(roster) as Observable<UsageManager[]>,

    getUsageManagers: function (this: { managers$: Observable<UsageManager[]> }) { count('managers'); return this.managers$; },
    getUsageExclusionsCanManage: function () { count('canManage'); return of({ canManage: false }); },
    getUsageDashboardSummary: function (_f: string, _t: string, managerId?: string) { count('summary', managerId); return of(null as never); },
    getUsageDashboardUsers: function (_f: string, _t: string, managerId?: string) { count('users', managerId); return of([] as UsageDashboardUser[]); },
    getUsageDailyActive: function (_f: string, _t: string, managerId?: string) { count('dailyActive', managerId); return of([]); },
    getUsageFeatureSessions: function (_f: string, _t: string, managerId?: string) { count('featureSessions', managerId); return of([]); },
    getUsageWeeklyTrend: function (managerId?: string) { count('weeklyTrend', managerId); return of([]); },
    getUsageActivityBreakdown: function (_f: string, _t: string, managerId?: string) { count('activityBreakdown', managerId); return of([]); },
    getUsageQueryLibraryUsage: function (_f: string, _t: string, managerId?: string) { count('queryLibrary', managerId); return of([]); },
    getUsageQuerySearchGaps: function (_f: string, _t: string, managerId?: string) { count('querySearchGaps', managerId); return of([]); },
    getUsageUnderusedFeatures: function (this: { underusedSubject: Subject<never[]> }, _f: string, _t: string, managerId?: string) {
      count('underusedFeatures', managerId);
      return this.underusedSubject.asObservable();
    },
  };
}

/** UserRolesService reaches for MsalService; the dashboard only needs the short name. */
function rolesStub(userShortName = 'CEgr') {
  return {
    userShortName: signal(userShortName),
    userId: signal(`${userShortName}@scoular.com`),
    canViewUsageDashboard: signal(true),
    isAdmin: signal(true),
    roles: signal<string[]>([]),
  };
}

function configure(api: ReturnType<typeof makeApiStub>, roles = rolesStub(), toasts?: string[]) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { show: (m: string) => toasts?.push(m), error: () => {}, success: () => {} } },
      { provide: Router, useValue: { navigate: () => {} } },
      { provide: UserRolesService, useValue: roles },
    ],
  });
  // happy-dom + JIT can't fetch templateUrl, and the child imports carry their own templateUrls.
  TestBed.overrideComponent(UsageDashboardComponent, {
    set: { template: '', templateUrl: undefined, imports: [] },
  });
}

function build(): UsageDashboardComponent {
  const fixture = TestBed.createComponent(UsageDashboardComponent);
  // Effects run on the first change detection pass.
  fixture.detectChanges();
  return fixture.componentInstance;
}

describe('UsageDashboardComponent — fetch orchestration', () => {
  let api: ReturnType<typeof makeApiStub>;
  let component: UsageDashboardComponent;

  beforeEach(() => {
    // An empty roster: the signed-in user manages nobody, so the filter starts at "All Managers"
    // and these tests exercise the orchestration without a default in play.
    api = makeApiStub([]);
    configure(api);
  });

  it('hides the exclusion gear unless the backend says the caller is an exclusion manager', () => {
    component = build();
    // The stub answers canManage: false — the gear must stay hidden for ordinary admins.
    expect(api.calls['canManage']).toBe(1);
    expect(component.canManageExclusions()).toBe(false);
  });

  it('loads the manager roster exactly once on mount', () => {
    component = build();
    expect(api.calls['managers']).toBe(1);
  });

  it('requests feature sessions exactly once on mount', () => {
    component = build();
    expect(api.calls['featureSessions']).toBe(1);
  });

  it('requests the weekly trend exactly once on mount', () => {
    component = build();
    expect(api.calls['weeklyTrend']).toBe(1);
  });

  it('does not load a tab\'s data until that tab is opened', () => {
    component = build();
    // "Who's Using It" is the default tab, so the other tabs' endpoints stay untouched.
    expect(api.calls['activityBreakdown']).toBeUndefined();
    expect(api.calls['underusedFeatures']).toBeUndefined();

    component.onTabChange('whats-doing');
    TestBed.tick();
    expect(api.calls['activityBreakdown']).toBe(1);
  });

  it('does not refetch a tab that has already loaded for the current filters', () => {
    component = build();
    component.onTabChange('whats-doing');
    TestBed.tick();
    component.onTabChange('whos-using-it');
    TestBed.tick();
    component.onTabChange('whats-doing');
    TestBed.tick();

    expect(api.calls['activityBreakdown']).toBe(1);
  });

  it('refetches only feature sessions when the screen filter changes', () => {
    component = build();
    const usersBefore = api.calls['users'];

    component.selectedScreen.set('bidsheet');
    TestBed.tick();

    expect(api.calls['featureSessions']).toBe(2);
    expect(api.calls['users']).toBe(usersBefore); // unrelated panels are left alone
  });

  it('leaves the weekly trend alone when the date range changes', () => {
    // It is a whole-calendar-week trend, so the dashboard's window is not one of its inputs.
    component = build();
    component.setRange('7d');
    TestBed.tick();

    expect(api.calls['weeklyTrend']).toBe(1);
  });

  it('refetches every always-visible panel exactly once when the manager filter changes', () => {
    component = build();

    component.managerFilter.set('KCanning');
    TestBed.tick();

    expect(api.calls['summary']).toBe(2);
    expect(api.calls['users']).toBe(2);
    expect(api.calls['dailyActive']).toBe(2);
    expect(api.calls['featureSessions']).toBe(2);
    // Unlike the date range, the manager narrows the universe, so the weekly trend refetches too.
    expect(api.calls['weeklyTrend']).toBe(2);
  });

  it('includes the manager in the tab dedupe key', () => {
    component = build();
    component.onTabChange('whats-doing');
    TestBed.tick();
    expect(api.calls['activityBreakdown']).toBe(1);

    // A manager change invalidates the loaded tab...
    component.managerFilter.set('KCanning');
    TestBed.tick();
    expect(api.calls['activityBreakdown']).toBe(2);

    // ...but revisiting with the same manager does not refetch.
    component.onTabChange('whos-using-it');
    TestBed.tick();
    component.onTabChange('whats-doing');
    TestBed.tick();
    expect(api.calls['activityBreakdown']).toBe(2);
  });

  it('clearing the manager filter returns to the whole organisation with one more fetch', () => {
    component = build();
    component.managerFilter.set('KCanning');
    TestBed.tick();

    component.managerFilter.set(null);
    TestBed.tick();

    expect(api.calls['users']).toBe(3); // mount, filtered, cleared
    expect(api.managerIds['users']).toEqual([undefined, 'KCanning', undefined]);
  });
});

describe('UsageDashboardComponent — loading state', () => {
  let api: ReturnType<typeof makeApiStub>;

  beforeEach(() => {
    api = makeApiStub([]);
    configure(api);
  });

  it('stays true while a request is outstanding and clears when it completes', () => {
    const component = build();

    // Open the tab whose endpoint is held open by the stub.
    component.onTabChange('whos-not');
    TestBed.tick();
    expect(component.loading()).toBe(true);

    api.underusedSubject.next([]);
    api.underusedSubject.complete();
    expect(component.loading()).toBe(false);
  });
});

describe('UsageDashboardComponent — derived values', () => {
  let component: UsageDashboardComponent;
  let toasts: string[];

  function user(over: Partial<UsageDashboardUser>): UsageDashboardUser {
    return {
      userId: 'u', displayName: 'U', loginCount: 0, lastActive: null,
      avgSessionMinutes: 0, status: 'Active',
      customersContacted: 0, notesCreated: 0, ...over,
    };
  }

  beforeEach(() => {
    toasts = [];
    configure(makeApiStub([]), rolesStub(), toasts);
    component = build();
  });

  it('counts each recency tier separately for the donut', () => {
    component.users.set([
      user({ userId: 'a', status: 'Active' }),
      user({ userId: 'b', status: 'Light Usage' }),
      user({ userId: 'c', status: 'Light Usage' }),
      user({ userId: 'd', status: 'Dormant' }),
      user({ userId: 'e', status: 'Never' }),
    ]);

    expect(component.activeCount()).toBe(1);
    expect(component.lightUsageCount()).toBe(2);
    expect(component.dormantCount()).toBe(1);
    expect(component.neverCount()).toBe(1);
  });

  it('lists the Light Usage tier as low usage, most-stale first', () => {
    component.users.set([
      user({ userId: 'a', status: 'Light Usage', lastActive: '2026-08-03T00:00:00' }),
      user({ userId: 'b', status: 'Active', lastActive: '2026-08-05T00:00:00' }),
      user({ userId: 'c', status: 'Light Usage', lastActive: '2026-07-30T00:00:00' }),
      user({ userId: 'd', status: 'Dormant', lastActive: '2026-07-01T00:00:00' }),
    ]);

    expect(component.lowUsageOriginators().map(u => u.userId)).toEqual(['c', 'a']);
  });

  it('lists Dormant and Never accounts as inactive, most-stale first', () => {
    component.users.set([
      user({ userId: 'a', status: 'Active', lastActive: '2026-08-05T00:00:00' }),
      user({ userId: 'b', status: 'Light Usage', lastActive: '2026-08-01T00:00:00' }),
      user({ userId: 'c', status: 'Dormant', lastActive: '2026-07-01T00:00:00' }),
      user({ userId: 'd', status: 'Never', lastActive: null }),
    ]);

    expect(component.inactiveOriginators().map(u => u.userId)).toEqual(['d', 'c']);
  });
});

/**
 * The manager filter's default.
 *
 * Every dashboard user gets the dropdown and may pick anyone; the server honours whatever it is
 * sent (see UsageDashboardServiceTests). What the CLIENT decides is where the filter starts: the
 * signed-in user when they manage someone, otherwise the whole organisation — and that decision has
 * to be made before the first fetch so the page does not load twice.
 */
describe('UsageDashboardComponent — manager default', () => {
  const rosterWithMe = [manager(), manager({ userId: 'CEgr', displayName: 'Caden Egr', directReports: 2, totalReports: 2 })];

  it('defaults to the signed-in user when they are in the roster, and fetches once with that manager', () => {
    const api = makeApiStub(rosterWithMe);
    configure(api, rolesStub('CEgr'));

    const component = build();

    expect(component.managerFilter()).toBe('CEgr');
    expect(api.calls['users']).toBe(1);
    expect(api.managerIds['users']).toEqual(['CEgr']);
    expect(api.managerIds['weeklyTrend']).toEqual(['CEgr']);
  });

  it('matches the signed-in user against the roster case-insensitively, using the roster\'s casing', () => {
    // /api/me reports the UPN as the token carries it; the directory may case it differently.
    const api = makeApiStub(rosterWithMe);
    configure(api, rolesStub('cegr'));

    const component = build();

    expect(component.managerFilter()).toBe('CEgr');
  });

  it('starts at "All Managers" when the signed-in user manages nobody', () => {
    // A non-manager is not in the roster: defaulting to them would select a name the dropdown
    // cannot show and a team the server resolves to nobody.
    const api = makeApiStub([manager()]);
    configure(api, rolesStub('NotAManager'));

    const component = build();

    expect(component.managerFilter()).toBeNull();
    expect(api.managerIds['users']).toEqual([undefined]);
  });

  it('starts at "All Managers" when the short name is unknown', () => {
    const api = makeApiStub(rosterWithMe);
    configure(api, rolesStub(''));

    const component = build();

    expect(component.managerFilter()).toBeNull();
  });

  it('falls back to the whole organisation when the roster cannot be loaded, rather than blocking the page', () => {
    const api = makeApiStub(rosterWithMe);
    api.managers$ = throwError(() => ({ status: 503 }));
    configure(api, rolesStub('CEgr'));

    const component = build();

    expect(component.managersLoadFailed()).toBe(true);
    expect(component.managerFilter()).toBeNull();
    expect(api.calls['users']).toBe(1); // the data still loads — no manager means no directory lookup
  });

  it('a retry that succeeds after a failed first load still applies the self default', () => {
    // The first attempt settled the page on "All Managers" so it would not block; that must not
    // use up the one chance to default once the roster actually arrives.
    const api = makeApiStub(rosterWithMe);
    api.managers$ = throwError(() => ({ status: 503 }));
    configure(api, rolesStub('CEgr'));
    const component = build();
    expect(component.managerFilter()).toBeNull();

    api.managers$ = of(rosterWithMe);
    component.loadManagers();
    TestBed.tick();

    expect(component.managerFilter()).toBe('CEgr');
    expect(api.managerIds['users']).toEqual([undefined, 'CEgr']); // whole org, then the defaulted team
  });

  it('a retry after a successful load does not re-apply the default over a cleared filter', () => {
    const api = makeApiStub(rosterWithMe);
    configure(api, rolesStub('CEgr'));
    const component = build();
    expect(component.managerFilter()).toBe('CEgr');

    component.managerFilter.set(null); // the user chose "All Managers"
    TestBed.tick();
    component.loadManagers();
    TestBed.tick();

    expect(component.managerFilter()).toBeNull();
  });

  it('a roster retry does not flip the page-level loading state', () => {
    const api = makeApiStub(rosterWithMe);
    api.managers$ = throwError(() => ({ status: 503 }));
    configure(api, rolesStub('CEgr'));
    const component = build();
    expect(component.loading()).toBe(false);

    api.managers$ = new Subject<UsageManager[]>(); // held open
    component.loadManagers();

    expect(component.managersLoading()).toBe(true);
    expect(component.loading()).toBe(false); // the dropdown shows its own spinner; the panels keep their data
  });

  it('does not show the empty-team message when the summary failed to load', () => {
    // null is "not loaded", not "zero users" — the toast already reports the failure.
    const api = makeApiStub(rosterWithMe);
    configure(api, rolesStub('CEgr'));
    const component = build();
    component.summary.set(null);

    expect(component.teamIsEmpty()).toBe(false);
  });

  it('a retry after a failed load restores the roster without clobbering a choice the user made', () => {
    const api = makeApiStub(rosterWithMe);
    api.managers$ = throwError(() => ({ status: 503 }));
    configure(api, rolesStub('CEgr'));
    const component = build();

    component.managerFilter.set('KCanning');
    TestBed.tick();
    api.managers$ = of(rosterWithMe);
    component.loadManagers();
    TestBed.tick();

    expect(component.managersLoadFailed()).toBe(false);
    expect(component.managers().length).toBe(2);
    expect(component.managerFilter()).toBe('KCanning'); // not reset to the default
  });

  it('explains an empty team when a selected manager resolves to nobody', () => {
    const api = makeApiStub(rosterWithMe);
    configure(api, rolesStub('CEgr'));
    const component = build();
    component.summary.set({ totalUsers: 0 } as never);

    // Server-side this is a real state, not an error: a team with nobody who can sign in resolves
    // to an empty universe, which would otherwise render as a wall of zeros with nothing to explain it.
    expect(component.teamIsEmpty()).toBe(true);
  });

  it('does not show the empty-team message when the team has people', () => {
    const api = makeApiStub(rosterWithMe);
    configure(api, rolesStub('CEgr'));
    const component = build();
    component.summary.set({ totalUsers: 4 } as never);

    expect(component.teamIsEmpty()).toBe(false);
  });

  it('never shows the empty-team message for the whole-organisation view', () => {
    const api = makeApiStub([]);
    configure(api, rolesStub('CEgr'));
    const component = build();
    component.summary.set({ totalUsers: 0 } as never);

    // Zero users with no manager selected means the org really is empty (or everyone is excluded) —
    // telling them the team is empty would be wrong.
    expect(component.teamIsEmpty()).toBe(false);
  });
});

describe('UsageDashboardComponent — panel load failures', () => {
  // These panels used to swallow their errors, so a dead endpoint drew an empty chart or a table of
  // zeros that read as "nobody used it". The KPI row and the originator table already toast.
  const PanelFailure = 'Some usage panels failed to load — they may be empty or out of date. Refresh to try again.';
  const fail = () => throwError(() => new Error('boom'));

  let toasts: string[];
  beforeEach(() => { toasts = []; });

  it.each([
    ['daily active users', (a: ReturnType<typeof makeApiStub>) => { a.getUsageDailyActive = fail; }],
    ['weekly trend', (a: ReturnType<typeof makeApiStub>) => { a.getUsageWeeklyTrend = fail; }],
    ['feature sessions', (a: ReturnType<typeof makeApiStub>) => { a.getUsageFeatureSessions = fail; }],
  ] as const)('tells the user when the %s panel fails to load', (_name, breakIt) => {
    const api = makeApiStub([]);
    breakIt(api);
    configure(api, rolesStub(), toasts);
    build();

    expect(toasts).toEqual([PanelFailure]);
  });

  it.each([
    ['activity breakdown', 'whats-doing', (a: ReturnType<typeof makeApiStub>) => { a.getUsageActivityBreakdown = fail; }],
    ['query library usage', 'whats-doing', (a: ReturnType<typeof makeApiStub>) => { a.getUsageQueryLibraryUsage = fail; }],
    ['query search gaps', 'whats-doing', (a: ReturnType<typeof makeApiStub>) => { a.getUsageQuerySearchGaps = fail; }],
    ['underused features', 'whos-not', (a: ReturnType<typeof makeApiStub>) => { a.getUsageUnderusedFeatures = fail; }],
  ] as const)('tells the user when the %s panel fails to load', (_name, tab, breakIt) => {
    const api = makeApiStub([]);
    breakIt(api);
    configure(api, rolesStub(), toasts);
    const fixture = TestBed.createComponent(UsageDashboardComponent);
    fixture.detectChanges();
    expect(toasts).toEqual([]);

    fixture.componentInstance.onTabChange(tab);
    fixture.detectChanges();

    expect(toasts).toEqual([PanelFailure]);
  });

  it('says it once when several panels fail together, not once per panel', () => {
    const api = makeApiStub([]);
    api.getUsageDailyActive = fail;
    api.getUsageWeeklyTrend = fail;
    api.getUsageFeatureSessions = fail;
    configure(api, rolesStub(), toasts);
    build();

    expect(toasts).toEqual([PanelFailure]);
  });

  it('stays quiet when every panel loads', () => {
    configure(makeApiStub([]), rolesStub(), toasts);
    build();

    expect(toasts).toEqual([]);
  });
});
