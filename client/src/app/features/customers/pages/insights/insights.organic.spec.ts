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
import { Customer, Contract, OrganicCertificationStatusChange, OrganicMissingCertificate } from '@models';

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

  function setup(
    changes: OrganicCertificationStatusChange[],
    missing: OrganicMissingCertificate[] = [],
  ): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApiService,
          useValue: {
            getOrganicStatusChanges: () => of(changes),
            getOrganicMissingCertificates: () => of(missing),
          },
        },
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
  const uncontracted = () => component.allInsights().filter(i => i.category === 'OrganicUncontracted');

  it('raises an alert for a contracted producer whose certification changed', () => {
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract()]);

    const alerts = organic();
    expect(alerts.length).toBe(1);
    expect(alerts[0].message).toContain('Certified');
    expect(alerts[0].message).toContain('Surrendered');
  });

  // Until 2026-10-07 an uncontracted producer appeared NOWHERE. The desk then asked for a second
  // category so that every non-certified producer lands in exactly one of the two — they are not
  // urgent when we hold no open business, but the team still wants to know before they go looking
  // to trade someone. So these three cases are no longer "silent"; they MOVE.

  it('moves a producer with no contracts to the uncontracted category', () => {
    // The second producer carries the trade unit's only contract. Without ANY contract anywhere,
    // allInsights() short-circuits before the customer loop runs — a deliberate optimisation for
    // "nothing has loaded yet", but it means this category cannot populate on a desk with no
    // contracts at all. Not a scenario trade unit 2080 will meet, and not worth special-casing.
    appState.setCustomers([
      makeCustomer({ id: 1, scoularId: 'CUST1' }),
      makeCustomer({ id: 2, scoularId: 'CUST2' }),
    ]);
    appState.setContracts([makeContract({ id: 9, customerId: 2, ctrmCustomerId: 'CUST2' })]);

    expect(organic()).toEqual([]);
    expect(uncontracted().map(i => i.customer.id)).toEqual([1]);
  });

  it('moves a producer to uncontracted once the contract is cancelled', () => {
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract({ status: 'Cancelled' })]);

    expect(organic()).toEqual([]);
    expect(uncontracted().length).toBe(1);
  });

  it('moves a producer to uncontracted once the contract is fulfilled', () => {
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract({ status: 'Fulfilled' })]);

    expect(organic()).toEqual([]);
    expect(uncontracted().length).toBe(1);
  });

  it('puts every flagged producer in exactly one of the two categories', () => {
    // The desk's own framing of the pair: "any producer with a non-certified certificate should
    // show up in one of two categories". A producer in both, or in neither, is the bug.
    setup([
      makeChange({ customerId: 1, scoularId: 'CUST1' }),
      makeChange({ customerId: 2, scoularId: 'CUST2' }),
    ]);
    appState.setCustomers([
      makeCustomer({ id: 1, scoularId: 'CUST1' }),
      makeCustomer({ id: 2, scoularId: 'CUST2' }),
    ]);
    appState.setContracts([makeContract({ id: 1, customerId: 1, ctrmCustomerId: 'CUST1' })]);

    expect(organic().map(i => i.customer.id)).toEqual([1]);
    expect(uncontracted().map(i => i.customer.id)).toEqual([2]);
  });

  it('flags a producer who was ALREADY surrendered when we first saw them', () => {
    // The gap this closes. The old rule required PreviousStatus to be set — we had to have watched
    // the change — so a producer whose first message already said Surrendered appeared on no list
    // at all. The desk asked for them (2026-10-07): meeting someone already surrendered is not a
    // reason to stay quiet about it.
    setup([makeChange({ previousStatus: null, status: 'Surrendered' })]);
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract()]);

    expect(organic().length).toBe(1);
  });

  it('flags Suspended and Revoked, not Surrendered alone', () => {
    // Anything that is not Certified. Suspended and Revoked are at least as serious, and a status
    // USDA invents tomorrow should flag rather than slip through.
    for (const status of ['Suspended', 'Revoked', 'Something USDA Invented']) {
      setup([makeChange({ status, previousStatus: null })]);
      appState.setCustomers([makeCustomer()]);
      appState.setContracts([makeContract()]);

      expect(organic().length, status).toBe(1);
    }
  });

  // "Certified producers are not flagged" is deliberately NOT tested here: the filtering is the
  // server's, applied in OrganicCertificationService against the shared NeedsAttention rule, and a
  // certified producer never reaches this component. Re-checking it client-side would duplicate the
  // rule in a second place — the exact drift OrganicCertificationStatus exists to prevent.
  // Covered by OrganicCertificationStatusTests.NeedsAttentionFlagsAnythingNotCertified.

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

  it('handles a certification with no previous status without printing undefined', () => {
    // No previous status means we never watched it change — this producer was already surrendered
    // the first time we saw them. They are listed now (they were not before 2026-10-07), so the
    // wording drops "now": "is now Surrendered" asserts a change that never happened on our watch.
    setup([makeChange({ previousStatus: null })]);
    appState.setCustomers([makeCustomer()]);
    appState.setContracts([makeContract()]);

    const alert = organic()[0];
    expect(alert.message).toBe('Organic certification is Surrendered.');
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

  it('has a loading skeleton for every category, organic included', () => {
    // The skeletons were once a positional array one entry short of the category list, so the
    // organic card threw "reading 'headerClass'" on every render until contracts arrived.
    for (const category of component.allCategories) {
      expect(component.skeletonCategories[category]?.headerClass, category).toBeTruthy();
    }
  });

  /**
   * The category belongs to the organics desk (trade unit 2080) and to nobody else. Every other
   * desk trades conventional grain, where a certification alert is noise on a page they check
   * daily.
   */
  describe('visibility by trade unit', () => {
    it('shows the category on the organics desk', () => {
      appState.selectedTradeUnits.set(['2080']);

      expect(component.visibleCategories()).toContain('OrganicStatusChanges');
    });

    it('hides it on any other desk', () => {
      appState.selectedTradeUnits.set(['2347']);

      expect(component.visibleCategories()).not.toContain('OrganicStatusChanges');
    });

    it('shows it when the organics desk is selected alongside another', () => {
      // "2080 is among the selection", not "2080 is the whole selection".
      appState.selectedTradeUnits.set(['2347', '2080']);

      expect(component.visibleCategories()).toContain('OrganicStatusChanges');
    });

    it('never hides the three categories traders use daily', () => {
      appState.selectedTradeUnits.set(['2347']);

      expect(component.visibleCategories())
        .toEqual(['UnconfirmedContracts', 'SpotLoads', 'UnshippedBushels']);
    });

    it('still groups organic insights off-desk, so the page cannot throw on a stale selection', () => {
      // customerGroupsByCategory indexes its map by insight category. If the gate were applied to
      // the grouping pass rather than only to rendering, an organic insight arriving while another
      // desk is selected would dereference an undefined map.
      appState.selectedTradeUnits.set(['2347']);
      appState.setCustomers([makeCustomer()]);
      appState.setContracts([makeContract({ tradeUnit: '2347' })]);

      expect(() => component.customerGroupsByCategory()).not.toThrow();
      expect(component.customerGroupsByCategory().OrganicStatusChanges).toBeDefined();
    });
  });
});
