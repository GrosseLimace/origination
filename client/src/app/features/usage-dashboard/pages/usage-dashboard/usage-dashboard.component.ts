import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';
import {
  TableComponent, TableHeaderComponent, TableBodyComponent,
  TableRowComponent, TableHeadComponent, TableCellComponent
} from '@shared/components/table/table.component';
import {
  UsageDashboardSummary, UsageDashboardUser,
  UsageDashboardInactiveUser, DailyActive,
  FeatureSessions, WeeklyTrend, ActivityBreakdown, UnderusedFeature,
  QueryLibraryUsage, QuerySearchGap
} from '@models';

@Component({
  selector: 'app-usage-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    TradeUnitSelectorComponent,
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

  // Date range
  readonly dateFrom = signal(this.formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  readonly dateTo = signal(this.formatDate(new Date()));
  readonly activeRange = signal<'7d' | '30d' | 'custom'>('30d');
  readonly customRangeOpen = signal(false);

  // Tab state
  readonly activeTab = signal<'whos-using-it' | 'whats-doing' | 'whos-not'>('whos-using-it');
  readonly statusFilter = signal<string>('all');

  // Data signals
  readonly summary = signal<UsageDashboardSummary | null>(null);
  readonly users = signal<UsageDashboardUser[]>([]);
  readonly dailyActive = signal<DailyActive[]>([]);
  readonly featureSessions = signal<FeatureSessions[]>([]);
  readonly weeklyTrend = signal<WeeklyTrend[]>([]);
  readonly activityBreakdown = signal<ActivityBreakdown[]>([]);
  readonly inactiveUsers = signal<UsageDashboardInactiveUser[]>([]);
  readonly underusedFeatures = signal<UnderusedFeature[]>([]);
  readonly queryLibraryUsage = signal<QueryLibraryUsage[]>([]);
  readonly queryLibraryOpen = signal(false);
  readonly querySearchGaps = signal<QuerySearchGap[]>([]);
  readonly querySearchGapsOpen = signal(false);
  readonly loading = signal(false);

  // Trade unit key derived from app state (shared trade unit selector)
  readonly tradeUnitKey = computed(() => {
    const selected = this.appState.selectedTradeUnits();
    return selected.length > 0 ? selected.join(',') : undefined;
  });

  // Search and sort for originator table
  readonly originatorSearch = signal('');
  readonly sortColumn = signal<string | null>(null);
  readonly sortDirection = signal<'none' | 'asc' | 'desc'>('none');

  // Filtered users by status + search, then sorted
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

    // Sort
    const col = this.sortColumn();
    const dir = this.sortDirection();
    if (col && dir !== 'none') {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        switch (col) {
          case 'name': cmp = a.displayName.localeCompare(b.displayName); break;
          case 'status': cmp = a.status.localeCompare(b.status); break;
          case 'lastLogin': cmp = (a.lastActive ?? '').localeCompare(b.lastActive ?? ''); break;
          case 'logins': cmp = a.loginCount - b.loginCount; break;
          case 'avgSession': cmp = a.avgSessionMinutes - b.avgSessionMinutes; break;
          case 'contacted': cmp = a.customersContacted - b.customersContacted; break;
          case 'notes': cmp = a.notesCreated - b.notesCreated; break;
        }
        return dir === 'desc' ? -cmp : cmp;
      });
    }
    return result;
  });

  handleSort(column: string): void {
    if (this.sortColumn() === column) {
      if (this.sortDirection() === 'none') this.sortDirection.set('asc');
      else if (this.sortDirection() === 'asc') this.sortDirection.set('desc');
      else { this.sortDirection.set('none'); this.sortColumn.set(null); }
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  getSortIconClass(column: string): string {
    return this.sortColumn() === column ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600';
  }

  // Status breakdown counts
  readonly activeCount = computed(() => this.users().filter(u => u.status === 'Active').length);
  readonly lowUsageCount = computed(() => this.users().filter(u => u.status === 'Inactive').length);
  readonly inactiveCount = computed(() => this.users().filter(u => u.status === 'Never Logged In').length);
  readonly needsAttentionCount = computed(() => this.lowUsageCount() + this.inactiveCount());

  // Donut chart segments for status breakdown (circumference = 2 * PI * 40 ≈ 251.33)
  readonly circumference = 2 * Math.PI * 40;
  readonly donutSegments = computed(() => {
    const total = this.users().length;
    if (total === 0) return { activeLen: 0, activeOffset: 0, lowLen: 0, lowOffset: 0, inactiveLen: 0, inactiveOffset: 0 };
    const c = this.circumference;
    const activeLen = (this.activeCount() / total) * c;
    const lowLen = (this.lowUsageCount() / total) * c;
    const inactiveLen = (this.inactiveCount() / total) * c;
    return {
      activeLen, activeOffset: 0,
      lowLen, lowOffset: -(activeLen),
      inactiveLen, inactiveOffset: -(activeLen + lowLen)
    };
  });

  // Daily active chart — last 15 days only
  readonly dailyActiveLast15 = computed(() => {
    const data = this.dailyActive();
    return data.slice(-15);
  });

  readonly maxDailyActive = computed(() => {
    const data = this.dailyActiveLast15();
    const max = Math.max(...data.map(d => d.uniqueUserCount));
    return max > 0 ? max : 1;
  });

  // Logins label
  readonly loginsLabel = computed(() => this.activeRange() === '7d' ? 'Avg Logins / Week' : 'Avg Logins / Month');
  readonly loginsSubLabel = computed(() => this.activeRange() === '7d' ? 'sessions this week' : 'sessions per month');
  readonly avgLoginsDisplay = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    if (this.activeRange() === '7d') return s.avgLoginsPerWeek;
    return Math.round(s.avgLoginsPerWeek * 4.33 * 10) / 10;
  });

  // Feature sessions
  readonly selectedScreen = signal<string>('all');
  readonly featureScreens = [
    { id: 'all', label: 'All Features' },
    { id: 'customers', label: 'Customer Page' },
    { id: 'dashboard', label: 'Planting Intention Dashboard' },
    { id: 'build-a-list', label: 'Build a List' },
    { id: 'insights', label: 'Actionable Insights' },
    { id: 'bidsheet', label: 'Bid Sheet' },
  ];

  readonly selectedScreenFeatures = computed(() => {
    const data = this.featureSessions();
    const screenId = this.selectedScreen();
    if (screenId === 'all') {
      return data.map(f => ({ name: f.featureLabel, sessions: f.sessionCount }));
    }
    const screen = data.find(f => f.featureCode === screenId);
    if (!screen) return [];
    return screen.subFeatures.map(sf => ({ name: sf.label, sessions: sf.sessionCount }));
  });

  readonly maxScreenFeatureSessions = computed(() => {
    const feats = this.selectedScreenFeatures();
    const max = Math.max(...feats.map(f => f.sessions));
    return max > 0 ? max : 1;
  });

  // Weekly trend
  readonly maxWeeklyTrend = computed(() => {
    const data = this.weeklyTrend();
    const max = Math.max(...data.map(w => Math.max(w.totalLogins, w.totalSessions)));
    return max > 0 ? max : 1;
  });

  // Activity breakdown chart max
  readonly maxActivityBreakdown = computed(() => {
    const data = this.activityBreakdown();
    if (data.length === 0) return 1;
    return Math.max(...data.map(d => d.profilesViewed + d.contractsViewed + d.notesTaken + d.callsEmails + d.listsBuilt + d.plantingIntentionsAdded + d.producerDetails));
  });

  // Inactive originators
  readonly inactiveDaysThreshold = signal<number>(30);
  readonly inactiveCustomOpen = signal(false);
  readonly inactiveCustomDays = signal<string>('30');

  readonly inactiveOriginators = computed(() => {
    return this.inactiveUsers().filter(u => u.status === 'Inactive' || u.status === 'Never Logged In');
  });

  readonly lowUsageOriginators = computed(() => {
    return this.users().filter(u => u.status !== 'Never Logged In' && u.loginCount < 15 && u.loginCount > 0);
  });

  readonly tabs = [
    { id: 'whos-using-it', label: "Who's Using It" },
    { id: 'whats-doing', label: "What They're Doing" },
    { id: 'whos-not', label: "Who Isn't Using It" }
  ];

  constructor() {
    // Re-fetch when date range or trade unit changes
    effect(() => {
      const from = this.dateFrom();
      const to = this.dateTo();
      const tuKey = this.tradeUnitKey();
      if (from && to) {
        this.loadData(from, to, tuKey);
      }
    });

    // Re-fetch feature sessions when screen selection changes
    effect(() => {
      const screen = this.selectedScreen();
      const from = this.dateFrom();
      const to = this.dateTo();
      const tuKey = this.tradeUnitKey();
      if (from && to) {
        this.loadFeatureSessions(from, to, tuKey, screen);
      }
    });

    // Re-fetch inactive when threshold changes
    effect(() => {
      const threshold = this.inactiveDaysThreshold();
      const from = this.dateFrom();
      const to = this.dateTo();
      const tuKey = this.tradeUnitKey();
      if (from && to) {
        this.loadInactive(from, to, tuKey, threshold);
      }
    });
  }

  loadData(from: string, to: string, tradeUnitKey?: string): void {
    this.loading.set(true);

    this.apiService.getUsageDashboardSummary(from, to, tradeUnitKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.summary.set(data),
        error: () => this.toastService.show('Failed to load summary', 'error')
      });

    this.apiService.getUsageDashboardUsers(from, to, tradeUnitKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.users.set(data),
        error: () => this.toastService.show('Failed to load users', 'error')
      });

    this.apiService.getUsageDailyActive(from, to, tradeUnitKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.dailyActive.set(data),
        error: () => {}
      });

    this.loadFeatureSessions(from, to, tradeUnitKey, this.selectedScreen());

    this.apiService.getUsageWeeklyTrend(tradeUnitKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.weeklyTrend.set(data),
        error: () => {}
      });

    this.apiService.getUsageActivityBreakdown(from, to, tradeUnitKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.activityBreakdown.set(data),
        error: () => {}
      });

    this.loadInactive(from, to, tradeUnitKey, this.inactiveDaysThreshold());

    this.apiService.getUsageQueryLibraryUsage(from, to, tradeUnitKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: data => this.queryLibraryUsage.set(data), error: () => {} });

    this.apiService.getUsageQuerySearchGaps(from, to, tradeUnitKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: data => this.querySearchGaps.set(data), error: () => {} });

    this.apiService.getUsageUnderusedFeatures(from, to, tradeUnitKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => {
          this.underusedFeatures.set(data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
  }

  loadFeatureSessions(from: string, to: string, tradeUnitKey?: string, screen?: string): void {
    this.apiService.getUsageFeatureSessions(from, to, tradeUnitKey, screen)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: data => this.featureSessions.set(data), error: () => {} });
  }

  loadInactive(from: string, to: string, tradeUnitKey?: string, daysThreshold?: number): void {
    this.apiService.getUsageDashboardInactive(from, to, tradeUnitKey, daysThreshold)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: data => this.inactiveUsers.set(data), error: () => {} });
  }

  setRange(range: '7d' | '30d'): void {
    const days = range === '7d' ? 7 : 30;
    this.dateFrom.set(this.formatDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000)));
    this.dateTo.set(this.formatDate(new Date()));
    this.activeRange.set(range);
    this.customRangeOpen.set(false);
  }

  onCustomDateChange(field: 'from' | 'to', value: string): void {
    if (field === 'from') this.dateFrom.set(value);
    else this.dateTo.set(value);
    this.activeRange.set('custom');
  }

  onTabChange(tabId: string): void {
    this.activeTab.set(tabId as any);
  }

  setInactiveDays(days: number): void {
    this.inactiveDaysThreshold.set(days);
    this.inactiveCustomOpen.set(false);
  }

  applyCustomInactiveDays(): void {
    const days = parseInt(this.inactiveCustomDays(), 10);
    if (days > 0) this.inactiveDaysThreshold.set(days);
    this.inactiveCustomOpen.set(false);
  }

  formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  formatTimeSpent(minutes: number): string {
    if (minutes <= 0) return '0m';
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = Math.round(minutes % 60);
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
    return parts.join(' ');
  }

  formatSessionDuration(minutes: number): string {
    if (minutes >= 60) {
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${Math.round(minutes)}m`;
  }

  formatLastActive(dateStr: string | null): string {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    // Compare dates only (ignore time) to avoid timezone off-by-one
    const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((todayLocal.getTime() - dateLocal.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatTimestamp(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  formatDayLabel(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  formatWeekLabel(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  getStatusClasses(status: string): string {
    switch (status) {
      case 'Active': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
      case 'Inactive': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'Never Logged In': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300';
    }
  }

  getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }
}
