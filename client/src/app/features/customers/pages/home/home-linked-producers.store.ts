import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import type { Customer } from '@models';
import { applyProducerDetails } from '@shared/utils/apply-producer-details';
import { HomePageState } from './home-page.state';

/**
 * Linked producers outside the selected trade units: the cache of producers fetched to complete a
 * selected producer's linked group, and the walk that fills it. Provided by HomeComponent, which
 * exposes the cache and computes the group itself (getLinkedGroup) over the roster plus this cache.
 */
@Injectable()
export class HomeLinkedProducersStore {
  private readonly apiService = inject(ApiService);
  private readonly page = inject(HomePageState);
  private readonly destroyRef = inject(DestroyRef);

  /** Customers whose linked-producer BFS has already completed in this session.
   *  Re-clicking a producer that's in this set skips the entire BFS — the cache
   *  is already correct, so there's nothing new to fetch. */
  private readonly _linkedFetchDone = new Set<number>();

  /** Customers fetched from outside the current trade unit filter (e.g. linked producers in other TUs). */
  readonly crossTradeUnitCustomersById = signal<Map<number, Customer>>(new Map());
  /** Flat array of cross-TU/linked producers fetched for the selected customer. Exposed so the
   *  customer list can resolve last-contacted dates through incoming linked producers when no TU
   *  is selected and the main customer roster is empty. */
  readonly crossTradeUnitCustomers = computed<Customer[]>(() => [...this.crossTradeUnitCustomersById().values()]);

  /** Forgets which producers have been walked, so the next visit re-walks the graph (after a trade-unit
   *  change, or after linked-producer membership was edited). The cached producers stay. */
  forgetWalks(): void {
    this._linkedFetchDone.clear();
  }

  /** Applies ProducerDetails enrichment onto a freshly-fetched Customer. */
  private _enrichCustomer(fetched: Customer): Customer {
    const pd = this.page.producerDetailsMap().get(fetched.id);
    return pd ? applyProducerDetails(fetched, pd) : fetched;
  }

  /**
   * Fetches every producer transitively linked to `customer` (forward + reverse) and
   * populates `crossTradeUnitCustomersById` with the full group so `getLinkedGroup()` can
   * surface the whole chain — e.g. if A→B and A→C, viewing B still shows C via A.
   *
   * BFS walks the graph one hop at a time; each newly discovered customer's own links
   * are fetched recursively. `visited` guards against cycles. `MAX_GROUP_SIZE` is a
   * safety cap in case a customer is part of an unexpectedly large link web. `onWalked` runs each
   * time a level of the walk lands (the page uses it to top up the notes cache for the new members).
   */
  fetchMissingLinkedProducers(customer: Customer, onWalked: () => void, visited: Set<number> = new Set()): void {
    const MAX_GROUP_SIZE = 25;
    if (visited.has(customer.id) || visited.size >= MAX_GROUP_SIZE) return;
    // Already fetched this producer's linked group earlier in the session — the
    // cache is correct, so skip the network round-trip entirely. This is what
    // makes re-clicking a producer (or hopping back and forth in a saved list)
    // instant after the first visit.
    if (this._linkedFetchDone.has(customer.id)) return;
    visited.add(customer.id);

    const linkedIds = customer.linkedProducerIds || [];
    const allCustomers = [...this.page.customers(), ...this.crossTradeUnitCustomersById().values()];
    const missing = linkedIds.filter(sourceId =>
      !allCustomers.some(c => c.scoularId === sourceId)
    );

    // Outgoing: fetch each linked producer id this customer points to.
    const outgoingRequests = missing.map(sourceId =>
      this.apiService.getCustomerBySourceId(sourceId).pipe(catchError(() => of(null as Customer | null)))
    );

    // Incoming: fetch customers that link TO this one (reverse links). Needed so non-
    // loaded producers who reverse-link to this customer still appear in the dropdown.
    const incoming$ = customer.scoularId
      ? this.apiService.getCustomersLinkedTo(customer.scoularId)
      : of([] as Customer[]);

    // Nothing to fetch — skip network entirely.
    if (outgoingRequests.length === 0 && !customer.scoularId) return;

    forkJoin({
      outgoing: outgoingRequests.length > 0 ? forkJoin(outgoingRequests) : of([] as (Customer | null)[]),
      incoming: incoming$
    }).pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe(({ outgoing, incoming }) => {
      // BFS finished for this customer — mark done so re-selecting skips the network.
      this._linkedFetchDone.add(customer.id);
      // Merge new fetches into the cache. Use .update() so concurrent BFS branches
      // from different customers don't clobber each other's additions.
      this.crossTradeUnitCustomersById.update(current => {
        const next = new Map(current);
        for (const fetched of outgoing) {
          if (!fetched) continue;
          if (!next.has(fetched.id)) next.set(fetched.id, this._enrichCustomer(fetched));
        }
        for (const fetched of incoming) {
          if (!fetched || fetched.id === customer.id) continue;
          if (!next.has(fetched.id)) next.set(fetched.id, this._enrichCustomer(fetched));
        }
        return next;
      });

      const discovered = [...outgoing, ...incoming]
        .filter((c): c is Customer => !!c && !visited.has(c.id));

      // Recurse into each newly-discovered customer so their own links (both
      // directions) get fetched too — completes the transitive closure.
      for (const next of discovered) {
        this.fetchMissingLinkedProducers(next, onWalked, visited);
      }

      // The selected producer's linked group may have just expanded — the page tops up the
      // per-customer notes cache for any newly-known members (the per-customer
      // endpoint has no TU filter, so linked producers in unselected trade units
      // are fully covered) and recompute the panel. Cache hits skip the network,
      // so BFS levels with no new members cost nothing.
      onWalked();
    });
  }
}
