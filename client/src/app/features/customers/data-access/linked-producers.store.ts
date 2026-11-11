import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import type { Customer } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { linkedGroupOf } from '@shared/utils/linked-producers';
import { profileLinkedIds } from '@shared/utils/producer-profile';
import { CustomerStore } from './customer.store';
import { CustomersApiService } from './customers-api.service';

/**
 * Producers linked to the trade units' customers from outside them: those fetched to complete a selected producer's
 * linked group, by a walk of the links both ways. With the trade units' customers (CustomerStore) and the links in every
 * producer's saved details (ProducerProfiles), they make up each producer's linked group, which the home page shows and
 * Engagement reads the notes and last-contacted dates of. Kept for the session; dropped on a trade-unit change.
 */
@Injectable({ providedIn: 'root' })
export class LinkedProducersStore {
  private readonly customersApi = inject(CustomersApiService);
  private readonly customerStore = inject(CustomerStore);
  private readonly producerProfiles = inject(ProducerProfiles);

  /** Producers whose walk has finished since the trade units changed or a link was edited: walking them again would
   *  fetch nothing new. */
  private readonly walked = new Set<number>();
  private readonly _byId = signal<ReadonlyMap<number, Customer>>(new Map());

  /** The producers fetched from outside the trade units, by id. */
  readonly crossTradeUnitCustomersById = this._byId.asReadonly();
  /** The same, as a list. */
  readonly crossTradeUnitCustomers = computed<Customer[]>(() => [...this._byId().values()]);

  constructor() {
    inject(SessionReset).onReset(() => this.clear());
  }

  /** Keeps a producer from outside the trade units: one the user opened, or one a link points to. */
  put(customer: Customer): void {
    this._byId.update(held => new Map(held).set(customer.id, customer));
  }

  /** Replaces a producer already held, after an edit; one not held stays out. */
  refresh(customer: Customer): void {
    if (this._byId().has(customer.id)) this.put(customer);
  }

  /** A new selection of trade units: the producers held and the walks done were for the last one. */
  clear(): void {
    this._byId.set(new Map());
    this.walked.clear();
  }

  /** Forgets which producers have been walked, so the next selection walks again (after a link was edited). The
   *  producers held stay. */
  forgetWalks(): void {
    this.walked.clear();
  }

  /**
   * Every producer transitively linked to `customer`, forward and reverse, among the trade units' customers and those
   * held here, by the links in their saved details (see linkedGroupOf). One not fetched yet is left out until it is.
   * Read in a computed or a template, it follows all three.
   */
  groupOf(customer: Customer): Customer[] {
    return linkedGroupOf(customer, [...this.customerStore.customers(), ...this._byId().values()],
      c => profileLinkedIds(this.producerProfiles.profileOf(c.id)));
  }

  /**
   * Fetches every producer transitively linked to `customer` that isn't loaded yet, so their whole group shows: the
   * producers their saved details link to and those that link to them, then the same for each of those. Each producer
   * is walked once until the trade units change or a link is edited; `visited` stops cycles, and a group stops growing
   * at 25. `cancel$` stops the walk: the page's next selection.
   */
  fetchMissingLinkedProducers(customer: Customer, cancel$: Observable<unknown>, visited: Set<number> = new Set()): void {
    const MAX_GROUP_SIZE = 25;
    if (visited.has(customer.id) || visited.size >= MAX_GROUP_SIZE) return;
    if (this.walked.has(customer.id)) return;
    visited.add(customer.id);

    const linkedIds = profileLinkedIds(this.producerProfiles.profileOf(customer.id));
    const known = [...this.customerStore.customers(), ...this._byId().values()];
    const missing = linkedIds.filter(sourceId => !known.some(c => c.scoularId === sourceId));

    // Outgoing: each producer this one links to that isn't loaded.
    const outgoing = missing.map(sourceId =>
      this.customersApi.getCustomerBySourceId(sourceId).pipe(catchError(() => of(null as Customer | null))));
    // Incoming: the producers that link to this one, which only they know of.
    const incoming$ = customer.scoularId ? this.customersApi.getCustomersLinkedTo(customer.scoularId) : of([] as Customer[]);
    if (outgoing.length === 0 && !customer.scoularId) return;

    forkJoin({
      outgoing: outgoing.length > 0 ? forkJoin(outgoing) : of([] as (Customer | null)[]),
      incoming: incoming$,
    }).pipe(takeUntil(cancel$)).subscribe(({ outgoing: found, incoming }) => {
      this.walked.add(customer.id);
      // update(), so walks from different producers running at once keep each other's finds.
      this._byId.update(held => {
        const next = new Map(held);
        for (const fetched of found) if (fetched && !next.has(fetched.id)) next.set(fetched.id, fetched);
        for (const fetched of incoming) if (fetched && fetched.id !== customer.id && !next.has(fetched.id)) next.set(fetched.id, fetched);
        return next;
      });
      // Their own links, both ways, complete the group.
      for (const next of [...found, ...incoming]) {
        if (next && !visited.has(next.id)) this.fetchMissingLinkedProducers(next, cancel$, visited);
      }
    });
  }
}
