import type { Contract, Ticket, CommodityConversion } from '@models';

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

/** Builds the per-contract applied-pounds maps used by overdue-bu / fulfillment math.
 *  Mirrors the priority used by the Contracts Table getAppliedTickets matcher: string match
 *  on `ticket.ctrmContractNumber` → `contract.sourceContractId` first; FK on `ticket.contractId`
 *  → `contract.id` only when the string key is missing. */
export function buildAppliedLbsMaps(tickets: readonly Ticket[]): {
  byCtrmNumber: Map<string, number>;
  byContractId: Map<number, number>;
} {
  const byCtrmNumber = new Map<string, number>();
  const byContractId = new Map<number, number>();
  for (const t of tickets) {
    if (!t.isApplied) continue;
    const lbs = t.appliedDockQuantity ?? 0;
    const ctrmKey = t.ctrmContractNumber?.trim();
    if (ctrmKey) {
      byCtrmNumber.set(ctrmKey, (byCtrmNumber.get(ctrmKey) ?? 0) + lbs);
    } else if (t.contractId) {
      byContractId.set(t.contractId, (byContractId.get(t.contractId) ?? 0) + lbs);
    }
  }
  return { byCtrmNumber, byContractId };
}

/** Builds a commodityCode (uppercase, trimmed) → lbsPerBushel map from CommodityConversion rows. */
export function buildConversionMap(conversions: readonly CommodityConversion[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of conversions) {
    if (!c.commodityCode) continue;
    map.set(c.commodityCode.trim().toUpperCase(), c.lbsPerUnit);
  }
  return map;
}

/** Returns true if `contract` is past its delivery end date AND still has unshipped bushels
 *  per ticket-applied math — same rule used by the Insights "Unshipped Bushels Past Delivery
 *  Date" category and the activity-summary action-items overdue alert. When the conversion
 *  factor for the commodity is missing we conservatively flag the contract (matches Insights
 *  behavior: "err on the side of flagging" rather than silently dropping legitimate past-due
 *  contracts when CTRM data is incomplete). */
export function isContractOverdueWithUnshippedBu(
  contract: Contract,
  today: Date,
  appliedLbsByCtrmNumber: Map<string, number>,
  appliedLbsByContractId: Map<number, number>,
  conversionMap: Map<string, number>
): boolean {
  if (!contract.deliveryEnd) return false;
  const deliveryEnd = new Date(contract.deliveryEnd);
  if (isNaN(deliveryEnd.getTime()) || deliveryEnd >= today) return false;
  if (!(contract.status === 'Active' || contract.status === 'Pending' || contract.status === 'Overdue')) return false;

  const code = (contract.commodityCode || '').trim().toUpperCase();
  const lbsPerBu = code ? conversionMap.get(code) ?? 0 : 0;
  // Conservative: missing conversion → still flag (matches Insights behavior comment)
  if (!lbsPerBu || lbsPerBu <= 0) return true;

  const contractKey = contract.sourceContractId?.trim();
  const appliedLbs = (contractKey ? appliedLbsByCtrmNumber.get(contractKey) : undefined)
    ?? appliedLbsByContractId.get(contract.id)
    ?? 0;

  const unitLower = (contract.unit || '').toLowerCase().trim();
  const isTons = unitLower === 'st' || unitLower.includes('ton');
  let contractLbs: number;
  if (isTons) contractLbs = (contract.quantity || 0) * 2000;
  else if (unitLower.includes('pound') || unitLower.includes('lb')) contractLbs = (contract.quantity || 0);
  else if (unitLower === 'cwt' || unitLower.includes('hundredweight')) contractLbs = (contract.quantity || 0) * 100;
  else contractLbs = (contract.quantity || 0) * lbsPerBu;

  // Sub-bushel residue = effectively complete (matches Contract Detail's 100% rule)
  const remainingLbs = Math.max(0, contractLbs - appliedLbs);
  return remainingLbs >= lbsPerBu;
}
