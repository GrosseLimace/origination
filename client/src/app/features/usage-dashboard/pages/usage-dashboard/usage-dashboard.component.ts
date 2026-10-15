import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, finalize } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { UserRolesService } from '@core/services/user-roles.service';
import {
  TableComponent, TableHeaderComponent, TableBodyComponent,
  TableRowComponent, TableHeadComponent, TableCellComponent
} from '@shared/components/table/table.component';
import {
  UsageDashboardSummary, UsageDashboardUser, UsageManager, DailyActive,
  FeatureSessions, WeeklyTrend, ActivityBreakdown, UnderusedFeature,
  QueryLibraryUsage, QuerySearchGap
} from '@models';

import { SortIconComponent } from '../../components/sort-icon/sort-icon.component';
import { ExcludedUsersPanelComponent } from '../../components/excluded-users-panel/excluded-users-panel.component';
import { ManagerFilterComponent } from '../../components/manager-filter/manager-filter.component';
import { createTableSort } from '../../utils/table-sort';
import {
  formatDayLabel, formatLastActive, formatSessionDuration, formatTimeSpent,
  getInitials, getStatusClasses, localIsoDateDaysAgo, toLocalIsoDate, windowDays
} from '../../utils/usage-format';

type DashboardTabId = 'whos-using-it' | 'whats-doing' | 'whos-not';

