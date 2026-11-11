import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { takeUntil } from 'rxjs/operators';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { profileCommodities, profileLinkedIds } from '@shared/utils/producer-profile';
import type { Contract, Customer, DpContract, StoredGrain, Ticket } from '@models';
import { commodityCodesFrom, linkedGroupOf } from './home-derivations';
import { HomeLinkedProducersStore } from './home-linked-producers.store';
import { HomeNotesStore } from './home-notes.store';
import { HomePageState } from './home-page.state';

/**
 * What the producer page still reads for the selected producer itself: their stored grain and DP contracts, the notes
 * of their linked group, and the auto-save of the commodities their contracts and tickets show into their saved
 * details. Their contracts, tickets and pricing lines are the Contracts module's (SelectedProducerActivity). Provided
 * by HomeComponent, which exposes these signals under the same names. Phase 4 moves the rest to Producers (step 10d)
 * and Engagement (step 10e).
 */
@Injectable()
export class HomeProducerActivityStore {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly page = inject(HomePageState);
  /** Every producer's details, kept by the Producers module. */
  private readonly producerProfiles = inject(ProducerProfiles);
  /** The selected producer's contracts and tickets, read by the Contracts module. */
  private readonly activity = inject(SelectedProducerActivity);
  private readonly notes = inject(HomeNotesStore);
  private readonly linked = inject(HomeLinkedProducersStore);
  private readonly destroyRef = inject(DestroyRef);

  /** Producers whose stored grain and DP contracts have been read since the trade units last changed: they show from
   *  the pools on a later selection rather than being read again. */
  private readonly _storageLoaded = new Set<number>();

  readonly customerCodeMap = signal<Map<number, string>>(new Map());
  readonly customerStoredGrain = signal<StoredGrain[]>([]);
  readonly customerDpContracts = signal<DpContract[]>([]);
  readonly allCustomerStoredGrain = signal<StoredGrain[]>([]);
  readonly allCustomerDpContracts = signal<DpContract[]>([]);
  readonly isLoadingStoredGrain = signal(false);
  readonly isLoadingDpContracts = signal(false);

  constructor() {
    // The commodities the producer's contracts and tickets show are saved into their details as they arrive, for the
    // producer selected now.
    effect(() => {
      const contracts = this.activity.contracts();
      const tickets = this.activity.tickets();
      untracked(() => {
        const customer = this.page.selectedCustomer();
        if (customer && (contracts.length > 0 || tickets.length > 0)) this._autoSaveCommodities(customer, tickets, contracts);
      });
    });
  }

  /** Trade units changed: every producer's stored grain and DP are read again on their next selection. */
  forgetAll(): void {
    this._storageLoaded.clear();
  }

  /**
   * Every producer transitively linked to `customer`, forward and reverse, among the roster and the cross-trade-unit
   * cache (see HomeComponent.getLinkedGroup).
   */
  private linkedGroup(customer: Customer): Customer[] {
    return linkedGroupOf(customer, [...this.page.customers(), ...this.linked.crossTradeUnitCustomersById().values()],
      c => profileLinkedIds(this.producerProfiles.profileOf(c.id)));
  }

