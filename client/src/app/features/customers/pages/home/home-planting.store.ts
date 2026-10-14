import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, map, takeUntil } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import type { Customer, PlantingIntention } from '@models';
import { HomeBackgroundFailures } from './home-background-failures';
import { HomePageState } from './home-page.state';

/**
 * The selected producer's planting intentions on the producer page: the per-producer read and its
 * cache, the add / edit / delete handlers, and re-homing intentions off a trade unit the user removed.
 * Provided by HomeComponent, which exposes these signals and delegates its planting handlers here.
 * The trade unit's full list (plantingIntentions) is page state; these handlers keep it in step.
 */
@Injectable()
export class HomePlantingStore {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly backgroundFailures = inject(HomeBackgroundFailures);
  private readonly page = inject(HomePageState);
  private readonly destroyRef = inject(DestroyRef);

  /** Per-customer planting-intentions cache. Hydrated from the first visit's
   *  fetch; kept in sync by the add/edit/delete handlers. Subsequent visits to
   *  the same producer skip the network entirely. */
  private readonly _customerPlantingCache = new Map<number, PlantingIntention[]>();
  /** Bumped by every read and cache restore, so a read that lands after a newer one is dropped. */
  private _piRequestId = 0;

  readonly customerPlantingIntentions = signal<PlantingIntention[]>([]);
  readonly allCustomerPlantingIntentions = signal<PlantingIntention[]>([]);

  /** Trade units changed: drop the cache so the next visit re-reads for the new scope. */
  forgetAll(): void {
    this._customerPlantingCache.clear();
  }

