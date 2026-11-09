import { ModuleManifest } from '@core/modules/module-manifest';

export const engagementModule: ModuleManifest = {
  id: 'engagement',
  // Recap groups: who gets the daily recap, and who can be @-mentioned in notes. The page kept the Daily Digest
  // path it launched with.
  routes: [
    {
      path: 'daily-digest',
      requires: ['recap-groups:read'],
      loadComponent: () => import('./pages/daily-digest/daily-digest.component').then(m => m.DailyDigestComponent),
    },
  ],
  nav: [
    {
      requires: ['recap-groups:read'],
      label: 'Manage Groups',
      path: '/daily-digest',
      icon: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
      order: 20,
      menu: 'user',
    },
  ],
};
