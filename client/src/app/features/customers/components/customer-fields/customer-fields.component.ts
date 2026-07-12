import { Component, ChangeDetectionStrategy, DestroyRef, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { from } from 'rxjs';
import { concatMap, first } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { Customer, CustomerFieldTag, FieldTagDraft, FieldTagMapConfig } from '@models';
import { expandStateAbbrev, geocodeCacheKey, resolveCustomerAddress } from '@shared/utils/geocode-address';
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
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs / outputs ──────────────────────────────────────────────────────
  readonly customer = input.required<Customer>();
  readonly tags = input<CustomerFieldTag[]>([]);
  readonly mapConfig = input.required<FieldTagMapConfig>();
  readonly tagsChange = output<CustomerFieldTag[]>();

  // ── On-demand geocoding for the map's initial center ─────────────────────
  // `Customer.coordinates` is only ever populated by the Build List map's geocoding flow
  // (CustomerMapComponent), never when a customer is reached via Customer Profile — so without
  // this, the Fields tab map always falls back to its blank, zoomed-out CONUS default view.
  // Resolves the address the same way the Build List map does and checks/writes the SAME shared
  // `AppStateService.mapGeocodeCache`, so an address geocoded from either screen benefits the other.
  private readonly _resolvedCoords = signal<{ lat: number; lng: number } | null>(null);
  private _geocodeRequestSeq = 0;

  /** The customer passed down to the map: `customer()` as-is when it already carries coordinates
   *  (or once this component has resolved some), otherwise the same object with resolved
   *  coordinates merged in so `FieldTagMapComponent` can center on it without needing its own
   *  geocoding logic. */
  readonly customerForMap = computed<Customer>(() => {
    const c = this.customer();
    if (c.coordinates) return c;
    const coords = this._resolvedCoords();
    return coords ? { ...c, coordinates: coords } : c;
  });

  constructor() {
    // Re-resolve whenever the displayed customer changes (e.g. navigating Customer Profile
    // between producers without a full component re-create).
    effect(() => {
      const customer = this.customer();
      this._resolvedCoords.set(null);
      if (customer.coordinates) return;
      this._geocodeCustomerAddress(customer);
    });
  }

  /** Resolves `customer`'s address to lat/lng for the map's initial center, cache-first. Silently
   *  no-ops (map keeps its default view) when the customer has no usable address or the geocode
   *  call fails — this must never surface an error to the user. */
  private _geocodeCustomerAddress(customer: Customer): void {
    const seq = ++this._geocodeRequestSeq;
    const addr = resolveCustomerAddress(customer);
    if (!addr.city && !addr.state && !addr.zip) return;

    const fullKey = geocodeCacheKey(addr);
    const cached = this.appState.mapGeocodeCache.get(fullKey);
    if (cached) {
      this._resolvedCoords.set(cached);
      return;
    }

    // Progressive degradation ladder: full address, then city+state, then zip-only, stopping at
    // first success. Each tier gets its own composed cache key via geocodeCacheKey(...), using the
    // raw (un-expanded) state abbreviation to stay consistent with how a customer with only those
    // parts would compose their own key. Caching under BOTH the full-address key and the winning
    // tier's own narrower key is safe: a narrow key is only ever read by another customer whose own
    // full address composes to that exact same narrow string (i.e. one who themselves only has
    // that much address info), so serving them the cached centroid is never worse than what they'd
    // get otherwise, and a fuller-address customer always composes a different, more specific key.
    const cityStateKey = geocodeCacheKey({ street: '', city: addr.city, state: addr.state, zip: '' });
    const zipKey = geocodeCacheKey({ street: '', city: '', state: '', zip: addr.zip });

    const tiers: Array<{ key: string; street?: string; city?: string; state?: string; zip?: string }> = [];
    tiers.push({ key: fullKey, street: addr.street || undefined, city: addr.city, state: expandStateAbbrev(addr.state), zip: addr.zip });
    if (addr.city && addr.state) tiers.push({ key: cityStateKey, city: addr.city, state: expandStateAbbrev(addr.state) });
    if (addr.zip) tiers.push({ key: zipKey, zip: addr.zip });

    // Drop tiers whose key duplicates an earlier one (avoids a redundant identical call, e.g. a
    // city+state-only customer whose full key already equals cityStateKey).
    const seen = new Set<string>();
    const uniqueTiers = tiers.filter((t) => !seen.has(t.key) && (seen.add(t.key), true));

    from(uniqueTiers).pipe(
      concatMap((req) => this.apiService.geocodeSingle(req)),
      first((r) => r.lat != null && r.lng != null, null as { key: string; lat: number | null; lng: number | null } | null),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (result) => {
        if (seq !== this._geocodeRequestSeq) return; // stale — customer() changed mid-flight
        if (!result || result.lat == null || result.lng == null) return; // all tiers failed — map falls back to its default view
        const coords = { lat: result.lat, lng: result.lng };
        this.appState.setGeocodeCache(fullKey, coords);
        if (result.key !== fullKey) this.appState.setGeocodeCache(result.key, coords);
        this._resolvedCoords.set(coords);
      },
      // ApiService.geocodeSingle already swallows HTTP errors into a null-coords result, so this
      // is just a defensive backstop — the map's own default-view fallback still applies.
      error: () => { /* no-op: map falls back to its default view */ },
    });
  }

  // ── Owned state — single source of truth for hover sync (see class doc) ──
  readonly hoveredTagId = signal<number | null>(null);
  readonly mode = signal<'review' | 'select'>('review');
  /** Click-to-fly "command" signal. Modeled as { tagId, nonce } (not just tagId) so clicking the
   *  SAME row twice still re-fires the map's fitBounds — plain signal equality would otherwise
   *  swallow a repeat click on an unchanged tagId (04-frontend-list-and-hover-sync.md → "Click-to-fly"). */
  readonly flyToTag = signal<{ tagId: number; nonce: number } | null>(null);
  private flyNonce = 0;

  /** Address-search "fly" command signal, mirroring flyToTag's nonce pattern above. */
  readonly flyToLocation = signal<{ lat: number; lng: number; nonce: number } | null>(null);
  private flyLocationNonce = 0;
  readonly isSearchingAddress = signal(false);

  // ── Fullscreen/maximize toggle ────────────────────────────────────────────
  // CSS fixed-overlay, not the native Fullscreen API: ToastContainerComponent is mounted at the
  // app root as a sibling of the whole feature tree, so native requestFullscreen() would hide
  // toasts this feature depends on (duplicate-field warnings, save/AOI errors, "no location
  // found"). The CSS overlay keeps toasts, nav, and the delete-confirm modal all working.
  readonly isMaximized = signal(false);

  /**
   * z-[55]: the app's `<app-header>` is `position: sticky; z-50` (see header.component.ts), so a
   * plain `z-40` here (as originally planned, assuming the header was unpositioned/unindexed)
   * left the sticky header painting ON TOP of this "fullscreen" overlay — the header never
   * actually got covered. z-[55] sits strictly above the header's z-50 so maximizing genuinely
   * covers it, while staying strictly below the toast container and the delete-confirm modal
   * below (both bumped to z-[60] specifically so they remain reachable while maximized).
   */
  readonly rootClass = computed(() =>
    this.isMaximized()
      ? 'fixed inset-0 z-[55] flex flex-col gap-3 bg-gray-50 dark:bg-gray-900 p-4 overflow-hidden'
      : 'flex flex-col gap-3 h-full');

  toggleMaximize(): void {
    this.isMaximized.set(!this.isMaximized());
  }

  @HostListener('document:keydown.escape') onEsc(): void {
    if (this.isMaximized()) this.isMaximized.set(false);
  }

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

  // ── Address search (map's addressSearch output) ───────────────────────────
  onAddressSearch(query: string): void {
    this.isSearchingAddress.set(true);
    this.apiService.geocodeSearch(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          this.isSearchingAddress.set(false);
          const hit = results[0];
          if (!hit) {
            this.toastService.warning(`No location found for "${query}".`);
            return;
          }
          this.flyLocationNonce++;
          this.flyToLocation.set({ lat: hit.lat, lng: hit.lng, nonce: this.flyLocationNonce });
        },
        // geocodeSearch already swallows HTTP errors to [] — defensive only.
        error: () => { this.isSearchingAddress.set(false); },
      });
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
