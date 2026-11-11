import { Injectable, inject, signal } from '@angular/core';
import { Customer, PlantingIntention, Note, NoteLastContact, ReminderDue, StoredGrain, DpContract, Commodity, CommodityConversion, HarvestWindow } from '@models';
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
  private readonly _plantingIntentions = signal<PlantingIntention[]>([]);
  private readonly _notes = signal<Note[]>([]);
  private readonly _noteLastContacts = signal<NoteLastContact[]>([]);
  private readonly _myReminders = signal<ReminderDue[]>([]);
  private readonly _storedGrain = signal<StoredGrain[]>([]);
  private readonly _dpContracts = signal<DpContract[]>([]);
  private readonly _dpContractsLoaded = signal(false);
  private readonly _commodities = signal<Commodity[]>([]);
  private readonly _commodityConversions = signal<CommodityConversion[]>([]);
  private readonly _harvestWindows = signal<HarvestWindow[]>([]);
  private readonly _notesLoaded = signal(false);
  private readonly _dpContractsLoadFailed = signal(false);
  private readonly _noteLastContactsLoadFailed = signal(false);
  private readonly _myRemindersLoadFailed = signal(false);
  private readonly _plantingIntentionsLoadFailed = signal(false);
  private readonly _harvestWindowsLoadFailed = signal(false);
  private readonly _commodityConversionsLoadFailed = signal(false);

  // The trade-unit selection lives in TradeUnitContext, which clearAll clears with the rest.
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

  // Data cache - persists across navigation
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
  readonly commodities = this._commodities.asReadonly();
  readonly commodityConversions = this._commodityConversions.asReadonly();
  readonly harvestWindows = this._harvestWindows.asReadonly();

  selectCustomer(customer: Customer | null): void {
    this._selectedCustomer.set(customer);
  }

  setAllProducersMode(on: boolean): void {
    this._allProducersMode.set(on);
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  // Update data cache
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

  setCommodities(commodities: Commodity[]): void {
    this._commodities.set(commodities);
  }

  setCommodityConversions(conversions: CommodityConversion[]): void {
    this._commodityConversions.set(conversions);
  }

  setHarvestWindows(windows: HarvestWindow[]): void {
    this._harvestWindows.set(windows);
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
    this._dpContractsLoadFailed.set(false);
    this._noteLastContactsLoadFailed.set(false);
    this._myRemindersLoadFailed.set(false);
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
    this._plantingIntentions.set([]);
    this.clearNotesCache();
    this._noteLastContacts.set([]);
    this._myReminders.set([]);
    this._storedGrain.set([]);
    this._dpContracts.set([]);
    this._dpContractsLoaded.set(false);
    this._commodities.set([]);
    this.sessionReset.reset();
  }
}
