import { ModuleManifest } from '@core/modules/module-manifest';

export const helpModule: ModuleManifest = {
  id: 'help',
  spaOnly: true,
  // Self-help, open to everyone: every question, by category or search. The Help panel itself isn't a route; it
  // opens over whatever page the user is on.
  routes: [
    { path: 'help', requires: [], loadComponent: () => import('./pages/help/help.component').then(m => m.HelpComponent) },
  ],
};
