import { Injectable, inject, signal } from '@angular/core';
import { Customer, Contract, Ticket, PlantingIntention, Note, NoteLastContact, ReminderDue, StoredGrain, DpContract, SavedList, Commodity, CommodityConversion, HarvestWindow, ContractPricingLine, QueryLibraryItem } from '@models';
import { ProducerDetails } from '../../models/producer-details.model';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { SessionReset } from '@core/auth/session-reset.service';

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
  // Writable state lives here, private. Each one is exposed below as a read-only signal next to its
  // documentation, and changes only through this service's methods — so every write to shared state
  // is a named, searchable call rather than a .set() from whichever component happened to hold it.
  private readonly _selectedCustomer = signal<Customer | null>(null);
  private readonly _allProducersMode = signal(false);
  private readonly _searchQuery = signal<string>('');
  private readonly _selectedSavedListId = signal<string>('');
  private readonly _contracts = signal<Contract[]>([]);
  private readonly _todaysTickets = signal<Ticket[]>([]);
  private readonly _tickets = signal<Ticket[]>([]);
  private readonly _plantingIntentions = signal<PlantingIntention[]>([]);
  private readonly _notes = signal<Note[]>([]);
  private readonly _noteLastContacts = signal<NoteLastContact[]>([]);
  private readonly _myReminders = signal<ReminderDue[]>([]);
  private readonly _storedGrain = signal<StoredGrain[]>([]);
  private readonly _dpContracts = signal<DpContract[]>([]);
  private readonly _dpContractsLoaded = signal(false);
  private readonly _savedLists = signal<SavedList[]>([]);
  private readonly _commodities = signal<Commodity[]>([]);
  private readonly _commodityConversions = signal<CommodityConversion[]>([]);
  private readonly _queryLibrary = signal<QueryLibraryItem[]>([]);
  private readonly _harvestWindows = signal<HarvestWindow[]>([]);
  private readonly _producerDetails = signal<ProducerDetails[]>([]);
  private readonly _pricingLines = signal<ContractPricingLine[]>([]);
  private readonly _ticketsLoaded = signal(false);
  private readonly _ticketsTradeUnitKey = signal<string | null>(null);
  private readonly _notesLoaded = signal(false);
  private readonly _contractsLoading = signal(false);
  private readonly _todaysTicketsLoading = signal(false);
  private readonly _contractsLoadFailed = signal(false);
  private readonly _ticketsLoadFailed = signal(false);
  private readonly _dpContractsLoadFailed = signal(false);
  private readonly _noteLastContactsLoadFailed = signal(false);
  private readonly _myRemindersLoadFailed = signal(false);
  private readonly _savedListsLoadFailed = signal(false);
  private readonly _plantingIntentionsLoadFailed = signal(false);
  private readonly _harvestWindowsLoadFailed = signal(false);
  private readonly _commodityConversionsLoadFailed = signal(false);
  private readonly _sourceLoadPending = signal(false);

  // The trade-unit selection lives in TradeUnitContext; setTickets records which one the tickets were loaded for.
  private readonly tradeUnitContext = inject(TradeUnitContext);
  private readonly sessionReset = inject(SessionReset);

  // Selection state
  readonly selectedCustomer = this._selectedCustomer.asReadonly();
  // "All Producers" mode — a session-only override that clears scope so the customer-list
  // search spans all producers (our table + ODS onboarding fallback). Deliberately NOT
  // persisted (localStorage or server preference) and starts false every session, so the
  // user's saved preference always remains a real trade group, never "All Producers".
  readonly allProducersMode = this._allProducersMode.asReadonly();

  // Search state
  readonly searchQuery = this._searchQuery.asReadonly();

  // Saved list selection state — persists across navigation
  readonly selectedSavedListId = this._selectedSavedListId.asReadonly();

  // Data cache - persists across navigation
  readonly contracts = this._contracts.asReadonly();
  readonly todaysTickets = this._todaysTickets.asReadonly();
  readonly tickets = this._tickets.asReadonly();
  readonly plantingIntentions = this._plantingIntentions.asReadonly();
  /** Full TU-wide note set — a LAZY cache for NLQ/saved-list consumers only (see notesLoaded).
   *  No longer eagerly bulk-loaded on page load / TU change; badges use noteLastContacts. */
  readonly notes = this._notes.asReadonly();
  /** Per-customer "last contacted" aggregate — the lightweight badge feed (all trade units,
   *  entitlement-filtered). Preloaded on TU change; tiny regardless of how many notes exist. */
  readonly noteLastContacts = this._noteLastContacts.asReadonly();
  /** The signed-in user's OWN open follow-up reminders — the producer-list reminder badge feed.
   *  Private per user (the API only returns the caller's), and tiny: one row per scheduled
   *  follow-up, no reminder text. Preloaded on TU change alongside noteLastContacts. */
  readonly myReminders = this._myReminders.asReadonly();
  readonly storedGrain = this._storedGrain.asReadonly();
  readonly dpContracts = this._dpContracts.asReadonly();
  /** True once a DP fetch has COMPLETED for the current trade units, regardless of row count.
   *  Callers must gate on this rather than `dpContracts().length > 0`: a trade unit with genuinely
   *  zero DP positions is indistinguishable from "not fetched yet" by length alone, which makes a
   *  query flash "no producers found" while the fetch is still in flight. Same reason
   *  `ticketsLoaded` exists. Reset on trade-unit change. */
  readonly dpContractsLoaded = this._dpContractsLoaded.asReadonly();
  readonly savedLists = this._savedLists.asReadonly();
  readonly commodities = this._commodities.asReadonly();
  readonly commodityConversions = this._commodityConversions.asReadonly();
  /** Shared query library cache so home + customer-list can resolve a saved list's prompt
   *  category (Contracts / Tickets / etc.) by queryText match without each page fetching
   *  independently. Loaded lazily on first access — both build-list and customer-list
   *  populate this signal when they receive the API response. */
  readonly queryLibrary = this._queryLibrary.asReadonly();
  readonly harvestWindows = this._harvestWindows.asReadonly();
  readonly producerDetails = this._producerDetails.asReadonly();
  readonly pricingLines = this._pricingLines.asReadonly();

  selectCustomer(customer: Customer | null): void {
    this._selectedCustomer.set(customer);
  }

  setAllProducersMode(on: boolean): void {
    this._allProducersMode.set(on);
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  setSelectedSavedListId(id: string): void {
    this._selectedSavedListId.set(id);
  }

  // Update data cache
  setContracts(contracts: Contract[]): void {
    this._contracts.set(contracts);
  }

  setTodaysTickets(tickets: Ticket[]): void {
    this._todaysTickets.set(tickets);
  }

  setTickets(tickets: Ticket[]): void {
    this._tickets.set(tickets);
    this._ticketsTradeUnitKey.set(this.tradeUnitContext.selectedTradeUnits().join(','));
    this._ticketsLoaded.set(true);
  }

  setPlantingIntentions(plantingIntentions: PlantingIntention[]): void {
    this._plantingIntentions.set(plantingIntentions);
  }

  setNotes(notes: Note[]): void {
    this._notes.set(notes);
    this._notesLoaded.set(true);
  }

  setNoteLastContacts(rows: NoteLastContact[]): void {
    this._noteLastContacts.set(rows);
  }

  setMyReminders(rows: ReminderDue[]): void {
    this._myReminders.set(rows);
  }

  setStoredGrain(storedGrain: StoredGrain[]): void {
    this._storedGrain.set(storedGrain);
  }

  /** TU-WIDE load: replaces the set and marks DP loaded for the current trade units. Only call this
   *  from a fetch that covers the whole trade-unit scope. */
  setDpContracts(dpContracts: DpContract[]): void {
    this._dpContracts.set(dpContracts);
    this._dpContractsLoaded.set(true);
  }

  /**
   * PER-PRODUCER merge — swaps in one producer's DP rows and leaves everyone else's alone.
   *
   * Deliberately does NOT set dpContractsLoaded: one producer's rows are not a trade-unit-wide load.
   * Claiming otherwise made TU-wide consumers (Build A List) believe DP was fully loaded after a
   * single producer was opened, then filter every producer against that partial set and report
   * "no producers match".
   */
  mergeCustomerDpContracts(customerId: number, rows: DpContract[]): void {
    this._dpContracts.update(existing => [...existing.filter(d => d.customerId !== customerId), ...rows]);
  }

  setPricingLines(lines: ContractPricingLine[]): void {
    this._pricingLines.set(lines);
  }

  setSavedLists(savedLists: SavedList[]): void {
    this._savedLists.set(savedLists);
  }

  setCommodities(commodities: Commodity[]): void {
    this._commodities.set(commodities);
  }

  setProducerDetails(details: ProducerDetails[]): void {
    this._producerDetails.set(details);
  }

  setCommodityConversions(conversions: CommodityConversion[]): void {
    this._commodityConversions.set(conversions);
  }

  setHarvestWindows(windows: HarvestWindow[]): void {
    this._harvestWindows.set(windows);
  }

  setQueryLibrary(items: QueryLibraryItem[]): void {
    this._queryLibrary.set(items);
  }

  // True once the TU-wide ticket set has been loaded into `tickets` (via setTickets). List/NLQ
  // consumers (customer-list, build-list) gate their own lazy TU-wide fetch on this instead of
  // `tickets().length === 0`, because per-producer selection no longer populates `tickets` — so an
  // emptiness check would misfire. Reset on TU change / logout via clearTicketsCache().
  readonly ticketsLoaded = this._ticketsLoaded.asReadonly();

  /** Which trade-unit selection `tickets` was loaded for. Consumers that adopt the shared set into
   *  their own copy must check this: `clearTicketsCache()` and a component's own trade-unit effect
   *  are independent subscribers to `selectedTradeUnits` with no ordering guarantee between them,
   *  so there is a window where a component has already cleared its local set for the NEW trade
   *  unit while this one still holds the PREVIOUS trade unit's tickets. */
  readonly ticketsTradeUnitKey = this._ticketsTradeUnitKey.asReadonly();

  clearTicketsCache(): void {
    this._tickets.set([]);
    this._ticketsTradeUnitKey.set(null);
    this._ticketsLoaded.set(false);
  }

  /** Drops the DP set + its loaded flag. Must run on TU change: without it, dpContractsLoaded stays
   *  true from the PREVIOUS trade unit, so a DP query runs against the prior TU's rows and reports
   *  "no producers match" for producers that do hold DP. */
  clearDpContractsCache(): void {
    this._dpContracts.set([]);
    this._dpContractsLoaded.set(false);
  }

  // True once the full TU-wide note set has been loaded into `notes` (via setNotes). NLQ/
  // saved-list consumers gate their lazy fetch on this instead of `notes().length === 0`,
  // because notes are no longer eagerly bulk-loaded — an emptiness check would misfire for
  // a user whose trade units genuinely have zero notes. Reset on TU change / logout.
  readonly notesLoaded = this._notesLoaded.asReadonly();

  clearNotesCache(): void {
    this._notes.set([]);
    this._notesLoaded.set(false);
  }

  // Per-dataset loading flags — let each screen/category render as soon as ITS own data
  // arrives instead of waiting on the slowest core query. Set by DataPreloadService: all
  // true when a trade-unit load starts, each flipped false as its data streams in.
  //   - Actionable Insights: Spot Loads waits on todaysTicketsLoading; the contract-based
  //     categories (Unconfirmed Contracts, Unshipped Bushels) wait on contractsLoading.
  //   - Dashboard: waits on customers + contracts, NOT tickets (it doesn't use them).
  // The customers' own flag is CustomerStore.customersLoading, set by Customers' preload.
  readonly contractsLoading = this._contractsLoading.asReadonly();
  readonly todaysTicketsLoading = this._todaysTicketsLoading.asReadonly();

  setContractsLoading(loading: boolean): void { this._contractsLoading.set(loading); }
  setTodaysTicketsLoading(loading: boolean): void { this._todaysTicketsLoading.set(loading); }

  /**
   * Set when the trade-unit-wide CONTRACT read failed, as opposed to returning nothing.
   *
   * Build-a-List and Actionable Insights filter these signals in memory, so a failed read leaves them
   * empty and every prompt answers "no producers found" - which is what happened twice during CTRM
   * development before anyone realised the gateway had timed out. Screens must check this before showing
   * an empty state.
   */
  readonly contractsLoadFailed = this._contractsLoadFailed.asReadonly();

  /** Same, for the trade-unit-wide ticket read behind the delivery and unapplied prompts. */
  readonly ticketsLoadFailed = this._ticketsLoadFailed.asReadonly();

  /**
   * Set when a trade-unit read did not FAIL but had not finished in time - the client gave up waiting.
   *
   * Measured 2026-08-27: a cold trade-unit ticket walk is 1-2+ minutes (33,313 tickets across three
   * windows for 587 producers; 80,219 for 1,271), while the client times out at 60s. That timeout is a
   * client decision, not a CTRM failure - the server carries on and caches the result, so a retry a
   * moment later succeeds. Telling the user "could not be loaded from CTRM" in that situation is simply
   * false, and it is the message they saw during the first cold test.
   */
  readonly sourceLoadPending = this._sourceLoadPending.asReadonly();

  /** Records that a read timed out client-side rather than failing. See sourceLoadPending. */
  setSourceLoadPending(pending: boolean): void { this._sourceLoadPending.set(pending); }

  /**
   * Records the outcome of the TRADE-UNIT-WIDE contract read. Call it on success too.
   *
   * <b>Clear it from a tap BEFORE the catchError, never from setContracts.</b> Clearing inside the setter
   * looks tidier and is wrong: the failure path resolves to an empty array that flows through
   * setContracts one operator later, so the flag was set and then cleared in the same tick and the banner
   * could never appear. A tap placed ahead of catchError only ever sees a real emission.
   *
   * Scope matters as much as timing. This flag means "the trade-unit contract list is missing", which is
   * what Build-a-List and customer-list filter against. A producer-scoped read (pacing history) or another
   * screen's read (the dashboard's crop year) failing does NOT belong here - it would put an outage banner
   * on Build-a-List while its list was perfectly fine.
   */
  setContractsLoadFailed(failed: boolean): void { this._contractsLoadFailed.set(failed); }

  /** Same for the trade-unit-wide ticket reads. See setContractsLoadFailed. */
  setTicketsLoadFailed(failed: boolean): void { this._ticketsLoadFailed.set(failed); }

  /** Same, for the trade-unit-wide DP read. The [] fallback still flips dpContractsLoaded (so a DP
   *  prompt never waits forever), so without this a failure answers "no producers hold DP". */
  readonly dpContractsLoadFailed = this._dpContractsLoadFailed.asReadonly();
  setDpContractsLoadFailed(failed: boolean): void { this._dpContractsLoadFailed.set(failed); }

  /** Same, for the last-contact aggregate. Without it every producer reads "Never contacted" and the
   *  recency prompts ("not contacted in 30 days") match everyone. */
  readonly noteLastContactsLoadFailed = this._noteLastContactsLoadFailed.asReadonly();
  setNoteLastContactsLoadFailed(failed: boolean): void { this._noteLastContactsLoadFailed.set(failed); }

  /** Same, for the signed-in user's follow-ups: follow-up badges vanish and follow-up prompts match no one. */
  readonly myRemindersLoadFailed = this._myRemindersLoadFailed.asReadonly();
  setMyRemindersLoadFailed(failed: boolean): void { this._myRemindersLoadFailed.set(failed); }

  /** Same, for the user's saved lists, which otherwise read as "No saved lists yet". */
  readonly savedListsLoadFailed = this._savedListsLoadFailed.asReadonly();
  setSavedListsLoadFailed(failed: boolean): void { this._savedListsLoadFailed.set(failed); }

  /** Same, for the trade-unit planting intentions behind the dashboard and planting prompts. */
  readonly plantingIntentionsLoadFailed = this._plantingIntentionsLoadFailed.asReadonly();
  setPlantingIntentionsLoadFailed(failed: boolean): void { this._plantingIntentionsLoadFailed.set(failed); }

  /** Same, for the harvest windows behind contract pacing, which otherwise reads "No contract data available". */
  readonly harvestWindowsLoadFailed = this._harvestWindowsLoadFailed.asReadonly();
  setHarvestWindowsLoadFailed(failed: boolean): void { this._harvestWindowsLoadFailed.set(failed); }

  /** Same, for the commodity unit conversions. Without them every non-bushel contract drops out of
   *  bushel totals, and the exclusion notes blame the contract's unit. Loaded once per sign-in, so
   *  clearLoadFailures (a trade-unit change) does not reset it. */
  readonly commodityConversionsLoadFailed = this._commodityConversionsLoadFailed.asReadonly();
  setCommodityConversionsLoadFailed(failed: boolean): void { this._commodityConversionsLoadFailed.set(failed); }

  /** A new trade-unit load is starting: the previous load's failures no longer describe anything. */
  clearLoadFailures(): void {
    this._contractsLoadFailed.set(false);
    this._ticketsLoadFailed.set(false);
    this._dpContractsLoadFailed.set(false);
    this._noteLastContactsLoadFailed.set(false);
    this._myRemindersLoadFailed.set(false);
    this._savedListsLoadFailed.set(false);
    this._plantingIntentionsLoadFailed.set(false);
    this._harvestWindowsLoadFailed.set(false);
  }

  clearSelection(): void {
    this._selectedCustomer.set(null);
  }

  /** Clears everything held for the signed-in user (sign-out, idle timeout): this service's state, the trade-unit
   *  selection, and every module store registered with SessionReset. */
  clearAll(): void {
    this.tradeUnitContext.clear();
    this._selectedCustomer.set(null);
    this._searchQuery.set('');
    this._selectedSavedListId.set('');
    this._contracts.set([]);
    this.clearTicketsCache();
    this._plantingIntentions.set([]);
    this.clearNotesCache();
    this._noteLastContacts.set([]);
    this._myReminders.set([]);
    this._storedGrain.set([]);
    this._dpContracts.set([]);
    this._dpContractsLoaded.set(false);
    this._savedLists.set([]);
    this._commodities.set([]);
    this._producerDetails.set([]);
    this._contractsLoading.set(false);
    this._todaysTicketsLoading.set(false);
    this._todaysTickets.set([]);
    this.sessionReset.reset();
  }
}
