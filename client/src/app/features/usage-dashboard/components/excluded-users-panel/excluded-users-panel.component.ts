import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { AccessUser, ExcludedUser } from '@models';

import { formatLastActive } from '../../utils/usage-format';

/**
 * Manages the accounts hidden from every usage-dashboard view — IT, dev and admin accounts whose
 * activity would otherwise skew adoption numbers. Excluding someone changes nothing about their
 * access to the app.
 *
 * Adding is a search-and-select over the people who actually have app access (the Entra access
 * group), so you pick a real user instead of typing an id — no spelling mistakes. If that roster
 * can't be read (Graph not configured/blocked in this environment) the panel falls back to a
 * free-text short-name entry so exclusions can still be managed.
 *
 * The whole Usage Dashboard is admin-gated (route adminGuard + AdminOnly endpoints), so only admin
 * accounts ever see this panel.
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

  // Picker state — the access-group roster to search, the current query, and the picked user.
  readonly accessUsers = signal<AccessUser[]>([]);
  readonly accessAvailable = signal(true); // assume picker; flips to false → free-text fallback
  readonly search = signal('');
  readonly selectedUser = signal<AccessUser | null>(null);

  readonly newReason = signal('');
  readonly newUserId = signal(''); // free-text fallback only

  readonly formatCreatedAt = formatLastActive;

  /** People with access who aren't already excluded, matching the search — capped for the dropdown. */
  readonly candidates = computed<AccessUser[]>(() => {
    const q = this.search().trim().toLowerCase();
    const already = new Set(this.excluded().map(e => e.userId.toLowerCase()));
    return this.accessUsers()
      .filter(u => !already.has(u.userId.toLowerCase()))
      .filter(u => !q || u.displayName.toLowerCase().includes(q) || u.userId.toLowerCase().includes(q))
      .slice(0, 8);
  });

  /** Add is enabled once a user is picked (picker mode) or typed (fallback mode). */
  readonly canAdd = computed(() =>
    this.accessAvailable() ? this.selectedUser() !== null : this.newUserId().trim().length > 0);

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    // Load on first open rather than on construction — most visits never open this panel.
    if (next && this.excluded().length === 0 && this.accessUsers().length === 0) this.load();
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

    // Roster for the picker. If it's unavailable (Graph not configured/blocked) or errors, fall back
    // to free-text entry so exclusions can still be managed.
    this.api.getUsageAccessUsers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => { this.accessAvailable.set(res.available); this.accessUsers.set(res.users ?? []); },
        error: () => { this.accessAvailable.set(false); this.accessUsers.set([]); }
      });
  }

  select(user: AccessUser): void {
    this.selectedUser.set(user);
    this.search.set('');
  }

  clearSelection(): void {
    this.selectedUser.set(null);
  }

  add(): void {
    if (this.saving()) return;
    // Picker mode uses the selected user's short name; fallback uses the typed id.
    const userId = this.accessAvailable() ? (this.selectedUser()?.userId ?? '') : this.newUserId().trim();
    if (!userId) return;

    this.saving.set(true);
    this.api.addUsageExcludedUser(userId, this.newReason())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: row => {
          this.excluded.update(rows => [...rows, row].sort((a, b) => a.userId.localeCompare(b.userId)));
          this.selectedUser.set(null);
          this.newUserId.set('');
          this.newReason.set('');
          this.search.set('');
          this.saving.set(false);
          this.toast.show(`${row.displayName || row.userId} excluded from usage reporting`, 'success');
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
