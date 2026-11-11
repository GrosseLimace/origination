import { Injectable, inject, signal } from '@angular/core';
import { Contract, Ticket } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';

/**
 * The selected trade units' contracts and tickets, kept for the session so every screen shares one load: Build a
 * List, Actionable Insights, the saved lists and the Planting Dashboard. Contracts' preload loads the contracts and
 * today's tickets on each trade-unit change; the trade unit's full ticket set is read only when a screen needs it.
 * The selected producer's own reads (CustomerActivityStore) merge their live contracts in.
 */
@Injectable({ providedIn: 'root' })
export class ContractStore {
  private readonly tradeUnitContext = inject(TradeUnitContext);

  private readonly _contracts = signal<Contract[]>([]);
  private readonly _todaysTickets = signal<Ticket[]>([]);
  private readonly _tickets = signal<Ticket[]>([]);
  private readonly _ticketsLoaded = signal(false);
  private readonly _ticketsTradeUnitKey = signal<string | null>(null);
  private readonly _contractsLoading = signal(false);
  private readonly _todaysTicketsLoading = signal(false);
  private readonly _contractsLoadFailed = signal(false);
  private readonly _ticketsLoadFailed = signal(false);
  private readonly _sourceLoadPending = signal(false);

  /** The trade units' contracts, with the selected producers' live reads merged in. */
  readonly contracts = this._contracts.asReadonly();
  /** Today's tickets for the trade units: Actionable Insights' Spot Loads. */
  readonly todaysTickets = this._todaysTickets.asReadonly();
  /** The trade units' full ticket set, once a screen that needs it has read it (see ticketsLoaded). */
  readonly tickets = this._tickets.asReadonly();

  /**
   * True once the trade unit's ticket set has been read into `tickets`. Check this rather than
   * `tickets().length === 0`: no producer's own read fills `tickets`, and a trade unit can have none. Reset on a
   * trade-unit change and at sign-out.
   */
  readonly ticketsLoaded = this._ticketsLoaded.asReadonly();

  /** Which trade-unit selection `tickets` was read for. A screen that copies the shared set must check it: the
   *  clear on a trade-unit change and the screen's own effect can run in either order, so the copy could otherwise
   *  take the previous trade unit's tickets. */
  readonly ticketsTradeUnitKey = this._ticketsTradeUnitKey.asReadonly();

  // Each dataset's loading flag, so a screen or category renders as soon as its own data arrives rather than waiting
  // on the slowest read: Actionable Insights' Spot Loads waits on today's tickets, its contract categories and the
  // Planting Dashboard on the contracts. True while Contracts' preload reads them.
  readonly contractsLoading = this._contractsLoading.asReadonly();
  readonly todaysTicketsLoading = this._todaysTicketsLoading.asReadonly();

  /**
   * Set when the trade-unit-wide CONTRACT read failed, as opposed to returning nothing. Build a List and Actionable
   * Insights filter the contracts in memory, so a failed read leaves them empty and every prompt answers "no
   * producers found"; screens must check this before showing an empty state.
   */
  readonly contractsLoadFailed = this._contractsLoadFailed.asReadonly();
  /** Same, for the trade-unit-wide ticket reads behind the delivery and unapplied prompts. */
  readonly ticketsLoadFailed = this._ticketsLoadFailed.asReadonly();

  /**
   * Set when a trade-unit read did not fail but had not finished in time: the client gave up waiting. A cold
   * trade-unit ticket walk takes one to two minutes, while the client waits sixty seconds; the server carries on and
   * caches the result, so a retry a moment later succeeds. Saying "could not be loaded from CTRM" then is false.
   */
  readonly sourceLoadPending = this._sourceLoadPending.asReadonly();

  constructor() {
    inject(SessionReset).onReset(() => {
      this._contracts.set([]);
      this._todaysTickets.set([]);
      this.clearTicketsCache();
      this._contractsLoading.set(false);
      this._todaysTicketsLoading.set(false);
      this.clearLoadFailures();
      this._sourceLoadPending.set(false);
    });
  }

  setContracts(contracts: Contract[]): void {
    this._contracts.set(contracts);
  }

  setTodaysTickets(tickets: Ticket[]): void {
    this._todaysTickets.set(tickets);
  }

  /** The trade unit's full ticket set, read for the selection now. */
  setTickets(tickets: Ticket[]): void {
    this._tickets.set(tickets);
    this._ticketsTradeUnitKey.set(this.tradeUnitContext.selectedTradeUnits().join(','));
    this._ticketsLoaded.set(true);
  }

  /** Drops the trade unit's ticket set, so the next screen that needs it reads the new selection's. */
  clearTicketsCache(): void {
    this._tickets.set([]);
    this._ticketsTradeUnitKey.set(null);
    this._ticketsLoaded.set(false);
  }

  setContractsLoading(loading: boolean): void { this._contractsLoading.set(loading); }
  setTodaysTicketsLoading(loading: boolean): void { this._todaysTicketsLoading.set(loading); }

  /**
   * Records the outcome of the TRADE-UNIT-WIDE contract read. Call it on success too.
   *
   * <b>Clear it from a tap BEFORE the catchError, never from setContracts.</b> The failure path resolves to an empty
   * array that flows through setContracts one operator later, so clearing there would undo the flag in the same tick.
   * A tap ahead of the catchError only ever sees a real emission. Only the trade units' contract read belongs here: a
   * producer's own read, or another screen's (the dashboard's crop year), failing doesn't mean the list is missing.
   */
  setContractsLoadFailed(failed: boolean): void { this._contractsLoadFailed.set(failed); }
  /** Same for the trade-unit-wide ticket reads. See setContractsLoadFailed. */
  setTicketsLoadFailed(failed: boolean): void { this._ticketsLoadFailed.set(failed); }
  /** Records that a read timed out client-side rather than failing. See sourceLoadPending. */
  setSourceLoadPending(pending: boolean): void { this._sourceLoadPending.set(pending); }

  /** A new trade-unit load is starting: the previous load's failures no longer describe anything. */
  clearLoadFailures(): void {
    this._contractsLoadFailed.set(false);
    this._ticketsLoadFailed.set(false);
  }
}
