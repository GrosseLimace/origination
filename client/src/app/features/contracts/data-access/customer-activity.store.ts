import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subject, forkJoin, of, timer } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { Contract, ContractPricingLine, Customer, Ticket } from '@models';
import { environment } from '@env/environment';
import { SessionReset } from '@core/auth/session-reset.service';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { mergeProducerRows } from '../utils/merge-producer-rows';
import { producerContractsAndTickets, readFailureMessage } from '../utils/producer-activity';
import { ContractStore } from './contract.store';
import { ContractsApiService } from './contracts-api.service';

/**
 * The selected producer's contracts, tickets and pricing lines: the customer screen's SelectedProducerActivity, which
 * the composition root provides. The page tells it who is selected (select) and who the pointer rests on (prefetch);
 * it reads them, keeps each producer's reads fresh by the rules below, and cancels a producer's reads when another is
 * selected. A producer's live contract read is merged into the trade units' contracts (ContractStore); their tickets
 * into a set of the selected producers' tickets kept here, never the trade unit's set, which only the screens that
 * need it read.
 */
@Injectable({ providedIn: 'root' })
export class CustomerActivityStore implements SelectedProducerActivity {
  private readonly api = inject(ContractsApiService);
  private readonly contractStore = inject(ContractStore);
  private readonly tradeUnits = inject(TradeUnitContext);

  /** Producers whose contracts and tickets have been read, and WHEN.
   *
   *  Re-selecting shows the rows already read at once and refetches in the background if they are older than
   *  {@link CUSTOMER_DATA_MAX_AGE_MS}, swapping them when the response lands. Without an age, the first click of a
   *  session was the only one that ever hit the network: a load applied afterwards, or a contract that closed, stayed
   *  invisible until the user changed trade units, the wrong default for a screen people leave open through a harvest
   *  day. Forgotten on a trade-unit change. */
  private readonly _customerLoadedAt = new Map<number, number>();

  /** How long a producer's contracts and tickets are served without a refetch. Matched to the server's own
   *  per-producer cache (Ctrm:LiveCacheSeconds, 60s): refetching sooner would usually be answered from that cache. */
  private static readonly CUSTOMER_DATA_MAX_AGE_MS = 60_000;

  /** How long after a FIRST read of a producer the silent convergence refresh fires.
   *
   *  The server may answer a first click instantly from the warm trade-unit cache (rows up to a few minutes old)
   *  while it starts the live read behind the answer. This one-shot refresh re-reads once that live read has had time
   *  to land, so anything added or closed in CTRM in the gap appears within seconds of the click. When the first
   *  answer was already live, the refresh hits the server's 60s per-producer cache and costs one ~50ms round trip. */
  private static readonly CLICK_CONVERGENCE_MS = 4_000;

  /** The contract and ticket ids each producer's last read returned.
   *
   *  A refresh has to be able to make a row DISAPPEAR or CHANGE, and merging by id alone cannot: the synthetic ticket
   *  id is built from prefix/number/suffix/BL date/product/sequence and does NOT include the contract number or the
   *  status, so a ticket applied to a contract, settled, or cancelled since the first read has the SAME id. So the
   *  refresh removes exactly the ids the previous read contributed, then merges the new rows. Keyed on the previous ids
   *  rather than on customerCode on purpose: an applied split-load row can carry another producer's code. */
  private readonly _customerRowIds = new Map<number, { contracts: Set<number>; tickets: Set<number> }>();

  /** Each producer's pricing lines, by producer code. Restored OUTSIDE the contracts-and-tickets freshness short-cut,
   *  so every selection swaps to the right producer's lines. */
  private readonly _customerPricingCache = new Map<string, ContractPricingLine[]>();
  /** When each producer's pricing lines were read. Same 60s rule as the contracts and tickets: without an age, a
   *  contract priced after the first click kept its UNPRICED badge for the rest of the session. */
  private readonly _customerPricingLoadedAt = new Map<string, number>();

  /** Producers the pointer rested on, with their contracts and tickets already read. Taken by the next selection of
   *  that producer; anything older than the server's live cache is discarded unused. */
  private readonly _prefetched = new Map<number, { at: number; contracts?: Contract[]; tickets?: Ticket[] }>();
  private readonly _prefetchInFlight = new Set<number>();
  private static readonly PREFETCH_MAX_AGE_MS = 60_000;
  /** Two at once keeps ahead of a reader and stays small enough not to compete with the click. */
  private static readonly PREFETCH_MAX_IN_FLIGHT = 2;

  /** Cancels the reads still running for the producer selected before. */
  private readonly cancel$ = new Subject<void>();

