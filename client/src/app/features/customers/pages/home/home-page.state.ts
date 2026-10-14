import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { Contract, Customer, DpContract, PlantingIntention, ProducerDetails, StoredGrain, Ticket } from '@models';

/**
 * The producer page's shared state: the signals more than one part of the page reads or writes.
 * HomeComponent provides it, exposes these same signal instances under their old names (so the
 * template and callers are unchanged), and the page-scoped stores it delegates to inject it rather
 * than being handed the component.
 */
@Injectable()
export class HomePageState {
  /** The producer whose profile is open. */
  readonly selectedCustomer = signal<Customer | null>(null);

  /** The page's copy of the global trade-unit selection, updated when the page reacts to a change. */
  readonly selectedTradeUnits = signal<string[]>([]);

  // The trade unit's pools, which the page loads and saved lists resolve against. contracts,
  // storedGrain and dpContracts also take per-producer reads merged in; tickets holds per-producer
  // reads only (they are not bulk-loaded).
  readonly customers = signal<Customer[]>([]);
  readonly contracts = signal<Contract[]>([]);
  readonly tickets = signal<Ticket[]>([]);
  readonly plantingIntentions = signal<PlantingIntention[]>([]);
  readonly storedGrain = signal<StoredGrain[]>([]);
  readonly dpContracts = signal<DpContract[]>([]);

  /** Producer-entered details (acres, contacts, links, grain on farm) by customer id. */
  readonly producerDetailsMap = signal<Map<number, ProducerDetails>>(new Map());

  /** Emits whenever the user picks a new customer. Every async call kicked off by
   *  handleSelectCustomer is piped through takeUntil(this) so the prior selection's
   *  in-flight HTTP requests are cancelled the moment a new producer is clicked —
   *  stops stale linked-producer / notes / planting calls from clogging the browser's
   *  connection pool while the newly-selected customer waits for free sockets. */
  readonly cancelSelection$ = new Subject<void>();
}
