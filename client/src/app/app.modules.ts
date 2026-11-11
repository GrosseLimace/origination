import { Provider } from '@angular/core';
import { CustomerSearch } from '@core/context/customer-search';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { SelectedProducerProduction } from '@core/context/selected-producer-production';
import { ModuleManifest } from '@core/modules/module-manifest';
import { CustomerActivityStore } from './features/contracts/data-access/customer-activity.store';
import { CustomersApiService } from './features/customers/data-access/customers-api.service';
import { ProducerProfileStore } from './features/producers/data-access/producer-profile.store';
import { ProducerProductionStore } from './features/producers/data-access/producer-production.store';
import { bidSheetModule } from './features/bid-sheet/bid-sheet.module';
import { calculatorsModule } from './features/calculators/calculators.module';
import { contractsModule } from './features/contracts/contracts.module';
import { customersModule } from './features/customers/customers.module';
import { engagementModule } from './features/engagement/engagement.module';
import { helpModule } from './features/help/help.module';
import { listsModule } from './features/lists/lists.module';
import { producersModule } from './features/producers/producers.module';
import { usageAnalyticsModule } from './features/usage-analytics/usage-analytics.module';
import { whatsNewModule } from './features/whats-new/whats-new.module';

/**
 * Every module of the app. The only file that lists them all; main.ts provides it to ModuleRegistry as APP_MODULES.
 * Each manifest comes from its own file rather than the module's index.ts: an index also exports components, which
 * the build cannot drop, so importing a manifest through one would put that module's screens in the initial bundle.
 */
export const appModules: readonly ModuleManifest[] = [
  customersModule,
  contractsModule,
  engagementModule,
  producersModule,
  listsModule,
  bidSheetModule,
  usageAnalyticsModule,
  calculatorsModule,
  helpModule,
  whatsNewModule,
];

/**
 * What core declares and a module implements, for the whole app. main.ts provides these with APP_MODULES.
 */
export const appModuleProviders: Provider[] = [
  // Every producer's details, which Customers' home page and customer list read without importing Producers.
  { provide: ProducerProfiles, useExisting: ProducerProfileStore },
  // Searching customers, which Help's troubleshooter runs without importing Customers.
  { provide: CustomerSearch, useExisting: CustomersApiService },
  // The selected producer's contracts, tickets and pricing lines, which the customer screen reads and the home page
  // tells who is selected.
  { provide: SelectedProducerActivity, useExisting: CustomerActivityStore },
  // The selected producer's planting intentions, stored grain, DP contracts and crop year, which the customer screen's
  // production tabs and panels read and the home page tells who is selected.
  { provide: SelectedProducerProduction, useExisting: ProducerProductionStore },
];
