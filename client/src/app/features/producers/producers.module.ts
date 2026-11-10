import { computed, inject } from '@angular/core';
import { EMPTY, Observable, of } from 'rxjs';
import { catchError, switchMap, take, tap } from 'rxjs/operators';
import { PermissionService } from '@core/access/permission.service';
import { SelectedProducerProduction } from '@core/context/selected-producer-production';
import { ModuleManifest } from '@core/modules/module-manifest';
import { ApiService } from '@core/services/api.service';
import { PlantingIntention } from '@models';
import { dpContractCount } from '@shared/utils/dp-aggregate';
import { DashboardStore } from './data-access/dashboard.store';

/**
 * Pre-fetches the Planting Dashboard's summary for the current year, so the dashboard renders without its own round
 * trip. The caches are dropped first: they belong to the previous trade-unit selection.
 */
export function preloadDashboardSummary(tradeUnits: readonly string[]): Observable<unknown> {
  const store = inject(DashboardStore);
  const api = inject(ApiService);
  const permissions = inject(PermissionService);
  store.clearDashboardCache();
  store.clearPreloadedDashboardSummary();

  const tuKey = [...tradeUnits].sort().join(',');
  const currentYear = new Date().getFullYear();
  // Only for a user who may read the dashboard, so nobody else gets a 403 on every trade-unit change.
  return permissions.loaded().pipe(
    take(1),
    switchMap(() => permissions.has('planting-estimates:read')
      // A failed prefetch is left unset rather than stored as an empty summary. The dashboard adopts a
      // preloaded summary without fetching its own, so an empty one showed a season with no
      // estimates, market shares or harvest, and kept showing it for the rest of the session.
      ? api.getDashboardSummary(tuKey, currentYear).pipe(
          tap(summary => store.setPreloadedDashboardSummary(tuKey, currentYear, summary)),
          catchError(() => of(null)),
        )
      : EMPTY),
  );
}

/**
 * How many of the intentions are for the newest crop year among them: the Planting tab's count, which answers "how
 * many crops are planned for the season" rather than counting every year on record. With no crop year on any, all.
 */
export function newestSeasonIntentionCount(intentions: readonly PlantingIntention[]): number {
  const newest = Math.max(0, ...intentions.map(intention => intention.plantingYear || 0));
  return newest ? intentions.filter(intention => intention.plantingYear === newest).length : intentions.length;
}

export const producersModule: ModuleManifest = {
  id: 'producers',
  routes: [
    {
      path: 'dashboard',
      requires: ['planting-estimates:read'],
      loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent),
    },
  ],
  nav: [
    {
      requires: ['planting-estimates:read'],
      label: 'Planting Intentions Dashboard',
      shortLabel: 'Dashboard',
      path: '/dashboard',
      icon: ['M18 20V10', 'M12 20V4', 'M6 20v-6'],
      order: 10,
      menu: 'main',
    },
  ],
  preload: preloadDashboardSummary,
  // A producer's own production. Each reads it from the profile's SelectedProducerProduction.
  customerTabs: [
    {
      id: 'planting',
      requires: ['planting-intentions:read'],
      segments: ['Producer'],
      label: 'Planting',
      shortLabel: 'Plan',
      order: 30,
      badge: () => {
        const production = inject(SelectedProducerProduction);
        return computed(() => newestSeasonIntentionCount(production.visiblePlantingIntentions()));
      },
      component: () => import('./components/planting-intentions-table/planting-intentions-table.component').then(m => m.PlantingIntentionsTableComponent),
    },
    {
      id: 'storage',
      requires: ['stored-grain:read'],
      segments: ['Producer'],
      label: 'Storage',
      shortLabel: 'Stor',
      order: 40,
      // The crops in storage.
      badge: () => {
        const production = inject(SelectedProducerProduction);
        return computed(() => new Set(production.storedGrain().map(grain => grain.crop || 'Unknown')).size);
      },
      component: () => import('./components/stored-grain-table/stored-grain-table.component').then(m => m.StoredGrainTableComponent),
    },
    {
      id: 'dpContracts',
      requires: ['dp-contracts:read'],
      segments: ['Producer'],
      label: 'DP Contracts',
      shortLabel: 'DP',
      order: 50,
      // Distinct contracts, not commodities (as Storage counts) and not charge rows: 8 contracts across 2 commodities
      // read as 8.
      badge: () => {
        const production = inject(SelectedProducerProduction);
        return computed(() => dpContractCount(production.dpContracts()));
      },
      component: () => import('./components/dp-contracts-table/dp-contracts-table.component').then(m => m.DpContractsTableComponent),
    },
  ],
};
