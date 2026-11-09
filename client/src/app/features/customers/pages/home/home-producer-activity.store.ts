import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of, timer } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import type { Contract, ContractPricingLine, Customer, DpContract, StoredGrain, Ticket } from '@models';
import { environment } from '@env/environment';
import { CustomerStore } from '../../data-access/customer.store';
import { commodityCodesFrom, linkedGroupOf, producerContractsAndTickets, readFailureMessage } from './home-derivations';
import { mergeProducerRows } from './merge-producer-rows';
import { HomeLinkedProducersStore } from './home-linked-producers.store';
import { HomeNotesStore } from './home-notes.store';
import { HomePageState } from './home-page.state';

/**
 * The selected producer's activity on the producer page: their contracts, tickets and pricing lines, and their
 * stored grain and DP contracts, with the freshness rules, hover prefetch, background refresh, retries and the
 * commodity auto-save that keep them current. Provided by HomeComponent, which exposes these signals under the
 * same names and delegates its handlers here, and provides this store as the page's SelectedProducerActivity. The
 * trade unit's pools it merges into (contracts, tickets, stored grain, DP) are page state.
 */
@Injectable()
export class HomeProducerActivityStore implements SelectedProducerActivity {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly customerStore = inject(CustomerStore);
  private readonly page = inject(HomePageState);
  private readonly notes = inject(HomeNotesStore);
  private readonly linked = inject(HomeLinkedProducersStore);
  private readonly destroyRef = inject(DestroyRef);
  /** Customers whose contracts / tickets / pricing-lines / stored-grain have
   *  already been fetched, and WHEN.
   *
   *  Re-clicking shows the cached rows immediately - they are still in the signals from the first visit -
   *  and refetches in the background if they are older than {@link CUSTOMER_DATA_MAX_AGE_MS}, swapping
   *  them when the response lands. It used to be a plain Set with no age, which meant the first click of
   *  a session was the only one that ever hit the network: a load applied afterwards, or a contract that
   *  closed, stayed invisible until the user changed trade units. That is the wrong default for a screen
   *  people leave open through a harvest day.
   *
   *  Cleared when the user adds/removes a contract, ticket, or storage record. */
  private readonly _customerLoadedAt = new Map<number, number>();

  /** How long a producer's cached contracts/tickets are served without a refetch. Matched to the
   *  server's own per-producer cache (Ctrm:LiveCacheSeconds, 60s): refetching sooner would usually be
   *  answered from that cache anyway, so it would cost a round trip for the same bytes. */
  private static readonly CUSTOMER_DATA_MAX_AGE_MS = 60_000;

  /** How long after a FIRST load of a producer the silent convergence refresh fires.
   *
   *  The server may answer a first click instantly from the warm trade-unit cache (rows up to a few
   *  minutes old) while it starts the live read behind the answer. This one-shot refresh re-reads once
   *  that live read has had time to land, so anything added or closed in CTRM in the gap appears within
   *  seconds of the click - the user never has to leave and come back. When the first answer was already
   *  live, the refresh hits the server's 60s per-producer cache and costs one ~50ms round trip. */
  private static readonly CLICK_CONVERGENCE_MS = 4_000;

  /** The contract and ticket ids each producer's last read returned.
   *
   *  A refresh has to be able to make a row DISAPPEAR or CHANGE, and merging by id alone cannot:
   *  the synthetic ticket id is built from prefix/number/suffix/BL date/product/sequence and does NOT
   *  include the contract number or the status, so a ticket applied to a contract, settled, or cancelled
   *  since the first read has the SAME id. Merging "only if unseen" dropped the new row and left the stale
   *  one on screen for the session; merging by replacement still could not remove a row that had fallen
   *  out of the result entirely. So the refresh removes exactly the ids the previous read contributed,
   *  then merges the new rows.
   *
   *  Keyed on the previous ids rather than on customerCode on purpose: an applied split-load row can carry
   *  another producer's code, so filtering by code would drop rows this producer legitimately owns. */
  private readonly _customerRowIds = new Map<number, { contracts: Set<number>; tickets: Set<number> }>();
  /** Per-customer pricing-lines cache keyed by scoularId. Pricing lines are
   *  hydrated OUTSIDE the _customerLoadedAt short-circuit so that every click
   *  swaps to the right producer's lines (the contracts/tickets/grain short-
   *  circuit returned early before pricing lines were restored, leaving the
   *  panel showing the prior producer's data on re-click). */
  private readonly _customerPricingCache = new Map<string, ContractPricingLine[]>();

