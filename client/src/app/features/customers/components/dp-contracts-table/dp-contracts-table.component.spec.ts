import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
    contractNumber: 'PCPL84649',
    contractPrefixType: 'P',
    contractPrefixCommodity: 'C',
    contractSuffix: 'A',
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
  /** Needed to flush the auto-expand effect — computeds are sync, effects are not. */
  let fixture: ComponentFixture<DpContractsTableComponent>;

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
    fixture = TestBed.createComponent(DpContractsTableComponent);
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

  it('nests contracts under the crop group, with tickets under each contract', () => {
    // The real prod shape: 4 corn tickets on one contract, 2 soybean tickets on another.
    ref.setInput('dpContracts', [
      makeDelivery('c1', { crop: 'YC', contractNumber: 'PCPL84649', bushels: 100, receivableAmount: 10 }),
      makeDelivery('c2', { crop: 'YC', contractNumber: 'PCPL84649', bushels: 200, receivableAmount: 20 }),
      makeDelivery('s1', { crop: 'YSB', contractNumber: 'PCPL83903', bushels: 300, receivableAmount: 30 }),
    ]);

    // Groups sort by crop: YC before YSB.
    const [yc, ysb] = component.groups();

    expect(yc.crop).toBe('YC');
    expect(yc.contractCount).toBe(1);
    expect(yc.contracts[0].contractNumber).toBe('PCPL84649');
    expect(yc.contracts[0].deliveryCount).toBe(2);
    expect(yc.contracts[0].totalBushels).toBe(300);
    expect(ysb.contracts[0].contractNumber).toBe('PCPL83903');
  });

  it('splits a crop across several contracts and totals each separately', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { crop: 'YC', contractNumber: 'PCPL111', bushels: 100, receivableAmount: 10 }),
      makeDelivery('b', { crop: 'YC', contractNumber: 'PCPL222', bushels: 400, receivableAmount: 40 }),
    ]);

    const group = component.groups()[0];

    expect(group.contractCount).toBe(2);
    expect(group.totalBushels).toBe(500);            // group still totals across contracts
    expect(group.contracts.map(c => c.totalBushels)).toEqual([100, 400]);
  });

  it('auto-expands a lone contract so the extra level costs no click', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { crop: 'YC', contractNumber: 'PCPL84649' }),
      makeDelivery('b', { crop: 'YC', contractNumber: 'PCPL84649' }),
    ]);
    fixture.detectChanges(); // flush the auto-expand effect

    const contract = component.groups()[0].contracts[0];

    expect(component.isContractExpanded(contract.key)).toBe(true);
  });

  it('leaves multiple contracts collapsed so they can be compared', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { crop: 'YC', contractNumber: 'PCPL111' }),
      makeDelivery('b', { crop: 'YC', contractNumber: 'PCPL222' }),
    ]);
    fixture.detectChanges();

    for (const c of component.groups()[0].contracts) {
      expect(component.isContractExpanded(c.key)).toBe(false);
    }
  });

  it('orders contracts oldest-first by their Since date', () => {
    ref.setInput('dpContracts', [
      makeDelivery('mid', { crop: 'YC', contractNumber: 'PCPL222', chargedFromDate: new Date('2025-06-01') }),
      makeDelivery('new', { crop: 'YC', contractNumber: 'PCPL333', chargedFromDate: new Date('2026-01-15') }),
      makeDelivery('old', { crop: 'YC', contractNumber: 'PCPL111', chargedFromDate: new Date('2024-11-20') }),
    ]);

    expect(component.groups()[0].contracts.map(c => c.contractNumber))
      .toEqual(['PCPL111', 'PCPL222', 'PCPL333']);
  });

  it('orders by date, not by contract number', () => {
    // A high-numbered contract that started earlier must still lead.
    ref.setInput('dpContracts', [
      makeDelivery('a', { crop: 'YC', contractNumber: 'PCPL111', chargedFromDate: new Date('2026-05-01') }),
      makeDelivery('b', { crop: 'YC', contractNumber: 'PCPL999', chargedFromDate: new Date('2025-01-01') }),
    ]);

    expect(component.groups()[0].contracts.map(c => c.contractNumber)).toEqual(['PCPL999', 'PCPL111']);
  });

  it('falls back to contract number when Since dates tie', () => {
    const same = new Date('2025-08-20');
    ref.setInput('dpContracts', [
      makeDelivery('b', { crop: 'YC', contractNumber: 'PCPL222', chargedFromDate: same }),
      makeDelivery('a', { crop: 'YC', contractNumber: 'PCPL111', chargedFromDate: same }),
    ]);

    expect(component.groups()[0].contracts.map(c => c.contractNumber)).toEqual(['PCPL111', 'PCPL222']);
  });

  it('uses a contract\'s EARLIEST ticket date as its Since date', () => {
    ref.setInput('dpContracts', [
      makeDp({ id: 'x1', ticketKey: 'x1', contractNumber: 'PCPL111', chargedFromDate: new Date('2026-03-01') }),
      makeDp({ id: 'x2', ticketKey: 'x2', contractNumber: 'PCPL111', chargedFromDate: new Date('2025-09-09') }),
    ]);

    expect(component.groups()[0].contracts[0].earliestDate).toEqual(new Date('2025-09-09'));
  });

  it('labels a row with no contract number rather than dropping it', () => {
    ref.setInput('dpContracts', [makeDelivery('a', { contractNumber: '' })]);

    expect(component.groups()[0].contracts[0].contractNumber).toBe('No contract');
  });

  it('drops a contract entirely when the search filters out all of its tickets', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { crop: 'YC', contractNumber: 'PCPL111', ticketNumber: '100' }),
      makeDelivery('b', { crop: 'YC', contractNumber: 'PCPL222', ticketNumber: '200' }),
    ]);
    component.searchQuery.set('100');

    const group = component.groups()[0];

    expect(group.contractCount).toBe(1);
    expect(group.contracts[0].contractNumber).toBe('PCPL111');
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

  it('groups strictly by commodity — there is no location dimension', () => {
    // vw_GNTA70D1 has no elevator/facility code, so the only location signal was the trade unit the
    // user already selected. Rows differing in nothing but trade unit stay in ONE commodity group.
    ref.setInput('dpContracts', [
      makeDelivery('a', { crop: 'YC', tradeUnitCode: '1085' }),
      makeDelivery('b', { crop: 'YC', tradeUnitCode: '2115' }),
    ]);

    const groups = component.groups();

    expect(groups).toHaveLength(1);
    expect(groups[0].crop).toBe('YC');
    expect(groups[0].deliveryCount).toBe(2);
  });

  describe('search', () => {
    beforeEach(() => {
      ref.setInput('dpContracts', [
        makeDelivery('a', { crop: 'YC', contractNumber: 'PCPL84649', ticketNumber: '370285', chargedFromDate: new Date('2025-08-20') }),
        makeDelivery('b', { crop: 'YSB', contractNumber: 'PCPL83903', ticketNumber: '250057', chargedFromDate: new Date('2025-08-05') }),
      ]);
    });

    it('reveals matches even when the groups were collapsed', () => {
      // Two groups means neither auto-expands; a search must still show what it found rather than
      // leaving it behind a closed header.
      fixture.detectChanges();
      const group = component.groups()[0];
      expect(component.isExpanded(group.key)).toBe(false);

      component.searchQuery.set('370285');

      const matched = component.groups()[0];
      expect(component.isExpanded(matched.key)).toBe(true);
      expect(component.isContractExpanded(matched.contracts[0].key)).toBe(true);
    });

    it('matches the full contract id including the prefix', () => {
      component.searchQuery.set('PCPL84649');
      expect(component.groups()).toHaveLength(1);
      expect(component.groups()[0].contracts[0].contractNumber).toBe('PCPL84649');
    });

    it('matches a contract number typed without the prefix', () => {
      component.searchQuery.set('84649');
      expect(component.groups()[0].contracts[0].contractNumber).toBe('PCPL84649');
    });

    it('matches on commodity', () => {
      component.searchQuery.set('YSB');
      expect(component.groups()[0].crop).toBe('YSB');
    });

    it('matches on the charged-from date as displayed', () => {
      // Dates must be built the way the API sends them — "2025-08-20T00:00:00", no offset, which JS
      // parses as LOCAL midnight. A date-only string ("2025-08-20") parses as UTC instead and shifts
      // a day back in any negative-offset timezone.
      ref.setInput('dpContracts', [
        makeDelivery('a', { crop: 'YC', chargedFromDate: new Date('2025-08-20T00:00:00') }),
      ]);

      component.searchQuery.set('8/20/2025');

      expect(component.groups()[0].crop).toBe('YC');
    });

    it('is case-insensitive', () => {
      component.searchQuery.set('pcpl84649');
      expect(component.groups()).toHaveLength(1);
    });

    it('returns nothing for a term that matches no row', () => {
      component.searchQuery.set('zzzznope');
      expect(component.groups()).toEqual([]);
    });

    it('restores every group when the search is cleared', () => {
      component.searchQuery.set('370285');
      expect(component.groups()).toHaveLength(1);

      component.clearSearch();

      expect(component.groups()).toHaveLength(2);
    });

    it('keeps contract ordering oldest-first within a search', () => {
      ref.setInput('dpContracts', [
        makeDelivery('n', { crop: 'YC', contractNumber: 'PCPL222', ticketNumber: '11', chargedFromDate: new Date('2026-02-01') }),
        makeDelivery('o', { crop: 'YC', contractNumber: 'PCPL111', ticketNumber: '12', chargedFromDate: new Date('2025-02-01') }),
      ]);
      component.searchQuery.set('YC');

      expect(component.groups()[0].contracts.map(c => c.contractNumber)).toEqual(['PCPL111', 'PCPL222']);
    });
  });

  it('filters by ticket number and contract number', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { ticketNumber: '100', contractNumber: 'PW 111' }),
      makeDelivery('b', { ticketNumber: '200', contractNumber: 'PW 222' }),
    ]);

    component.searchQuery.set('200');
    expect(component.groups()[0].positions.map(p => p.id)).toEqual(['b|2']);

    component.searchQuery.set('PW 111');
    expect(component.groups()[0].positions.map(p => p.id)).toEqual(['a|2']);
  });

  it('rebuilds group totals from the matched rows when searching', () => {
    ref.setInput('dpContracts', [
      makeDelivery('a', { ticketNumber: '100', bushels: 1000 }),
      makeDelivery('b', { ticketNumber: '200', bushels: 500 }),
    ]);
    component.searchQuery.set('100');

    expect(component.groups()[0].totalBushels).toBe(1000);
  });

  describe('charge-line pairing', () => {
    /** The real prod shape: initial charge dated Aug-Dec, accruing storage rate dated Jan-now. */
    function ticket(num: string, over: Partial<DpContract> = {}): DpContract[] {
      const key = `H|${num}||1|1340`;
      return [
        makeDp({ id: `${key}|2`, ticketKey: key, ticketNumber: num, status: '2',
                 statusDescription: 'INITIAL CHARGE 2 - CHARGE/BU/D', storageRate: 0.3,
                 chargedFromDate: new Date('2025-08-20'), chargedThruDate: new Date('2025-12-31'),
                 ...over }),
        makeDp({ id: `${key}|S`, ticketKey: key, ticketNumber: num, status: 'S',
                 statusDescription: 'REGULAR STG RATE', storageRate: 0.001667,
                 chargedFromDate: new Date('2026-01-01'), chargedThruDate: new Date('2026-08-04'),
                 ...over }),
      ];
    }

    it('keeps a ticket\'s two charge rows adjacent, initial first', () => {
      // Before the fix this listed both initial charges, THEN both storage charges.
      const rows = [...ticket('370285'), ...ticket('370295')];

      const sorted = component.sortedPositions(rows);

      expect(sorted.map(r => `${r.ticketNumber}/${r.status}`))
        .toEqual(['370285/2', '370285/S', '370295/2', '370295/S']);
    });

    it('keeps rows paired even when the source order interleaves them', () => {
      const [aInit, aReg] = ticket('370285');
      const [bInit, bReg] = ticket('370295');
      const rows = [aReg, bInit, bReg, aInit]; // deliberately scrambled

      const sorted = component.sortedPositions(rows);

      expect(sorted.map(r => `${r.ticketNumber}/${r.status}`))
        .toEqual(['370285/2', '370285/S', '370295/2', '370295/S']);
    });

    it('flips ticket order on desc but never the lines within a ticket', () => {
      const rows = [...ticket('370285'), ...ticket('370295')];
      component.handleSort('ticket');   // asc
      component.handleSort('ticket');   // desc

      const sorted = component.sortedPositions(rows);

      // Tickets reversed; initial still above accrued inside each.
      expect(sorted.map(r => `${r.ticketNumber}/${r.status}`))
        .toEqual(['370295/2', '370295/S', '370285/2', '370285/S']);
    });

    it('sorts by amount on the ticket total, not a single charge line', () => {
      // Small ticket has the bigger SINGLE line; big ticket has the bigger TOTAL.
      const small = ticket('1'); small[0].receivableAmount = 300; small[1].receivableAmount = 0;
      const big = ticket('2');   big[0].receivableAmount = 200;   big[1].receivableAmount = 200;
      component.handleSort('amount'); // asc

      const sorted = component.sortedPositions([...big, ...small]);

      expect(sorted[0].ticketNumber).toBe('1'); // 300 total sorts below 400 total
      expect(sorted.map(r => r.ticketNumber)).toEqual(['1', '1', '2', '2']);
    });
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
