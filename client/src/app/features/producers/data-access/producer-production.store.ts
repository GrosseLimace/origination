import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, map, takeUntil } from 'rxjs/operators';
import { Contract, Customer, PlantingIntention, PlantingIntentionDraft, PlantingIntentionEdit, Ticket } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import {
  PlantingIntentionMove, ProducerSelection, SelectedProducerProduction,
} from '@core/context/selected-producer-production';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { alreadyShown } from '@core/http/shown-errors';
import { ApiService } from '@core/services/api.service';
import { HandledErrorReporter } from '@core/services/handled-error-reporter.service';
import { ToastService } from '@core/services/toast.service';
import { commodityCodesFrom } from '@shared/utils/commodity-codes';
import { profileCommodities } from '@shared/utils/producer-profile';
import { ProducerStore } from './producer.store';
import { ProducersApiService } from './producers-api.service';
import { YieldEstimateStore } from './yield-estimate.store';

/**
 * The selected producer's production: the customer screen's SelectedProducerProduction, which the composition root
 * provides. The page tells it who is selected; it reads their planting intentions (kept per producer for the trade-unit
 * selection), stored grain and DP contracts, keeps the crop year being looked at, and adds, edits, deletes and moves
 * planting intentions, keeping the trade units' planting in ProducerStore in step. It also saves into a producer's
 * details the commodities their contracts, tickets and planting show that the details don't list yet.
 */
@Injectable({ providedIn: 'root' })
export class ProducerProductionStore implements SelectedProducerProduction {
  private readonly api = inject(ProducersApiService);
  private readonly appApi = inject(ApiService);
  private readonly store = inject(ProducerStore);
  private readonly yields = inject(YieldEstimateStore);
  private readonly activity = inject(SelectedProducerActivity);
  private readonly producerProfiles = inject(ProducerProfiles);
  private readonly tradeUnitContext = inject(TradeUnitContext);
  private readonly toast = inject(ToastService);
  private readonly handledErrors = inject(HandledErrorReporter);

  /** How many crop years the profile surfaces. Producers accumulate seasons indefinitely, but only the current and
   *  prior one are actionable, so older years are hidden rather than paged. */
  private static readonly MAX_PLANTING_YEARS = 2;
  /** How long a failed planting read stays quiet after saying so. */
  private static readonly FAILURE_QUIET_MS = 5 * 60_000;

  /** Cancels what is still being read for the producer selected before. */
  private readonly cancel$ = new Subject<void>();
  private readonly _selected = signal<Customer | null>(null);

  /** Each producer's planting intentions, from their first read, kept in step by the add, edit and delete. Later
   *  selections of the same producer show them without a read. Forgotten on a trade-unit change. */
  private readonly plantingCache = new Map<number, PlantingIntention[]>();
  private readonly _plantingIntentions = signal<PlantingIntention[]>([]);
  private readonly _isLoadingPlanting = signal(false);

  /** Producers whose stored grain and DP contracts have been read since the trade units last changed: they show from
   *  the trade units' sets on a later selection rather than being read again. */
  private readonly storageLoaded = new Set<number>();
  private readonly _isLoadingStoredGrain = signal(false);
  private readonly _isLoadingDpContracts = signal(false);

  /** The crop year being looked at; 0 picks the newest. */
  private readonly _selectedPlantingYear = signal(0);
  /** True once a year was picked (or a deep link asked for one): it is kept even without data for it. */
  private readonly yearPicked = signal(false);

  readonly plantingIntentions = this._plantingIntentions.asReadonly();
  readonly isLoadingPlanting = this._isLoadingPlanting.asReadonly();
  readonly selectedPlantingYear = this._selectedPlantingYear.asReadonly();
  readonly isLoadingStoredGrain = this._isLoadingStoredGrain.asReadonly();
  readonly isLoadingDpContracts = this._isLoadingDpContracts.asReadonly();

