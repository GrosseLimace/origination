import { computed, inject } from '@angular/core';
import { EMPTY, Observable, merge, of } from 'rxjs';
import { catchError, finalize, tap, timeout } from 'rxjs/operators';
import { Contract, Ticket } from '@models';
import { PermissionService } from '@core/access/permission.service';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { ModuleManifest } from '@core/modules/module-manifest';
import { ContractStore } from './data-access/contract.store';
import { ContractsApiService } from './data-access/contracts-api.service';

/**
 * What Contracts loads for a new trade-unit selection: the trade units' contracts and today's tickets, each only for a
 * user who may read them. Screens wait on each one's loading flag. The trade unit's full ticket set isn't read here:
 * the screens that need it read it, so it is only dropped, for the new selection to be read.
 */
export function preloadContracts(tradeUnits: readonly string[]): Observable<unknown> {
  const store = inject(ContractStore);
  const api = inject(ContractsApiService);
  const permissions = inject(PermissionService);
  store.clearLoadFailures();
  store.clearTicketsCache();

  // Cleared ahead of the catchError, so only a real emission clears it: the [] fallback flows through the same taps.
  // Still resolves to [], so the rest of the page loads, but the failure is recorded: otherwise every contract-based
  // prompt reports "no producers found" for what is an outage.
  const contracts$ = permissions.has('contracts:read')
    ? api.getContracts([...tradeUnits]).pipe(
        tap(() => store.setContractsLoadFailed(false)),
        catchError(() => { store.setContractsLoadFailed(true); return of([] as Contract[]); }),
        tap(contracts => { store.setContracts(contracts); store.setContractsLoading(false); }),
        finalize(() => store.setContractsLoading(false)),
      )
    : EMPTY;

  // Bounded above the read's honest cold time (3-5s; the server serves it stale-while-revalidate), so the Spot Loads
  // skeleton can't spin forever if the gateway stalls. A timeout is not a failure: the server carries on and caches
  // the result, so a retry shortly after succeeds, and saying it could not be loaded from CTRM would be false.
  const todaysTickets$ = permissions.has('tickets:read')
    ? api.getTodaysTickets([...tradeUnits]).pipe(
        timeout(60000),
        tap(() => { store.setTicketsLoadFailed(false); store.setSourceLoadPending(false); }),
        catchError(err => {
          if (err?.name === 'TimeoutError') store.setSourceLoadPending(true);
          else store.setTicketsLoadFailed(true);
          return of([] as Ticket[]);
        }),
        tap(tickets => { store.setTodaysTickets(tickets); store.setTodaysTicketsLoading(false); }),
        finalize(() => store.setTodaysTicketsLoading(false)),
      )
    : EMPTY;

  store.setContractsLoading(permissions.has('contracts:read'));
  store.setTodaysTicketsLoading(permissions.has('tickets:read'));
  return merge(contracts$, todaysTickets$);
}


export const contractsModule: ModuleManifest = {
  id: 'contracts',
  preload: preloadContracts,
  customerTabs: [
    {
      id: 'contracts',
      // Each contract also lists its applied tickets and its pricing lines (read under contracts:read).
      requires: ['contracts:read', 'tickets:read'],
      label: 'Open Contracts',
      shortLabel: 'Cont',
      order: 10,
      badge: () => {
        const activity = inject(SelectedProducerActivity);
        return computed(() => activity.contracts().filter(contract => !contract.closedDate).length);
      },
      component: () => import('./components/contracts-table/contracts-table.component').then(m => m.ContractsTableComponent),
    },
    {
      id: 'tickets',
      // Each ticket is matched to its contract. Applied and unapplied are purchase-side rules, so this is a producer's
      // tab; commercial customers will get a sales-side one.
      requires: ['tickets:read', 'contracts:read'],
      segments: ['Producer'],
      label: 'Unapplied Tickets',
      shortLabel: 'Tick',
      order: 20,
      badge: () => {
        const activity = inject(SelectedProducerActivity);
        return computed(() => activity.tickets().filter(ticket => !ticket.isApplied).length);
      },
      component: () => import('./components/tickets-table/tickets-table.component').then(m => m.TicketsTableComponent),
    },
  ],
};
