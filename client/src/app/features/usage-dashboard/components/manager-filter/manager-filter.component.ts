import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '@core/services/api.service';
import { UsageManager } from '@models';

/**
 * Manager filter for the usage dashboard: a searchable dropdown over the org hierarchy's active
 * managers (from the TradeUnitPreferences user/manager lookup). Picking one narrows every panel to
 * that manager's entire team — reports of reports included, manager included.
 *
 * The roster loads lazily on first open. If the managers endpoint is unavailable (the server fails
 * closed with a 503 on a TradeUnitPreferences outage) the panel shows a retry affordance rather
 * than a stale or empty roster.
 */
@Component({
  selector: 'app-manager-filter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manager-filter.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ManagerFilterComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Two-way: the selected manager's short name, or null for "All Managers". */
  readonly managerId = model<string | null>(null);

  readonly open = signal(false);
  readonly managers = signal<UsageManager[]>([]);
  readonly loading = signal(false);
  readonly loadFailed = signal(false);
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
    const next = !this.open();
    this.open.set(next);
    // Load on first open rather than on construction — most visits never open this dropdown.
    if (next && this.managers().length === 0 && !this.loading()) this.load();
  }

  close(): void {
    this.open.set(false);
    this.search.set('');
  }

  load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.api.getUsageManagers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: rows => { this.managers.set(rows); this.loading.set(false); },
        error: () => { this.loadFailed.set(true); this.loading.set(false); }
      });
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