  /** The producer's stored grain and DP contracts, from the trade units' sets their own reads merge into. */
  readonly storedGrain = computed(() => {
    const id = this._selected()?.id;
    return id === undefined ? [] : this.store.storedGrain().filter(row => row.customerId === id);
  });
  readonly dpContracts = computed(() => {
    const id = this._selected()?.id;
    return id === undefined ? [] : this.store.dpContracts().filter(row => row.customerId === id);
  });

  /** The crop years the producer's profile offers, newest first: the most recent ones they have planting intentions
   *  for. Their contracts' crop years are only a fallback, for a producer with contracts and no intentions yet. */
  private readonly plantingYearOptions = computed(() => {
    const intentionYears = newestFirst(this._plantingIntentions().map(pi => pi.plantingYear));
    if (intentionYears.length > 0) return intentionYears.slice(0, ProducerProductionStore.MAX_PLANTING_YEARS);
    return newestFirst(this.activity.contracts().map(c => c.cropYear)).slice(0, ProducerProductionStore.MAX_PLANTING_YEARS);
  });

  /** The years offered. A deep-linked year is included even outside the newest ones, so the year being looked at is
   *  never missing from the list. */
  readonly plantingYears = computed(() => {
    const options = this.plantingYearOptions();
    const selected = this._selectedPlantingYear();
    return selected > 0 && !options.includes(selected) ? [selected, ...options].sort((a, b) => b - a) : options;
  });

  /** The producer's planting intentions in the years offered, so the table and the panels agree on which seasons
   *  exist. */
  readonly visiblePlantingIntentions = computed(() => {
    const years = new Set(this.plantingYears());
    if (years.size === 0) return this._plantingIntentions();
    return this._plantingIntentions().filter(pi => years.has(pi.plantingYear));
  });

  readonly yieldEstimates = this.yields.estimates;
  readonly isLoadingEstimates = this.yields.isLoading;

  /** Commodity codes the producer deals in: their tickets' and those on their profile. */
  readonly commodityCodes = computed(() => {
    const customer = this._selected();
    const ticketCommodities = [...new Set(this.activity.tickets().map(t => t.productCode || '').filter(Boolean))];
    const profile = customer ? profileCommodities(this.producerProfiles.profileOf(customer.id)) : [];
    return [...new Set([...ticketCommodities, ...profile])].sort();
  });

  readonly tradeUnits = this.tradeUnitContext.selectedTradeUnits;

  constructor() {
    inject(SessionReset).onReset(() => {
      this.select(null);
      this.forgetAll();
    });

    // A new selection of trade units: each producer is read again for the new scope.
    let first = true;
    effect(() => {
      this.tradeUnitContext.selectedTradeUnits();
      untracked(() => {
        if (first) { first = false; return; }
        this.forgetAll();
      });
    });

    // The newest year offered, unless a year was picked (or deep-linked), which is kept even without data for it.
    effect(() => {
      const best = this.plantingYearOptions()[0] || 0;
      untracked(() => {
        if (!this.yearPicked() && best !== this._selectedPlantingYear()) this._selectedPlantingYear.set(best);
      });
    });

    // The yield estimates of the years offered, for the producer's projected production.
    effect(() => {
      const years = this.plantingYears();
      untracked(() => this.yields.load(years));
    });

    // The commodities the producer's contracts and tickets show are saved into their details as they arrive.
    effect(() => {
      const contracts = this.activity.contracts();
      const tickets = this.activity.tickets();
      untracked(() => {
        const customer = this._selected();
        if (customer && (contracts.length > 0 || tickets.length > 0)) this.autoSaveCommodities(customer, tickets, contracts);
      });
    });
  }

  select(customer: Customer | null, options: ProducerSelection = {}): void {
    this.cancel$.next();
    this._selected.set(customer);
    const year = options.plantingYear ?? 0;
    this.yearPicked.set(year > 0);
    this._selectedPlantingYear.set(year > 0 ? year : 0);
    if (!customer) {
      this._plantingIntentions.set([]);
      this._isLoadingPlanting.set(false);
      this._isLoadingStoredGrain.set(false);
      this._isLoadingDpContracts.set(false);
      return;
    }
    this.loadPlanting(customer.id, options.reread ?? false);
    this.loadStorageAndDp(customer.id);
  }

