import { computed, inject } from '@angular/core';
import type { CustomerScreenSource } from '@core/context/selected-customer-context.service';
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
  return {
    customer: page.selectedCustomer,
    // As HomeComponent.getLinkedGroup: among the roster and the producers fetched from other trade units.
    linkedCustomers: computed(() => {
      const customer = page.selectedCustomer();
      return customer ? linkedGroupOf(customer, [...page.customers(), ...linked.crossTradeUnitCustomersById().values()]) : [];
    }),
    link: computed(() => ({
      tab: page.pendingTab(),
      contractId: page.pendingContractId(),
      ticketCrop: page.pendingTicketCrop(),
      plantingYear: page.pendingPlantingYear(),
    })),
  };
}
