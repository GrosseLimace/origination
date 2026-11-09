import { ModuleManifest } from '@core/modules/module-manifest';

export const usageAnalyticsModule: ModuleManifest = {
  id: 'usage-analytics',
  routes: [
    {
      path: 'usage-dashboard',
      requires: ['usage-reports:read'],
      loadComponent: () => import('./pages/usage-dashboard/usage-dashboard.component').then(m => m.UsageDashboardComponent),
    },
    {
      path: 'usage-dashboard/users/:userId',
      requires: ['usage-reports:read'],
      loadComponent: () => import('./pages/user-usage-detail/user-usage-detail.component').then(m => m.UserUsageDetailComponent),
    },
  ],
  nav: [
    {
      requires: ['usage-reports:read'],
      label: 'Usage Dashboard',
      path: '/usage-dashboard',
      icon: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
      order: 10,
      menu: 'user',
    },
  ],
};
