import { ModuleManifest } from '@core/modules/module-manifest';

export const calculatorsModule: ModuleManifest = {
  id: 'calculators',
  customerPanels: [
    {
      // The floating calculator launcher on the home page, for every customer. The calculators read none of the
      // user's data, so they ask for no permission.
      slot: 'floating',
      id: 'calculator-launcher',
      requires: [],
      order: 10,
      component: () => import('./components/calculator-panel.component').then(m => m.CalculatorPanelComponent),
    },
  ],
};