  selectPlantingYear(year: number): void {
    this.yearPicked.set(true);
    this._selectedPlantingYear.set(year);
  }

  addPlantingIntention(data: PlantingIntentionDraft): void {
    const sel = this._selected();
    // A premature add, before a producer is selected, says so rather than reading as a save that did nothing.
    if (!sel) {
      this.toast.error('Select a producer before adding a planting intention.');
      return;
    }
    this.api.createPlantingIntention({
      customerId: sel.id, customerName: sel.name, customerCode: sel.scoularId || '',
      tradeUnit: data.tradeUnit, crop: data.crop, category: data.category, type: data.type,
      description: data.description, acres: data.acres, plantingYear: data.plantingYear,
    }).subscribe({
      next: intention => {
        this.store.setPlantingIntentions([...this.store.plantingIntentions(), intention]);
        this.applyToProducer(sel.id, rows => [...rows, intention]);
        this.toast.success('Planting intention added');
        this.ensureCommodityOnProducerDetails(sel, data.crop);
      },
      error: (e: Error) => { if (!alreadyShown(e)) this.toast.error(e?.message || 'Failed to add planting intention'); },
    });
  }

  editPlantingIntention(data: PlantingIntentionEdit): void {
    const sel = this._selected();
    this.api.updatePlantingIntention(data.intentionId, {
      crop: data.crop, category: data.category, type: data.type, description: data.description, acres: data.acres,
      plantingYear: data.plantingYear, tradeUnit: data.tradeUnit,
    }).subscribe({
      next: updated => {
        const update = (rows: PlantingIntention[]) => rows.map(p => p.id === data.intentionId ? updated : p);
        this.store.setPlantingIntentions(update(this.store.plantingIntentions()));
        if (sel) this.applyToProducer(sel.id, update);
        this.toast.success('Planting intention updated');
        if (sel) this.ensureCommodityOnProducerDetails(sel, data.crop);
      },
      error: (e: Error) => { if (!alreadyShown(e)) this.toast.error(e?.message || 'Failed to update planting intention'); },
    });
  }

  deletePlantingIntention(intentionId: number): void {
    this.api.deletePlantingIntention(intentionId).subscribe({
      next: () => {
        const remove = (rows: PlantingIntention[]) => rows.filter(p => p.id !== intentionId);
        this.store.setPlantingIntentions(remove(this.store.plantingIntentions()));
        const sel = this._selected();
        if (sel) this.applyToProducer(sel.id, remove);
        this.toast.success('Planting intention deleted');
      },
      error: err => { if (!alreadyShown(err)) this.toast.error('Failed to delete planting intention'); },
    });
  }

  /**
   * Re-homes planting intentions whose trade unit the user just removed, then reads this producer's intentions again so
   * the profile and the dashboards show the new trade unit. Without the read the move lands in the database while the
   * held rows still read the old trade unit.
   */
  movePlantingIntentions(customerId: number, moves: readonly PlantingIntentionMove[]): void {
    if (moves.length === 0) return;
    forkJoin(moves.map(m => this.api.retagPlantingIntentions(customerId, m.from, m.to).pipe(
      map(result => ({ ...m, moved: result.moved })),
      catchError(err => {
        if (!alreadyShown(err)) {
          this.toast.error(`Couldn't move planting intentions from ${m.from} to ${m.to} — they're still recorded against ${m.from}.`);
        }
        return of({ ...m, moved: 0 });
      }),
    ))).subscribe(results => {
      const moved = results.reduce((sum, r) => sum + r.moved, 0);
      if (moved > 0) {
        const destinations = [...new Set(results.filter(r => r.moved > 0).map(r => r.to))].join(', ');
        this.toast.success(`Moved ${moved} planting intention${moved === 1 ? '' : 's'} to ${destinations}.`);
        this.rereadProducerPlanting(customerId);
      }
    });
  }

