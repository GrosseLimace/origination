import { describe, it, expect } from 'vitest';
import { DpContract } from '@models';
import {
  dpDistinctDeliveries,
  dpDeliveryCount,
  dpTotalBushels,
  dpUnconvertedCount,
  dpTotalCharges,
  dpBreakdownByCrop,
  dpContractCount,
} from './dp-aggregate';

function makeDp(over: Partial<DpContract> = {}): DpContract {
  return {
    id: 'H|370145||316657104|1340|2',
    ticketKey: 'H|370145||316657104|1340',
    ticketNumber: '370145',
    contractNumber: 'PCPL84649',
    contractPrefixType: 'P',
    contractPrefixCommodity: 'C',
    contractSuffix: 'A',
    ticketStatus: 'U/L',
    customerId: 1,
    customerCode: 'ABCFARM',
    tradeUnitCode: '1340',
    crop: 'YC',
    quantity: 812.5,
    grossQuantity: 812.5,
    quantityUom: 'BU',
    bushels: 812.5,
    storageDays: 259,
    decideFreeDays: 0,
    storageRate: 0.3,
    receivableAmount: 243.75,
    prepaidAmount: 0,
    unearnedStorageAmount: 0,
    unpaidHandlingAmount: 0,
    storageStartDate: new Date('2025-08-19'),
    chargedFromDate: new Date('2025-08-19'),
    chargedThruDate: new Date('2025-12-31'),
    paidThruDate: new Date('2025-08-19'),
    bolDate: new Date('2025-08-19'),
    status: '2',
    statusDescription: 'INITIAL CHARGE 2 - CHARGE/BU/D',
    storageProgramCode: 'D25',
    storageErrorFlag: '',
    storageErrorDescription: '',
    ...over,
  };
}

/**
 * The reference case, straight from prod: ticket 370145 appears TWICE in one run — a flat initial
 * charge and an accruing regular storage rate — both carrying quantity 812.50 BU.
 */
const REFERENCE_TICKET: DpContract[] = [
  makeDp({ id: 'H|370145||316657104|1340|2', status: '2', statusDescription: 'INITIAL CHARGE 2 - CHARGE/BU/D', storageRate: 0.3, receivableAmount: 243.75 }),
  makeDp({ id: 'H|370145||316657104|1340|S', status: 'S', statusDescription: 'REGULAR STG RATE', storageRate: 0.001667, receivableAmount: 170.66 }),
];

describe('dp-aggregate', () => {
  it('collapses a delivery\'s charge rows to one entry', () => {
    expect(dpDistinctDeliveries(REFERENCE_TICKET)).toHaveLength(1);
    expect(dpDeliveryCount(REFERENCE_TICKET)).toBe(1);
  });

  it('counts bushels ONCE per delivery, not per charge row', () => {
    // The regression this helper exists to prevent: naive summing yields 1,625 bu for 812.5 bu.
    expect(dpTotalBushels(REFERENCE_TICKET)).toBe(812.5);
  });

  it('sums charges across every charge row, because charge types are additive', () => {
    expect(dpTotalCharges(REFERENCE_TICKET)).toBeCloseTo(414.41, 2);
  });

  it('derives a correct cents-per-bushel from the two combined', () => {
    const cents = (dpTotalCharges(REFERENCE_TICKET) / dpTotalBushels(REFERENCE_TICKET)) * 100;
    expect(cents).toBeCloseTo(51.0, 1);
  });

  it('adds bushels across genuinely different deliveries', () => {
    const rows = [
      ...REFERENCE_TICKET,
      makeDp({ id: 'H|370146||316657105|1340|2', ticketKey: 'H|370146||316657105|1340', ticketNumber: '370146', bushels: 100, receivableAmount: 30 }),
    ];

    expect(dpDeliveryCount(rows)).toBe(2);
    expect(dpTotalBushels(rows)).toBe(912.5);
  });

  it('excludes unconvertible deliveries from the bushel total and counts them', () => {
    const rows = [
      makeDp({ id: 'a|1', ticketKey: 'a', bushels: 500 }),
      makeDp({ id: 'b|1', ticketKey: 'b', bushels: null, quantity: 99_999, quantityUom: 'XX' }),
    ];

    expect(dpTotalBushels(rows)).toBe(500);
    expect(dpUnconvertedCount(rows)).toBe(1);
  });

  it('groups a keyless row on its own id rather than collapsing keyless rows together', () => {
    const rows = [
      makeDp({ id: 'x', ticketKey: '', bushels: 10 }),
      makeDp({ id: 'y', ticketKey: '', bushels: 20 }),
    ];

    expect(dpDeliveryCount(rows)).toBe(2);
    expect(dpTotalBushels(rows)).toBe(30);
  });

  it('breaks down by crop with per-delivery bushels, sorted descending', () => {
    const rows = [
      ...REFERENCE_TICKET, // YC, 812.5 bu across 2 charge rows
      makeDp({ id: 's|1', ticketKey: 's', crop: 'SOY', bushels: 1000, receivableAmount: 10 }),
    ];

    const breakdown = dpBreakdownByCrop(rows);

    expect(breakdown.map(b => b.crop)).toEqual(['SOY', 'YC']);
    expect(breakdown.find(b => b.crop === 'YC')!.bushels).toBe(812.5);
    expect(breakdown.find(b => b.crop === 'YC')!.charges).toBeCloseTo(414.41, 2);
  });

  it('counts contracts, not commodities — 8 contracts over 2 crops reads as 8', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) =>
        makeDp({ id: `c${i}`, ticketKey: `c${i}`, crop: 'YC', contractNumber: `PCPL${i}` })),
      ...Array.from({ length: 4 }, (_, i) =>
        makeDp({ id: `s${i}`, ticketKey: `s${i}`, crop: 'YSB', contractNumber: `PCPS${i}` })),
    ];

    expect(dpContractCount(rows)).toBe(8);
  });

  it('counts a contract once no matter how many tickets or charge rows it carries', () => {
    // The reference ticket is 2 charge rows on 1 contract.
    expect(dpContractCount(REFERENCE_TICKET)).toBe(1);
  });

  it('buckets rows with no contract number together', () => {
    const rows = [
      makeDp({ id: 'a', ticketKey: 'a', contractNumber: '' }),
      makeDp({ id: 'b', ticketKey: 'b', contractNumber: '   ' }),
      makeDp({ id: 'c', ticketKey: 'c', contractNumber: 'PCPL1' }),
    ];

    expect(dpContractCount(rows)).toBe(2);
  });

  it('returns zeroes for an empty set', () => {
    expect(dpTotalBushels([])).toBe(0);
    expect(dpTotalCharges([])).toBe(0);
    expect(dpDeliveryCount([])).toBe(0);
    expect(dpBreakdownByCrop([])).toEqual([]);
  });
});
