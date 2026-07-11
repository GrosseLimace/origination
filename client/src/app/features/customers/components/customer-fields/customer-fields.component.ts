import { Component, ChangeDetectionStrategy, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { Customer, CustomerFieldTag, FieldTagDraft, FieldTagMapConfig } from '@models';
import { FieldTagMapComponent } from '../field-tag-map/field-tag-map.component';
import { FieldTagListComponent } from '../field-tag-list/field-tag-list.component';

/**
 * CustomerFieldsComponent — parent composition for the Field Tagging POC's "Fields (N)" tab.
 * See docs/poc/field-tagging/04-frontend-list-and-hover-sync.md → "Parent: CustomerFieldsComponent".
 *
 * Owns the single source of truth for hover sync (`hoveredTagId`), the review/select mode toggle,
 * and the click-to-fly command signal — passed down to both `FieldTagMapComponent` and
 * `FieldTagListComponent` as inputs, written by either child's corresponding output. Also owns all
 * persistence (create/delete/apply-calculated-acres): neither child talks to `ApiService` directly.
 */
@Component({
  selector: 'app-customer-fields',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonComponent, FieldTagMapComponent, FieldTagListComponent],
  templateUrl: './customer-fields.component.html',
})
export class CustomerFieldsComponent {
  private readonly apiService = inject(ApiService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs / outputs ──────────────────────────────────────────────────────
  readonly customer = input.required<Customer>();
  readonly tags = input<CustomerFieldTag[]>([]);
  readonly mapConfig = input.required<FieldTagMapConfig>();
  readonly tagsChange = output<CustomerFieldTag[]>();

  // ── Owned state — single source of truth for hover sync (see class doc) ──
  readonly hoveredTagId = signal<number | null>(null);
  readonly mode = signal<'review' | 'select'>('review');
  /** Click-to-fly "command" signal. Modeled as { tagId, nonce } (not just tagId) so clicking the
   *  SAME row twice still re-fires the map's fitBounds — plain signal equality would otherwise
   *  swallow a repeat click on an unchanged tagId (04-frontend-list-and-hover-sync.md → "Click-to-fly"). */
  readonly flyToTag = signal<{ tagId: number; nonce: number } | null>(null);
  private flyNonce = 0;

  /** Total calculated acres across all currently loaded tags (null calcAcres excluded). */
  readonly totalAcres = computed(() => this.tags().reduce((sum, t) => sum + (t.calcAcres ?? 0), 0));

  /** Row pending delete confirmation (inline modal — mirrors the Notes delete-confirm pattern
   *  already used elsewhere in the Customer Profile; the shared ConfirmDialogService/
   *  app-confirm-dialog exists but is dead/unwired code with broken relative imports today). */
  readonly tagPendingDelete = signal<CustomerFieldTag | null>(null);
  readonly isApplyingAcres = signal(false);

  // ── Mode toggle ("Add fields" / "Done") ──────────────────────────────────
  toggleMode(): void {
    this.mode.set(this.mode() === 'review' ? 'select' : 'review');
  }

  startAddingFields(): void {
    this.mode.set('select');
  }

  // ── Hover sync (list <-> map), both funnel into the one signal ───────────
  onRowHover(tagId: number | null): void {
    this.hoveredTagId.set(tagId);
  }

  onMapHover(tagId: number | null): void {
    this.hoveredTagId.set(tagId);
  }

  // ── Click-to-fly ──────────────────────────────────────────────────────────
  onRowClick(tagId: number): void {
    this.flyNonce++;
    this.flyToTag.set({ tagId, nonce: this.flyNonce });
  }

  // ── Persistence: create (map's fieldConfirmed output) ────────────────────
  onFieldConfirmed(draft: FieldTagDraft): void {
    const customerId = this.customer().id;
    this.apiService.createFieldTag(customerId, draft)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.tagsChange.emit([...this.tags(), created]);
        },
        error: (err: Error & { status?: number }) => {
          if (err.status === 409) {
            this.onDuplicateAttempted(draft.externalRef);
          } else {
            this.toastService.error('Failed to save this field. Please try again.');
          }
        },
      });
  }

  onDuplicateAttempted(_externalRef: string): void {
    this.toastService.warning('This field is already tagged for this producer.');
  }

  onSelectError(message: string): void {
    this.toastService.error(message);
  }

  // ── Delete (list's delete output -> confirm -> soft-delete) ──────────────
  requestDelete(tagId: number): void {
    const tag = this.tags().find((t) => t.id === tagId) ?? null;
    this.tagPendingDelete.set(tag);
  }

  cancelDelete(): void {
    this.tagPendingDelete.set(null);
  }

  confirmDelete(): void {
    const tag = this.tagPendingDelete();
    if (!tag) return;
    const customerId = this.customer().id;
    this.apiService.deleteFieldTag(customerId, tag.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.tagsChange.emit(this.tags().filter((t) => t.id !== tag.id));
          this.tagPendingDelete.set(null);
          this.toastService.success('Field removed.');
        },
        error: () => {
          this.toastService.error('Failed to delete this field. Please try again.');
          this.tagPendingDelete.set(null);
        },
      });
  }

  // ── "Use calculated acres" ────────────────────────────────────────────────
  useCalculatedAcres(): void {
    if (this.tags().length === 0 || this.isApplyingAcres()) return;
    const customerId = this.customer().id;
    this.isApplyingAcres.set(true);
    this.apiService.applyCalculatedAcres(customerId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.isApplyingAcres.set(false);
          this.toastService.success(
            `Producer total acres set to ${result.totalAcres.toLocaleString()} from ${result.tagCount} tagged field${result.tagCount === 1 ? '' : 's'}.`
          );
        },
        error: () => {
          this.isApplyingAcres.set(false);
          this.toastService.error('Failed to apply calculated acres. Please try again.');
        },
      });
  }
}
