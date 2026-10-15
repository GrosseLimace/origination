/**
 * The desktop's contract rules, restated so the phone shows the same numbers and status:
 *  - getContractDeliveryStats (client/src/app/shared/utils/contract-delivery.ts) — delivered / remaining /
 *    progress, with a contract counted complete once less than 0.1% of it is left;
 *  - contracts-table _computeCalculatedStatus — Filled / Cancelled / Past Due / Active / To Arrive;
 *  - contracts-table getUnsettledQty — delivered minus settled.
 */
export interface DeliveryInput {
  quantity?: number | null;
  openBalanceQuantity?: number | null;
}

export interface DeliveryStats {
  delivered: number;
  remaining: number;
  progressPercent: number;
  isEffectivelyComplete: boolean;
  remainingIsUnknown: boolean;
}

export function contractDeliveryStats(c: DeliveryInput): DeliveryStats {
  const qty = c.quantity ?? 0;
  const remainingIsUnknown = c.openBalanceQuantity == null;
  // Not populated yet: assume nothing delivered (keeps the contract visible rather than calling it complete).
  const rawRemaining = remainingIsUnknown ? qty : c.openBalanceQuantity!;
  const threshold = Math.max(0.01, qty * 0.001);
  const isEffectivelyComplete = rawRemaining < threshold;
  const remaining = isEffectivelyComplete ? 0 : rawRemaining;
  // Over-delivered (negative remaining) shows the real delivered amount instead of capping at the quantity.
  const delivered = isEffectivelyComplete ? (rawRemaining < 0 ? qty - rawRemaining : qty) : Math.max(0, qty - remaining);
  const progressPercent = isEffectivelyComplete ? 100 : qty > 0 ? Math.min(100, (delivered / qty) * 100) : 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return { delivered: round2(delivered), remaining: round2(remaining), progressPercent, isEffectivelyComplete, remainingIsUnknown };
}

export type ContractStatus = 'Filled' | 'Cancelled' | 'Past Due' | 'Active' | 'To Arrive';

export function contractStatus(
  c: DeliveryInput & { status?: string | null; deliveryStart?: string | null; deliveryEnd?: string | null },
  now: Date = new Date(),
): ContractStatus {
  const stats = contractDeliveryStats(c);
  if (stats.progressPercent >= 100 || stats.remaining <= 0) return 'Filled';
  if (c.status === 'Cancelled') return 'Cancelled';
  if (c.deliveryEnd && now > new Date(c.deliveryEnd)) return 'Past Due';
  if (c.deliveryStart && now >= new Date(c.deliveryStart)) return 'Active';
  return 'To Arrive';
}

/** Delivered but not yet settled; null when CTRM has not populated the inputs. */
export function unsettledQuantity(c: DeliveryInput & { settledQuantity?: number | null }): number | null {
  if (c.openBalanceQuantity == null || c.settledQuantity == null) return null;
  const delivered = (c.quantity ?? 0) - c.openBalanceQuantity;
  return Math.max(0, delivered - c.settledQuantity);
}

/** The desktop's status pill colours (contracts-table getStatusClass). */
export function contractStatusClass(status: ContractStatus): string {
  switch (status) {
    case 'Active': return 'bg-scoular-green-accessible';
    case 'Filled': return 'bg-scoular-blue';
    case 'To Arrive': return 'bg-yellow-500';
    case 'Past Due': return 'bg-scoular-red-accessible';
    default: return 'bg-gray-500';
  }
}
