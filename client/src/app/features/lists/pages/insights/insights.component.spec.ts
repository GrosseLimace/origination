import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { InsightsComponent } from './insights.component';
import { AppStateService } from '@core/services/app-state.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Contract, Ticket } from '@models';

// Regression guard for the Spot Loads performance fix (GetTodaysTicketsAsync). The backend now
// returns ONLY unapplied tickets on /api/tickets/today (it stopped running the slow applied-ticket
// SQL branch whose rows the UI discarded anyway). These tests pin the frontend contract that makes
// that safe: the Spot Loads insight is derived solely from UNAPPLIED tickets, so the smaller payload
// cannot change what the user sees. If someone ever drops the `if (ticket.isApplied) continue;`
// guard in allInsights(), test 2 fails loudly.

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1, scoularId: 'CUST1', name: 'Test Farm', farm: 'Test Farm LLC', location: 'Omaha, NE',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, ...over,
  };
}

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 1, farmId: '', ticketNumber: 'T-1', date: '2026-06-01',
    grossWeight: 0, tareWeight: 0, netWeight: 0, isApplied: false, isActive: true,
    customerCode: 'CUST1', productCode: 'YC', unloadQuantity: 1000, ...over,
  };
}

function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1, customerId: 1, farmId: '', contractNumber: 'P-1', quantity: 0, unit: 'bu', price: 0,
    deliveryStart: new Date('2026-05-01'), deliveryEnd: new Date('2026-06-30'),
    status: 'Active', signed: false, ctrmCustomerId: 'CUST1', commodityCode: 'YC', ...over,
  };
}

describe('InsightsComponent — Spot Loads derivation', () => {
  let appState: AppStateService;
  let component: InsightsComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DataPreloadService, useValue: { forceReload: () => {} } },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {}, info: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {}, trackProfileOpened: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
      ],
    });
    // happy-dom + JIT can't fetch templateUrl, and the child component imports carry their own
    // templateUrls. Blank the template + imports so JIT compiles a bare shell; allInsights() is a
    // class member and is unaffected by the template.
    TestBed.overrideComponent(InsightsComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    appState = TestBed.inject(AppStateService);
    component = TestBed.createComponent(InsightsComponent).componentInstance;
  });

  const spotLoads = () => component.allInsights().filter(i => i.category === 'SpotLoads');

  it('flags an unapplied ticket with no covering contract as a spot load', () => {
    appState.setCustomers([makeCustomer({ id: 1, scoularId: 'CUST1' })]);
    appState.setContracts([]);
    appState.setTodaysTickets([makeTicket({ id: 10, ticketNumber: 'T-10', isApplied: false })]);

    const loads = spotLoads();
    expect(loads.length).toBe(1);
    expect(loads[0].ticketNumber).toBe('T-10');
  });

  it('is invariant to applied tickets in the payload (backend no longer sends them)', () => {
    appState.setCustomers([makeCustomer({ id: 1, scoularId: 'CUST1' })]);
    appState.setContracts([]);
    appState.setTodaysTickets([
      makeTicket({ id: 10, ticketNumber: 'T-10', isApplied: false }),
      // Applied rows used to arrive from the old SQL branch; the UI must ignore them, so whether
      // or not the API sends them the Spot Loads result is identical.
      makeTicket({ id: 11, ticketNumber: 'T-APPLIED', isApplied: true, ctrmContractNumber: 'P 123' }),
    ]);

    const loads = spotLoads();
    expect(loads.length).toBe(1);
    expect(loads.map(l => l.ticketNumber)).toEqual(['T-10']);
  });

  it('does NOT flag an unapplied ticket covered by an open same-commodity contract', () => {
    appState.setCustomers([makeCustomer({ id: 1, scoularId: 'CUST1' })]);
    appState.setContracts([
      makeContract({ ctrmCustomerId: 'CUST1', commodityCode: 'YC',
        deliveryStart: new Date('2026-05-01'), deliveryEnd: new Date('2026-06-30') }),
    ]);
    appState.setTodaysTickets([
      makeTicket({ id: 10, ticketNumber: 'T-10', productCode: 'YC', date: '2026-06-01', isApplied: false }),
    ]);

    expect(spotLoads().length).toBe(0);
  });
});
