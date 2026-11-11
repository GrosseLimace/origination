import { Injectable, inject, signal } from '@angular/core';
import { Customer, Commodity, CommodityConversion, HarvestWindow } from '@models';
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
  private readonly _commodities = signal<Commodity[]>([]);
  private readonly _commodityConversions = signal<CommodityConversion[]>([]);
  private readonly _harvestWindows = signal<HarvestWindow[]>([]);
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

  // Reference data - persists across navigation
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

  setCommodities(commodities: Commodity[]): void {
    this._commodities.set(commodities);
  }

  setCommodityConversions(conversions: CommodityConversion[]): void {
    this._commodityConversions.set(conversions);
  }

  setHarvestWindows(windows: HarvestWindow[]): void {
    this._harvestWindows.set(windows);
  }

  /** Set when the harvest windows' read failed, as opposed to returning nothing: contract pacing would otherwise read
   *  "No contract data available". */
  readonly harvestWindowsLoadFailed = this._harvestWindowsLoadFailed.asReadonly();
  setHarvestWindowsLoadFailed(failed: boolean): void { this._harvestWindowsLoadFailed.set(failed); }

  /** Same, for the commodity unit conversions. Without them every non-bushel contract drops out of
   *  bushel totals, and the exclusion notes blame the contract's unit. Loaded once per sign-in, so
   *  clearLoadFailures (a trade-unit change) does not reset it. */
  readonly commodityConversionsLoadFailed = this._commodityConversionsLoadFailed.asReadonly();
  setCommodityConversionsLoadFailed(failed: boolean): void { this._commodityConversionsLoadFailed.set(failed); }

  /** A new trade-unit load is starting: the previous load's failures no longer describe anything. */
  clearLoadFailures(): void {
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
    this._commodities.set([]);
    this.sessionReset.reset();
  }
}
