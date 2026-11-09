import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Contract, HarvestWindow } from '@models';
import { contractMatchesPacingCommodity, contractOverlapsWindow, customerPacingDirection } from './contract-pacing';

const CORN: HarvestWindow = { id: 1, commodity: 'Corn', deliveryStartMonth: 9, deliveryStartDay: 1, deliveryEndMonth: 11, deliveryEndDay: 30, isActive: true };
const BEANS: HarvestWindow = { id: 2, commodity: 'Soybeans', deliveryStartMonth: 9, deliveryStartDay: 15, deliveryEndMonth: 10, deliveryEndDay: 31, isActive: true };

function contract(over: Partial<Contract>): Contract {
  return {
    id: 1, customerId: 1, ctrmCustomerId: 'C1', sourceContractId: 'P1', farmId: 'F', contractNumber: '1', contractPrefixType: 'P',
    commodityCode: 'YC', commodityDescription: 'Corn', commodityGroup: 'Corn', quantity: 1000, unit: 'bushels', price: 0,
    status: 'Active', signed: true, ...over,
  } as Contract;
}
const inOct = (year: number, quantity: number, over: Partial<Contract> = {}) =>
  contract({ deliveryStart: new Date(year, 9, 10), deliveryEnd: new Date(year, 9, 20), quantity, ...over });

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00')); });
afterEach(() => vi.useRealTimers());

describe('customerPacingDirection', () => {
  it('is null with no contracts, no active windows, or nothing in any window', () => {
    expect(customerPacingDirection([], [CORN])).toBeNull();
    expect(customerPacingDirection([inOct(2026, 1)], [{ ...CORN, isActive: false }])).toBeNull();
    expect(customerPacingDirection([inOct(2024, 1)], [CORN])).toBeNull();
  });

  it('down when this year trails last year, up when ahead, flat when level', () => {
    expect(customerPacingDirection([inOct(2026, 5), inOct(2025, 9)], [CORN])).toBe('down');
    expect(customerPacingDirection([inOct(2026, 9), inOct(2025, 5)], [CORN])).toBe('up');
    expect(customerPacingDirection([inOct(2026, 5), inOct(2025, 5)], [CORN])).toBe('flat');
  });

  it('any commodity behind makes the producer down, even if another is ahead', () => {
    const beans = { commodityCode: 'SB', commodityDescription: 'Soybeans', commodityGroup: 'Soybeans' };
    const contracts = [inOct(2026, 9), inOct(2025, 5), inOct(2026, 1, beans), inOct(2025, 2, beans)];
    expect(customerPacingDirection(contracts, [CORN, BEANS])).toBe('down');
  });

  it('a window with no isActive flag counts as active', () => {
    const { isActive: _ignored, ...noFlag } = CORN;
    expect(customerPacingDirection([inOct(2026, 9)], [noFlag as HarvestWindow])).toBe('up');
  });
});

describe('contractOverlapsWindow', () => {
  it('overlaps on any shared day, inclusive of the window\'s last day', () => {
    expect(contractOverlapsWindow(contract({ deliveryStart: new Date(2026, 7, 1), deliveryEnd: new Date(2026, 8, 1) }), CORN, 2026)).toBe(true);
    expect(contractOverlapsWindow(contract({ deliveryStart: new Date(2026, 10, 30, 18), deliveryEnd: new Date(2026, 11, 5) }), CORN, 2026)).toBe(true);
    expect(contractOverlapsWindow(contract({ deliveryStart: new Date(2026, 11, 1), deliveryEnd: new Date(2026, 11, 5) }), CORN, 2026)).toBe(false);
    expect(contractOverlapsWindow(inOct(2026, 1), CORN, 2025)).toBe(false);
  });

  it('treats a single delivery date as one day, and no dates as no overlap', () => {
    expect(contractOverlapsWindow(contract({ deliveryStart: undefined, deliveryEnd: new Date(2026, 9, 1) }), CORN, 2026)).toBe(true);
    expect(contractOverlapsWindow(contract({ deliveryStart: new Date(2026, 9, 1), deliveryEnd: undefined }), CORN, 2026)).toBe(true);
    expect(contractOverlapsWindow(contract({ deliveryStart: undefined, deliveryEnd: undefined }), CORN, 2026)).toBe(false);
  });
});

describe('contractMatchesPacingCommodity', () => {
  it('matches the exact group, or the commodity inside the description or code', () => {
    expect(contractMatchesPacingCommodity(contract({ commodityGroup: 'corn' }), ' Corn ')).toBe(true);
    expect(contractMatchesPacingCommodity(contract({ commodityGroup: '', commodityDescription: 'YELLOW CORN #2' }), 'Corn')).toBe(true);
    expect(contractMatchesPacingCommodity(contract({ commodityGroup: '', commodityDescription: '', commodityCode: 'XCORNX' }), 'corn')).toBe(true);
    expect(contractMatchesPacingCommodity(contract({}), 'Wheat')).toBe(false);
    expect(contractMatchesPacingCommodity(contract({}), '  ')).toBe(false);
  });
});