  private readonly _selected = signal<Customer | null>(null);
  /** The selected producers' tickets, each read merged in. */
  private readonly _tickets = signal<Ticket[]>([]);
  private readonly _pricingLines = signal<ContractPricingLine[]>([]);
  private readonly _isLoadingContracts = signal(false);
  private readonly _isLoadingTickets = signal(false);
  private readonly _isLoadingPricingLines = signal(false);
  private readonly _contractsLoadError = signal<string | null>(null);
  private readonly _ticketsLoadError = signal<string | null>(null);
  private readonly _pricingLinesLoadError = signal<string | null>(null);

  /** The selected producer's contracts and tickets, from the trade units' contracts and the producers' tickets as
   *  they stand: their own, and tickets of other producers' split loads applied to their contracts. */
  private readonly rows = computed(() => {
    const customer = this._selected();
    return customer
      ? producerContractsAndTickets(customer, this.contractStore.contracts(), this._tickets())
      : { contracts: [] as Contract[], tickets: [] as Ticket[] };
  });

  readonly contracts = computed(() => this.rows().contracts);
  readonly tickets = computed(() => this.rows().tickets);
  readonly pricingLines = this._pricingLines.asReadonly();
  readonly isLoadingContracts = this._isLoadingContracts.asReadonly();
  readonly isLoadingTickets = this._isLoadingTickets.asReadonly();
  readonly isLoadingPricingLines = this._isLoadingPricingLines.asReadonly();
  /** Kept apart from the loading flag: "empty" and "failed" would render alike, and a CTRM timeout showing as "no
   *  contracts found" is how a grower's book appears empty. */
  readonly contractsLoadError = this._contractsLoadError.asReadonly();
  readonly ticketsLoadError = this._ticketsLoadError.asReadonly();
  /** Apart from the contract error: the contract rows can be good while their prices are missing, and an empty set
   *  reads as "this contract has no priced lines", a wrong number rather than an absent one. */
  readonly pricingLinesLoadError = this._pricingLinesLoadError.asReadonly();

  constructor() {
    inject(SessionReset).onReset(() => {
      this.select(null);
      this.forgetAll();
      this._tickets.set([]);
    });

    // Another selection of trade units: each producer is read again, since the new scope can include or exclude
    // their rows, and the producers' tickets read for the old selection go.
    let first = true;
    effect(() => {
      this.tradeUnits.selectedTradeUnits();
      untracked(() => {
        if (first) { first = false; return; }
        this.forgetAll();
        this._tickets.set([]);
      });
    });
  }

  select(customer: Customer | null): void {
    this.cancel$.next();
    this._selected.set(customer);
    this._contractsLoadError.set(null);
    this._ticketsLoadError.set(null);
    this._pricingLinesLoadError.set(null);
    if (!customer) {
      this._isLoadingContracts.set(false);
      this._isLoadingTickets.set(false);
      this._isLoadingPricingLines.set(false);
      this._pricingLines.set([]);
      return;
    }
    this._isLoadingContracts.set(true);
    this._isLoadingTickets.set(true);
    this.load(customer.id, customer.scoularId);
  }

  /** Warms one producer's reads so the click renders from memory. Touches no signal and no loading flag: the results
   *  wait until the producer is selected, so a prefetch can never repaint the screen for a producer not shown. Only
   *  worth a round trip when the backend reads CTRM; against ODS it is one more read per hovered row for nothing. */
  prefetch(customer: Customer): void {
    if (!environment.ctrmReadAheadEnabled) return;

    const id = customer.id;
    if (this._selected()?.id === id) return;
    if (this._customerLoadedAt.has(id) || this._prefetched.has(id) || this._prefetchInFlight.has(id)) return;
    if (this._prefetchInFlight.size >= CustomerActivityStore.PREFETCH_MAX_IN_FLIGHT) return;

    this._prefetchInFlight.add(id);
    const scoularId = customer.scoularId ?? undefined;
    forkJoin({
      contracts: this.api.getContractsByCustomer(id, scoularId).pipe(catchError(() => of(null))),
      tickets: this.api.getTicketsByCustomer(id, scoularId).pipe(catchError(() => of(null))),
      pricing: scoularId ? this.api.getPricingLinesByCustomer(scoularId).pipe(catchError(() => of(null))) : of(null),
    }).subscribe(r => {
      this._prefetchInFlight.delete(id);
      // Selected before this finished: the real read has run and owns the state.
      if (this._customerLoadedAt.has(id)) return;
      if (r.contracts || r.tickets) {
        this._prefetched.set(id, { at: Date.now(), contracts: r.contracts ?? undefined, tickets: r.tickets ?? undefined });
      }
      // Pricing lines have their own cache, which a selection consults first.
      if (scoularId && r.pricing) {
        this._customerPricingCache.set(scoularId, r.pricing);
        this._customerPricingLoadedAt.set(scoularId, Date.now());
      }
    });
  }

