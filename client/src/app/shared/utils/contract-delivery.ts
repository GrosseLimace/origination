import type { Contract } from '@models';

export interface ContractDeliveryStats {
  /** Bushels (or contract-native units) already delivered: contract.quantity − openBalanceQuantity. */
  delivered: number;
  /** Bushels (or contract-native units) still to deliver. 0 when isEffectivelyComplete. */
  remaining: number;
  /** 0–100. Reaches exactly 100 when isEffectivelyComplete. */
  progressPercent: number;
  /** Sub-0.1%-of-contract residue counts as fully delivered so a contract sitting at
   *  99.97% delivered shows as Filled instead of Active forever. */
  isEffectivelyComplete: boolean;
  /** True when openBalanceQuantity was null (not populated by CTRM yet) — caller can
   *  treat as "data missing, err on the side of flagging" rather than silently dropping. */
  remainingIsUnknown: boolean;
  /** Legacy field — always true today. Kept so callers that branched on `computable`
   *  keep compiling without behavior drift. */
  computable: true;
}

/** Single source of truth for contract Delivered / Remaining / Progress numbers across
 *  the app — contracts-table, activity-summary, customer-print-report, insights, the
 *  past-due util, the unshipped-bushels page, and anywhere else that needs to know how
 *  much of a contract is left.
 *
 *  Drives off CTRM's `openBalanceQuantity` aggregate (already in the contract's native
 *  unit; no lbs↔bushel conversion needed, no GNP024 lookup, no waiting for tickets).
 *
 *  Null vs zero handling:
 *  - `openBalanceQuantity === null` → CTRM hasn't populated the aggregate yet.
 *    Treat the contract as having `quantity` remaining (delivered = 0). Past-due
 *    gates will flag it rather than silently drop. `remainingIsUnknown: true`.
 *  - `openBalanceQuantity === 0` → CTRM says fully delivered. `isEffectivelyComplete`.
 *
 *  Completion rule: sub-0.1%-of-contract remainder counts as Filled and the residue
 *  folds into Delivered. Matches the contracts-table 100% rule that the rest of the
 *  app should agree with. */
export function getContractDeliveryStats(contract: Contract): ContractDeliveryStats {
  const qty = contract.quantity ?? 0;
  const rawRemainingRaw = contract.openBalanceQuantity;
  const remainingIsUnknown = rawRemainingRaw == null;
  // When CTRM hasn't populated the aggregate, assume nothing delivered (the conservative
  // choice — keeps the contract visible on past-due alerts instead of silently filing it
  // as complete).
  const rawRemaining = remainingIsUnknown ? qty : rawRemainingRaw!;
  // Floor the threshold at 0.01. Without it a contract with quantity 0 would get a threshold of 0,
  // and `0 < 0` would leave it open forever at 0% with nothing to deliver, listed on Unshipped
  // Bushels and flagged past due. With it, a quantity-0 contract with no open balance (0 or not
  // populated) counts as complete; one with a positive open balance stays open.
  const threshold = Math.max(0.01, qty * 0.001);
  const isEffectivelyComplete = rawRemaining < threshold;
  const remaining = isEffectivelyComplete ? 0 : rawRemaining;
  // When the residue is folded into Delivered, Delivered + Remaining still = qty.
  // Negative rawRemaining (CTRM has the contract over-delivered) surfaces the real
  // delivered amount instead of capping at qty.
  const delivered = isEffectivelyComplete
    ? (rawRemaining < 0 ? qty - rawRemaining : qty)
    : Math.max(0, qty - remaining);
  const progressPercent = isEffectivelyComplete
    ? 100
    : (qty > 0 ? Math.min(100, (delivered / qty) * 100) : 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    delivered: round2(delivered),
    remaining: round2(remaining),
    progressPercent,
    isEffectivelyComplete,
    remainingIsUnknown,
    computable: true,
  };
}
