import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { ActivitySummaryComponent } from './activity-summary.component';
import { AppStateService } from '@core/services/app-state.service';
import { CommodityConversion, Contract, Customer, Ticket } from '@models';

/**
 * The summary is open by default, and collapsing it has to STICK — including when the user moves to
 * another producer, which tears this component down and builds a new one. That's why the preference
 * lives in localStorage rather than in a component field.
 */
const KEY = 'origination.activitySummary.collapsed';

function makeCustomer(id: number): Customer {
  return { id, name: 'Test Farm' } as Customer;
}

function createComponent(): { component: ActivitySummaryComponent; ref: ComponentRef<ActivitySummaryComponent> } {
  const fixture = TestBed.createComponent(ActivitySummaryComponent);
  const ref = fixture.componentRef;
  ref.setInput('customer', makeCustomer(1));
  fixture.detectChanges();
  return { component: fixture.componentInstance, ref };
}

describe('ActivitySummaryComponent — collapsible', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AppStateService, useValue: { harvestWindows: () => [], commodityConversions: () => [] } }],
    });
    // happy-dom + JIT can't fetch templateUrl; the toggle logic is class-level.
    TestBed.overrideComponent(ActivitySummaryComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
  });

  it('is open by default', () => {
    const { component } = createComponent();
    expect(component.expanded()).toBe(true);
  });

  it('collapses and re-opens on toggle', () => {
    const { component } = createComponent();

    component.toggle();
    expect(component.expanded()).toBe(false);

    component.toggle();
    expect(component.expanded()).toBe(true);
  });

  it('stays collapsed when the user switches producers', () => {
    const first = createComponent();
    first.component.toggle();
    expect(first.component.expanded()).toBe(false);

    // Selecting another producer rebuilds the profile, so a fresh instance is constructed.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AppStateService, useValue: { harvestWindows: () => [], commodityConversions: () => [] } }],
    });
    TestBed.overrideComponent(ActivitySummaryComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const second = createComponent();

    expect(second.component.expanded()).toBe(false);
  });

  it('re-opens for the next producer once the user expands it again', () => {
    localStorage.setItem(KEY, 'true');
    const first = createComponent();
    expect(first.component.expanded()).toBe(false);

    first.component.toggle();   // back open — the collapse preference is cleared

    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('defaults to open when the stored value is missing or unrecognised', () => {
    localStorage.setItem(KEY, 'not-a-boolean');
    expect(createComponent().component.expanded()).toBe(true);
  });
});

/**
 * The unapplied-ticket sentence converts each ticket's dock pounds to bushels through the commodity
 * conversion list (GNP024). Rendered through the real template, with the conversions as a signal
 * so the list can be replaced the way app state replaces it.
 */
describe('ActivitySummaryComponent — unapplied ticket bushels', () => {
  const conversions = signal<CommodityConversion[]>([]);
  let fixture: ComponentFixture<ActivitySummaryComponent>;

  const summary = (): string =>
    (fixture.nativeElement.querySelector('#activity-summary-body')?.textContent ?? '').replace(/\s+/g, ' ').trim();

  /** An unapplied ticket from long enough ago that it is not also a recent spot load. */
  const ticket = (over: Partial<Ticket>): Ticket =>
    ({ id: 1, farmId: 'F1', ticketNumber: '1', date: '2025-01-15', grossWeight: 0, tareWeight: 0, netWeight: 0,
      isApplied: false, isActive: true, ...over }) as Ticket;

  function render(tickets: Ticket[]): void {
    fixture = TestBed.createComponent(ActivitySummaryComponent);
    fixture.componentRef.setInput('customer', makeCustomer(1));
    fixture.componentRef.setInput('tickets', tickets);
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.removeItem(KEY);
    conversions.set([]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AppStateService, useValue: {
        harvestWindows: signal([]), commodityConversions: conversions,
        harvestWindowsLoadFailed: signal(false), commodityConversionsLoadFailed: signal(false),
      } }],
    });
  });

  it('totals the unapplied tickets in bushels, skipping products with no conversion', () => {
    conversions.set([{ commodityCode: ' yc ', lbsPerUnit: 56 }, { commodityCode: 'SB', lbsPerUnit: 0 }]);
    render([
      ticket({ id: 1, productCode: 'YC', appliedDockQuantity: 56000 }),
      ticket({ id: 2, productCode: 'HRW', appliedDockQuantity: 60000 }),   // not in the list: dropped
      ticket({ id: 3, productCode: 'SB', appliedDockQuantity: 60000 }),    // zero lbs/bu: dropped
    ]);

    expect(summary()).toContain('3 unapplied tickets (1,000 bushels) not yet matched to a contract.');
  });

  it('leaves the bushel figure out while the conversions have not loaded', () => {
    render([ticket({ productCode: 'YC', appliedDockQuantity: 56000 })]);

    expect(summary()).toContain('1 unapplied ticket not yet matched to a contract.');
  });

  it('re-converts when the conversion list is replaced by one of the same length', () => {
    conversions.set([{ commodityCode: 'YC', lbsPerUnit: 56 }]);
    render([ticket({ productCode: 'YC', appliedDockQuantity: 56000 })]);
    expect(summary()).toContain('1 unapplied ticket (1,000 bushels) not yet matched');

    conversions.set([{ commodityCode: 'YC', lbsPerUnit: 50 }]);
    fixture.detectChanges();

    expect(summary()).toContain('1 unapplied ticket (1,120 bushels) not yet matched');
  });

  it('builds the conversion lookup once per conversion list, not once per ticket', () => {
    let builds = 0;
    const list: CommodityConversion[] = [{ commodityCode: 'YC', lbsPerUnit: 56 }];
    Object.defineProperty(list, 'map', {
      value: function (this: CommodityConversion[], ...args: Parameters<CommodityConversion[]['map']>) {
        builds++;
        return Array.prototype.map.apply(this, args);
      },
    });
    conversions.set(list);
    render([
      ticket({ id: 1, productCode: 'YC', appliedDockQuantity: 56000 }),
      ticket({ id: 2, productCode: 'YC', appliedDockQuantity: 112000 }),
    ]);
    expect(summary()).toContain('2 unapplied tickets (3,000 bushels)');

    fixture.componentRef.setInput('tickets', [ticket({ id: 3, productCode: 'YC', appliedDockQuantity: 168000 })]);
    fixture.detectChanges();

    expect(summary()).toContain('1 unapplied ticket (3,000 bushels)');
    expect(builds).toBe(1);
  });
});

