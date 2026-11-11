import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { MsalService } from '@azure/msal-angular';
import { PermissionService } from '@core/access/permission.service';
import { SessionReset } from '@core/auth/session-reset.service';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { alreadyShown } from '@core/http/shown-errors';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ContractStore, ContractsApiService } from '@features/contracts';
import { NlqFilterContext, NlqFilterService } from '../nlq/nlq-filter.service';
import { ToastService } from '@core/services/toast.service';
import { Contract, Customer, Note, Ticket } from '@models';
import { CustomerStore } from '@features/customers';
import { QueryLibraryItem } from '../models/query-library.model';
import { SavedList } from '../models/saved-list.model';
import { filterSavedListsByTradeUnitOverlap } from '../utils/saved-list-trade-units';
import { SavedListsApiService } from './saved-lists-api.service';

/** One change to a customer's membership of a saved list: added to it, or taken off it. */
export interface SavedListMembershipChange {
  listId: number;
  add: boolean;
}

/** Who a saved list holds. `matched` is false when the engine understood none of its query, which then matches every
 *  customer: a resolve that says nothing about who the list means. */
export interface ResolvedList {
  ids: number[];
  matched: boolean;
}

/**
 * The user's saved lists and, with the team permissions, the team's lists for the selected trade units; the query
 * library; and who each list holds. A list stores an NLQ query, refinement filters and manual includes and excludes;
 * who it holds is worked out here from the trade unit's data (the customers, and what AppStateService holds of their
 * contracts, tickets, planting, storage, DP and notes), and worked out again as that data arrives. Add to List's
 * ticks read it, and the customer list's saved-list filter runs a list through the same resolve.
 *
 * Lists' preload loads the lists for each trade-unit selection; Build a List writes back the lists it saves or
 * deletes.
 */
@Injectable({ providedIn: 'root' })
export class SavedListsStore {
  private readonly api = inject(SavedListsApiService);
  private readonly appApi = inject(ApiService);
  private readonly appState = inject(AppStateService);
  /** The trade units' contracts and tickets, kept by the Contracts module. */
  private readonly contractStore = inject(ContractStore);
  private readonly contractsApi = inject(ContractsApiService);
  private readonly customerStore = inject(CustomerStore);
  private readonly producerProfiles = inject(ProducerProfiles);
  private readonly tradeUnits = inject(TradeUnitContext);
  private readonly nlq = inject(NlqFilterService);
  private readonly msal = inject(MsalService);
  private readonly access = inject(PermissionService);
  private readonly toast = inject(ToastService);

  private readonly _lists = signal<SavedList[]>([]);
  private readonly _loaded = signal(false);
  private readonly _loadFailed = signal(false);
  private readonly _teamLists = signal<SavedList[]>([]);
  private readonly _queryLibrary = signal<QueryLibraryItem[]>([]);

  /** The user's own lists as saved: the same objects until a list is read, saved or changed again. */
  readonly lists = this._lists.asReadonly();
  /** Whether the user's own lists have loaded since sign-in (or Build a List has set them). */
  readonly loaded = this._loaded.asReadonly();
  /** The user's own lists failed to load, so having none does not mean they have none. */
  readonly loadFailed = this._loadFailed.asReadonly();
  /** The query library, once read: Build a List's prompts, and the categories older lists are resolved by. */
  readonly queryLibrary = this._queryLibrary.asReadonly();

  /** The Team Lists: reading teammates' lists needs the team read, and adding a customer to one changes someone
   *  else's list, which needs the team write. */
  readonly canEditTeamLists = computed(() => this.access.hasAll(['saved-lists:read:team', 'saved-lists:write:team']));

  /** The user's own lists sharing a trade unit with the selection, as saved: the lists the customer list's filter
   *  and Add to List offer. */
  readonly listsInScope = computed(() =>
    filterSavedListsByTradeUnitOverlap(this._lists(), this.tradeUnits.selectedTradeUnits()));
  /** Teammates' lists tied to the selected trade units. Empty with no trade unit selected, and for a user without the
   *  team permissions. */
  private readonly teamInScope = computed(() =>
    this.tradeUnits.selectedTradeUnits().length === 0 ? [] : this._teamLists());

