import { Signal } from '@angular/core';
import { Contract } from '@models';

/**
 * The selected trade units' contracts, which the Contracts module's ContractStore holds. Declared in core for the home
 * page, which reads the crop years they cover to know which years' yield estimates to read, until the yield estimates
 * move to the Producers module (Phase 4, step 10d); nothing else should need it.
 */
export abstract class TradeUnitContracts {
  /** The trade units' contracts, as the last trade-unit read and the producers read since left them. */
  abstract readonly contracts: Signal<Contract[]>;
}
