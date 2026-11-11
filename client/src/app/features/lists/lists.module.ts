import { Injector, inject } from '@angular/core';
import { Observable, from, merge, switchMap } from 'rxjs';
import { ModuleManifest } from '@core/modules/module-manifest';

/**
 * What Lists loads for a new trade-unit selection: the user's own saved lists (with the query library, the first time),
 * and the team's lists for the selection, each only for a user who may read them. Who each list holds is worked out
 * as the trade unit's data arrives. The store's code loads here rather than with the manifest, which the app loads up
 * front: it brings the NLQ engine.
 */
export function preloadLists(): Observable<unknown> {
  const injector = inject(Injector);
  return from(import('./data-access/saved-lists.store')).pipe(
    switchMap(({ SavedListsStore }) => {
      const store = injector.get(SavedListsStore);
      return merge(store.load(), store.loadTeamLists());
    }),
  );
}


export const listsModule: ModuleManifest = {
  id: 'lists',
  preload: preloadLists,
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
  customerPanels: [
    {
      // Add to List, first of the profile header's buttons: puts the customer on the user's own saved lists or takes
      // them off. Its Team Lists tab, for teammates' lists, needs saved-lists:read:team and :write:team as well. For
      // every customer: a saved list is a list of customers.
      slot: 'toolbar',
      id: 'add-to-list',
      requires: ['saved-lists:read:own', 'saved-lists:write:own'],
      order: 10,
      component: () => import('./components/add-to-list/add-to-list.component').then(m => m.AddToListComponent),
    },
    {
      // The customer list's saved-list picker: narrows the list to who one of the user's own lists holds.
      slot: 'list-filter',
      id: 'saved-list-filter',
      requires: ['saved-lists:read:own'],
      order: 10,
      component: () => import('./components/saved-list-filter/saved-list-filter.component').then(m => m.SavedListFilterComponent),
    },
  ],
};
