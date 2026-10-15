import { Routes } from '@angular/router';

import { offlineAuthGuard } from './core/auth/offline-auth.guard';

// The producer flow: trade units → producers (browse / search) → one producer.
// Deep links are real URLs (unlike the desktop, where producer selection is in-memory state), so a
// phone reopening /customers/123 lands on that producer.
export const routes: Routes = [
  {
    path: '',
    canActivate: [offlineAuthGuard],
    loadComponent: () => import('./features/trade-units/trade-units.page').then((m) => m.TradeUnitsPage),
    title: 'Trade units',
  },
  {
    path: 'producers',
    canActivate: [offlineAuthGuard],
    loadComponent: () => import('./features/customers/producers.page').then((m) => m.ProducersPage),
    title: 'Producers',
  },
  {
    path: 'customers/:customerId',
    canActivate: [offlineAuthGuard],
    loadComponent: () => import('./features/customers/detail.page').then((m) => m.DetailPage),
    title: 'Producer',
  },
  {
    path: 'offline',
    loadComponent: () => import('./features/offline/offline.page').then((m) => m.OfflinePage),
    title: 'Offline',
  },
  { path: '**', redirectTo: '' },
];