// A failed background load used to leave the summary reading as complete: the pace sentence simply
// vanished, and contracts in other units dropped out of the bushel totals. Real AppStateService, real
// template; state is set through its setters.
describe('ActivitySummaryComponent — failed background loads', () => {
  let fixture: ComponentFixture<ActivitySummaryComponent>;
  let state: AppStateService;

  const text = (): string => (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ').trim();

  const contract = (over: Partial<Contract>): Contract =>
    ({ id: 1, customerId: 1, contractNumber: '100', commodityCode: 'YC', commodityGroup: 'Corn', quantity: 5000,
      unit: 'BU', status: 'Active', deliveryStart: '2020-01-01', deliveryEnd: '2020-02-01', ...over }) as Contract;

  function render(contracts: Contract[]): void {
    fixture = TestBed.createComponent(ActivitySummaryComponent);
    fixture.componentRef.setInput('customer', makeCustomer(1));
    fixture.componentRef.setInput('contracts', contracts);
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.removeItem(KEY);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    state = TestBed.inject(AppStateService);
  });

  describe('harvest windows', () => {
    const note = "Harvest contract pace couldn't be shown — the harvest windows couldn't be loaded. Refresh the page to try again.";

    it('says the pace could not be shown when the windows failed to load', () => {
      state.setHarvestWindowsLoadFailed(true);
      render([contract({})]);

      expect(text()).toContain(note);
    });

    it('adds nothing when the windows loaded empty', () => {
      render([contract({})]);

      expect(text()).not.toContain("Harvest contract pace couldn't be shown");
      expect(text()).toContain('On the contract side, they currently have 1 contract totaling 5,000 bushels.');
    });

    it('adds nothing for a producer with no contracts to pace', () => {
      state.setHarvestWindowsLoadFailed(true);
      render([]);

      expect(text()).not.toContain("Harvest contract pace couldn't be shown");
    });
  });

  describe('bushel conversions', () => {
    const tons = contract({ id: 2, contractNumber: '200', commodityCode: 'SB', unit: 'ST', quantity: 100 });

    it('counts the contracts left out of the bushel totals when the conversions failed to load', () => {
      state.setCommodityConversionsLoadFailed(true);
      render([contract({}), tons]);

      expect(text()).toContain("1 contract left out of the bushel totals — the bushel conversions couldn't be loaded. Refresh the page to try again.");
    });

    it('adds nothing when the conversions loaded', () => {
      state.setCommodityConversions([{ commodityCode: 'SB', lbsPerUnit: 60 }]);
      render([contract({}), tons]);

      expect(text()).not.toContain('left out of the bushel totals');
      expect(text()).toContain('On the contract side, they currently have 2 contracts totaling 8,333.333 bushels.');
    });

    it('adds nothing once conversions are present, whatever the flag says', () => {
      state.setCommodityConversionsLoadFailed(true);
      state.setCommodityConversions([{ commodityCode: 'SB', lbsPerUnit: 60 }]);
      render([contract({}), tons]);

      expect(text()).not.toContain('left out of the bushel totals');
    });

    it('adds nothing when nothing failed, even with no conversions in hand', () => {
      render([contract({}), tons]);

      expect(text()).not.toContain('left out of the bushel totals');
      expect(text()).toContain('On the contract side, they currently have 2 contracts totaling 5,000 bushels.');
    });

    it('adds nothing when every open contract is already in bushels', () => {
      state.setCommodityConversionsLoadFailed(true);
      render([contract({})]);

      expect(text()).not.toContain('left out of the bushel totals');
    });
  });
});
