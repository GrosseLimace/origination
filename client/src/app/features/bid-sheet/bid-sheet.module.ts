import { ModuleManifest } from '@core/modules/module-manifest';

export const bidSheetModule: ModuleManifest = {
  id: 'bid-sheet',
  routes: [
    {
      path: 'bid-sheet',
      requires: ['bid-sheets:read'],
      loadComponent: () => import('./pages/bid-sheet/bid-sheet.component').then(m => m.BidSheetComponent),
    },
  ],
  nav: [
    {
      requires: ['bid-sheets:read'],
      label: 'Bid Sheet',
      path: '/bid-sheet',
      icon: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M12 18v-6', 'M9 15h6'],
      order: 40,
      menu: 'main',
    },
  ],
};
