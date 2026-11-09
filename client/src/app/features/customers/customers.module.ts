import { ModuleManifest } from '@core/modules/module-manifest';

export const customersModule: ModuleManifest = {
  id: 'customers',
  // The home page. The header's home link stays in the header: its "Producers" label will come from the
  // customer segment, and the desktop bar reaches home through the logo.
  routes: [
    { path: '', requires: [], loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
  ],
};
