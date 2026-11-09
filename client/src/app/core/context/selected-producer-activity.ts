import { Signal } from '@angular/core';
import { Contract, ContractPricingLine, Ticket } from '@models';

/**
 * The selected producer's contracts, tickets and pricing lines, as the customer screen's pieces read them: the
 * contracts and tickets tabs, and whatever else on the screen shows the producer's activity. Declared in core so
 * those pieces can read it without importing the module that loads it; the page that hosts the customer screen
 * provides the implementation (the home page's HomeProducerActivityStore).
 */
export abstract class SelectedProducerActivity {
  /** The producer's contracts. */
  abstract readonly contracts: Signal<Contract[]>;
  /** The producer's tickets, applied and unapplied, including split loads applied to their contracts. */
  abstract readonly tickets: Signal<Ticket[]>;
  /** The pricing lines of the producer's contracts. */
  abstract readonly pricingLines: Signal<ContractPricingLine[]>;

  /** True while the producer's contract read is in flight. */
  abstract readonly isLoadingContracts: Signal<boolean>;
  /** True while the producer's ticket read is in flight. */
  abstract readonly isLoadingTickets: Signal<boolean>;
  /** True while the producer's pricing-line read is in flight. */
  abstract readonly isLoadingPricingLines: Signal<boolean>;

  /** The message when the producer's contract read failed, as opposed to returning nothing; null otherwise. */
  abstract readonly contractsLoadError: Signal<string | null>;
  /** The same for the ticket read. */
  abstract readonly ticketsLoadError: Signal<string | null>;
  /** The same for the pricing-line read: the contracts can be fine while their prices are missing. */
  abstract readonly pricingLinesLoadError: Signal<string | null>;

  /** Reads the producer's contracts again, after a failure. */
  abstract retryContracts(): void;
  /** Reads the producer's tickets again, after a failure. */
  abstract retryTickets(): void;
}