  /** Reads the selected producer's stored grain and DP contracts into the pools, once per trade-unit selection. */
  loadStorageAndDp(customerId: number): void {
    if (this._storageLoaded.has(customerId)) {
      this.isLoadingStoredGrain.set(false);
      this.isLoadingDpContracts.set(false);
      this.loadCustomerData(customerId);
      return;
    }
    let grainDone = false;
    let dpDone = false;
    const markIfAllDone = () => { if (grainDone && dpDone) this._storageLoaded.add(customerId); };

    this.apiService.getStoredGrainByCustomer(customerId).pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (grain) => {
        const existing = this.page.storedGrain();
        const merged = [...existing.filter(s => s.customerId !== customerId), ...grain];
        this.page.storedGrain.set(merged);
        this.appState.setStoredGrain(merged);
        this.isLoadingStoredGrain.set(false);
        this.loadCustomerData(customerId);
        grainDone = true;
        markIfAllDone();
      },
      error: () => { this.isLoadingStoredGrain.set(false); }
    });

    this.apiService.getDpContractsByCustomer(customerId).pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (dp) => {
        // Per-producer merge, NOT a TU-wide load: it must not flip dpContractsLoaded, or Build A List
        // would treat this one producer's rows as the whole trade unit's DP set.
        this.appState.mergeCustomerDpContracts(customerId, dp);
        this.page.dpContracts.set(this.appState.dpContracts());
        this.isLoadingDpContracts.set(false);
        this.loadCustomerData(customerId);
        dpDone = true;
        markIfAllDone();
      },
      error: () => { this.isLoadingDpContracts.set(false); }
    });
  }

  /** Re-derives the selected producer's stored grain, DP and linked group's notes from the pools as they stand. */
  loadCustomerData(customerId: number, customer?: Customer): void {
    const currentCustomer = customer || this.page.selectedCustomer();
    if (!currentCustomer) return;

    const allStored = this.page.storedGrain().filter(s => s.customerId === customerId);
    this.allCustomerStoredGrain.set([...allStored]);
    this.customerStoredGrain.set([...allStored]);

    const allDp = this.page.dpContracts().filter(d => d.customerId === customerId);
    this.allCustomerDpContracts.set([...allDp]);
    this.customerDpContracts.set([...allDp]);

    const linkedGroup = this.linkedGroup(currentCustomer);
    const linkedIds = new Set([customerId, ...linkedGroup.map(c => c.id)]);
    const codeMap = new Map<number, string>();
    [currentCustomer, ...linkedGroup].forEach(c => { if (c?.scoularId) codeMap.set(c.id, c.scoularId); });
    this.customerCodeMap.set(codeMap);
    // Pure recompute from the per-customer notes cache (hydrated by _ensureCustomerNotes) —
    // safe to call from every data-arrival callback, exactly like the filters above.
    this.notes.showNotesFor(linkedIds);
  }

  /** Producer ids with an auto-save PUT currently in flight — prevents the concurrent double-save race. */
  private readonly _autoSaveInFlight = new Set<number>();
  /** Producer ids whose auto-save was deferred while one was in flight — re-run once it completes. */
  private readonly _autoSavePending = new Set<number>();

  private _autoSaveCommodities(customer: Customer, customerTickets: Ticket[], customerContracts: Contract[]): void {
    const sourceCommodities = commodityCodesFrom(customerTickets, customerContracts);
    if (sourceCommodities.length === 0) return;

    const storedCommodities = profileCommodities(this.producerProfiles.profileOf(customer.id));
    const hasNew = sourceCommodities.some(tc => !storedCommodities.includes(tc));
    if (!hasNew) return;

    // Serialize auto-saves per producer: the contracts and the tickets arrive separately, and two PUTs at once race
    // the upsert's child-row rebuild (each deletes rows the other already deleted → 500). If one is in flight for
    // this producer, defer and re-run once it finishes with the freshly-merged commodity set.
    if (this._autoSaveInFlight.has(customer.id)) {
      this._autoSavePending.add(customer.id);
      return;
    }
    this._autoSaveInFlight.add(customer.id);

    const merged = [...new Set([...storedCommodities, ...sourceCommodities])].sort();
    const existingPd = this.producerProfiles.profileOf(customer.id);
    this.apiService.saveProducerDetails(customer.id, {
      scoularId: customer.scoularId || null,
      customerName: customer.name,
      totalAcres: existingPd?.totalAcres ?? null,
      primaryContact: existingPd?.primaryContact ?? null,
      primaryPhone: existingPd?.primaryPhone ?? null,
      commodities: merged.join(','),
      linkedProducerIds: existingPd?.linkedProducerIds ?? null,
      // grainOnFarm intentionally omitted — this save isn't editing grain on farm, and the server
      // preserves the existing rows when it is absent (a cached copy could be older than a teammate's edit).
    }).subscribe({
      next: (pd) => {
        // The saved commodities are the producer's details, which every screen reads from ProducerProfiles.
        this.producerProfiles.put(pd);
        this._autoSaveInFlight.delete(customer.id);
        // A deferred call arrived while this save was in flight — re-run once, now serialized, against the
        // freshly-saved commodities so those from the later arrival still get persisted.
        if (this._autoSavePending.delete(customer.id)) {
          this._autoSaveCommodities(customer, this.activity.tickets(), this.activity.contracts());
        }
      },
      error: () => {
        this._autoSaveInFlight.delete(customer.id);
        this._autoSavePending.delete(customer.id);
      }
    });
  }
}
