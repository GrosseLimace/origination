import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { ActivitySummaryComponent } from './activity-summary.component';
import { AppStateService } from '@core/services/app-state.service';
import { CommodityConversion, Customer, Ticket } from '@models';

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
      providers: [{ provide: AppStateService, useValue: { harvestWindows: signal([]), commodityConversions: conversions } }],
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