  retryContracts(): void {
    const customer = this._selected();
    if (!customer) return;
    this._contractsLoadError.set(null);
    this._isLoadingContracts.set(true);
    this.api.getContractsByCustomer(customer.id, customer.scoularId)
      .pipe(takeUntil(this.cancel$))
      .subscribe({
        next: contracts => this.applyContracts(customer.id, contracts),
        error: err => {
          this._isLoadingContracts.set(false);
          this._contractsLoadError.set(readFailureMessage(err));
        },
      });
  }

  retryTickets(): void {
    const customer = this._selected();
    if (!customer) return;
    this._ticketsLoadError.set(null);
    this._isLoadingTickets.set(true);
    this.loadTickets(customer.id, customer.scoularId);
  }

  /** Drops every producer's cached reads, so a producer the new scope still covers is read again. */
  private forgetAll(): void {
    this._customerLoadedAt.clear();
    this._customerRowIds.clear();
    this._customerPricingCache.clear();
    this._customerPricingLoadedAt.clear();
    this._prefetched.clear();
  }

  /** The selected producer's reads: their pricing lines every time, and their contracts and tickets unless read
   *  within the last minute, which show at once, with a refresh behind them once they age out. */
  private load(customerId: number, scoularId?: string): void {
    this.loadPricingLines(scoularId);

    const loadedAt = this._customerLoadedAt.get(customerId);
    if (loadedAt !== undefined) {
      this._isLoadingContracts.set(false);
      this._isLoadingTickets.set(false);
      // No spinner for the refresh: the rows on screen are real, so a flicker would be a downgrade.
      if (Date.now() - loadedAt >= CustomerActivityStore.CUSTOMER_DATA_MAX_AGE_MS) this.refresh(customerId, scoularId);
      return;
    }

    let contractsDone = false;
    let ticketsDone = false;
    const markIfAllDone = () => {
      if (contractsDone && ticketsDone) this._customerLoadedAt.set(customerId, Date.now());
    };

    // One-shot convergence pass behind the first paint, through the same retract-then-replace path every refresh
    // uses. Only on the CTRM path: there is nothing to converge on unless the backend answered from a warm trade-unit
    // cache with a live read behind it; against ODS the first answer is already the live one.
    if (environment.ctrmReadAheadEnabled) {
      timer(CustomerActivityStore.CLICK_CONVERGENCE_MS).pipe(takeUntil(this.cancel$)).subscribe(() => {
        if (this._selected()?.id !== customerId) return;
        this.refresh(customerId, scoularId);
      });
    }

    // A hover prefetch may already hold them; they are applied through the same functions the network path uses.
    const prefetched = this.takePrefetched(customerId);

    if (prefetched?.contracts) {
      this.applyContracts(customerId, prefetched.contracts);
      contractsDone = true;
      markIfAllDone();
    } else {
      this.api.getContractsByCustomer(customerId, scoularId).pipe(takeUntil(this.cancel$)).subscribe({
        next: contracts => {
          this.applyContracts(customerId, contracts);
          contractsDone = true;
          markIfAllDone();
        },
        error: err => {
          this._isLoadingContracts.set(false);
          this._contractsLoadError.set(readFailureMessage(err));
        },
      });
    }

    // Applied and unapplied, scoped to this producer: applied tickets are matched server-side by the producer's open
    // contract numbers, so split-load and cross-producer applied tickets are included.
    if (prefetched?.tickets) {
      this.applyTickets(customerId, prefetched.tickets);
      ticketsDone = true;
      markIfAllDone();
    } else {
      this.loadTickets(customerId, scoularId, () => { ticketsDone = true; markIfAllDone(); });
    }
  }

  private loadTickets(customerId: number, scoularId: string | undefined, onDone?: () => void): void {
    this.api.getTicketsByCustomer(customerId, scoularId).pipe(takeUntil(this.cancel$)).subscribe({
      next: tickets => {
        this.applyTickets(customerId, tickets);
        onDone?.();
      },
      error: err => {
        this._isLoadingTickets.set(false);
        this._ticketsLoadError.set(readFailureMessage(err));
      },
    });
  }

