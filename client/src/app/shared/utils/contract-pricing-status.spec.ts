import { describe, it, expect } from 'vitest';
import type { Contract, ContractPricingLine } from '@models';
import { contractPricingInfo } from './contract-pricing-status';

const contract = (over: Partial<Contract> = {}): Contract =>
  ({ id: 1, sourceContractId: 'PYC1', priceTypeCode: 'U', quantity: 10000, ...over }) as Contract;
const line = (over: Partial<ContractPricingLine> = {}): ContractPricingLine =>
  ({ contractId: 'PYC1', priceSequence: 1, priceQuantity: 0, ...over }) as ContractPricingLine;

/**
 * The pricing badge rule, shared by the contracts table and the customer print report. These pin
 * every branch, including the two the print report's old copy had lost: LOADING and the 1-bushel
 * tolerance.
 */
describe('contractPricingInfo', () => {
  it('waits (LOADING) while the pricing lines are not loaded, but not once they are', () => {
    expect(contractPricingInfo(contract(), undefined, false)).toEqual({ status: 'LOADING' });
    expect(contractPricingInfo(contract(), undefined, true)).toEqual({ status: 'UNPRICED' });
  });

  it('flat-priced (P): the cash price from the first line, else plain PRICED', () => {
    const p = contract({ priceTypeCode: ' p ' });
    expect(contractPricingInfo(p, [line({ priceSequence: 0, flatPrice: 4.25 })], true)).toEqual({ status: 'FLAT', cashPrice: 4.25 });
    expect(contractPricingInfo(p, [], true)).toEqual({ status: 'PRICED' });
  });

  it('deferred (D)', () => {
    expect(contractPricingInfo(contract({ priceTypeCode: 'D' }), [], true)).toEqual({ status: 'DEFERRED' });
  });

  it('unpriced (U): PARTIAL while more than a bushel remains, PRICED once covered', () => {
    expect(contractPricingInfo(contract(), [line({ priceQuantity: 4000 })], true)).toEqual({ status: 'PARTIAL' });
    expect(contractPricingInfo(contract(), [line({ priceQuantity: 10000 })], true)).toEqual({ status: 'PRICED' });
    expect(contractPricingInfo(contract(), [line({ priceQuantity: 12000 })], true)).toEqual({ status: 'PRICED' });
  });

  it('treats a float sum within one bushel of the quantity as fully priced', () => {
    const lines = [line({ priceQuantity: 3333.3333 }), line({ priceSequence: 2, priceQuantity: 6666.6666 })];
    expect(contractPricingInfo(contract(), lines, true)).toEqual({ status: 'PRICED' });
    // One bushel short is the boundary: still priced. More than that is partial.
    expect(contractPricingInfo(contract(), [line({ priceQuantity: 9999 })], true)).toEqual({ status: 'PRICED' });
    expect(contractPricingInfo(contract(), [line({ priceQuantity: 9998.5 })], true)).toEqual({ status: 'PARTIAL' });
  });

  it('only counts priced quantity once a line with a real sequence exists', () => {
    expect(contractPricingInfo(contract(), [line({ priceSequence: 0, priceQuantity: 10000 })], true)).toEqual({ status: 'UNPRICED' });
  });

  it('surfaces a single unpriced line\'s basis, but not a zero basis or an ambiguous multi-line one', () => {
    expect(contractPricingInfo(contract(), [line({ priceSequence: 0, basisPrice: -0.35 })], true))
      .toEqual({ status: 'UNPRICED', basisPrice: -0.35 });
    expect(contractPricingInfo(contract(), [line({ priceSequence: 0, basisPrice: 0 })], true)).toEqual({ status: 'UNPRICED' });
    expect(contractPricingInfo(contract(), [line({ priceSequence: 0, basisPrice: -0.35 }), line({ priceSequence: 0 })], true))
      .toEqual({ status: 'UNPRICED' });
  });

  it('defaults to UNPRICED with no price type at all', () => {
    expect(contractPricingInfo(contract({ priceTypeCode: undefined }), [], true)).toEqual({ status: 'UNPRICED' });
  });
});
