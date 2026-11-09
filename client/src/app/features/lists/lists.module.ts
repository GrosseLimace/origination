import { ModuleManifest } from '@core/modules/module-manifest';

export const listsModule: ModuleManifest = {
  id: 'lists',
  routes: [
    {
      path: 'build-list',
      requires: ['query-library:read', 'saved-lists:read:own'],
      loadComponent: () => import('./pages/build-list/build-list.component').then(m => m.BuildListComponent),
    },
    {
      path: 'insights',
      requires: ['customers:read', 'contracts:read', 'tickets:read'],
      loadComponent: () => import('./pages/insights/insights.component').then(m => m.InsightsComponent),
    },
  ],
  nav: [
    {
      requires: ['query-library:read', 'saved-lists:read:own'],
      label: 'Build a List',
      path: '/build-list',
      icon: ['M3 6h18', 'M7 12h10', 'M10 18h4'],
      order: 20,
      menu: 'main',
    },
    {
      requires: ['customers:read', 'contracts:read', 'tickets:read'],
      label: 'Actionable Insights',
      shortLabel: 'Insights',
      path: '/insights',
      icon: ['M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5', 'M9 18h6', 'M10 22h4'],
      order: 30,
      menu: 'main',
    },
  ],
};