  /**
   * Refetches a producer's contracts and tickets behind rows already on screen. Silent: a failed refresh leaves the
   * visible rows, which are real, rather than replacing a correct screen with an error. The read time only advances
   * when both reads succeed, so a partial failure retries on the next selection.
   */
  private refresh(customerId: number, scoularId?: string): void {
    forkJoin({
      contracts: this.api.getContractsByCustomer(customerId, scoularId).pipe(catchError(() => of(null))),
      tickets: this.api.getTicketsByCustomer(customerId, scoularId).pipe(catchError(() => of(null))),
    }).pipe(takeUntil(this.cancel$)).subscribe(({ contracts, tickets }) => {
      // Only while still on this producer: a refresh landing after the user moved on would write one producer's rows
      // into another's view.
      if (this._selected()?.id !== customerId) return;
      if (contracts) this.applyContracts(customerId, contracts, true);
      if (tickets) this.applyTickets(customerId, tickets, true);
      if (contracts && tickets) this._customerLoadedAt.set(customerId, Date.now());
    });
  }

  private takePrefetched(customerId: number): { contracts?: Contract[]; tickets?: Ticket[] } | undefined {
    const entry = this._prefetched.get(customerId);
    this._prefetched.delete(customerId);
    if (!entry || Date.now() - entry.at > CustomerActivityStore.PREFETCH_MAX_AGE_MS) return undefined;
    return entry;
  }

  /** Merges one producer's live contract read into the trade units' contracts. The live read has no date window and
   *  the trade units' set is a cached snapshot, so on an id collision the incoming row is the fresher and wins; a
   *  refresh also drops what its producer's last read contributed (see mergeProducerRows). */
  private applyContracts(customerId: number, contracts: Contract[], isRefresh = false): void {
    const merged = mergeProducerRows(
      this.contractStore.contracts(), contracts, this._customerRowIds.get(customerId)?.contracts, isRefresh);
    this.rememberRowIds(customerId, 'contracts', contracts.map(c => c.id));
    this.contractStore.setContracts(merged);
    this._isLoadingContracts.set(false);
  }

  /** Merges one producer's ticket read into the producers' tickets, replacing on an id collision: a ticket's
   *  synthetic id doesn't change when it is applied or settled, so replacement is what updates its status. */
  private applyTickets(customerId: number, tickets: Ticket[], isRefresh = false): void {
    const merged = mergeProducerRows(this._tickets(), tickets, this._customerRowIds.get(customerId)?.tickets, isRefresh);
    this.rememberRowIds(customerId, 'tickets', tickets.map(t => t.id));
    this._tickets.set(merged);
    this._isLoadingTickets.set(false);
  }

  /** Records which ids a producer's read contributed, so the next refresh can retract exactly those. */
  private rememberRowIds(customerId: number, kind: 'contracts' | 'tickets', ids: number[]): void {
    const entry = this._customerRowIds.get(customerId) ?? { contracts: new Set<number>(), tickets: new Set<number>() };
    entry[kind] = new Set(ids);
    this._customerRowIds.set(customerId, entry);
  }

  /** The selected producer's pricing lines: from the cache at once, refreshed behind them once a minute old; or read,
   *  clearing the previous producer's lines first so none show during the read. */
  private loadPricingLines(scoularId?: string): void {
    if (!scoularId) {
      this._pricingLines.set([]);
      this._isLoadingPricingLines.set(false);
      return;
    }
    const cached = this._customerPricingCache.get(scoularId);
    if (cached) {
      this._pricingLines.set(cached);
      this._isLoadingPricingLines.set(false);
      const loadedAt = this._customerPricingLoadedAt.get(scoularId) ?? 0;
      if (Date.now() - loadedAt >= CustomerActivityStore.CUSTOMER_DATA_MAX_AGE_MS) this.refreshPricingLines(scoularId);
      return;
    }
    this._pricingLines.set([]);
    this._isLoadingPricingLines.set(true);
    this.api.getPricingLinesByCustomer(scoularId).pipe(takeUntil(this.cancel$)).subscribe({
      next: lines => {
        this._pricingLines.set(lines);
        this._customerPricingCache.set(scoularId, lines);
        this._customerPricingLoadedAt.set(scoularId, Date.now());
        this._isLoadingPricingLines.set(false);
      },
      error: err => {
        this._pricingLines.set([]);
        this._isLoadingPricingLines.set(false);
        this._pricingLinesLoadError.set(readFailureMessage(err));
      },
    });
  }

  /** Refetches a producer's pricing lines behind badges on screen. Silent like the contract refresh, and replaces the
   *  set outright: a line repriced since keeps its sequence, so merging by key would keep the stale price. */
  private refreshPricingLines(scoularId: string): void {
    this.api.getPricingLinesByCustomer(scoularId).pipe(takeUntil(this.cancel$)).subscribe({
      next: lines => {
        if (this._selected()?.scoularId !== scoularId) return;
        this._customerPricingCache.set(scoularId, lines);
        this._customerPricingLoadedAt.set(scoularId, Date.now());
        this._pricingLinesLoadError.set(null);
        this._pricingLines.set(lines);
      },
      error: () => { /* keep the visible badges; the failure is recorded server-side and logged */ },
    });
  }
}
