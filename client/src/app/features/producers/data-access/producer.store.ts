import { Injectable, inject, signal } from '@angular/core';
import { DpContract, PlantingIntention, StoredGrain } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';

/**
 * The selected trade units' planting intentions, stored grain and DP contracts, kept for the session so every screen
 * shares one load: Build a List, the saved lists, the Planting Dashboard and the customer screen. Producers' preload
 * loads them on each trade-unit change; the selected producer's own reads and edits (ProducerProductionStore) merge
 * into them.
 */
@Injectable({ providedIn: 'root' })
export class ProducerStore {
  private readonly _plantingIntentions = signal<PlantingIntention[]>([]);
  private readonly _storedGrain = signal<StoredGrain[]>([]);
  private readonly _dpContracts = signal<DpContract[]>([]);
  private readonly _dpContractsLoaded = signal(false);
  private readonly _plantingIntentionsLoadFailed = signal(false);
  private readonly _dpContractsLoadFailed = signal(false);

  readonly plantingIntentions = this._plantingIntentions.asReadonly();
  readonly storedGrain = this._storedGrain.asReadonly();
  readonly dpContracts = this._dpContracts.asReadonly();

  /** True once a DP read has COMPLETED for the current trade units, regardless of row count. Check this rather than
   *  `dpContracts().length > 0`: a trade unit with no DP at all reads the same as "not read yet" by length, and a
   *  query would flash "no producers found" while the read is still running. Reset on a trade-unit change. */
  readonly dpContractsLoaded = this._dpContractsLoaded.asReadonly();

  /** Set when the trade-unit planting read failed, as opposed to returning nothing: the dashboard and the planting
   *  prompts would otherwise read an outage as "no intentions". */
  readonly plantingIntentionsLoadFailed = this._plantingIntentionsLoadFailed.asReadonly();
  /** Same, for the trade-unit DP read. The [] fallback still marks DP loaded (so a DP prompt never waits forever), so
   *  without this a failure answers "no producers hold DP". */
  readonly dpContractsLoadFailed = this._dpContractsLoadFailed.asReadonly();

  constructor() {
    inject(SessionReset).onReset(() => {
      this._plantingIntentions.set([]);
      this._storedGrain.set([]);
      this.clearDpContractsCache();
      this.clearLoadFailures();
    });
  }

  setPlantingIntentions(intentions: PlantingIntention[]): void {
    this._plantingIntentions.set(intentions);
  }

  setStoredGrain(storedGrain: StoredGrain[]): void {
    this._storedGrain.set(storedGrain);
  }

  /** The trade units' DP contracts, read for the selection now. */
  setDpContracts(dpContracts: DpContract[]): void {
    this._dpContracts.set(dpContracts);
    this._dpContractsLoaded.set(true);
  }

  /**
   * PER-PRODUCER merge: swaps in one producer's DP rows and leaves everyone else's alone. Deliberately does NOT mark DP
   * loaded: one producer's rows are not a trade-unit-wide read, and Build a List would filter every producer against
   * that partial set and report "no producers match".
   */
  mergeCustomerDpContracts(customerId: number, rows: DpContract[]): void {
    this._dpContracts.update(existing => [...existing.filter(d => d.customerId !== customerId), ...rows]);
  }

  /** Drops the DP set and its loaded flag. Runs on a trade-unit change: otherwise the flag stays true from the previous
   *  trade units, and a DP query runs against their rows. */
  clearDpContractsCache(): void {
    this._dpContracts.set([]);
    this._dpContractsLoaded.set(false);
  }

  setPlantingIntentionsLoadFailed(failed: boolean): void { this._plantingIntentionsLoadFailed.set(failed); }
  setDpContractsLoadFailed(failed: boolean): void { this._dpContractsLoadFailed.set(failed); }

  /** A new trade-unit load is starting: the previous load's failures no longer describe anything. */
  clearLoadFailures(): void {
    this._plantingIntentionsLoadFailed.set(false);
    this._dpContractsLoadFailed.set(false);
  }
}
