import { ModuleManifest } from '@core/modules/module-manifest';
import { bidSheetModule } from './features/bid-sheet/bid-sheet.module';
import { calculatorsModule } from './features/calculators/calculators.module';
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
  engagementModule,
  producersModule,
  listsModule,
  bidSheetModule,
  usageAnalyticsModule,
  calculatorsModule,
  helpModule,
  whatsNewModule,
];
