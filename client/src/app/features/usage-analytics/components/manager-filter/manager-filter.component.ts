import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { UsageManager } from '@models';

/**
 * Manager filter for the usage dashboard: a searchable dropdown over the org hierarchy's active
 * managers (from the TradeUnitPreferences user/manager lookup). Picking one narrows every panel to
 * that manager's entire team — reports of reports included, manager included. Clearing it shows the
 * whole organisation.
 *
 * Presentational: the roster comes in as an input. The dashboard page owns the load, because it has
 * to know the roster before its first data fetch — the filter defaults to the signed-in user, and
 * that can only be decided once the page knows whether they manage anyone. If the managers endpoint
 * is unavailable (the server fails closed with a 503 on a TradeUnitPreferences outage) the panel
 * shows a retry affordance rather than a stale or empty roster.
 */
@Component({
  selector: 'app-manager-filter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manager-filter.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ManagerFilterComponent {
  /** Two-way: the selected manager's short name, or null for "All Managers". */
  readonly managerId = model<string | null>(null);

  readonly managers = input<UsageManager[]>([]);
  readonly loading = input(false);
  readonly loadFailed = input(false);

  /** The user asked to reload the roster after a failed load. */
  readonly retry = output<void>();

  readonly open = signal(false);
  readonly search = signal('');

  readonly selected = computed<UsageManager | null>(() => {
    const id = (this.managerId() ?? '').toLowerCase();
    return id ? this.managers().find(m => m.userId.toLowerCase() === id) ?? null : null;
  });

  /** Managers matching the search — capped for the dropdown. */
  readonly candidates = computed<UsageManager[]>(() => {
    const q = this.search().trim().toLowerCase();
    return this.managers()
      .filter(m => !q || m.displayName.toLowerCase().includes(q) || m.userId.toLowerCase().includes(q))
      .slice(0, 12);
  });

  toggle(): void {
    this.open.set(!this.open());
  }

  close(): void {
    this.open.set(false);
    this.search.set('');
  }

  select(manager: UsageManager): void {
    this.managerId.set(manager.userId);
    this.close();
  }

  clear(): void {
    this.managerId.set(null);
    this.close();
  }
}
