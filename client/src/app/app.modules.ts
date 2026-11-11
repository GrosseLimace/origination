import { Provider } from '@angular/core';
import { CustomerSearch } from '@core/context/customer-search';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { ModuleManifest } from '@core/modules/module-manifest';
import { CustomersApiService } from './features/customers/data-access/customers-api.service';
import { ProducerProfileStore } from './features/producers/data-access/producer-profile.store';
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
];
