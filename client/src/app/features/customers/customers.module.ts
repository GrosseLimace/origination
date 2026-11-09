import { inject } from '@angular/core';
import { EMPTY, Observable, of } from 'rxjs';
import { catchError, finalize, switchMap, take, tap } from 'rxjs/operators';
import { Customer } from '@models';
import { PermissionService } from '@core/access/permission.service';
import { ModuleManifest } from '@core/modules/module-manifest';
import { CustomerStore } from './data-access/customer.store';
import { CustomersApiService } from './data-access/customers-api.service';

/**
 * Loads the selected trade units' customers into CustomerStore, for a user who may read them. Screens wait on
 * customersLoading meanwhile. A failed read leaves the list empty with customersLoadFailed set, so it doesn't read as
 * "no producers in these trade units".
 */
export function preloadCustomers(tradeUnits: readonly string[]): Observable<unknown> {
  const store = inject(CustomerStore);
  const api = inject(CustomersApiService);
  const permissions = inject(PermissionService);
  store.setCustomersLoading(true);
  store.setCustomersLoadFailed(false);

  return permissions.loaded().pipe(
    take(1),
    switchMap(() => permissions.has('customers:read')
      ? api.getCustomers([...tradeUnits]).pipe(
          // Cleared ahead of the catchError, so only a real emission clears it: the [] fallback below flows through
          // the same taps.
          tap(() => store.setCustomersLoadFailed(false)),
          catchError(() => { store.setCustomersLoadFailed(true); return of([] as Customer[]); }),
          tap(customers => store.setCustomers(customers)),
        )
      : EMPTY),
    // Loaded, failed, refused or cancelled by the next selection: either way nothing is loading any more. A
    // cancellation finalizes before the next selection's preload starts, so this never clears the new load's flag.
    finalize(() => store.setCustomersLoading(false)),
  );
}

export const customersModule: ModuleManifest = {
  id: 'customers',
  // The home page. The header's home link stays in the header: its "Producers" label will come from the
  // customer segment, and the desktop bar reaches home through the logo.
  routes: [
    { path: '', requires: [], loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
  ],
  preload: preloadCustomers,
};
