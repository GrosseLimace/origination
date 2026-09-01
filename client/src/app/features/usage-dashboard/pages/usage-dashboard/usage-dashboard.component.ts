import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, finalize } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';
import {
  TableComponent, TableHeaderComponent, TableBodyComponent,
  TableRowComponent, TableHeadComponent, TableCellComponent
} from '@shared/components/table/table.component';
import {
  UsageDashboardSummary, UsageDashboardUser, DailyActive,
  FeatureSessions, WeeklyTrend, ActivityBreakdown, UnderusedFeature,
  QueryLibraryUsage, QuerySearchGap
} from '@models';

import { SortIconComponent } from '../../components/sort-icon/sort-icon.component';
import { ExcludedUsersPanelComponent } from '../../components/excluded-users-panel/excluded-users-panel.component';
import { ManagerFilterComponent } from '../../components/manager-filter/manager-filter.component';
import { createTableSort } from '../../utils/table-sort';
import { tradeUnitKeySignal } from '../../utils/trade-unit-key';
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
    TradeUnitSelectorComponent,
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
  readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
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

  readonly tradeUnitKey = tradeUnitKeySignal(this.appState);

  /** Selected manager's short name, or null for everyone. Narrows every panel to that manager's
   *  entire org subtree (server-side, via the managerId query param). */
  readonly managerFilter = signal<string | null>(null);

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
  readonly loading = computed(() => this.pendingCount() > 0);

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

    // Four effects with disjoint dependencies. Previously the last three loaders were *also* called
    // from loadData, so every date or trade-unit change fetched them twice.

    // Always-visible data: the KPI row, the donut, and the default tab's chart.
    effect(() => {
      const from = this.dateFrom();
      const to = this.dateTo();
      const tuKey = this.tradeUnitKey();
      const managerId = this.managerFilter() ?? undefined;
      this.refreshTick();
      if (from && to) this.loadCoreData(from, to, tuKey, managerId);
    });

    // Feature sessions also depend on the selected screen.
    effect(() => {
      const screen = this.selectedScreen();
      const from = this.dateFrom();
      const to = this.dateTo();
      const tuKey = this.tradeUnitKey();
      const managerId = this.managerFilter() ?? undefined;
      this.refreshTick();
      if (from && to) this.loadFeatureSessions(from, to, tuKey, managerId, screen);
    });

    // The weekly trend covers whole calendar weeks, so the date filter is not a dependency.
    effect(() => {
      const tuKey = this.tradeUnitKey();
      const managerId = this.managerFilter() ?? undefined;
      this.refreshTick();
      this.loadWeeklyTrend(tuKey, managerId);
    });

    // Per-tab data loads when its tab is first shown for the current filters.
    effect(() => {
      const tab = this.activeTab();
      const from = this.dateFrom();
      const to = this.dateTo();
      const tuKey = this.tradeUnitKey();
      const managerId = this.managerFilter() ?? undefined;
      const tick = this.refreshTick();
      if (from && to) this.loadTabData(tab, from, to, tuKey, managerId, `${from}|${to}|${tuKey ?? ''}|${managerId ?? ''}|${tick}`);
    });
  }

  /** Wraps a request so `loading` reflects everything in flight, not just the last responder. */
  private track<T>(source: Observable<T>): Observable<T> {
    this.pendingCount.update(n => n + 1);
    // finalize must run before takeUntilDestroyed so a cancelled request still decrements.
    return source.pipe(finalize(() => this.pendingCount.update(n => Math.max(0, n - 1))));
  }

  private loadCoreData(from: string, to: string, tradeUnitKey?: string, managerId?: string): void {
    this.track(this.apiService.getUsageDashboardSummary(from, to, tradeUnitKey, managerId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.summary.set(data),
        error: () => this.toastService.show('Failed to load summary', 'error')
      });

    this.track(this.apiService.getUsageDashboardUsers(from, to, tradeUnitKey, managerId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.users.set(data),
        error: () => this.toastService.show('Failed to load users', 'error')
      });

    this.track(this.apiService.getUsageDailyActive(from, to, tradeUnitKey, managerId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: data => this.dailyActive.set(data), error: () => {} });
  }

  /** Tracks which filter combination each tab's data was loaded for, so switching tabs back and
   *  forth doesn't refetch. */
  private readonly loadedTabKeys = new Map<DashboardTabId, string>();

  private loadTabData(tab: DashboardTabId, from: string, to: string, tradeUnitKey: string | undefined, managerId: string | undefined, key: string): void {
    if (this.loadedTabKeys.get(tab) === key) return;
    this.loadedTabKeys.set(tab, key);

    if (tab === 'whats-doing') {
      this.track(this.apiService.getUsageActivityBreakdown(from, to, tradeUnitKey, managerId))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: data => this.activityBreakdown.set(data), error: () => {} });

      this.track(this.apiService.getUsageQueryLibraryUsage(from, to, tradeUnitKey, managerId))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: data => this.queryLibraryUsage.set(data), error: () => {} });

      this.track(this.apiService.getUsageQuerySearchGaps(from, to, tradeUnitKey, managerId))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: data => this.querySearchGaps.set(data), error: () => {} });
    }

    if (tab === 'whos-not') {
      this.track(this.apiService.getUsageUnderusedFeatures(from, to, tradeUnitKey, managerId))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: data => this.underusedFeatures.set(data), error: () => {} });
    }
  }

  loadFeatureSessions(from: string, to: string, tradeUnitKey?: string, managerId?: string, screen?: string): void {
    this.featureSessionsLoading.set(true);
    this.track(this.apiService.getUsageFeatureSessions(from, to, tradeUnitKey, managerId, screen))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => { this.featureSessions.set(data); this.featureSessionsLoading.set(false); },
        error: () => this.featureSessionsLoading.set(false)
      });
  }

  loadWeeklyTrend(tradeUnitKey?: string, managerId?: string): void {
    this.track(this.apiService.getUsageWeeklyTrend(tradeUnitKey, managerId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: data => this.weeklyTrend.set(data), error: () => {} });
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

  /** Navigate to the per-user drill-down page, propagating the active date range
   *  and trade-unit context as query params so the detail view opens with the
   *  same window the admin was viewing. */
  selectUser(userId: string): void {
    this.router.navigate(['/usage-dashboard/users', userId], {
      queryParams: {
        from: this.dateFrom(),
        to: this.dateTo(),
        tradeUnitKey: this.tradeUnitKey() ?? null,
      },
    });
  }
}
