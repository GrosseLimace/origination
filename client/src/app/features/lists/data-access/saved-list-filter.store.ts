import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { SessionReset } from '@core/auth/session-reset.service';
import { KeptCustomers } from '@core/context/customer-list-filter';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { AppStateService } from '@core/services/app-state.service';
import { ContractStore } from '@features/contracts';
import { NlqFilterService } from '../nlq/nlq-filter.service';
import { CustomerStore } from '@features/customers';
import { SavedList } from '../models/saved-list.model';
import { SavedListsStore } from './saved-lists.store';

/** What the customer list says while a saved list is worked out. */
export const RUNNING_SAVED_LIST = 'Running saved list...';

/**
 * The saved list picked in the customer list's filter, and who it holds. Kept for the session, so the list is still
 * picked when the home page opens again. A pick reads what the list's query needs and isn't loaded yet, then works the
 * list out against the trade unit's customers (SavedListsStore.resolve); until then the customer list keeps what it
 * shows, with a spinner. It is worked out again when more of what it reads arrives: the trade unit's tickets, stored
 * grain or planting for a list that reads them, a producer added to the roster, or the list itself changed. A new
 * selection of trade units keeps the list picked while it still applies to them, and goes back to every customer when
 * it doesn't.
 */
@Injectable({ providedIn: 'root' })
export class SavedListFilterStore {
  private readonly lists = inject(SavedListsStore);
  private readonly customerStore = inject(CustomerStore);
  private readonly appState = inject(AppStateService);
  /** The trade units' contracts and tickets, kept by the Contracts module. */
  private readonly contractStore = inject(ContractStore);
  private readonly tradeUnits = inject(TradeUnitContext);
  private readonly nlq = inject(NlqFilterService);

  private readonly _selectedId = signal('all');
  /** Who the picked list holds; null until it has been worked out. */
  private readonly _ids = signal<ReadonlySet<number> | null>(null);
  /** The roster size the list was last worked out against, so a larger roster works it out again. */
  private resolvedForCustomers = -1;
  /** The list as it was saved when it was last worked out, so a change to it can be told. */
  private resolvedFrom: SavedList | null = null;
  private run: Subscription | null = null;

  /** The picked list's id, or 'all'. */
  readonly selectedId = this._selectedId.asReadonly();
  /** The lists the filter offers: the user's own lists that share a trade unit with the selection. */
  readonly options = this.lists.listsInScope;
  /** How many customers the picked list holds, once worked out. */
  readonly count = computed(() => this._ids()?.size ?? 0);

  /** Which of its customers the customer list keeps. */
  readonly kept = computed<KeptCustomers>(() => {
    if (this._selectedId() === 'all') return { kind: 'all' };
    const ids = this._ids();
    return ids ? { kind: 'some', ids } : { kind: 'pending', message: RUNNING_SAVED_LIST };
  });

  constructor() {
    inject(SessionReset).onReset(() => this.select('all'));

    // More of what the list reads arrived after it was worked out: work it out again, for a list that reads it.
    effect(() => {
      const tickets = this.contractStore.tickets();
      const storedGrain = this.appState.storedGrain();
      const planting = this.appState.plantingIntentions();
      untracked(() => {
        const list = this.picked();
        if (!list || this._ids() === null) return;
        if ((this.nlq.queryInvolvesTickets(list.query) && tickets.length > 0)
          || (this.nlq.queryInvolvesStorage(list.query) && storedGrain.length > 0)
          || (this.nlq.queryInvolvesPlanting(list.query) && planting.length > 0)) {
          this.workOut(list);
        }
      });
    });

    // The roster arrived or grew. A list still waiting on customers runs now; one already worked out against fewer
    // customers is worked out again. Only a larger roster counts: it changes often enough that re-running on every
    // change would redo the whole query for nothing.
    effect(() => {
      const count = this.customerStore.customers().length;
      untracked(() => {
        const list = this.picked();
        if (!list || count === 0) return;
        if (this._ids() === null) {
          if (!this.run) this.start(list);
        } else if (count > this.resolvedForCustomers) {
          this.workOut(list);
        }
      });
    });

    // The lists changed: the picked one deleted goes back to every customer; changed (a customer added to it or taken
    // off it, from Add to List or Build a List), it is worked out again.
    effect(() => {
      this._selectedId();
      this.lists.lists();
      const loaded = this.lists.loaded();
      untracked(() => {
        const list = this.picked();
        if (this._selectedId() === 'all') return;
        if (!list) {
          if (loaded) this.select('all');
          return;
        }
        if (this.resolvedFrom && this.resolvedFrom !== list && this._ids() !== null) this.start(list);
      });
    });

    // Another selection of trade units: the list stays picked while it still applies to them, and runs again against
    // their customers once they arrive; otherwise the filter goes back to every customer.
    let first = true;
    effect(() => {
      this.tradeUnits.selectedTradeUnits();
      this.tradeUnits.selectedGroupNames();
      untracked(() => {
        if (first) { first = false; return; }
        const id = this._selectedId();
        if (id === 'all') return;
        this.stop();
        if (this.options().some(list => String(list.id) === id)) {
          this._ids.set(null);
          this.resolvedForCustomers = -1;
        } else {
          this.select('all');
        }
      });
    });
  }

  /** Picks a list by id, or 'all'. A list is worked out from scratch: until then the customer list keeps what it
   *  shows, with a spinner. */
  select(id: string): void {
    this.stop();
    this._selectedId.set(id);
    this._ids.set(null);
    this.resolvedForCustomers = -1;
    this.resolvedFrom = null;
    const list = this.picked();
    if (list) this.start(list);
  }

  /** The picked list as it is saved now, or null. */
  private picked(): SavedList | null {
    const id = this._selectedId();
    if (id === 'all') return null;
    return this.lists.lists().find(list => String(list.id) === id) ?? null;
  }

  /**
   * Reads what the list needs and works it out. Without customers yet it waits: the roster effect starts it when they
   * arrive. A failed read still works the list out, with what is there.
   */
  private start(list: SavedList): void {
    this.stop();
    if (this.customerStore.customers().length === 0) return;
    const run = this.lists.loadDataFor(list).subscribe({
      next: () => this.finish(list),
      error: () => this.finish(list),
    });
    // Everything already loaded answers at once, before subscribe returns: nothing is left running.
    this.run = run.closed ? null : run;
  }

  private finish(list: SavedList): void {
    this.run = null;
    // The list as it is now: it may have changed while its data loaded.
    this.workOut(this.picked() ?? list);
  }

  /** Works the list out against what is loaded now. */
  private workOut(list: SavedList): void {
    if (String(list.id) !== this._selectedId()) return;
    this._ids.set(new Set(this.lists.resolve(list).ids));
    this.resolvedForCustomers = this.customerStore.customers().length;
    this.resolvedFrom = list;
  }

  private stop(): void {
    this.run?.unsubscribe();
    this.run = null;
  }
}
