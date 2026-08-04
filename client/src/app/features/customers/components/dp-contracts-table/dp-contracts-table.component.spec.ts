import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DpContractsTableComponent } from './dp-contracts-table.component';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, DpContract } from '@models';

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    name: 'Test Producer',
    farm: 'Test Farm',
    location: 'Adrian, MO',
    phone: '',
    email: '',
    totalAcres: 0,
    linkedProducerIds: [],
    eSignEnabled: false,
    achEnabled: false,
    ...over,
  } as Customer;
}

function makeDp(over: Partial<DpContract> = {}): DpContract {
  return {
    id: 'T|100|A|1|2115|2',
    ticketKey: 'T|100|A|1|2115',
    ticketNumber: '100',
    contractNumber: 'PL84649-A',
    contractPrefixType: 'P',
    contractPrefixCommodity: 'C',
    ticketStatus: 'U/L',
    customerId: 1,
    customerCode: 'C123',
    tradeUnitCode: '2115',
    crop: 'YC',
    quantity: 1000,
    grossQuantity: 1010,
    quantityUom: 'BU',
    bushels: 1000,
    storageDays: 30,
    decideFreeDays: 0,
    storageRate: 0.001,
    receivableAmount: 30,
    prepaidAmount: 0,
    unearnedStorageAmount: 0,
    unpaidHandlingAmount: 0,
    storageStartDate: new Date('2026-01-01'),
    chargedFromDate: new Date('2026-01-01'),
    chargedThruDate: new Date('2026-01-31'),
    paidThruDate: null,
    bolDate: new Date('2026-01-01'),
    status: 'A',
    statusDescription: 'Active',
    storageProgramCode: 'DP',
    storageErrorFlag: '',
    storageErrorDescription: '',
    locationName: 'Adrian, MO',
    ...over,
  };
}

/**
 * Distinct physical delivery. Overriding `id` alone would leave every row sharing the default
 * `ticketKey`, which the aggregation would (correctly) collapse into ONE delivery — so tests that
 * want separate deliveries go through this.
 */
function makeDelivery(key: string, over: Partial<DpContract> = {}): DpContract {
  return makeDp({ id: `${key}|2`, ticketKey: key, ...over });
}