  /** When each producer's pricing lines were read. Same 60s rule as the contracts and tickets: without an
   *  age, a contract priced after the first click kept its UNPRICED badge for the rest of the session,
   *  which is a wrong number on screen rather than merely an old one. */
  private readonly _customerPricingLoadedAt = new Map<string, number>();

  readonly customerContracts = signal<Contract[]>([]);
  readonly customerTickets = signal<Ticket[]>([]);
  readonly customerPricingLines = signal<ContractPricingLine[]>([]);
  readonly customerCodeMap = signal<Map<number, string>>(new Map());
  readonly customerStoredGrain = signal<StoredGrain[]>([]);
  readonly customerDpContracts = signal<DpContract[]>([]);

  readonly allCustomerContracts = signal<Contract[]>([]);
  readonly allCustomerTickets = signal<Ticket[]>([]);
  readonly allCustomerStoredGrain = signal<StoredGrain[]>([]);
  readonly allCustomerDpContracts = signal<DpContract[]>([]);

  readonly isLoadingContracts = signal(false);

  /** Message when the producer's CONTRACT read failed, as opposed to returning nothing. Kept separate
   *  from the loading flag because "empty" and "failed" render identically otherwise, and a CTRM
   *  timeout showing as "no contracts found" is how a grower's book appears empty. */
  readonly contractsLoadError = signal<string | null>(null);
  /** True only while the FAST per-customer unapplied-tickets fetch is in flight. Drives the
   *  spinner on the Unapplied Tickets tab. */
  readonly isLoadingUnappliedTickets = signal(false);

  /** Message when the producer's TICKET read failed. See contractsLoadError. */
  readonly ticketsLoadError = signal<string | null>(null);

  /** Message when the producer's PRICING-LINE read failed. Separate from the contract error because the
   *  contract rows can be perfectly good while their prices are missing - and an empty pricing set renders
   *  as "this contract has no priced lines", which is a wrong number rather than an absent one. */
  readonly pricingLinesLoadError = signal<string | null>(null);
  readonly isLoadingPricingLines = signal(false);
  readonly isLoadingStoredGrain = signal(false);
  readonly isLoadingDpContracts = signal(false);

  // SelectedProducerActivity's names for the same signals.
  readonly contracts = this.customerContracts.asReadonly();
  readonly tickets = this.customerTickets.asReadonly();
  readonly pricingLines = this.customerPricingLines.asReadonly();
  readonly isLoadingTickets = this.isLoadingUnappliedTickets.asReadonly();

  /** Trade units changed: drop every producer's cached reads, so a producer the new scope still covers is re-read. */
  forgetAll(): void {
    this._customerLoadedAt.clear();
    this._customerRowIds.clear();
    this._customerPricingCache.clear();
    this._customerPricingLoadedAt.clear();
  }

  /**
   * Every producer transitively linked to `customer`, forward and reverse, among the roster and the cross-trade-unit
   * cache (see HomeComponent.getLinkedGroup).
   */
  private linkedGroup(customer: Customer): Customer[] {
    return linkedGroupOf(customer, [...this.page.customers(), ...this.linked.crossTradeUnitCustomersById().values()]);
  }

