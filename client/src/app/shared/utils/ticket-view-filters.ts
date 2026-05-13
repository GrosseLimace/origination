import type { Ticket, RefinementFilters } from '@models';

/** Net bu + quality avg refinement filters with view-mode semantics. Shared by build-list
 *  (live refinement) and nlq-filter saved-list re-evaluation so the two paths agree.
 *
 *  - 'grouped' (default): only UNAPPLIED tickets contribute; tickets are grouped by
 *    productCode|elevatorCode (same key the customer Unapplied Tickets tab uses).
 *    A customer matches if at least one group satisfies every active filter — total bu > X
 *    AND group-avg moisture/testWeight/protein within the over/under bounds.
 *  - 'single': ALL tickets (applied + unapplied) contribute as individuals.
 *    A customer matches if at least one ticket satisfies every active filter
 *    (per-ticket bu > X, per-ticket moisture/testWeight/protein within bounds).
 *
 *  Tickets whose productCode has no lbs/bu conversion are skipped for Net bu math; they
 *  can still satisfy quality bounds since those don't need conversion.
 *
 *  Returns the set of customer IDs satisfying every active filter under the chosen mode.
 *  If no Net bu and no quality filters are set, returns null to signal the caller should
 *  not apply this stage at all. */
export function matchTicketViewModeFilters(
  scopedTickets: readonly Ticket[],
  codeToId: Map<string, number>,
  conversionMap: Map<string, number>,
  mode: 'grouped' | 'single',
  r: RefinementFilters
): Set<number> | null {
  const hasNetBu = r.ticketQuantityOver != null && r.ticketQuantityOver > 0;
  const hasQualityFilter = r.avgMoistureOver != null || r.avgMoistureUnder != null ||
    r.avgTestWeightOver != null || r.avgTestWeightUnder != null ||
    r.avgProteinOver != null || r.avgProteinUnder != null;
  if (!hasNetBu && !hasQualityFilter) return null;

  const netBuThreshold = r.ticketQuantityOver ?? 0;

  const ticketBu = (t: Ticket): number | null => {
    const code = (t.productCode || '').trim().toUpperCase();
    const lbsPerBu = code ? conversionMap.get(code) : undefined;
    if (!lbsPerBu || lbsPerBu <= 0) return null;
    return (t.appliedDockQuantity || 0) / lbsPerBu;
  };

  const passesBounds = (value: number | null, over: number | null | undefined, under: number | null | undefined): boolean => {
    if (over == null && under == null) return true;
    if (value == null) return false;
    if (over != null && !(value > over)) return false;
    if (under != null && !(value < under)) return false;
    return true;
  };

  const matchingIds = new Set<number>();

  if (mode === 'single') {
    for (const t of scopedTickets) {
      if (!t.customerCode) continue;
      const cid = codeToId.get(t.customerCode);
      if (cid == null || matchingIds.has(cid)) continue;
      if (hasNetBu) {
        const bu = ticketBu(t);
        if (bu == null || !(bu > netBuThreshold)) continue;
      }
      if (!passesBounds(t.moisture ?? null, r.avgMoistureOver, r.avgMoistureUnder)) continue;
      if (!passesBounds(t.testWeight ?? null, r.avgTestWeightOver, r.avgTestWeightUnder)) continue;
      if (!passesBounds(t.proteinPercent ?? null, r.avgProteinOver, r.avgProteinUnder)) continue;
      matchingIds.add(cid);
    }
    return matchingIds;
  }

  // grouped — unapplied tickets only, grouped by productCode|elevatorCode.
  // Every active filter in this mode is an AVERAGE check: Net bu averages bushels per ticket
  // within the group (so a 4-ticket group totaling 4400 bu has avg 1100 bu/ticket); quality
  // averages average each field's readings within the group.
  type GroupAgg = { buSum: number; buCnt: number; mSum: number; mCnt: number; tSum: number; tCnt: number; pSum: number; pCnt: number };
  const groupsByCustomer = new Map<number, Map<string, GroupAgg>>();
  for (const t of scopedTickets) {
    if (t.isApplied) continue;
    if (!t.customerCode) continue;
    const cid = codeToId.get(t.customerCode);
    if (cid == null) continue;
    const productCode = (t.productCode || 'Unknown').trim();
    const elevatorCode = (t.elevatorCode || 'Unknown').trim().toUpperCase();
    const groupKey = `${productCode}|${elevatorCode}`;
    let custGroups = groupsByCustomer.get(cid);
    if (!custGroups) { custGroups = new Map(); groupsByCustomer.set(cid, custGroups); }
    let g = custGroups.get(groupKey);
    if (!g) { g = { buSum: 0, buCnt: 0, mSum: 0, mCnt: 0, tSum: 0, tCnt: 0, pSum: 0, pCnt: 0 }; custGroups.set(groupKey, g); }
    const bu = ticketBu(t);
    if (bu != null) { g.buSum += bu; g.buCnt++; }
    if (t.moisture != null) { g.mSum += t.moisture; g.mCnt++; }
    if (t.testWeight != null) { g.tSum += t.testWeight; g.tCnt++; }
    if (t.proteinPercent != null) { g.pSum += t.proteinPercent; g.pCnt++; }
  }

  for (const [cid, custGroups] of groupsByCustomer) {
    for (const g of custGroups.values()) {
      const buAvg = g.buCnt > 0 ? g.buSum / g.buCnt : null;
      if (hasNetBu && (buAvg == null || !(buAvg > netBuThreshold))) continue;
      const mAvg = g.mCnt > 0 ? g.mSum / g.mCnt : null;
      const tAvg = g.tCnt > 0 ? g.tSum / g.tCnt : null;
      const pAvg = g.pCnt > 0 ? g.pSum / g.pCnt : null;
      if (!passesBounds(mAvg, r.avgMoistureOver, r.avgMoistureUnder)) continue;
      if (!passesBounds(tAvg, r.avgTestWeightOver, r.avgTestWeightUnder)) continue;
      if (!passesBounds(pAvg, r.avgProteinOver, r.avgProteinUnder)) continue;
      matchingIds.add(cid);
      break;
    }
  }
  return matchingIds;
}