  /**
   * Who each list in scope holds, by list id, against the trade unit's data as it stands: worked out only when read
   * (Add to List's ticks), and again after anything it reads changes, from the customers arriving to a list saved.
   * A list the engine understood none of holds nobody of its own; only its includes count.
   */
  private readonly members = computed(() => {
    const members = new Map<number, number[]>();
    if (this.customerStore.customers().length === 0) return members;
    for (const list of [...this.listsInScope(), ...this.teamInScope()]) {
      const resolved = this.resolve(list);
      if (resolved.matched) members.set(list.id, resolved.ids);
    }
    return members;
  });

  /** The own lists in scope, each with who it holds (`customerIds`): Add to List's ticks. */
  readonly ownListsWithMembers = computed(() => this.withMembers(this.listsInScope()));
  /** The team's lists in scope, each with who it holds. */
  readonly teamListsWithMembers = computed(() => this.withMembers(this.teamInScope()));

  constructor() {
    inject(SessionReset).onReset(() => {
      this._lists.set([]);
      this._loaded.set(false);
      this._loadFailed.set(false);
      this._teamLists.set([]);
      this._queryLibrary.set([]);
    });
  }

  /**
   * Reads the user's own lists, and the query library their older lists' categories are resolved by when it isn't
   * read yet. A failure is kept (`loadFailed`) and ends the read quietly.
   */
  load(): Observable<unknown> {
    if (!this.access.has('saved-lists:read:own')) return of(null);
    const lists$ = this.api.getSavedLists().pipe(
      tap(lists => { this.setLists(lists ?? []); this._loadFailed.set(false); }),
      catchError(() => { this._loadFailed.set(true); return of(null); }),
    );
    const library$ = this._queryLibrary().length > 0 || !this.access.has('query-library:read')
      ? of(null)
      : this.api.getQueryLibrary().pipe(tap(items => this._queryLibrary.set(items ?? [])), catchError(() => of(null)));
    return forkJoin([lists$, library$]);
  }

  /** Reads the team's lists for the selected trade units, for a user with the team permissions; clears them
   *  otherwise. A failure leaves the last ones in place: they are a supplementary view. */
  loadTeamLists(): Observable<unknown> {
    const tus = this.tradeUnits.selectedTradeUnits();
    if (!this.canEditTeamLists() || tus.length === 0) {
      this._teamLists.set([]);
      return of(null);
    }
    return this.api.getTeamSavedLists(tus.join(',')).pipe(
      tap(lists => this._teamLists.set(lists ?? [])),
      catchError(() => of(null)),
    );
  }

  /** Replaces the user's own lists: after a read, or after Build a List saves or deletes one. Whether the last read
   *  failed is its own say (setLoadFailed): Build a List keeps an empty set after a failed read. */
  setLists(lists: SavedList[]): void {
    this._lists.set(lists.map(list => ({ ...list, customerIds: undefined })));
    this._loaded.set(true);
  }

  /** Records that reading the user's own lists failed, or succeeded after all. */
  setLoadFailed(failed: boolean): void {
    this._loadFailed.set(failed);
  }

  /** Keeps the query library Build a List read. */
  setQueryLibrary(items: QueryLibraryItem[]): void {
    this._queryLibrary.set(items);
  }

  /** What a list's query is run against: the trade unit's data, and who the user is for "my" and "me". */
  private context(customers: Customer[]): NlqFilterContext {
    const account = this.account();
    return {
      customers,
      producerProfiles: this.producerProfiles.profiles(),
      contracts: this.contractStore.contracts(),
      tickets: this.contractStore.tickets(),
      notes: this.appState.notes(),
      noteLastContacts: this.appState.noteLastContacts(),
      myReminders: this.appState.myReminders(),
      plantingIntentions: this.appState.plantingIntentions(),
      storedGrain: this.appState.storedGrain(),
      dpContracts: this.appState.dpContracts(),
      commodities: this.appState.commodities(),
      commodityConversions: this.appState.commodityConversions(),
      // So a list's "by me" filters work even where a note's author wasn't resolved to a name by the API.
      currentUserDisplayName: account?.name ?? '',
      currentUserUsername: account?.username ?? '',
    };
  }