describe('DpContractsTableComponent', () => {
  let component: DpContractsTableComponent;
  let ref: ComponentRef<DpContractsTableComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: UsageTrackingService, useValue: { trackDpContractsDropdownOpen: () => {} } },
      ],
    });
    // happy-dom + JIT can't fetch an external templateUrl, so strip the template.
    TestBed.overrideComponent(DpContractsTableComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(DpContractsTableComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer());
  });

  it('groups by crop by default and sums bushels', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { crop: 'YC', bushels: 1000 }),
      makeDelivery('b', { crop: 'YC', bushels: 500 }),
      makeDelivery('c', { crop: 'SOY', bushels: 200 }),
    ]);

    const groups = component.groups();

    expect(groups.map(g => g.crop)).toEqual(['SOY', 'YC']);
    expect(groups.find(g => g.crop === 'YC')!.totalBushels).toBe(1500);
  });

  it('counts one delivery\'s charge rows once for bushels but sums their charges', () => {
    // Straight from prod: ticket 370145 appears twice in one run — a flat initial charge and an
    // accruing regular storage rate — BOTH carrying quantity 812.50 BU for the same grain.
    ref.setInput('dpContracts', [
      makeDp({ id: 'H|370145||1|1340|2', ticketKey: 'H|370145||1|1340', status: '2', bushels: 812.5, receivableAmount: 243.75 }),
      makeDp({ id: 'H|370145||1|1340|S', ticketKey: 'H|370145||1|1340', status: 'S', bushels: 812.5, receivableAmount: 170.66 }),
    ]);

    const group = component.groups()[0];

    expect(group.positions).toHaveLength(2);   // both charge rows still listed
    expect(group.deliveryCount).toBe(1);       // ...but it is ONE ticket
    expect(group.totalBushels).toBe(812.5);    // not 1,625 — the bug this guards
    expect(group.totalCost).toBeCloseTo(414.41, 2); // charges ARE additive
  });

  it('excludes unconvertible rows from the bushel total and counts them instead', () => {
    // The rule: a null bushels means "we could not convert" — it must never be treated as the raw
    // quantity, and the group must disclose that its total is incomplete.
    ref.setInput('dpContracts', [
      makeDelivery('a', { crop: 'YC', bushels: 1000 }),
      makeDelivery('b', { crop: 'YC', bushels: null, quantity: 99_999, quantityUom: 'XX' }),
    ]);

    const group = component.groups()[0];

    expect(group.totalBushels).toBe(1000);
    expect(group.unconvertedCount).toBe(1);
    expect(group.positions).toHaveLength(2);
  });

  it('groups by location when the mode is switched', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { crop: 'YC', locationName: 'Adrian, MO' }),
      makeDelivery('b', { crop: 'SOY', locationName: 'Adrian, MO' }),
    ]);
    component.setGroupMode('location');

    const groups = component.groups();

    expect(groups).toHaveLength(1);
    expect(groups[0].location).toBe('Adrian, MO');
  });

  it('labels a blank location as "No location"', () => {
    ref.setInput('dpContracts', [makeDp({ locationName: '' })]);
    component.setGroupMode('location');

    expect(component.groups()[0].location).toBe('No location');
  });

  it('separates crop and location groups in "both" mode', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { crop: 'YC', locationName: 'Adrian, MO' }),
      makeDelivery('b', { crop: 'YC', locationName: 'Pratt, KS' }),
    ]);
    component.setGroupMode('both');

    expect(component.groups()).toHaveLength(2);
  });

  it('filters by ticket number, contract number, and location', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { ticketNumber: '100', contractNumber: 'PW 111', locationName: 'Adrian, MO' }),
      makeDelivery('b', { ticketNumber: '200', contractNumber: 'PW 222', locationName: 'Pratt, KS' }),
    ]);

    component.searchQuery.set('200');
    expect(component.groups()[0].positions.map(p => p.id)).toEqual(['b|2']);

    component.searchQuery.set('PW 111');
    expect(component.groups()[0].positions.map(p => p.id)).toEqual(['a|2']);

    component.searchQuery.set('pratt');
    expect(component.groups()[0].positions.map(p => p.id)).toEqual(['b|2']);
  });

  it('rebuilds group totals from the matched rows when searching', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { ticketNumber: '100', bushels: 1000 }),
      makeDelivery('b', { ticketNumber: '200', bushels: 500 }),
    ]);
    component.searchQuery.set('100');

    expect(component.groups()[0].totalBushels).toBe(1000);
  });

  it('cycles sort direction asc → desc → none on repeat clicks', () => {
    component.handleSort('netBu');
    expect(component.currentSortDirection).toBe('asc');

    component.handleSort('netBu');
    expect(component.currentSortDirection).toBe('desc');

    component.handleSort('netBu');
    expect(component.currentSortColumn).toBeNull();
    expect(component.currentSortDirection).toBe('none');
  });

  it('resets to ascending when a different column is sorted', () => {
    component.handleSort('netBu');
    component.handleSort('netBu');
    component.handleSort('amount');

    expect(component.currentSortColumn).toBe('amount');
    expect(component.currentSortDirection).toBe('asc');
  });

  it('sorts unconvertible rows below every real bushel figure', () => {
    const rows = [
      makeDelivery('null', { bushels: null }),
      makeDelivery('zero', { bushels: 0 }),
      makeDelivery('big', { bushels: 100 }),
    ];
    component.handleSort('netBu'); // asc

    const sorted = component.sortedPositions(rows);

    expect(sorted.map(r => r.ticketKey)).toEqual(['null', 'zero', 'big']);
  });

  it('defaults to charged-from date then ticket number', () => {
    const rows = [
      makeDelivery('later', { ticketNumber: '5', chargedFromDate: new Date('2026-02-01') }),
      makeDelivery('earlyHighTicket', { ticketNumber: '20', chargedFromDate: new Date('2026-01-01') }),
      makeDelivery('earlyLowTicket', { ticketNumber: '3', chargedFromDate: new Date('2026-01-01') }),
    ];

    const sorted = component.sortedPositions(rows);

    expect(sorted.map(r => r.ticketKey)).toEqual(['earlyLowTicket', 'earlyHighTicket', 'later']);
  });
});
