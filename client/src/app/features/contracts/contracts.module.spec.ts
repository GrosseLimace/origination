import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Contract, Ticket } from '@models';
import { provideSelectedProducerActivity, selectedProducerActivityFake } from '@testing/selected-producer-activity.fake';
import { contractsModule } from './contracts.module';
import { ContractsTableComponent } from './components/contracts-table/contracts-table.component';
import { TicketsTableComponent } from './components/tickets-table/tickets-table.component';

const tab = (id: string) => contractsModule.customerTabs!.find(t => t.id === id)!;

describe("Contracts module: the customer profile's tabs", () => {
  it('contributes Open Contracts and, for producers, Unapplied Tickets, as the first tabs', () => {
    expect(contractsModule.customerTabs!.map(t => [t.id, t.label, t.shortLabel, t.order])).toEqual([
      ['contracts', 'Open Contracts', 'Cont', 10],
      ['tickets', 'Unapplied Tickets', 'Tick', 20],
    ]);
    expect(tab('contracts').segments).toBeUndefined();
    expect(tab('tickets').segments).toEqual(['Producer']);
  });

  it('asks for every read each tab makes: contracts with their applied tickets, tickets with their contracts', () => {
    expect([...tab('contracts').requires].sort()).toEqual(['contracts:read', 'tickets:read']);
    expect([...tab('tickets').requires].sort()).toEqual(['contracts:read', 'tickets:read']);
  });

  it("counts the producer's open contracts and unapplied tickets, as they change", () => {
    const activity = selectedProducerActivityFake();
    TestBed.configureTestingModule({ providers: [provideSelectedProducerActivity(activity)] });
    const openContracts = TestBed.runInInjectionContext(tab('contracts').badge!);
    const unappliedTickets = TestBed.runInInjectionContext(tab('tickets').badge!);

    activity.contracts.set([{ id: 1 }, { id: 2, closedDate: '2026-10-01' }, { id: 3 }] as Contract[]);
    activity.tickets.set([{ id: 1, isApplied: false }, { id: 2, isApplied: true }] as Ticket[]);

    expect(openContracts()).toBe(2);
    expect(unappliedTickets()).toBe(1);
  });

  it('loads each tab as its table', async () => {
    expect(await tab('contracts').component()).toBe(ContractsTableComponent);
    expect(await tab('tickets').component()).toBe(TicketsTableComponent);
  });
});