@Component({
  selector: 'app-usage-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    SortIconComponent, ExcludedUsersPanelComponent, ManagerFilterComponent,
    TableComponent, TableHeaderComponent, TableBodyComponent,
    TableRowComponent, TableHeadComponent, TableCellComponent
  ],
  templateUrl: './usage-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UsageDashboardComponent {
  readonly Math = Math;
  private readonly apiService = inject(ApiService);
  private readonly toastService = inject(ToastService);
  private readonly userRoles = inject(UserRolesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  // ── Filters ──
  // The window is inclusive of both ends, so an N-day range starts N-1 days back — otherwise the
  // "30 Days" button actually covers 31 days and every per-day average is computed against 31.
  readonly dateFrom = signal(localIsoDateDaysAgo(29));
  readonly dateTo = signal(toLocalIsoDate(new Date()));
  readonly activeRange = signal<'7d' | '30d' | 'custom'>('30d');
  readonly customRangeOpen = signal(false);

  readonly activeTab = signal<DashboardTabId>('whos-using-it');
  readonly statusFilter = signal<string>('all');

  // ── Manager filter ──
  // The dashboard's only filter. It is organised by reporting line, not by trade unit, so the
  // app-wide trade-unit selection is deliberately not an input here.

  /** Selected manager's short name, or null for the whole organisation. Narrows every panel to that
   *  manager's entire org subtree (server-side, via the managerId query param). */
  readonly managerFilter = signal<string | null>(null);

  readonly managers = signal<UsageManager[]>([]);
  readonly managersLoading = signal(false);
  readonly managersLoadFailed = signal(false);

  /** The data effects wait on this, so the first fetch already carries the defaulted manager instead
   *  of loading the whole organisation and then reloading once the default is known. Set once the
   *  first roster attempt has settled either way — a failed roster must not block the page. */
  private readonly managerFilterReady = signal(false);

  /** Whether the self default has been applied from a successful roster load. Kept apart from
   *  managerFilterReady so a Retry that succeeds after a failed first load still gets its one
   *  chance to default, while a Retry after a successful load never re-applies it. */
  private defaultManagerApplied = false;

  /** Bumped to force a reload — e.g. after the exclusion list changes, which moves every number. */
  private readonly refreshTick = signal(0);

  /** True only for the configured exclusion managers (IT) — hides the exclusion gear for everyone
   *  else. Display-only convenience: the server enforces the same allowlist on the endpoints. */
  readonly canManageExclusions = signal(false);

  // ── Data ──
  readonly summary = signal<UsageDashboardSummary | null>(null);
  readonly users = signal<UsageDashboardUser[]>([]);
  readonly dailyActive = signal<DailyActive[]>([]);
  readonly featureSessions = signal<FeatureSessions[]>([]);
  readonly featureSessionsLoading = signal(false);
  readonly weeklyTrend = signal<WeeklyTrend[]>([]);
  readonly activityBreakdown = signal<ActivityBreakdown[]>([]);
  readonly underusedFeatures = signal<UnderusedFeature[]>([]);
  readonly queryLibraryUsage = signal<QueryLibraryUsage[]>([]);
  readonly queryLibraryOpen = signal(false);
  readonly querySearchGaps = signal<QuerySearchGap[]>([]);
  readonly querySearchGapsOpen = signal(false);

  /**
   * In-flight request count. The panels load independently — one failing endpoint shouldn't blank
   * the others — so a counter reflects "still loading" more honestly than piggybacking on whichever
   * response happens to arrive last.
   */
  private readonly pendingCount = signal(0);
  /** Also true until the roster has settled the default manager — the data effects have not fired
   *  yet at that point, so pendingCount alone would read as "nothing to wait for". */
  readonly loading = computed(() => this.pendingCount() > 0 || !this.managerFilterReady());

  /** A selected manager whose team includes nobody who can sign in to the app resolves to an empty
   *  universe server-side, which would otherwise render as a wall of zeros with no explanation.
   *  Real state, not an error. Never shown for the whole-org view — zero users there would mean
   *  something else entirely — and never when the summary simply failed to load (null, not zero). */
  readonly teamIsEmpty = computed(() =>
    !!this.managerFilter() && !this.loading() && this.summary()?.totalUsers === 0);

  // ── Formatters (shared with the per-user drill-down) ──
  readonly formatTimeSpent = formatTimeSpent;
  readonly formatSessionDuration = formatSessionDuration;
  readonly formatLastActive = formatLastActive;
  readonly formatDayLabel = formatDayLabel;
  readonly formatWeekLabel = formatDayLabel;
  readonly getStatusClasses = getStatusClasses;
  readonly getInitials = getInitials;

  // ── All Originators table ──
  readonly originatorSearch = signal('');
  readonly sort = createTableSort<UsageDashboardUser>();

  readonly filteredUsers = computed(() => {
    const filter = this.statusFilter();
    const search = this.originatorSearch().toLowerCase().trim();
    let result = this.users();

    if (filter && filter !== 'all') {
      result = result.filter(u => u.status === filter);
    }
    if (search) {
      result = result.filter(u =>
        u.displayName.toLowerCase().includes(search) ||
        u.userId.toLowerCase().includes(search) ||
        (u.userId.toLowerCase() + '@scoular.com').includes(search) ||
        u.status.toLowerCase().includes(search)
      );
    }

    return this.sort.apply(result, {
      name: (a, b) => a.displayName.localeCompare(b.displayName),
      status: (a, b) => a.status.localeCompare(b.status),
      lastLogin: (a, b) => (a.lastActive ?? '').localeCompare(b.lastActive ?? ''),
      logins: (a, b) => a.loginCount - b.loginCount,
      avgSession: (a, b) => a.avgSessionMinutes - b.avgSessionMinutes,
      contacted: (a, b) => a.customersContacted - b.customersContacted,
      notes: (a, b) => a.notesCreated - b.notesCreated,
    });
  });

  // ── Status breakdown ──
  // Tier labels match the status values the API returns and the status filter offers, so the donut,
  // the pills and the dropdown can't tell different stories.
  readonly activeCount = computed(() => this.users().filter(u => u.status === 'Active').length);
  readonly lightUsageCount = computed(() => this.users().filter(u => u.status === 'Light Usage').length);
  readonly dormantCount = computed(() => this.users().filter(u => u.status === 'Dormant').length);
  readonly neverCount = computed(() => this.users().filter(u => u.status === 'Never').length);

  /** Used within the last week (Active + Light Usage) — the population behind the adoption KPI. */
  readonly engagedThisWeekCount = computed(() => {
    const s = this.summary();
    return s ? s.activeUsers + s.lightUsageUsers : 0;
  });

  /** Dormant + Never — the "Who Isn't Using It" Inactive panel's population. */
  readonly needsAttentionCount = computed(() => this.inactiveOriginators().length);

  readonly circumference = 2 * Math.PI * 40;
  readonly donutSegments = computed(() => {
    const total = this.users().length;
    const c = this.circumference;
    if (total === 0) return { activeLen: 0, activeOffset: 0, lightLen: 0, lightOffset: 0, dormantLen: 0, dormantOffset: 0, neverLen: 0, neverOffset: 0 };
    const activeLen = (this.activeCount() / total) * c;
    const lightLen = (this.lightUsageCount() / total) * c;
    const dormantLen = (this.dormantCount() / total) * c;
    const neverLen = (this.neverCount() / total) * c;
    return {
      activeLen, activeOffset: 0,
      lightLen, lightOffset: -(activeLen),
      dormantLen, dormantOffset: -(activeLen + lightLen),
      neverLen, neverOffset: -(activeLen + lightLen + dormantLen)
    };
  });

  // ── Daily active chart ──
  readonly dailyActiveLast15 = computed(() => this.dailyActive().slice(-15));

  readonly maxDailyActive = computed(() => {
    const max = Math.max(0, ...this.dailyActiveLast15().map(d => d.uniqueUserCount));
    return max > 0 ? max : 1;
  });

  // ── Window-aware labels ──
  /** Days covered by the selected range, inclusive. */
  readonly windowDays = computed(() => windowDays(this.dateFrom(), this.dateTo()));

  readonly loginsLabel = computed(() => this.activeRange() === '7d' ? 'Avg Logins / Week' : 'Avg Logins / Month');
  readonly loginsSubLabel = computed(() => this.activeRange() === '7d' ? 'per originator this week' : 'per originator per month');
  readonly avgLoginsDisplay = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    if (this.activeRange() === '7d') return s.avgLoginsPerWeek;
    // The API reports a weekly rate; scale it for the monthly label.
    return Math.round(s.avgLoginsPerWeek * 4.33 * 10) / 10;
  });

  readonly loginsColumnLabel = computed(() => `Logins (${this.windowDays()}d)`);

  // ── Feature sessions ──
  readonly selectedScreen = signal<string>('all');
  readonly featureScreens = [
    { id: 'all', label: 'All Features' },
    { id: 'customers', label: 'Producer Page' },
    { id: 'dashboard', label: 'Planting Intention Dashboard' },
    { id: 'build-a-list', label: 'Build a List' },
    { id: 'insights', label: 'Actionable Insights' },
    { id: 'unshipped-bushels', label: 'Unshipped Bushels' },
    { id: 'bidsheet', label: 'Bid Sheet' },
    { id: 'daily-recap', label: 'Daily Recap' },
  ];

  /**
   * Bars for the selected screen. In "all" mode the value is minutes on each screen; drilled into a
   * single screen it is a count of interactions with each sub-feature.
   */
  readonly selectedScreenFeatures = computed(() => {
    const data = this.featureSessions();
    const screenId = this.selectedScreen();
    if (screenId === 'all') {
      return data.map(f => ({ name: f.featureLabel, value: f.screenMinutes }));
    }
    const screen = data.find(f => f.featureCode === screenId);
    if (!screen) return [];
    return screen.subFeatures.map(sf => ({ name: sf.label, value: sf.interactionCount }));
  });

  /** True when the bars represent minutes rather than interaction counts. */
  readonly featureBarsAreMinutes = computed(() => this.selectedScreen() === 'all');

  readonly selectedScreenTotalMinutes = computed(() => {
    const screenId = this.selectedScreen();
    if (screenId === 'all') return 0;
    return this.featureSessions().find(f => f.featureCode === screenId)?.screenMinutes ?? 0;
  });

  readonly maxScreenFeatureValue = computed(() => {
    const max = Math.max(0, ...this.selectedScreenFeatures().map(f => f.value));
    return max > 0 ? max : 1;
  });

  // ── Weekly trend ──
  readonly maxWeeklyTrend = computed(() => {
    const max = Math.max(0, ...this.weeklyTrend().map(w => Math.max(w.activeUsers, w.totalSessions)));
    return max > 0 ? max : 1;
  });

  // ── Activity Breakdown table ──
  readonly activityByUserId = computed(() => {
    const map = new Map<string, ActivityBreakdown>();
    for (const row of this.activityBreakdown()) map.set(row.userId, row);
    return map;
  });

  readonly activitySearch = signal('');
  readonly activitySort = createTableSort<UsageDashboardUser>();

  readonly filteredActivityUsers = computed(() => {
    const search = this.activitySearch().toLowerCase().trim();
    const byId = this.activityByUserId();
    let result = this.users();

    if (search) {
      result = result.filter(u =>
        u.displayName.toLowerCase().includes(search) ||
        u.userId.toLowerCase().includes(search)
      );
    }

    const metric = (u: UsageDashboardUser, pick: (row: ActivityBreakdown) => number) => {
      const row = byId.get(u.userId);
      return row ? pick(row) : 0;
    };

    return this.activitySort.apply(result, {
      name: (a, b) => a.displayName.localeCompare(b.displayName),
      profiles: (a, b) => metric(a, r => r.profilesViewed) - metric(b, r => r.profilesViewed),
      contracts: (a, b) => metric(a, r => r.contractsViewed) - metric(b, r => r.contractsViewed),
      notes: (a, b) => metric(a, r => r.notesTaken) - metric(b, r => r.notesTaken),
      calls: (a, b) => metric(a, r => r.callsEmails) - metric(b, r => r.callsEmails),
      lists: (a, b) => metric(a, r => r.listsBuilt) - metric(b, r => r.listsBuilt),
      planting: (a, b) => metric(a, r => r.plantingIntentionsAdded) - metric(b, r => r.plantingIntentionsAdded),
      producer: (a, b) => metric(a, r => r.producerDetails) - metric(b, r => r.producerDetails),
    });
  });

  readonly maxActivityBreakdown = computed(() => {
    const data = this.activityBreakdown();
    if (data.length === 0) return 1;
    return Math.max(1, ...data.map(d =>
      d.profilesViewed + d.contractsViewed + d.notesTaken + d.callsEmails
      + d.listsBuilt + d.plantingIntentionsAdded + d.producerDetails));
  });

  // ── Who Isn't Using It ──
  // Inactive = not seen for over a week (Dormant) or never seen at all (Never), most-stale first.
  readonly inactiveOriginators = computed(() =>
    this.users()
      .filter(u => u.status === 'Dormant' || u.status === 'Never')
      .sort((a, b) => (a.lastActive ?? '').localeCompare(b.lastActive ?? '')));

  // Low usage = the Light Usage tier (used within the last week, but not today), most-stale first.
  readonly lowUsageOriginators = computed(() =>
    this.users()
      .filter(u => u.status === 'Light Usage')
      .sort((a, b) => (a.lastActive ?? '').localeCompare(b.lastActive ?? '')));

  readonly maxUnderusedUsers = computed(() => {
    const max = Math.max(0, ...this.underusedFeatures().map(f => f.uniqueUsers));
    return max > 0 ? max : 1;
  });

  readonly tabs: readonly { id: DashboardTabId; label: string }[] = [
    { id: 'whos-using-it', label: "Who's Using It" },
    { id: 'whats-doing', label: "What They're Doing" },
    { id: 'whos-not', label: "Who Isn't Using It" }
  ];

  constructor() {
    // One-time capability check — not filter-dependent, so it lives outside the effects below.
    this.apiService.getUsageExclusionsCanManage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: p => this.canManageExclusions.set(p.canManage),
        error: () => this.canManageExclusions.set(false)
      });

    // The roster decides the default manager, so it has to be known before anything else loads.
    this.loadManagers();

    // Four effects with disjoint dependencies. Previously the last three loaders were *also* called
    // from loadData, so every date or manager change fetched them twice. Each waits on
    // managerFilterReady for the same reason: one fetch with the right manager, not two.

    // Always-visible data: the KPI row, the donut, and the default tab's chart.
    effect(() => {
      if (!this.managerFilterReady()) return;
      const from = this.dateFrom();
      const to = this.dateTo();
      const managerId = this.managerFilter() ?? undefined;
      this.refreshTick();
      if (from && to) this.loadCoreData(from, to, managerId);
    });

    // Feature sessions also depend on the selected screen.
    effect(() => {
      if (!this.managerFilterReady()) return;
      const screen = this.selectedScreen();
      const from = this.dateFrom();
      const to = this.dateTo();
      const managerId = this.managerFilter() ?? undefined;
      this.refreshTick();
      if (from && to) this.loadFeatureSessions(from, to, managerId, screen);
    });

    // The weekly trend covers whole calendar weeks, so the date filter is not a dependency.
    effect(() => {
      if (!this.managerFilterReady()) return;
      const managerId = this.managerFilter() ?? undefined;
      this.refreshTick();
      this.loadWeeklyTrend(managerId);
    });

    // Per-tab data loads when its tab is first shown for the current filters.
    effect(() => {
      if (!this.managerFilterReady()) return;
      const tab = this.activeTab();
      const from = this.dateFrom();
      const to = this.dateTo();
      const managerId = this.managerFilter() ?? undefined;
      const tick = this.refreshTick();
      if (from && to) this.loadTabData(tab, from, to, managerId, `${from}|${to}|${managerId ?? ''}|${tick}`);
    });
  }

  /** Wraps a request so `loading` reflects everything in flight, not just the last responder. */
  private track<T>(source: Observable<T>): Observable<T> {
    this.pendingCount.update(n => n + 1);
    // finalize must run before takeUntilDestroyed so a cancelled request still decrements.
    return source.pipe(finalize(() => this.pendingCount.update(n => Math.max(0, n - 1))));
  }

  /** Quiet window for reportPanelFailure, so one outage that takes several panels down is one toast. */
  private static readonly PanelFailureQuietMs = 5000;
  private lastPanelFailureToastAt = 0;

  /**
   * The chart and breakdown panels used to swallow their errors, so a failed load drew an empty
   * chart or a table of zeros that read as "nobody used it". They share one message because they
   * load together and usually fail together; the KPI row and originator table keep their own.
   */
  private reportPanelFailure(): void {
    const now = Date.now();
    if (now - this.lastPanelFailureToastAt < UsageDashboardComponent.PanelFailureQuietMs) return;
    this.lastPanelFailureToastAt = now;
    this.toastService.show('Some usage panels failed to load — they may be empty or out of date. Refresh to try again.', 'error');
  }

  /** Loads the manager roster. Also the filter's Retry handler after a failed load. Deliberately
   *  not run through track(): the page-level spinner covers the first attempt via
   *  managerFilterReady, and a Retry from inside the dropdown must not blank every panel. */
  loadManagers(): void {
    this.managersLoading.set(true);
    this.managersLoadFailed.set(false);
    this.apiService.getUsageManagers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: rows => {
          this.managers.set(rows);
          this.managersLoading.set(false);
          this.applyDefaultManager(rows);
          this.managerFilterReady.set(true);
        },
        error: () => {
          this.managersLoadFailed.set(true);
          this.managersLoading.set(false);
          // No roster, no default: show the whole organisation rather than block the page. The
          // data endpoints don't need the directory when no manager is selected.
          this.managerFilterReady.set(true);
        }
      });
  }

  /**
   * Defaults the filter to the signed-in user — when they manage someone. The roster only lists
   * people who appear as someone's manager, so a non-manager is not in it; defaulting to them
   * would select a name the dropdown cannot display and a team the server resolves to nobody.
   * They start at "All Managers" instead.
   *
   * Applied once, from the first SUCCESSFUL roster load — so a Retry that finally succeeds after a
   * failed first attempt still defaults, but a later Retry never re-applies it. Also skipped when
   * the user has already picked a manager during an outage; their choice wins.
   */
  private applyDefaultManager(roster: UsageManager[]): void {
    if (this.defaultManagerApplied) return;
    this.defaultManagerApplied = true;
    if (this.managerFilter() !== null) return;
    const me = this.userRoles.userShortName().toLowerCase();
    const self = me ? roster.find(m => m.userId.toLowerCase() === me) : undefined;
    if (self) this.managerFilter.set(self.userId);
  }

  private loadCoreData(from: string, to: string, managerId?: string): void {
    this.track(this.apiService.getUsageDashboardSummary(from, to, managerId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.summary.set(data),
        error: () => this.toastService.show('Failed to load summary', 'error')
      });

    this.track(this.apiService.getUsageDashboardUsers(from, to, managerId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.users.set(data),
        error: () => this.toastService.show('Failed to load users', 'error')
      });

    this.track(this.apiService.getUsageDailyActive(from, to, managerId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: data => this.dailyActive.set(data), error: () => this.reportPanelFailure() });
  }

  /** Tracks which filter combination each tab's data was loaded for, so switching tabs back and
   *  forth doesn't refetch. */
  private readonly loadedTabKeys = new Map<DashboardTabId, string>();

  private loadTabData(tab: DashboardTabId, from: string, to: string, managerId: string | undefined, key: string): void {
    if (this.loadedTabKeys.get(tab) === key) return;
    this.loadedTabKeys.set(tab, key);

    if (tab === 'whats-doing') {
      this.track(this.apiService.getUsageActivityBreakdown(from, to, managerId))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: data => this.activityBreakdown.set(data), error: () => this.reportPanelFailure() });

      this.track(this.apiService.getUsageQueryLibraryUsage(from, to, managerId))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: data => this.queryLibraryUsage.set(data), error: () => this.reportPanelFailure() });

      this.track(this.apiService.getUsageQuerySearchGaps(from, to, managerId))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: data => this.querySearchGaps.set(data), error: () => this.reportPanelFailure() });
    }

    if (tab === 'whos-not') {
      this.track(this.apiService.getUsageUnderusedFeatures(from, to, managerId))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: data => this.underusedFeatures.set(data), error: () => this.reportPanelFailure() });
    }
  }

  loadFeatureSessions(from: string, to: string, managerId?: string, screen?: string): void {
    this.featureSessionsLoading.set(true);
    this.track(this.apiService.getUsageFeatureSessions(from, to, managerId, screen))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => { this.featureSessions.set(data); this.featureSessionsLoading.set(false); },
        error: () => { this.featureSessionsLoading.set(false); this.reportPanelFailure(); }
      });
  }

  loadWeeklyTrend(managerId?: string): void {
    this.track(this.apiService.getUsageWeeklyTrend(managerId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: data => this.weeklyTrend.set(data), error: () => this.reportPanelFailure() });
  }

  /** Exclusions change every panel's numbers, so re-read everything. */
  onExclusionsChanged(): void {
    this.loadedTabKeys.clear();
    this.refreshTick.update(n => n + 1);
  }

  setRange(range: '7d' | '30d'): void {
    const days = range === '7d' ? 7 : 30;
    this.dateFrom.set(localIsoDateDaysAgo(days - 1));
    this.dateTo.set(toLocalIsoDate(new Date()));
    this.activeRange.set(range);
    this.customRangeOpen.set(false);
  }

  onCustomDateChange(field: 'from' | 'to', value: string): void {
    if (field === 'from') this.dateFrom.set(value);
    else this.dateTo.set(value);
    this.activeRange.set('custom');
  }

  onTabChange(tabId: DashboardTabId): void {
    this.activeTab.set(tabId);
  }

  /** Navigate to the per-user drill-down page, propagating the active date range as query params
   *  so the detail view opens with the same window the admin was viewing. The manager filter is
   *  not propagated — it narrows who is listed, not one person's numbers. */
  selectUser(userId: string): void {
    this.router.navigate(['/usage-dashboard/users', userId], {
      queryParams: {
        from: this.dateFrom(),
        to: this.dateTo(),
      },
    });
  }
}
