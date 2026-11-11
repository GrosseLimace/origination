import { Injectable, inject, signal } from '@angular/core';
import { Customer, Note, NoteLastContact, ReminderDue, Commodity, CommodityConversion, HarvestWindow } from '@models';
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
  private readonly _notes = signal<Note[]>([]);
  private readonly _noteLastContacts = signal<NoteLastContact[]>([]);
  private readonly _myReminders = signal<ReminderDue[]>([]);
  private readonly _commodities = signal<Commodity[]>([]);
  private readonly _commodityConversions = signal<CommodityConversion[]>([]);
  private readonly _harvestWindows = signal<HarvestWindow[]>([]);
  private readonly _notesLoaded = signal(false);
  private readonly _noteLastContactsLoadFailed = signal(false);
  private readonly _myRemindersLoadFailed = signal(false);
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

  setCommodities(commodities: Commodity[]): void {
    this._commodities.set(commodities);
  }

  setCommodityConversions(conversions: CommodityConversion[]): void {
    this._commodityConversions.set(conversions);
  }

  setHarvestWindows(windows: HarvestWindow[]): void {
    this._harvestWindows.set(windows);
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

  /** Set when the last-contact aggregate's read failed, as opposed to returning nothing. Without it every producer
   *  reads "Never contacted" and the recency prompts ("not contacted in 30 days") match everyone. */
  readonly noteLastContactsLoadFailed = this._noteLastContactsLoadFailed.asReadonly();
  setNoteLastContactsLoadFailed(failed: boolean): void { this._noteLastContactsLoadFailed.set(failed); }

  /** Same, for the signed-in user's follow-ups: follow-up badges vanish and follow-up prompts match no one. */
  readonly myRemindersLoadFailed = this._myRemindersLoadFailed.asReadonly();
  setMyRemindersLoadFailed(failed: boolean): void { this._myRemindersLoadFailed.set(failed); }

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
    this._noteLastContactsLoadFailed.set(false);
    this._myRemindersLoadFailed.set(false);
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
    this.clearNotesCache();
    this._noteLastContacts.set([]);
    this._myReminders.set([]);
    this._commodities.set([]);
    this.sessionReset.reset();
  }
}