  /**
   * Who the list holds among the trade unit's customers: its query, then its refinement filters, then its own includes
   * and excludes. A list older than the prompt-category hint is matched to the query library by its query text, which
   * the refinements' dimension-aware filters need.
   */
  resolve(list: SavedList): ResolvedList {
    const customers = this.customerStore.customers();
    const context = this.context(customers);
    const account = this.account();
    // "I", "me" and "my" are the user, so author-based queries work.
    const query = this.nlq.resolveUserReferences(list.query, account?.name ?? '', account?.username ?? '');
    const result = this.nlq.parseAndFilter(query, context);
    let filters = list.filters;
    if (filters && !filters._promptCategory) {
      const text = list.query.trim().toLowerCase();
      const item = this._queryLibrary().find(q => q.queryText.trim().toLowerCase() === text);
      if (item?.category) filters = { ...filters, _promptCategory: item.category };
    }
    const refined = filters
      ? this.nlq.applyRefinementFilters(result.customers, filters, context.contracts, context.notes ?? [], {
          producerProfiles: context.producerProfiles,
          tickets: context.tickets,
          storedGrain: context.storedGrain,
          dpContracts: context.dpContracts,
          plantingIntentions: context.plantingIntentions,
          commodityConversions: context.commodityConversions,
          noteLastContacts: context.noteLastContacts,
          commodities: context.commodities,
        })
      : result.customers;
    return {
      ids: this.nlq.applyCustomerOverrides(refined.map(c => c.id), list.includedCustomerIds, list.excludedCustomerIds),
      matched: result.matchedPatterns.length > 0,
    };
  }

  /**
   * Reads, for the trade unit, what the list's query needs and isn't loaded yet, into AppStateService: stored grain,
   * DP contracts, tickets, planting intentions, contracts, the full notes, and the query library for a list older than
   * the category hint. Emits once all of it has answered, failed reads included; a failed contract or ticket read is
   * recorded, so a list that needed them doesn't read as "nobody".
   */
  loadDataFor(list: SavedList): Observable<void> {
    const query = list.query;
    const selected = this.tradeUnits.selectedTradeUnits();
    const tus = selected.length > 0 ? [...selected] : undefined;
    const reads: Observable<unknown>[] = [];
    if (this.nlq.queryInvolvesStorage(query) && this.appState.storedGrain().length === 0) {
      reads.push(this.appApi.getStoredGrain(tus).pipe(
        tap(rows => this.appState.setStoredGrain(rows)), catchError(() => of(null))));
    }
    // The loaded flag rather than the length: a producer's own rows can be there without the trade unit's, and a
    // trade unit with no DP at all would otherwise read again every time.
    if (this.nlq.queryInvolvesDpContracts(query) && !this.appState.dpContractsLoaded()) {
      reads.push(this.appApi.getDpContracts(tus).pipe(
        tap(rows => this.appState.setDpContracts(rows)), catchError(() => of(null))));
    }
    if (this.nlq.queryInvolvesTickets(query) && !this.contractStore.ticketsLoaded()) {
      reads.push(this.ticketsRead(tus));
    }
    if (this.nlq.queryInvolvesPlanting(query) && this.appState.plantingIntentions().length === 0) {
      reads.push(this.appApi.getPlantingIntentions(tus).pipe(
        tap(rows => this.appState.setPlantingIntentions(rows)), catchError(() => of(null))));
    }
    if (this.nlq.queryInvolvesContracts(query) && this.contractStore.contracts().length === 0) {
      reads.push(this.contractsApi.getContracts(tus).pipe(
        tap(() => this.contractStore.setContractsLoadFailed(false)),
        catchError(() => { this.contractStore.setContractsLoadFailed(true); return of([] as Contract[]); }),
        tap(rows => this.contractStore.setContracts(rows))));
    }
    // The full notes only for what reads their bodies, authors, pins or counts: recency resolves from the last-contact
    // summary, which is always loaded.
    if (this.needsFullNotes(list) && !this.appState.notesLoaded()) {
      reads.push(this.notesRead());
    }
    if (list.filters && !list.filters._promptCategory && this._queryLibrary().length === 0
      && this.access.has('query-library:read')) {
      reads.push(this.api.getQueryLibrary().pipe(tap(items => this._queryLibrary.set(items ?? [])), catchError(() => of(null))));
    }
    return reads.length === 0 ? of(undefined) : forkJoin(reads).pipe(map(() => undefined));
  }

