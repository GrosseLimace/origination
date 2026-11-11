import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { Customer } from '@models';

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

  // The trade unit's customers the page loads (their contracts and tickets are the Contracts module's; their
  // planting, stored grain and DP the Producers module's).
  readonly customers = signal<Customer[]>([]);

  // Where a deep link (from Insights, the dashboard or a shared URL) asked the producer's profile to open. Set from
  // the URL's query parameters, cleared when the user picks a producer themselves.
  readonly pendingContractId = signal<number | null>(null);
  readonly pendingTab = signal<string | null>(null);
  readonly pendingTicketCrop = signal<string | null>(null);
  readonly pendingPlantingYear = signal<number | null>(null);

  /** Emits whenever the user picks a new customer. Every async call kicked off by
   *  handleSelectCustomer is piped through takeUntil(this) so the prior selection's
   *  in-flight HTTP requests are cancelled the moment a new producer is clicked —
   *  stops stale linked-producer / notes / planting calls from clogging the browser's
   *  connection pool while the newly-selected customer waits for free sockets. */
  readonly cancelSelection$ = new Subject<void>();
}

