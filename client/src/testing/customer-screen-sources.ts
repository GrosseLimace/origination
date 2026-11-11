import { Provider, signal } from '@angular/core';
import { Customer } from '@models';
import { CUSTOMER_SCREEN_SOURCE, CustomerScreenLink, SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { provideSelectedProducerActivity, selectedProducerActivityFake } from './selected-producer-activity.fake';
import { provideSelectedProducerEngagement, selectedProducerEngagementFake } from './selected-producer-engagement.fake';
import { provideSelectedProducerProduction, selectedProducerProductionFake } from './selected-producer-production.fake';
import { provideProducerProfiles, producerProfilesFake } from './producer-profiles.fake';

/**
 * What a panel on the customer screen reads, for specs: the selected customer, the producers linked to them, the
 * producer's activity, engagement and production, and every producer's saved details, each as writable signals, with
 * the providers that put them in front of the panel. No customer is selected to start with.
 */
export function customerScreenSources() {
  const customer = signal<Customer | null>(null);
  const linkedCustomers = signal<Customer[]>([]);
  const activity = selectedProducerActivityFake();
  const engagement = selectedProducerEngagementFake();
  const production = selectedProducerProductionFake();
  const profiles = producerProfilesFake();
  const providers: Provider[] = [
    { provide: CUSTOMER_SCREEN_SOURCE, useValue: { customer, linkedCustomers, link: signal<CustomerScreenLink>({}) } },
    SelectedCustomerContext,
    provideSelectedProducerActivity(activity),
    provideSelectedProducerEngagement(engagement),
    provideSelectedProducerProduction(production),
    provideProducerProfiles(profiles),
  ];
  return { customer, linkedCustomers, activity, engagement, production, profiles, providers };
}

export type CustomerScreenSources = ReturnType<typeof customerScreenSources>;
