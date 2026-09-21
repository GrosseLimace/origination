import type { Contract, CommodityConversion } from '@models';
import { getContractDeliveryStats } from './contract-delivery';

/** Builds a commodityCode (uppercase, trimmed) → lbsPerBushel map from CommodityConversion
 *  rows. Used by ticket-view-filter helpers that still need lbs↔bushel conversion for
 *  per-ticket quality math (delivery stats no longer need it — they use openBalanceQuantity). */
export function buildConversionMap(conversions: readonly CommodityConversion[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of conversions) {
    if (!c.commodityCode) continue;
    map.set(c.commodityCode.trim().toUpperCase(), c.lbsPerUnit);
  }
  return map;
}

/** Returns true if a contract should be treated as "unconfirmed" — same rule used by the
 *  Insights "Unconfirmed Contracts" category and the contracts-table red highlight. A contract
 *  counts as unconfirmed when its `customerConfirmStatus` is anything other than "confirmed"
 *  (case-insensitive, trimmed), AND its status isn't Fulfilled/Cancelled (those are terminal —
 *  no point asking the customer to confirm a contract that's already done or dead). */
export function isContractUnconfirmed(contract: Contract): boolean {
  const confirmStatus = (contract.customerConfirmStatus || '').trim().toLowerCase();
  if (confirmStatus === 'confirmed') return false;
  if (contract.status === 'Fulfilled' || contract.status === 'Cancelled') return false;
  return true;
}

/** Returns true only when the customer has positively confirmed the contract.
 *
 *  Deliberately NOT the inverse of `isContractUnconfirmed`: that one also returns false for
 *  Fulfilled/Cancelled contracts, on the grounds that there's no point chasing a confirmation for
 *  a contract that's already done. Terminal-and-never-confirmed is not the same as confirmed, so
 *  negating it would count those as confirmed and widen any "confirmed contracts" query. Trimmed
 *  and case-insensitive, matching the unconfirmed rule. */
export function isContractCustomerConfirmed(contract: Contract): boolean {
  return (contract.customerConfirmStatus || '').trim().toLowerCase() === 'confirmed';
}

/** Returns true if `contract` is past its delivery end date AND still has unshipped bushels.
 *  Delegates to the shared `getContractDeliveryStats` util so this rule is identical to what
 *  contracts-table / activity-summary / insights / customer-print-report show — no separate
 *  ticket math, no GNP024 lookup, no commodity-conversion drift. */
export function isContractOverdueWithUnshippedBu(contract: Contract, today: Date): boolean {
  if (!contract.deliveryEnd) return false;
  const deliveryEnd = new Date(contract.deliveryEnd);
  if (isNaN(deliveryEnd.getTime()) || deliveryEnd >= today) return false;
  if (!(contract.status === 'Active' || contract.status === 'Pending' || contract.status === 'Overdue')) return false;
  return !getContractDeliveryStats(contract).isEffectivelyComplete;
}

/** Year-over-year booked-bushel pacing for one producer, as a percentage, or `null` when it can't
 *  be computed (no contracts, no delivery years, or nothing booked in the prior year to compare
 *  against). Negative means behind last year's pace at the same point in the calendar.
 *
 *  Takes ALL of the producer's contracts, deliberately — not just the open ones. Pacing asks "how
 *  much have they booked", and closing or fulfilling a contract doesn't un-book it. Filtering to
 *  open contracts also all but guarantees a null result, since last year's contracts are closed by
 *  now, which is exactly how the free-text pacing query and the refine-panel checkbox drifted into
 *  giving different answers to the same question. One rule, both call sites. */
export function computeHarvestPacePct(customerContracts: readonly Contract[], today: Date): number | null {
  if (customerContracts.length === 0) return null;

  // Pace against the producer's most recent delivery year, not the calendar year — crop years
  // straddle new year, and a producer with nothing booked yet for next year should still be
  // measured against the year they're actually delivering.
  let maxYear = 0;
  for (const ct of customerContracts) {
    if (ct.deliveryStart) {
      const y = new Date(ct.deliveryStart).getFullYear();
      if (y > maxYear) maxYear = y;
    }
  }
  if (maxYear === 0) return null;

  const thisYearBu = customerContracts
    .filter(ct => ct.deliveryStart && new Date(ct.deliveryStart).getFullYear() === maxYear)
    .reduce((s, ct) => s + (ct.quantity ?? 0), 0);

  // Only count prior-year contracts booked on or before this calendar date last year
  // (same-point-last-year comparison, matching the pacing card logic).
  const samePointLastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const lastYearBu = customerContracts
    .filter(ct => {
      if (!ct.deliveryStart || new Date(ct.deliveryStart).getFullYear() !== maxYear - 1) return false;
      if (!ct.contractDate) return true;
      return new Date(ct.contractDate) <= samePointLastYear;
    })
    .reduce((s, ct) => s + (ct.quantity ?? 0), 0);

  if (lastYearBu === 0) return null;
  return ((thisYearBu - lastYearBu) / lastYearBu) * 100;
}