  /**
   * Puts the customer on the lists or takes them off: each changed list saved once, and one message for them all. The
   * lists change at once and go back if any save fails. Membership is the list's includes and excludes: adding drops
   * an exclusion and includes the customer; removing drops a manual include, or else excludes a customer the query
   * matched, as Build a List does.
   */
  save(customer: Customer, changes: readonly SavedListMembershipChange[]): void {
    if (changes.length === 0) return;
    const id = customer.id;
    const ownBefore = this._lists();
    const teamBefore = this._teamLists();
    const own = [...ownBefore];
    const team = [...teamBefore];
    const saves: Observable<unknown>[] = [];

    for (const change of changes) {
      let working = own;
      let index = own.findIndex(l => l.id === change.listId);
      if (index === -1) {
        working = team;
        index = team.findIndex(l => l.id === change.listId);
      }
      if (index === -1) continue;
      const list = working[index];
      const included = new Set(list.includedCustomerIds ?? []);
      const excluded = new Set(list.excludedCustomerIds ?? []);
      if (change.add) {
        excluded.delete(id);
        included.add(id);
      } else if (included.has(id)) {
        included.delete(id);
      } else {
        excluded.add(id);
      }
      working[index] = { ...list, includedCustomerIds: [...included], excludedCustomerIds: [...excluded] };
      saves.push(this.api.updateSavedList(list.id, {
        name: list.name,
        query: list.query,
        tradeUnits: list.tradeUnits,
        filters: list.filters,
        includedCustomerIds: [...included],
        excludedCustomerIds: [...excluded],
      }));
    }
    if (saves.length === 0) return;

    this._lists.set(own);
    this._teamLists.set(team);
    forkJoin(saves).subscribe({
      next: () => this.toast.success(saves.length === 1 ? 'Saved list updated' : `${saves.length} saved lists updated`),
      error: err => {
        this._lists.set(ownBefore);
        this._teamLists.set(teamBefore);
        if (!alreadyShown(err)) this.toast.error('Failed to save list changes');
      },
    });
  }

  /** The lists with who each holds, where that has been worked out. */
  private withMembers(lists: SavedList[]): SavedList[] {
    const members = this.members();
    return lists.map(list => ({ ...list, customerIds: members.get(list.id) }));
  }

  /**
   * Starts the reads the lists in scope need for who they hold that the trade-unit load doesn't make: the trade unit's
   * tickets, the full notes. Each runs once at a time; who the lists hold is worked out again when they land. Add to
   * List calls it, being where who a list holds is shown.
   */
  loadMembershipData(): void {
    const lists = [...this.listsInScope(), ...this.teamInScope()];
    if (lists.some(list => this.nlq.queryInvolvesTickets(list.query)) && !this.contractStore.ticketsLoaded()) {
      const tus = this.selectedTradeUnits();
      const key = (tus ?? []).join(',');
      // Kept only while the selection is still the one it was read for: a trade-unit change clears the cache, and a
      // late answer for the old selection would otherwise fill it with the wrong trade unit's tickets.
      this.startOnce('tickets:' + key, () => this.ticketsRead(tus, () => (this.selectedTradeUnits() ?? []).join(',') === key));
    }
    if (lists.some(list => this.needsFullNotes(list)) && !this.appState.notesLoaded()) {
      this.startOnce('notes', () => this.notesRead());
    }
  }

  private readonly running = new Set<string>();

  /** Starts a background read unless the same one is already running. */
  private startOnce(key: string, read: () => Observable<unknown>): void {
    if (this.running.has(key)) return;
    this.running.add(key);
    read().subscribe({ complete: () => this.running.delete(key), error: () => this.running.delete(key) });
  }

  /** The trade unit's tickets into AppStateService, recording a failure so ticket lists don't read as "nobody". Kept
   *  only while `current` says the answer is still for the selection. */
  private ticketsRead(tus: string[] | undefined, current: () => boolean = () => true): Observable<unknown> {
    return this.contractsApi.getTickets(tus).pipe(
      tap(() => { if (current()) this.contractStore.setTicketsLoadFailed(false); }),
      catchError(() => { if (current()) this.contractStore.setTicketsLoadFailed(true); return of([] as Ticket[]); }),
      tap(rows => { if (current()) this.contractStore.setTickets(rows); }));
  }

  /** Every note the user may read, into AppStateService's lazy cache. */
  private notesRead(): Observable<unknown> {
    return this.appApi.getNotes().pipe(tap(rows => this.appState.setNotes(rows ?? [])), catchError(() => of([] as Note[])));
  }

  private needsFullNotes(list: SavedList): boolean {
    return this.nlq.queryNeedsFullNotes(list.query) || this.nlq.refineFiltersNeedFullNotes(list.filters);
  }

  private selectedTradeUnits(): string[] | undefined {
    const selected = this.tradeUnits.selectedTradeUnits();
    return selected.length > 0 ? [...selected] : undefined;
  }

  private account() {
    return this.msal.instance.getActiveAccount() ?? this.msal.instance.getAllAccounts()[0];
  }
}
