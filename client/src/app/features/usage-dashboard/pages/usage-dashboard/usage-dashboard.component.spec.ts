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
      avgSessionMinutes: 0, status: 'Active',
      customersContacted: 0, notesCreated: 0, ...over,
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
