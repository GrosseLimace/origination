import { computed, inject } from '@angular/core';
import type { CustomerScreenSource } from '@core/context/selected-customer-context.service';
import { LinkedProducersStore } from '../../data-access/linked-producers.store';
import { HomePageState } from './home-page.state';

/**
 * The page's selected producer, their linked producers and the deep link, as the customer screen's pieces read them
 * through SelectedCustomerContext. Provided by HomeComponent as CUSTOMER_SCREEN_SOURCE.
 */
export function homeScreenSource(): CustomerScreenSource {
  const page = inject(HomePageState);
  const linked = inject(LinkedProducersStore);
  return {
    customer: page.selectedCustomer,
    // As HomeComponent.getLinkedGroup: among the trade units' customers and the producers fetched from other trade
    // units, by the links in their saved details.
    linkedCustomers: computed(() => {
      const customer = page.selectedCustomer();
      return customer ? linked.groupOf(customer) : [];
    }),
    link: computed(() => ({
      tab: page.pendingTab(),
      contractId: page.pendingContractId(),
      ticketCrop: page.pendingTicketCrop(),
      plantingYear: page.pendingPlantingYear(),
    })),
  };
}
