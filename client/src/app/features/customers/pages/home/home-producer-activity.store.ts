import { Injectable, inject, signal } from '@angular/core';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { profileLinkedIds } from '@shared/utils/producer-profile';
import type { Customer } from '@models';
import { linkedGroupOf } from './home-derivations';
import { HomeLinkedProducersStore } from './home-linked-producers.store';
import { HomeNotesStore } from './home-notes.store';
import { HomePageState } from './home-page.state';

/**
 * What the producer page still derives for the selected producer itself: the notes of their linked group, and the
 * group's customer codes. Their contracts, tickets and pricing lines are the Contracts module's
 * (SelectedProducerActivity); their planting, stored grain and DP the Producers module's (SelectedProducerProduction).
 * Provided by HomeComponent, which exposes these signals under the same names. Phase 4 moves the rest to Engagement
 * (step 10e).
 */
@Injectable()
export class HomeProducerActivityStore {
  private readonly page = inject(HomePageState);
  /** Every producer's details, kept by the Producers module. */
  private readonly producerProfiles = inject(ProducerProfiles);
  private readonly notes = inject(HomeNotesStore);
  private readonly linked = inject(HomeLinkedProducersStore);

  readonly customerCodeMap = signal<Map<number, string>>(new Map());

  /**
   * Every producer transitively linked to `customer`, forward and reverse, among the roster and the cross-trade-unit
   * cache (see HomeComponent.getLinkedGroup).
   */
  private linkedGroup(customer: Customer): Customer[] {
    return linkedGroupOf(customer, [...this.page.customers(), ...this.linked.crossTradeUnitCustomersById().values()],
      c => profileLinkedIds(this.producerProfiles.profileOf(c.id)));
  }

  /** Re-derives the selected producer's linked group's customer codes and notes as they stand. */
  loadCustomerData(customerId: number, customer?: Customer): void {
    const currentCustomer = customer || this.page.selectedCustomer();
    if (!currentCustomer) return;

    const linkedGroup = this.linkedGroup(currentCustomer);
    const linkedIds = new Set([customerId, ...linkedGroup.map(c => c.id)]);
    const codeMap = new Map<number, string>();
    [currentCustomer, ...linkedGroup].forEach(c => { if (c?.scoularId) codeMap.set(c.id, c.scoularId); });
    this.customerCodeMap.set(codeMap);
    // Pure recompute from the per-customer notes cache (hydrated by _ensureCustomerNotes) —
    // safe to call from every data-arrival callback.
    this.notes.showNotesFor(linkedIds);
  }
}
