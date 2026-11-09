import { computed, inject } from '@angular/core';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { ModuleManifest } from '@core/modules/module-manifest';

export const contractsModule: ModuleManifest = {
  id: 'contracts',
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