  /** Drops every producer's held reads, so a producer the new scope still covers is read again. */
  private forgetAll(): void {
    this.plantingCache.clear();
    this.storageLoaded.clear();
  }

  /**
   * The producer's planting intentions: from what was read before, unless `reread`, else one read that fills the cache.
   * The next selection cancels the read, so an answer for a producer no longer selected never shows.
   */
  private loadPlanting(customerId: number, reread: boolean): void {
    const cached = reread ? undefined : this.plantingCache.get(customerId);
    if (cached) {
      this._plantingIntentions.set(cached);
      this._isLoadingPlanting.set(false);
      return;
    }
    this._plantingIntentions.set([]);
    this._isLoadingPlanting.set(true);
    this.api.getPlantingIntentionsByCustomer(customerId).pipe(takeUntil(this.cancel$)).subscribe({
      next: intentions => {
        this._plantingIntentions.set(intentions);
        this._isLoadingPlanting.set(false);
        this.plantingCache.set(customerId, intentions);
      },
      error: err => {
        this._isLoadingPlanting.set(false);
        this.reportPlantingReadFailure(err);
      },
    });
  }

  /** When a failed read of a producer's planting intentions last said so. */
  private plantingFailureToldAt = 0;

  /**
   * A failed read of a producer's planting intentions: otherwise the Planting tab reads as "none". An outage is worth
   * one message every five minutes rather than one per producer clicked; App Insights is sent every one.
   */
  private reportPlantingReadFailure(err: unknown): void {
    this.handledErrors.send('Producers: failed to load planting intentions', err);
    if (alreadyShown(err) || Date.now() - this.plantingFailureToldAt < ProducerProductionStore.FAILURE_QUIET_MS) return;
    this.plantingFailureToldAt = Date.now();
    this.toast.error('Failed to load planting intentions. Some data may be missing or out of date.');
  }

  /** Reads one producer's planting intentions again into everything that shows them: the cache, the profile when they
   *  are selected, and the trade units' planting the dashboard and Build a List read. */
  private rereadProducerPlanting(customerId: number): void {
    this.api.getPlantingIntentionsByCustomer(customerId).subscribe({
      next: rows => {
        this.plantingCache.set(customerId, rows);
        if (this._selected()?.id === customerId) this._plantingIntentions.set(rows);
        this.store.setPlantingIntentions([...this.store.plantingIntentions().filter(p => p.customerId !== customerId), ...rows]);
      },
      error: err => {
        if (!alreadyShown(err)) {
          this.toast.error('Planting intentions moved, but the list couldn\'t be refreshed — reload the page to see them.');
        }
      },
    });
  }

  /** Applies a change to the producer's held planting intentions: the cache, and the profile's when they are shown. */
  private applyToProducer(customerId: number, change: (rows: PlantingIntention[]) => PlantingIntention[]): void {
    const cached = this.plantingCache.get(customerId);
    if (cached) this.plantingCache.set(customerId, change(cached));
    if (this._selected()?.id === customerId) this._plantingIntentions.update(change);
  }

  /** Reads the producer's stored grain and DP contracts into the trade units' sets, once per trade-unit selection. */
  private loadStorageAndDp(customerId: number): void {
    if (this.storageLoaded.has(customerId)) {
      this._isLoadingStoredGrain.set(false);
      this._isLoadingDpContracts.set(false);
      return;
    }
    this._isLoadingStoredGrain.set(true);
    this._isLoadingDpContracts.set(true);
    let grainDone = false;
    let dpDone = false;
    const markIfAllDone = () => { if (grainDone && dpDone) this.storageLoaded.add(customerId); };

    this.api.getStoredGrainByCustomer(customerId).pipe(takeUntil(this.cancel$)).subscribe({
      next: grain => {
        this.store.setStoredGrain([...this.store.storedGrain().filter(s => s.customerId !== customerId), ...grain]);
        this._isLoadingStoredGrain.set(false);
        grainDone = true;
        markIfAllDone();
      },
      error: () => this._isLoadingStoredGrain.set(false),
    });

    // A producer's rows merged in: not the trade units' read, so DP isn't marked loaded (see mergeCustomerDpContracts).
    this.api.getDpContractsByCustomer(customerId).pipe(takeUntil(this.cancel$)).subscribe({
      next: dp => {
        this.store.mergeCustomerDpContracts(customerId, dp);
        this._isLoadingDpContracts.set(false);
        dpDone = true;
        markIfAllDone();
      },
      error: () => this._isLoadingDpContracts.set(false),
    });
  }