  /** Hydrate customerPricingLines for the selected producer. Always called on
   *  every click — independent of _customerLoadedAt — so re-clicking a producer
   *  swaps to their pricing lines instead of leaving the prior producer's lines
   *  on screen. Cache hit = instant, no network. Cache miss = single fetch then
   *  populate. */
  /**
   * Refetches a producer's pricing lines behind badges already on screen.
   *
   * Silent, like the contract and ticket refresh: a failed refresh leaves the visible badges alone rather
   * than blanking a correct panel. Replaces the cached set outright - a line repriced since the first read
   * keeps its sequence, so merging by key would preserve the stale price.
   */
  private _refreshCustomerPricingLines(scoularId: string): void {
    this.apiService.getPricingLinesByCustomer(scoularId)
      .pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lines) => {
          // Only apply if the user is still on this producer.
          if (this.page.selectedCustomer()?.scoularId !== scoularId) return;

          this._customerPricingCache.set(scoularId, lines);
          this._customerPricingLoadedAt.set(scoularId, Date.now());
          this.pricingLinesLoadError.set(null);
          this.customerPricingLines.set(lines);
          this.appState.setPricingLines(lines);
        },
        error: () => { /* keep the visible badges; the failure is recorded server-side and logged */ }
      });
  }

  private _loadCustomerPricingLines(scoularId?: string): void {
    if (!scoularId) {
      this.customerPricingLines.set([]);
      this.isLoadingPricingLines.set(false);
      return;
    }
    const cached = this._customerPricingCache.get(scoularId);
    if (cached) {
      this.customerPricingLines.set(cached);
      this.appState.setPricingLines(cached);
      this.isLoadingPricingLines.set(false);
      this.pricingLinesLoadError.set(null);

      // Refresh behind the visible badges when the copy has aged out. No spinner, same reasoning as the
      // contract and ticket refresh: what is on screen is real, so a flicker would be a downgrade.
      const loadedAt = this._customerPricingLoadedAt.get(scoularId) ?? 0;
      if (Date.now() - loadedAt >= HomeProducerActivityStore.CUSTOMER_DATA_MAX_AGE_MS)
        this._refreshCustomerPricingLines(scoularId);

      return;
    }
    // Cache miss — clear any prior producer's lines so the table doesn't show
    // stale data during the fetch, raise the loading flag, then issue the API call.
    this.customerPricingLines.set([]);
    this.isLoadingPricingLines.set(true);
    this.apiService.getPricingLinesByCustomer(scoularId)
      .pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lines) => {
          this.customerPricingLines.set(lines);
          this.appState.setPricingLines(lines);
          this._customerPricingCache.set(scoularId, lines);
          this._customerPricingLoadedAt.set(scoularId, Date.now());
          this.isLoadingPricingLines.set(false);
        },
        error: (err) => {
          this.customerPricingLines.set([]);
          this.isLoadingPricingLines.set(false);
          this.pricingLinesLoadError.set(readFailureMessage(err));
        }
      });
  }

  /**
   * Refetches a producer's contracts and tickets behind rows that are already on screen.
   *
   * Deliberately silent: no loading flags, no error state. The visible data is real - it is what the
   * first read returned - so a failed refresh should leave it alone rather than replace a correct screen
   * with an error. The failure is still recorded server-side (provenance) and in the log. The timestamp
   * is only advanced when BOTH reads succeed, so a partial failure retries on the next click rather than
   * pretending the data is fresh.
   */
  private _refreshCustomerContractsAndTickets(customerId: number, scoularId?: string): void {
    forkJoin({
      contracts: this.apiService.getContractsByCustomer(customerId, scoularId).pipe(catchError(() => of(null))),
      tickets: this.apiService.getTicketsByCustomer(customerId, scoularId).pipe(catchError(() => of(null)))
    })
      .pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe(({ contracts, tickets }) => {
        // Only swap if the user is still on this producer - a refresh that lands after they have moved on
        // would otherwise write one producer's rows into another's view.
        if (this.page.selectedCustomer()?.id !== customerId) return;

        if (contracts) this._applyCustomerContracts(customerId, contracts, /* isRefresh */ true);
        if (tickets) this._applyCustomerTickets(customerId, tickets, /* isRefresh */ true);

        if (contracts && tickets) this._customerLoadedAt.set(customerId, Date.now());
      });
  }

  loadCustomerContractsAndTickets(customerId: number, scoularId?: string): void {
    // Pricing lines are handled OUTSIDE the _customerLoadedAt short-circuit so
    // every click hydrates customerPricingLines for the right producer (the
    // short-circuit only covers contracts/tickets/grain). Without this,
    // re-clicking a previously-loaded producer left the panel showing the prior
    // producer's lines.
    this._loadCustomerPricingLines(scoularId);

    // Already fetched this customer's data — the merged signals still hold it, so show that immediately
    // rather than making the user watch a spinner for rows we already have.
    const loadedAt = this._customerLoadedAt.get(customerId);
    if (loadedAt !== undefined) {
      this.isLoadingContracts.set(false);
      this.isLoadingUnappliedTickets.set(false);
      this.isLoadingStoredGrain.set(false);
      this.isLoadingDpContracts.set(false);
      this.loadCustomerData(customerId);

      // ...and if that copy has aged out, refresh it BEHIND the visible rows. No spinner: the screen is
      // already populated and correct as of the first read, so a flicker would be a downgrade. The swap
      // happens when the response lands.
      if (Date.now() - loadedAt >= HomeProducerActivityStore.CUSTOMER_DATA_MAX_AGE_MS)
        this._refreshCustomerContractsAndTickets(customerId, scoularId);

      return;
    }

    let contractsDone = false;
    let ticketsDone = false;
    let grainDone = false;
    let dpDone = false;
    const markIfAllDone = () => {
      if (contractsDone && ticketsDone && grainDone && dpDone) this._customerLoadedAt.set(customerId, Date.now());
    };

    // One-shot convergence pass behind the first paint. The server may have answered from its warm
    // trade-unit cache (instant, but up to a few minutes old) with the live read started behind it;
    // re-reading once that read has landed swaps in anything that changed, silently, via the same
    // retract-then-replace path every background refresh uses. Cancelled if the user moves on.
    // Gated with the hover prefetch: there is nothing to converge on unless the backend answered from
    // a warm trade-unit cache with a live read behind it, which only the CTRM path does. Against ODS
    // the first answer is already the live one, so this would just read everything a second time.
    if (environment.ctrmReadAheadEnabled) {
      timer(HomeProducerActivityStore.CLICK_CONVERGENCE_MS)
        .pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          if (this.page.selectedCustomer()?.id !== customerId) return;
          this._refreshCustomerContractsAndTickets(customerId, scoularId);
        });
    }

    // A hover prefetch may already hold this producer's contracts and tickets. They are applied through
    // the SAME functions the network path uses, so the only difference is that the click pays no round
    // trip. Bounded by age: anything older than the server's own live cache is discarded and refetched.
    const prefetched = this._takePrefetched(customerId);

    if (prefetched?.contracts) {
      this._applyCustomerContracts(customerId, prefetched.contracts);
      contractsDone = true;
      markIfAllDone();
    } else {
      this.apiService.getContractsByCustomer(customerId, scoularId).pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (contracts) => {
          this._applyCustomerContracts(customerId, contracts);
          contractsDone = true;
          markIfAllDone();
        },
        error: (err) => {
          this.isLoadingContracts.set(false);
          this.contractsLoadError.set(readFailureMessage(err));
        }
      });
    }


    // Per-producer ticket fetch (applied + unapplied), scoped to this customer. Replaces the old
    // eager TU-wide bulk: applied tickets are matched server-side by the customer's open contract
    // numbers, so cross-customer / split-entity applied tickets still surface here.
    if (prefetched?.tickets) {
      this._applyCustomerTickets(customerId, prefetched.tickets);
      ticketsDone = true;
      markIfAllDone();
    } else {
      this.loadCustomerTickets(customerId, scoularId, () => { ticketsDone = true; markIfAllDone(); });
    }

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

  /** Producers the pointer rested on, with their contracts and tickets already fetched. Consumed by the
   *  next click on that producer; anything older than the server's live cache is discarded unused. */
  private readonly _prefetched = new Map<number, { at: number; contracts?: Contract[]; tickets?: Ticket[] }>();
  private readonly _prefetchInFlight = new Set<number>();
  private static readonly PREFETCH_MAX_AGE_MS = 60_000;
  /** Two at once keeps ahead of a reader and stays small enough not to compete with the click. */
  private static readonly PREFETCH_MAX_IN_FLIGHT = 2;

  /** Warms one producer's data on hover so the click renders from memory. Deliberately touches no
   *  signal and no loading flag: results sit in a side map until the producer is actually selected, so a
   *  prefetch can never repaint the screen for a producer the user is not looking at. */
  prefetch(customer: Customer): void {
    // Only worth a round trip when the backend is reading CTRM. Against ODS this is one extra read
    // per hovered row for no gain, on a page where scanning a list touches many rows.
    if (!environment.ctrmReadAheadEnabled) return;

    const id = customer.id;
    if (this.page.selectedCustomer()?.id === id) return;
    if (this._customerLoadedAt.has(id) || this._prefetched.has(id) || this._prefetchInFlight.has(id)) return;
    if (this._prefetchInFlight.size >= HomeProducerActivityStore.PREFETCH_MAX_IN_FLIGHT) return;

    this._prefetchInFlight.add(id);
    const scoularId = customer.scoularId ?? undefined;
    forkJoin({
      contracts: this.apiService.getContractsByCustomer(id, scoularId).pipe(catchError(() => of(null))),
      tickets: this.apiService.getTicketsByCustomer(id, scoularId).pipe(catchError(() => of(null))),
      pricing: scoularId
        ? this.apiService.getPricingLinesByCustomer(scoularId).pipe(catchError(() => of(null)))
        : of(null),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(r => {
      this._prefetchInFlight.delete(id);
      // The user clicked before we finished; the real load has already run and owns the state.
      if (this._customerLoadedAt.has(id)) return;
      if (r.contracts || r.tickets) {
        this._prefetched.set(id, { at: Date.now(), contracts: r.contracts ?? undefined, tickets: r.tickets ?? undefined });
      }
      // Pricing lines already have a per-producer cache that the click path consults first.
      if (scoularId && r.pricing) {
        this._customerPricingCache.set(scoularId, r.pricing);
        this._customerPricingLoadedAt.set(scoularId, Date.now());
      }
    });
  }

  private _takePrefetched(customerId: number): { contracts?: Contract[]; tickets?: Ticket[] } | undefined {
    const entry = this._prefetched.get(customerId);
    this._prefetched.delete(customerId);
    if (!entry || Date.now() - entry.at > HomeProducerActivityStore.PREFETCH_MAX_AGE_MS) return undefined;
    return entry;
  }

  /** Merges one producer's live contract read into the pool and re-derives the per-customer views.
   *  The per-customer response is a LIVE read with no date window; the pool it merges into is a cached
   *  window snapshot. So on an id collision the incoming row is the fresher of the two and must WIN. */
  private _applyCustomerContracts(customerId: number, contracts: Contract[], isRefresh = false): void {
    // Retract-then-replace, so a refresh can drop a contract that has closed out of the list as well as
    // update the ones still in it. See mergeProducerRows for why merging alone is not enough.
    const merged = mergeProducerRows(
      this.page.contracts(), contracts, this._customerRowIds.get(customerId)?.contracts, isRefresh);
    this._rememberRowIds(customerId, 'contracts', contracts.map(c => c.id));
    this.page.contracts.set(merged);
    this.appState.setContracts(merged);
    this.isLoadingContracts.set(false);
    this.loadCustomerData(customerId);
    // Re-run auto-save now that we have the complete contract list — tickets may have arrived first
    // and run auto-save before allCustomerContracts was populated.
    const customer = this.page.customers().find(c => c.id === customerId) || this.page.selectedCustomer();
    if (customer) this._autoSaveCommodities(customer, this.allCustomerTickets());
  }

  /** Merges one producer's ticket read into the LOCAL ticket signal and re-derives the views.
   *
   *  Replaces on id collision rather than skipping. The old version only pushed ids it had not seen,
   *  which meant a row already present from an earlier read - or from a TU-wide load - was never updated:
   *  a ticket applied to a contract or settled since then kept its stale status on screen, because the
   *  synthetic id does not change when the status does. */
  private _applyCustomerTickets(customerId: number, tickets: Ticket[], isRefresh = false): void {
    // Retract-then-replace. A ticket's synthetic id does not change when its status does, so replacement
    // is what lets an applied or settled ticket stop showing as unapplied.
    const merged = mergeProducerRows(
      this.page.tickets(), tickets, this._customerRowIds.get(customerId)?.tickets, isRefresh);
    this._rememberRowIds(customerId, 'tickets', tickets.map(t => t.id));
    this.page.tickets.set(merged);
    this.isLoadingUnappliedTickets.set(false);
    this.loadCustomerData(customerId);
    // Auto-save derives commodities from ticket ProductCodes; the edit dialog also merges
    // contracts' CommodityCode, so the commodity set stays complete.
    const customer = this.page.customers().find(c => c.id === customerId) || this.page.selectedCustomer();
    if (customer) this._autoSaveCommodities(customer, tickets);
  }
  /** Records which ids a producer's read contributed, so the next refresh can retract exactly those. */
  private _rememberRowIds(customerId: number, kind: 'contracts' | 'tickets', ids: number[]): void {
    const entry = this._customerRowIds.get(customerId)
      ?? { contracts: new Set<number>(), tickets: new Set<number>() };
    entry[kind] = new Set(ids);
    this._customerRowIds.set(customerId, entry);
  }

  /** Retries the producer's contract read after a failure, from the table's Retry button. */
  retryContracts(): void {
    const customer = this.page.selectedCustomer();
    if (!customer) return;
    this.contractsLoadError.set(null);
    this.isLoadingContracts.set(true);
    this.apiService.getContractsByCustomer(customer.id, customer.scoularId)
      .pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (contracts) => this._applyCustomerContracts(customer.id, contracts),
        error: (err) => {
          this.isLoadingContracts.set(false);
          this.contractsLoadError.set(readFailureMessage(err));
        }
      });
  }

  /** Retries the producer's ticket read after a failure, from the table's Retry button. */
  retryTickets(): void {
    const customer = this.page.selectedCustomer();
    if (!customer) return;
    this.ticketsLoadError.set(null);
    this.isLoadingUnappliedTickets.set(true);
    this.loadCustomerTickets(customer.id, customer.scoularId);
  }

  /** Loads one producer's tickets (applied + unapplied) into the LOCAL ticket signal and re-filters
   *  the per-customer views. Used on producer select and on navigation-restore. Deliberately does
   *  NOT write to appState.tickets — that signal is the TU-wide cache for list/NLQ queries only;
   *  polluting it with one producer's tickets would make the customer-list/build-list NLQ guard
   *  think the full TU set is loaded. Applied tickets are matched server-side by the customer's open
   *  contract numbers, so split / cross-CustomerCode applied tickets are included. */
  loadCustomerTickets(customerId: number, scoularId: string | undefined, onDone?: () => void): void {
    this.apiService.getTicketsByCustomer(customerId, scoularId)
      .pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tickets) => {
          this._applyCustomerTickets(customerId, tickets);
          onDone?.();
        },
        error: (err) => {
          this.isLoadingUnappliedTickets.set(false);
          this.ticketsLoadError.set(readFailureMessage(err));
        }
      });
  }

  loadCustomerData(customerId: number, customer?: Customer): void {
    const currentCustomer = customer || this.page.selectedCustomer();
    if (!currentCustomer) return;

    const { contracts: allContracts, tickets: allTickets } =
      producerContractsAndTickets(currentCustomer, this.page.contracts(), this.page.tickets());
    this.allCustomerContracts.set([...allContracts]);
    this.allCustomerTickets.set([...allTickets]);
    this.customerContracts.set([...allContracts]);
    this.customerTickets.set([...allTickets]);

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

  private _autoSaveCommodities(customer: Customer, customerTickets: Ticket[]): void {
    const sourceCommodities = commodityCodesFrom(customerTickets, this.allCustomerContracts());
    if (sourceCommodities.length === 0) return;

    const storedCommodities = customer.commodities || [];
    const hasNew = sourceCommodities.some(tc => !storedCommodities.includes(tc));
    if (!hasNew) return;

    // Serialize auto-saves per producer. This fires from BOTH the contracts- and tickets-arrival
    // callbacks on select; firing two PUTs concurrently races the upsert's child-row rebuild
    // (each deletes rows the other already deleted → 500). If one is already in flight for this
    // producer, defer and re-run once it finishes with the freshly-merged commodity set.
    if (this._autoSaveInFlight.has(customer.id)) {
      this._autoSavePending.add(customer.id);
      return;
    }
    this._autoSaveInFlight.add(customer.id);

    const merged = [...new Set([...storedCommodities, ...sourceCommodities])].sort();
    const existingPd = this.page.producerDetailsMap().get(customer.id);
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
        const map = new Map(this.page.producerDetailsMap());
        map.set(pd.customerId, pd);
        this.page.producerDetailsMap.set(map);
        const updatedCustomer = { ...customer, commodities: merged };
        const customers = this.page.customers();
        const index = customers.findIndex(c => c.id === customer.id);
        if (index >= 0) {
          const updated = [...customers];
          updated[index] = updatedCustomer;
          this.page.customers.set(updated);
          // Mirror into the shared cache too. This local signal duplicates appState.customers, and
          // every other write site pushes both; this one didn't — so build-list and insights
          // kept serving the pre-merge commodity list until the next full
          // trade-unit reload happened to overwrite it.
          this.customerStore.setCustomers(updated);
        }
        if (this.page.selectedCustomer()?.id === customer.id) this.page.selectedCustomer.set(updatedCustomer);
        this._autoSaveInFlight.delete(customer.id);
        // A deferred call arrived while this save was in flight — re-run once, now serialized, with
        // the freshly-merged customer so commodities from the later callback (e.g. contracts that
        // arrived after tickets) still get persisted.
        if (this._autoSavePending.delete(customer.id)) {
          const latest = this.page.customers().find(c => c.id === customer.id) || updatedCustomer;
          this._autoSaveCommodities(latest, this.allCustomerTickets());
        }
      },
      error: () => {
        this._autoSaveInFlight.delete(customer.id);
        this._autoSavePending.delete(customer.id);
      }
    });
  }
}
