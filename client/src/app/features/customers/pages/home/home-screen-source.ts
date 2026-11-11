import { computed, inject } from '@angular/core';
import type { CustomerScreenSource } from '@core/context/selected-customer-context.service';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { profileLinkedIds } from '@shared/utils/producer-profile';
import { linkedGroupOf } from './home-derivations';
import { HomeLinkedProducersStore } from './home-linked-producers.store';
import { HomePageState } from './home-page.state';

/**
 * The page's selected producer, their linked producers and the deep link, as the customer screen's pieces read them
 * through SelectedCustomerContext. Provided by HomeComponent as CUSTOMER_SCREEN_SOURCE.
 */
export function homeScreenSource(): CustomerScreenSource {
  const page = inject(HomePageState);
  const linked = inject(HomeLinkedProducersStore);
  const profiles = inject(ProducerProfiles);
  return {
    customer: page.selectedCustomer,
    // As HomeComponent.getLinkedGroup: among the roster and the producers fetched from other trade units, by the links in
    // their saved details.
    linkedCustomers: computed(() => {
      const customer = page.selectedCustomer();
      return customer
        ? linkedGroupOf(customer, [...page.customers(), ...linked.crossTradeUnitCustomersById().values()], c => profileLinkedIds(profiles.profileOf(c.id)))
        : [];
    }),
    link: computed(() => ({
      tab: page.pendingTab(),
      contractId: page.pendingContractId(),
      ticketCrop: page.pendingTicketCrop(),
      plantingYear: page.pendingPlantingYear(),
    })),
  };
}