  /** Saves a planting intention's crop into the producer's details when they don't list it yet. Silent: the intention
   *  itself is saved. */
  private ensureCommodityOnProducerDetails(customer: Customer, cropCode: string): void {
    if (!cropCode) return;
    const profile = this.producerProfiles.profileOf(customer.id);
    const existing = profileCommodities(profile);
    const codeUpper = cropCode.trim().toUpperCase();
    if (existing.some(c => c.trim().toUpperCase() === codeUpper)) return;

    this.appApi.saveProducerDetails(customer.id, {
      scoularId: customer.scoularId ?? null,
      customerName: customer.name,
      totalAcres: profile?.totalAcres ?? null,
      primaryContact: profile?.primaryContact ?? null,
      primaryPhone: profile?.primaryPhone ?? null,
      commodities: [...existing, cropCode.trim()].join(','),
      linkedProducerIds: profile?.linkedProducerIds ?? '',
      // grainOnFarm omitted: this save isn't editing it, and the server keeps the rows when it is absent.
    }).subscribe({
      // The new commodity shows wherever the producer's details are read.
      next: saved => this.producerProfiles.put(saved),
      error: () => { /* non-blocking: the intention saved */ },
    });
  }

  /** Producers with a commodity auto-save in flight, and those whose auto-save waits for it. */
  private readonly autoSaveInFlight = new Set<number>();
  private readonly autoSavePending = new Set<number>();

  /** Saves into the producer's details the commodities their tickets and contracts show and the details don't list. */
  private autoSaveCommodities(customer: Customer, tickets: Ticket[], contracts: Contract[]): void {
    const sourceCommodities = commodityCodesFrom(tickets, contracts);
    if (sourceCommodities.length === 0) return;
    const stored = profileCommodities(this.producerProfiles.profileOf(customer.id));
    if (!sourceCommodities.some(code => !stored.includes(code))) return;

    // One save per producer at a time: the contracts and the tickets arrive separately, and two saves at once race the
    // server's rebuild of the details' child rows. A later arrival waits, then runs once with what it saw.
    if (this.autoSaveInFlight.has(customer.id)) {
      this.autoSavePending.add(customer.id);
      return;
    }
    this.autoSaveInFlight.add(customer.id);

    const merged = [...new Set([...stored, ...sourceCommodities])].sort();
    const existing = this.producerProfiles.profileOf(customer.id);
    this.appApi.saveProducerDetails(customer.id, {
      scoularId: customer.scoularId || null,
      customerName: customer.name,
      totalAcres: existing?.totalAcres ?? null,
      primaryContact: existing?.primaryContact ?? null,
      primaryPhone: existing?.primaryPhone ?? null,
      commodities: merged.join(','),
      linkedProducerIds: existing?.linkedProducerIds ?? null,
      // grainOnFarm omitted: the server keeps the rows when it is absent, and a held copy could be older.
    }).subscribe({
      next: saved => {
        this.producerProfiles.put(saved);
        this.autoSaveInFlight.delete(customer.id);
        if (this.autoSavePending.delete(customer.id)) {
          this.autoSaveCommodities(customer, this.activity.tickets(), this.activity.contracts());
        }
      },
      error: () => {
        this.autoSaveInFlight.delete(customer.id);
        this.autoSavePending.delete(customer.id);
      },
    });
  }
}

/** The distinct years given, newest first. */
function newestFirst(years: (number | null | undefined)[]): number[] {
  return [...new Set(years.filter((y): y is number => !!y))].sort((a, b) => b - a);
}
