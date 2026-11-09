import { inject } from '@angular/core';
import { EMPTY, Observable, of } from 'rxjs';
import { catchError, switchMap, take, tap } from 'rxjs/operators';
import { PermissionService } from '@core/access/permission.service';
import { ModuleManifest } from '@core/modules/module-manifest';
import { ApiService } from '@core/services/api.service';
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
};
