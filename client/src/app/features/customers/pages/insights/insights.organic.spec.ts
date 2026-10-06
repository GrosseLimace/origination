import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { InsightsComponent } from './insights.component';
import { AppStateService } from '@core/services/app-state.service';
import { ApiService } from '@core/services/api.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Contract, OrganicCertificationStatusChange } from '@models';

/**
 * The organic certification status-change alert.
 *
 * Two rules from the organics desk shape all of this, and both are easy to break silently:
 *   - contracted producers only — a certification that moved matters when we are doing business
 *   - it clears when the status returns to Certified, OR when the contract closes
 *
 * The first half of that removal rule is applied server-side, so a resolved change never reaches
 * the client. The second half falls out of the contract filtering here, which is why these tests
 * lean on contract state rather than certification state.
 */
function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1, scoularId: 'CUST1', name: 'Test Farm', farm: 'Test Farm LLC', location: 'Omaha, NE',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, ...over,
  };
}

function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1, customerId: 1, farmId: '', contractNumber: 'P-1', quantity: 0, unit: 'bu', price: 0,
    deliveryStart: new Date('2026-05-01'), deliveryEnd: new Date('2026-12-31'),
    status: 'Active', signed: false, ctrmCustomerId: 'CUST1', commodityCode: 'YC', ...over,
  };
}

function makeChange(over: Partial<OrganicCertificationStatusChange> = {}): OrganicCertificationStatusChange {
  return {
    customerId: 1, scoularId: 'CUST1', nopid: '8150000123',
    operationName: 'Test Farm LLC', status: 'Surrendered', previousStatus: 'Certified',
    statusEffectiveDate: '2026-08-03', ...over,
  };
}

describe('InsightsComponent — organic certification status changes', () => {
  let appState: AppStateService;
  let component: InsightsComponent;

  function setup(changes: OrganicCertificationStatusChange[]): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getOrganicStatusChanges: () => of(changes) } },
        { provide: DataPreloadService, useValue: { forceReload: () => {} } },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {}, info: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {}, trackProfileOpened: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
      ],
    });
    // happy-dom + JIT can't fetch templateUrl; allInsights() is a class member either way.
    TestBed.overrideComponent(InsightsComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    appState = TestBed.inject(AppStateService);
    component = TestBed.createComponent(InsightsComponent).componentInstance;
  }

  beforeEach(() => setup([makeChange()]));

  const organic = () => component.allInsights().filter(i => i.category === 'OrganicStatusChanges');

  it('raises an alert for a contracted producer whose certification changed', () => {
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract()]);

    const alerts = organic();
    expect(alerts.length).toBe(1);
    expect(alerts[0].message).toContain('Certified');
    expect(alerts[0].message).toContain('Surrendered');
  });

  it('does NOT alert on a producer with no contracts', () => {
    // "Contracted customers only" — the desk does not want noise about producers we are not
    // currently doing business with.
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([]);

    expect(organic()).toEqual([]);
  });

  it('does NOT alert once the contract is cancelled', () => {
    // The second half of the desk's removal rule.
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract({ status: 'Cancelled' })]);

    expect(organic()).toEqual([]);
  });

  it('does NOT alert once the contract is fulfilled', () => {
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract({ status: 'Fulfilled' })]);

    expect(organic()).toEqual([]);
  });

  it('still alerts when one contract closed but another is open', () => {
    // Removal is about having no live business left, not about any single contract ending.
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([
      makeContract({ id: 1, status: 'Fulfilled' }),
      makeContract({ id: 2, status: 'Active' }),
    ]);

    expect(organic().length).toBe(1);
  });

  it('matches producers case-insensitively on the customer code', () => {
    // Customer codes reach us from two different systems — ODS for customers, the certification
    // feed for these — and nothing guarantees they agree on casing.
    setup([makeChange({ scoularId: 'cust1' })]);
    appState.setCustomers([makeCustomer({ scoularId: 'CUST1' })]);
    appState.setContracts([makeContract()]);

    expect(organic().length).toBe(1);
  });

  it('alerts each affected producer when one certificate covers several', () => {
    // Family operations and person-plus-LLC pairs share a NOP id. Insights is keyed by customer,
    // so each needs its own alert rather than one shared row.
    setup([
      makeChange({ customerId: 1, scoularId: 'CUST1' }),
      makeChange({ customerId: 2, scoularId: 'CUST2' }),
    ]);
    appState.setCustomers([
      makeCustomer({ id: 1, scoularId: 'CUST1' }),
      makeCustomer({ id: 2, scoularId: 'CUST2' }),
    ]);
    appState.setContracts([
      makeContract({ id: 1, ctrmCustomerId: 'CUST1' }),
      makeContract({ id: 2, customerId: 2, ctrmCustomerId: 'CUST2' }),
    ]);

    expect(organic().length).toBe(2);
  });

  it('reads as Urgent, above the warning-level categories', () => {
    // A surrendered certification can stop us trading with them — a harder consequence than an
    // unconfirmed contract or an overdue delivery.
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract()]);

    expect(organic()[0].priority).toBe('Urgent');
  });

  it('handles a change with no previous status without printing undefined', () => {
    setup([makeChange({ previousStatus: null })]);
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract()]);

    const alert = organic()[0];
    expect(alert.message).toBe('Organic certification is now Surrendered.');
    expect(alert.message).not.toContain('undefined');
  });

  it('leaves the other categories alone when there are no changes', () => {
    // The newest of four categories must not be able to suppress the three traders use daily.
    setup([]);
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract({ customerConfirmStatus: 'Pending' })]);

    expect(organic()).toEqual([]);
    expect(component.allInsights().some(i => i.category === 'UnconfirmedContracts')).toBe(true);
  });
});
