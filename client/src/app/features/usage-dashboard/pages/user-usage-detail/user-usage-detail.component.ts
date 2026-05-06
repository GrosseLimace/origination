import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';
import {
  TableComponent, TableHeaderComponent, TableBodyComponent,
  TableRowComponent, TableHeadComponent, TableCellComponent
} from '@shared/components/table/table.component';
import { UserUsageDetail, RecentActivity } from '@models';

type TabId = 'producer-page' | 'build-a-list' | 'insights' | 'bidsheet' | 'dashboard';

@Component({
  selector: 'app-user-usage-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    TradeUnitSelectorComponent,
    TableComponent, TableHeaderComponent, TableBodyComponent,
    TableRowComponent, TableHeadComponent, TableCellComponent
  ],
  templateUrl: './user-usage-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserUsageDetailComponent {
  readonly Math = Math;
  private readonly api = inject(ApiService);
  readonly appState = inject(AppStateService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // ── State ──
  readonly userId = signal<string>('');
  readonly dateFrom = signal(this.formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  readonly dateTo = signal(this.formatDate(new Date()));
  readonly activeRange = signal<'7d' | '30d' | 'custom'>('30d');
  readonly customRangeOpen = signal(false);
  readonly detail = signal<UserUsageDetail | null>(null);
  readonly loading = signal(false);
  readonly activeTab = signal<TabId>('producer-page');

  readonly tabs: { id: TabId; label: string; featureCode: string }[] = [
    { id: 'producer-page', label: 'Producer Page',       featureCode: 'customers' },
    { id: 'build-a-list',  label: 'Build a List',        featureCode: 'build-a-list' },
    { id: 'insights',      label: 'Actionable Insights', featureCode: 'insights' },
    { id: 'bidsheet',      label: 'Bid Sheet',           featureCode: 'bidsheet' },
    { id: 'dashboard',     label: 'Planting Dashboard',  featureCode: 'dashboard' },
  ];

  // Trade unit key — same logic as the parent dashboard so the detail respects
  // group selection too.
  readonly tradeUnitKey = computed(() => {
    const selected = this.appState.selectedTradeUnits();
    if (selected.length > 0) return selected.join(',');
    const groups = this.appState.selectedGroupNames();
    if (groups.length > 0) {
      const allGroups = this.appState.userGroups();
      const codes = allGroups
        .filter(g => groups.includes(g.groupName))
        .flatMap(g => g.tradeUnitCodes);
      if (codes.length > 0) return codes.join(',');
    }
    return undefined;
  });

  // ── Derived ──
  readonly maxDaily = computed(() => {
    const d = this.detail();
    if (!d || d.dailyActivity.length === 0) return 1;
    return Math.max(1, ...d.dailyActivity.map(a => a.eventCount));
  });

  readonly maxScreenMinutes = computed(() => {
    const d = this.detail();
    if (!d || d.timePerScreen.length === 0) return 1;
    return Math.max(1, ...d.timePerScreen.map(s => s.minutes));
  });

  // Last 30 days max for the daily-activity chart x-axis labels
  readonly dailyActivitySlice = computed(() => {
    const d = this.detail();
    if (!d) return [];
    return d.dailyActivity.slice(-30);
  });

  /** Days in the window where the user had at least one event — manager-glanceable
   *  "consistency" metric. Pairs with windowDays for the "X of Y" display. */
  readonly activeDays = computed(() => {
    const d = this.detail();
    if (!d) return 0;
    return d.dailyActivity.filter(a => a.eventCount > 0).length;
  });

  readonly windowDays = computed(() => {
    const d = this.detail();
    return d?.dailyActivity.length ?? 0;
  });

  /** Recent activity rows partitioned by featureCode so each tab can render only
   *  its own events. Falls back to "other" for any featureCode not in the tab list. */
  readonly recentActivityByFeature = computed(() => {
    const d = this.detail();
    const map = new Map<string, RecentActivity[]>();
    if (!d) return map;
    for (const ev of d.recentActivity) {
      const key = ev.featureCode ?? 'other';
      const arr = map.get(key);
      if (arr) arr.push(ev);
      else map.set(key, [ev]);
    }
    return map;
  });

  /** Recent activity for the currently selected tab. */
  readonly currentTabRecentActivity = computed(() => {
    const tab = this.tabs.find(t => t.id === this.activeTab());
    if (!tab) return [];
    return this.recentActivityByFeature().get(tab.featureCode) ?? [];
  });

  /** Display label for the active tab — used to title the per-feature sections. */
  readonly activeTabLabel = computed(() => {
    return this.tabs.find(t => t.id === this.activeTab())?.label ?? '';
  });

  setActiveTab(id: TabId): void {
    this.activeTab.set(id);
  }

  getTabClass(id: TabId): string {
    const base = 'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors';
    return this.activeTab() === id
      ? `${base} bg-scoular-green-accessible text-white`
      : `${base} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700`;
  }

  constructor() {
    // Read route params on construction
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = params.get('userId');
      if (id) this.userId.set(id);
    });

    // Date range / TU defaults can be seeded from the parent's query params on entry
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(qp => {
      const from = qp.get('from');
      const to = qp.get('to');
      if (from) this.dateFrom.set(from);
      if (to) this.dateTo.set(to);
      // tradeUnitKey is derived from appState, so we don't write it here — the
      // selector value is the source of truth and persists across pages.
    });

    // Re-fetch whenever userId, date range, or TU key change
    effect(() => {
      const id = this.userId();
      const from = this.dateFrom();
      const to = this.dateTo();
      const tuKey = this.tradeUnitKey();
      if (!id || !from || !to) return;
      this.load(id, from, to, tuKey);
    });
  }

  load(userId: string, from: string, to: string, tradeUnitKey?: string): void {
    this.loading.set(true);
    this.api.getUserUsageDetail(userId, from, to, tradeUnitKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => { this.detail.set(data); this.loading.set(false); },
        error: () => {
          this.toast.show('Failed to load user detail', 'error');
          this.loading.set(false);
        }
      });
  }

  // ── Range controls (mirror parent dashboard) ──
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

  goBack(): void {
    this.router.navigate(['/usage-dashboard'], {
      queryParams: {
        from: this.dateFrom(),
        to: this.dateTo(),
      },
    });
  }

  // ── Formatters (kept consistent with parent) ──
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
    const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((todayLocal.getTime() - dateLocal.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatTimestamp(dateStr: string): string {
    // Backend writes DateTime.UtcNow without a 'Z' suffix; JavaScript would parse
    // such strings as local time. Append Z when missing so we treat the value as
    // UTC and toLocaleString converts it to the viewer's local time correctly.
    const raw = /[Zz]|[+-]\d{2}:?\d{2}$/.test(dateStr) ? dateStr : dateStr + 'Z';
    const date = new Date(raw);
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  formatDayLabel(dateStr: string): string {
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

  /** True when the string is purely digits — i.e., an opaque numeric id that
   *  the backend couldn't resolve. Used to render those distinctly (mono +
   *  lighter) versus already-readable strings like location names or season
   *  targets summaries. */
  isNumericId(s: string): boolean {
    return /^\d+$/.test(s);
  }

  /** Pretty-print a sub-feature code for the recent-activity table. */
  formatSubFeature(code: string | null): string {
    if (!code) return '—';
    return code.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  }

  /** Resolve the most useful "Action" label for a recent-activity row. Falls back
   *  to the event type when sub-feature is null (mainly screen_enter events that
   *  fire on every route navigation). */
  formatAction(subFeatureCode: string | null, eventType: string, featureCode: string): string {
    if (subFeatureCode) return this.formatSubFeature(subFeatureCode);
    switch (eventType) {
      case 'screen_enter': return `Viewed ${this.formatFeatureLabel(featureCode)}`;
      case 'call_click':   return 'Called Producer';
      case 'email_click':  return 'Emailed Producer';
      case 'interaction':  return 'Interaction';
      default:             return eventType.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
    }
  }

  /** Human-readable feature label for the recent-activity table. Full names so
   *  composed strings like "Viewed Producer Page" read naturally. */
  formatFeatureLabel(code: string): string {
    const map: Record<string, string> = {
      'customers': 'Producer Page',
      'dashboard': 'Planting Dashboard',
      'build-a-list': 'Build a List',
      'insights': 'Actionable Insights',
      'bidsheet': 'Bid Sheet',
      'usage-dashboard': 'Usage Dashboard',
      'position-report': 'Position Report',
    };
    return map[code] ?? code;
  }
}
