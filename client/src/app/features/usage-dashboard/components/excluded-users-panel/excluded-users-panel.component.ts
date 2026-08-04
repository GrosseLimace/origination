import { ChangeDetectionStrategy, Component, DestroyRef, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { ExcludedUser } from '@models';

import { formatLastActive } from '../../utils/usage-format';

/**
 * Manages the accounts hidden from every usage-dashboard view — IT, dev and admin accounts whose
 * activity would otherwise skew adoption numbers. Excluding someone changes nothing about their
 * access to the app.
 *
 * This list used to be maintainable only by hand-written SQL against
 * dbo.UsageDashboardExcludedUsers.
 */
@Component({
  selector: 'app-excluded-users-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './excluded-users-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExcludedUsersPanelComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Emitted after an add or remove, so the dashboard can re-read its numbers. */
  readonly changed = output<void>();

  readonly open = signal(false);
  readonly excluded = signal<ExcludedUser[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly newUserId = signal('');
  readonly newReason = signal('');

  readonly formatCreatedAt = formatLastActive;

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    // Load on first open rather than on construction — most visits never open this panel.
    if (next && this.excluded().length === 0) this.load();
  }

  close(): void {
    this.open.set(false);
  }

  load(): void {
    this.loading.set(true);
    this.api.getUsageExcludedUsers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: rows => { this.excluded.set(rows); this.loading.set(false); },
        error: () => {
          this.toast.show('Failed to load excluded users', 'error');
          this.loading.set(false);
        }
      });
  }

  add(): void {
    const userId = this.newUserId().trim();
    if (!userId || this.saving()) return;

    this.saving.set(true);
    this.api.addUsageExcludedUser(userId, this.newReason())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: row => {
          this.excluded.update(rows => [...rows, row].sort((a, b) => a.userId.localeCompare(b.userId)));
          this.newUserId.set('');
          this.newReason.set('');
          this.saving.set(false);
          this.toast.show(`${row.userId} excluded from usage reporting`, 'success');
          this.changed.emit();
        },
        error: err => {
          this.saving.set(false);
          this.toast.show(err?.status === 409 ? 'That user is already excluded' : 'Failed to add exclusion', 'error');
        }
      });
  }

  remove(row: ExcludedUser): void {
    this.api.removeUsageExcludedUser(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.excluded.update(rows => rows.filter(r => r.id !== row.id));
          this.toast.show(`${row.userId} will appear in usage reporting again`, 'success');
          this.changed.emit();
        },
        error: () => this.toast.show('Failed to remove exclusion', 'error')
      });
  }
}
