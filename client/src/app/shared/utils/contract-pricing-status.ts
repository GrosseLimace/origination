import { Contract, ContractPricingLine } from '@models';

/** The pricing badge for one contract. ERROR is set by the contracts table when the pricing-line
 *  read itself failed; this function never returns it. */
export type ContractPricingInfo = {
  status: 'UNPRICED' | 'PARTIAL' | 'PRICED' | 'FLAT' | 'DEFERRED' | 'LOADING' | 'ERROR';
  cashPrice?: number;
  basisPrice?: number;
};

/**
 * Whether a contract is priced, and at what, from its PriceTypeCode and its CTRM pricing lines.
 *
 * The one place this rule lives. The contracts table and the customer print report each had a copy,
 * and the print report's had drifted: it had no 1-bushel tolerance (so a contract priced to within a
 * float rounding of its quantity printed PARTIAL while the table showed PRICED) and no LOADING state.
 *
 * `lines` is this contract's pricing lines, or undefined when none are indexed for it; `linesLoaded`
 * tells "no lines yet" from "no lines at all".
 */
export function contractPricingInfo(
  contract: Contract,
  lines: ContractPricingLine[] | undefined,
  linesLoaded: boolean,
): ContractPricingInfo {
  const ptc = (contract.priceTypeCode ?? '').trim().toUpperCase();

  // Pricing lines not loaded yet — wait
  if (lines === undefined && !linesLoaded) return { status: 'LOADING' };
  const safeLines = lines ?? [];
  const hasLines = safeLines.length > 0;

  // Flat pricing — PriceTypeCode is 'P', show the cash price from pricing line if available
  if (ptc === 'P') {
    if (hasLines && safeLines[0].flatPrice != null) {
      return { status: 'FLAT', cashPrice: safeLines[0].flatPrice };
    }
    return { status: 'PRICED' };
  }

  // Deferred pricing — special type
  if (ptc === 'D') {
    return { status: 'DEFERRED' };
  }

  // Unpriced — check if pricing has started via pricing lines with sequence > 0
  if (ptc === 'U') {
    if (hasLines) {
      const hasSequence = safeLines.some(l => (l.priceSequence ?? 0) > 0);
      if (hasSequence) {
        const totalPricedQty = safeLines.reduce((sum, l) => sum + (l.priceQuantity ?? 0), 0);
        const contractQty = contract.quantity ?? 0;
        // 1-bushel tolerance — float sums of priceQuantity can miss the contractQty target
        // by epsilon (e.g. 99999.9999 vs 100000) and flip the badge to PARTIAL when it's
        // actually fully priced. One bushel is below merchandiser-meaningful rounding.
        const remaining = contractQty - totalPricedQty;
        if (totalPricedQty > 0 && remaining > 1) return { status: 'PARTIAL' };
        if (remaining <= 1) return { status: 'PRICED' };
      }
    }
    // Single-line unpriced contract with a real basis on file: surface the basis number
    // alongside the UNPRICED state so the user sees the locked-in basis without
    // having to expand the row. Multiple lines still show plain UNPRICED — the
    // line ambiguity is the reason for the badge in the first place. Exclude 0 because
    // CTRM stores no-basis-yet as 0; rendering "$0.00/Bu" would look like a real lock.
    if (safeLines.length === 1 && safeLines[0].basisPrice != null && safeLines[0].basisPrice !== 0) {
      return { status: 'UNPRICED', basisPrice: safeLines[0].basisPrice };
    }
    return { status: 'UNPRICED' };
  }

  // No PriceTypeCode (NULL) — rare, default to unpriced
  return { status: 'UNPRICED' };
}