  /**
   * Loads a producer's intentions for a user selection: from the cache when it has them, otherwise
   * one read (cancelled by the next selection) that fills the cache. Called exactly once per
   * selection, not from the page's per-arrival re-derivation, so a click costs one read at most.
   */
  loadForSelection(customerId: number): void {
    const cachedPi = this._customerPlantingCache.get(customerId);
    if (cachedPi) {
      // Bump the counter on the cache-hit path too. The miss path below increments it so an
      // older in-flight fetch recognises itself as stale; restoring from cache without bumping
      // left a previous fetch's captured id still matching, so it could land afterwards and
      // overwrite the freshly-restored data.
      ++this._piRequestId;
      this.allCustomerPlantingIntentions.set(cachedPi);
      this.customerPlantingIntentions.set(cachedPi);
    } else {
      this.allCustomerPlantingIntentions.set([]);
      this.customerPlantingIntentions.set([]);
      const piRequestId = ++this._piRequestId;
      this.apiService.getPlantingIntentionsByCustomer(customerId)
        .pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (intentions) => {
            if (piRequestId !== this._piRequestId) return;
            this.allCustomerPlantingIntentions.set(intentions);
            this.customerPlantingIntentions.set(intentions);
            this._customerPlantingCache.set(customerId, intentions);
          },
          error: (err) => this.backgroundFailures.report('load planting intentions', err)
        });
    }
  }

  /**
   * Re-reads a producer's intentions without the cache: on navigation back to the page and when a
   * linked producer is opened. Not cancelled by a new selection; the request-id guard drops an answer
   * that a newer read or cache restore has superseded.
   */
  loadWithoutCache(customerId: number): void {
    this.allCustomerPlantingIntentions.set([]);
    this.customerPlantingIntentions.set([]);
    const piRequestId = ++this._piRequestId;
    this.apiService.getPlantingIntentionsByCustomer(customerId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (intentions) => {
          if (piRequestId !== this._piRequestId) return;
          this.allCustomerPlantingIntentions.set(intentions);
          this.customerPlantingIntentions.set(intentions);
        },
        error: (err) => this.backgroundFailures.report('load planting intentions', err)
      });
  }

  /**
   * Re-homes planting intentions whose trade unit the user just removed, then reloads this
   * producer's intentions so the profile and the dashboards show the new trade unit. Without the
   * reload the move lands in the database while the cached rows still read the old trade unit.
   */
  movePlantingIntentions(customerId: number, moves: { from: string; to: string }[]): void {
    if (moves.length === 0) return;
    forkJoin(
      moves.map(m => this.apiService.retagPlantingIntentions(customerId, m.from, m.to).pipe(
        map(result => ({ ...m, moved: result.moved })),
        catchError(() => {
          this.toastService.error(`Couldn't move planting intentions from ${m.from} to ${m.to} — they're still recorded against ${m.from}.`);
          return of({ ...m, moved: 0 });
        })
      ))
    ).subscribe(results => {
      const moved = results.reduce((sum, r) => sum + r.moved, 0);
      if (moved > 0) {
        const destinations = [...new Set(results.filter(r => r.moved > 0).map(r => r.to))].join(', ');
        this.toastService.success(`Moved ${moved} planting intention${moved === 1 ? '' : 's'} to ${destinations}.`);
        this._reloadCustomerPlantingIntentions(customerId);
      }
    });
  }

  /** Refetches one producer's planting intentions into every store that renders them. */
  private _reloadCustomerPlantingIntentions(customerId: number): void {
    this.apiService.getPlantingIntentionsByCustomer(customerId).subscribe({
      next: (rows) => {
        this._customerPlantingCache.set(customerId, rows);
        if (this.page.selectedCustomer()?.id === customerId) {
          this.allCustomerPlantingIntentions.set(rows);
          this.customerPlantingIntentions.set(rows);
        }
        // Swap this producer's rows in the app-wide list the dashboard and Build-A-List read.
        const merged = [...this.page.plantingIntentions().filter(p => p.customerId !== customerId), ...rows];
        this.page.plantingIntentions.set(merged);
        this.appState.setPlantingIntentions(merged);
      },
      error: () => this.toastService.error('Planting intentions moved, but the list couldn\'t be refreshed — reload the page to see them.')
    });
  }

  addPlantingIntention(data: {crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}): void {
    const sel = this.page.selectedCustomer();
    // Make a premature add (before a producer is selected/loaded) visible instead of a silent
    // no-op that reads as "the save did nothing / took two clicks".
    if (!sel) {
      console.warn('[PlantingIntentions] Add attempted with no producer selected — ignoring.');
      this.toastService.error('Select a producer before adding a planting intention.');
      return;
    }
    this.apiService.createPlantingIntention({
      customerId: sel.id, customerName: sel.name, customerCode: sel.scoularId || '',
      tradeUnit: data.tradeUnit, crop: data.crop, category: data.category, type: data.type,
      description: data.description, acres: data.acres, plantingYear: data.plantingYear
    }).subscribe({
      next: (intention) => {
        this.page.plantingIntentions.update(arr => [...arr, intention]);
        this.appState.setPlantingIntentions(this.page.plantingIntentions());
        this.customerPlantingIntentions.update(arr => [...arr, intention]);
        this.allCustomerPlantingIntentions.update(arr => [...arr, intention]);
        const cached = this._customerPlantingCache.get(sel.id);
        if (cached) this._customerPlantingCache.set(sel.id, [...cached, intention]);
        this.toastService.success('Planting intention added');
        this._ensureCommodityOnProducerDetails(sel, data.crop);
      },
      error: (e: Error) => this.toastService.error(e?.message || 'Failed to add planting intention')
    });
  }

  editPlantingIntention(data: {intentionId: number, crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit?: string}): void {
    const sel = this.page.selectedCustomer();
    this.apiService.updatePlantingIntention(data.intentionId, {
      crop: data.crop, category: data.category, type: data.type, description: data.description, acres: data.acres, plantingYear: data.plantingYear,
      tradeUnit: data.tradeUnit
    }).subscribe({
      next: (updated) => {
        const update = (arr: PlantingIntention[]) => arr.map(p => p.id === data.intentionId ? updated : p);
        this.page.plantingIntentions.update(update);
        this.appState.setPlantingIntentions(this.page.plantingIntentions());
        this.customerPlantingIntentions.update(update);
        this.allCustomerPlantingIntentions.update(update);
        if (sel) {
          const cached = this._customerPlantingCache.get(sel.id);
          if (cached) this._customerPlantingCache.set(sel.id, update(cached));
        }
        this.toastService.success('Planting intention updated');
        if (sel) this._ensureCommodityOnProducerDetails(sel, data.crop);
      },
      error: (e: Error) => this.toastService.error(e?.message || 'Failed to update planting intention')
    });
  }

  /**
   * If the just-saved planting intention's crop isn't already on the producer's
   * details, persist it there so the producer's commodities list stays in sync.
   * Silent: any failure here is logged but doesn't surface to the user — the
   * intention itself was already saved successfully.
   */
  private _ensureCommodityOnProducerDetails(customer: Customer, cropCode: string): void {
    if (!cropCode) return;
    const existing = customer.commodities ?? [];
    const codeUpper = cropCode.trim().toUpperCase();
    const alreadyPresent = existing.some(c => c.trim().toUpperCase() === codeUpper);
    if (alreadyPresent) return;

    const updated = [...existing, cropCode.trim()];
    this.apiService.saveProducerDetails(customer.id, {
      scoularId: customer.scoularId ?? null,
      customerName: customer.name,
      totalAcres: customer.totalAcres ?? null,
      primaryContact: customer.primaryContact ?? null,
      primaryPhone: customer.primaryPhone ?? null,
      commodities: updated.join(','),
      linkedProducerIds: (customer.linkedProducerIds ?? []).join(','),
      // grainOnFarm intentionally omitted — this save isn't editing grain on farm, and the server
      // preserves the existing rows when it is absent (a cached copy could be older than a teammate's edit).
    }).subscribe({
      next: (savedDetails) => {
        // Reflect the new commodity in local state so the UI updates without a refresh.
        const updatedCustomer = { ...customer, commodities: updated };
        this.page.selectedCustomer.set(updatedCustomer);
        this.page.customers.update(arr => arr.map(c => c.id === customer.id ? updatedCustomer : c));
        // Keep the producer-details map in sync — same pattern as handleSaveCustomer.
        const map = new Map(this.page.producerDetailsMap());
        map.set(savedDetails.customerId, savedDetails);
        this.page.producerDetailsMap.set(map);
      },
      error: () => { /* non-blocking — intention saved successfully */ }
    });
  }

  deletePlantingIntention(intentionId: number): void {
    this.apiService.deletePlantingIntention(intentionId).subscribe({
      next: () => {
        const remove = (arr: PlantingIntention[]) => arr.filter(p => p.id !== intentionId);
        this.page.plantingIntentions.update(remove);
        this.appState.setPlantingIntentions(this.page.plantingIntentions());
        this.customerPlantingIntentions.update(remove);
        this.allCustomerPlantingIntentions.update(remove);
        const sel = this.page.selectedCustomer();
        if (sel) {
          const cached = this._customerPlantingCache.get(sel.id);
          if (cached) this._customerPlantingCache.set(sel.id, remove(cached));
        }
        this.toastService.success('Planting intention deleted');
      },
      error: () => this.toastService.error('Failed to delete planting intention')
    });
  }

}
