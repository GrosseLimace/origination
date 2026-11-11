import { DpContract } from '@models';

/**
 * Aggregation helpers for DP contract rows. Every DP surface (producer tab, profile summary card,
 * Build-A-List chips, dashboard) must go through these rather than reducing the array directly.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * `ctrm.vw_GNTA70D1` emits one row per CHARGE TYPE per delivery, not one row per delivery.
 * Confirmed against prod: ticket 370145 appears twice in the same run —
 *
 *   Status '2'  INITIAL CHARGE 2 - CHARGE/BU/D   rate 0.300000   $243.75  (flat, constant)
 *   Status 'S'  REGULAR STG RATE                 rate 0.001667   $170.66  (accrues ~$1.35/day)
 *
 * Both rows carry `quantity = 812.50` — the SAME physical grain. So:
 *
 *   • BUSHELS must be counted once per `ticketKey`. Summing `bushels` across rows reports 1,625 bu
 *     for an 812.5-bu ticket and halves any derived cents-per-bushel figure.
 *   • CHARGE AMOUNTS are additive across rows — the two components together are what's owed
 *     ($243.75 + $170.66 = $414.41).
 *
 * A null `bushels` means the quantity could not be substantiated in bushels and must be excluded
 * from totals rather than treated as zero (see DpBushelConversion on the API side).
 */

/** Rows reduced to one per physical delivery, keeping the first row seen for each `ticketKey`. */
export function dpDistinctDeliveries(rows: readonly DpContract[]): DpContract[] {
  const byTicket = new Map<string, DpContract>();
  for (const row of rows) {
    // Fall back to `id` if ticketKey is somehow absent, so a bad row groups alone rather than
    // collapsing every keyless row together.
    const key = row.ticketKey || row.id;
    if (!byTicket.has(key)) byTicket.set(key, row);
  }
  return [...byTicket.values()];
}

/** Number of distinct physical deliveries (NOT the row count). */
export function dpDeliveryCount(rows: readonly DpContract[]): number {
  return dpDistinctDeliveries(rows).length;
}

/**
 * Number of distinct DP contracts — what the producer tab badge shows. Deliberately NOT a commodity
 * count: a producer with 8 contracts across 2 commodities has 8 DP contracts, and showing "2" badly
 * understated the workload. Uses the same "No contract" fallback as the table so the badge and the
 * rows can't disagree.
 */
export function dpContractCount(rows: readonly DpContract[]): number {
  return new Set(rows.map(r => r.contractNumber?.trim() || 'No contract')).size;
}

/** Total bushels, counted once per delivery. Rows with no bushel figure contribute nothing. */
export function dpTotalBushels(rows: readonly DpContract[]): number {
  return dpDistinctDeliveries(rows).reduce((sum, r) => sum + (r.bushels ?? 0), 0);
}

/** Deliveries whose quantity could not be converted to bushels, so they're absent from the total. */
export function dpUnconvertedCount(rows: readonly DpContract[]): number {
  return dpDistinctDeliveries(rows).filter(r => r.bushels == null).length;
}

/** Total accumulated charges — summed across ALL rows, since charge types are additive. */
export function dpTotalCharges(rows: readonly DpContract[]): number {
  return rows.reduce((sum, r) => sum + (r.receivableAmount ?? 0), 0);
}

/** Per-commodity bushels + charges, sorted by bushels descending. Powers chips and breakdowns. */
export function dpBreakdownByCrop(
  rows: readonly DpContract[]
): { crop: string; bushels: number; charges: number }[] {
  const byCrop = new Map<string, DpContract[]>();
  for (const row of rows) {
    const crop = row.crop || 'Unknown';
    const list = byCrop.get(crop);
    if (list) list.push(row); else byCrop.set(crop, [row]);
  }
  return [...byCrop.entries()]
    .map(([crop, cropRows]) => ({
      crop,
      bushels: dpTotalBushels(cropRows),
      charges: dpTotalCharges(cropRows),
    }))
    .sort((a, b) => b.bushels - a.bushels);
}
