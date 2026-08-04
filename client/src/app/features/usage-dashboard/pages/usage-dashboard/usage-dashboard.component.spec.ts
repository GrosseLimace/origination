import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject, of } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageDashboardUser } from '@models';

import { UsageDashboardComponent } from './usage-dashboard.component';

/**
 * Guards the dashboard's fetch orchestration. The component previously called
 * loadFeatureSessions/loadInactive/getUsageWeeklyTrend from *both* loadData and their own effects,
 * so every mount and every filter change issued those requests twice.
 */

/** Records how many times each ApiService method was called. */
function makeApiStub() {
  const calls: Record<string, number> = {};
  const count = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };

  return {
    calls,
    // Held open so `loading` can be asserted mid-flight.
    underusedSubject: new Subject<never[]>(),

    getUsageDashboardSummary: function () { count('summary'); return of(null as never); },
    getUsageDashboardUsers: function () { count('users'); return of([] as UsageDashboardUser[]); },
    getUsageDailyActive: function () { count('dailyActive'); return of([]); },
    getUsageFeatureSessions: function () { count('featureSessions'); return of([]); },
    getUsageWeeklyTrend: function () { count('weeklyTrend'); return of([]); },
    getUsageActivityBreakdown: function () { count('activityBreakdown'); return of([]); },
    getUsageDashboardInactive: function () { count('inactive'); return of([]); },
    getUsageQueryLibraryUsage: function () { count('queryLibrary'); return of([]); },
    getUsageQuerySearchGaps: function () { count('querySearchGaps'); return of([]); },
    getUsageUnderusedFeatures: function (this: { underusedSubject: Subject<never[]> }) {
      count('underusedFeatures');
      return this.underusedSubject.asObservable();
    },
  };
}

describe('UsageDashboardComponent — fetch orchestration', () => {
  let api: ReturnType<typeof makeApiStub>;
  let component: UsageDashboardComponent;

  function build(): UsageDashboardComponent {
    const fixture = TestBed.createComponent(UsageDashboardComponent);
    // Effects run on the first change detection pass.
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    api = makeApiStub();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
      ],
    });
    // happy-dom + JIT can't fetch templateUrl, and the child imports carry their own templateUrls.
    TestBed.overrideComponent(UsageDashboardComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    TestBed.inject(AppStateService);
  });

  it('requests feature sessions exactly once on mount', () => {
    component = build();
    expect(api.calls['featureSessions']).toBe(1);
  });

  it('requests inactive users exactly once on mount', () => {
    component = build();
    expect(api.calls['inactive']).toBe(1);
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

  it('refetches only the inactive list when its threshold changes', () => {
    component = build();
    const featureSessionsBefore = api.calls['featureSessions'];

    component.setInactiveDays(7);
    TestBed.tick();

    expect(api.calls['inactive']).toBe(2);
    expect(api.calls['featureSessions']).toBe(featureSessionsBefore);
  });

  it('leaves the weekly trend alone when the date range changes', () => {
    // It is a whole-calendar-week trend, so the dashboard's window is not one of its inputs.
    component = build();
    component.setRange('7d');
    TestBed.tick();

    expect(api.calls['weeklyTrend']).toBe(1);
  });
});

describe('UsageDashboardComponent — loading state', () => {
  let api: ReturnType<typeof makeApiStub>;

  beforeEach(() => {
    api = makeApiStub();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
      ],
    });
    TestBed.overrideComponent(UsageDashboardComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    TestBed.inject(AppStateService);
  });

  it('stays true while a request is outstanding and clears when it completes', () => {
    const fixture = TestBed.createComponent(UsageDashboardComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

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
      avgSessionMinutes: 0, status: 'Active', customersContacted: 0, notesCreated: 0, ...over,
    };
  }

  beforeEach(() => {
    toasts = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: makeApiStub() },
        { provide: ToastService, useValue: { show: (m: string) => toasts.push(m), error: () => {}, success: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
      ],
    });
    TestBed.overrideComponent(UsageDashboardComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    TestBed.inject(AppStateService);
    const fixture = TestBed.createComponent(UsageDashboardComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('counts each status separately for the donut', () => {
    component.users.set([
      user({ userId: 'a', status: 'Active' }),
      user({ userId: 'b', status: 'Inactive' }),
      user({ userId: 'c', status: 'Inactive' }),
      user({ userId: 'd', status: 'Never Logged In' }),
    ]);

    expect(component.activeCount()).toBe(1);
    expect(component.inactiveStatusCount()).toBe(2);
    expect(component.neverLoggedInCount()).toBe(1);
  });

  it('scales the low-usage threshold to the selected window', () => {
    component.setRange('30d');
    expect(component.lowUsageThreshold()).toBe(15);

    component.setRange('7d');
    // The label used to claim "fewer than 15 logins in the last 30 days" no matter the range.
    expect(component.lowUsageThreshold()).toBe(4);
  });

  it('excludes never-logged-in users from the low-usage list', () => {
    component.setRange('30d');
    component.users.set([
      user({ userId: 'a', status: 'Active', loginCount: 3 }),
      user({ userId: 'b', status: 'Never Logged In', loginCount: 0 }),
      user({ userId: 'c', status: 'Active', loginCount: 40 }),
    ]);

    expect(component.lowUsageOriginators().map(u => u.userId)).toEqual(['a']);
  });

  it('rejects a non-numeric or out-of-range custom inactivity threshold', () => {
    component.inactiveCustomDays.set('abc');
    component.applyCustomInactiveDays();
    expect(component.inactiveDaysThreshold()).toBe(30);

    component.inactiveCustomDays.set('0');
    component.applyCustomInactiveDays();
    expect(component.inactiveDaysThreshold()).toBe(30);

    component.inactiveCustomDays.set('9999');
    component.applyCustomInactiveDays();
    expect(component.inactiveDaysThreshold()).toBe(30);

    expect(toasts.length).toBe(3);
  });

  it('accepts a valid custom inactivity threshold', () => {
    component.inactiveCustomDays.set('45');
    component.applyCustomInactiveDays();
    expect(component.inactiveDaysThreshold()).toBe(45);
    expect(component.inactiveCustomOpen()).toBe(false);
  });
});
