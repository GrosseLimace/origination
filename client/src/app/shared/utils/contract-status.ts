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
