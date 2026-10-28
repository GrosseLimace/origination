/**
 * Refine filters for the rest of the Grain on Farm and Bin Sites inputs (user 2026-10-09: "make sure we
 * have ones for all the grain on farm inputs and same with the bin sites ones"). Total, Target and Grade
 * already had filters in both copies of the refine logic (Build a List's displayedCustomers and
 * NlqFilterService.applyRefinementFilters); these cover Sold, Last Bid and every bin-site field, and live
 * here once so the two copies can't drift.
 *
 * Grain filters act on the producer's grain rows the caller passes (crop-scoped when Crops chips are
 * selected, like the existing grain filters); bin-site filters act on the producer's sites.
 */
import { Customer, GrainOnFarmItem, RefinementFilters } from '@models';
import { binSiteHasCoordinates } from './coordinates';

type GrainBinRefine = Pick<RefinementFilters,
  'grainSoldOver' | 'hasGrainSold' | 'hasLastBid' | 'lastBidOver' | 'lastBidUnder'
  | 'hasBinSites' | 'noBinSites' | 'binCapacityOver' | 'binSiteNameContains' | 'binSitesWithLocation' | 'binSitesMissingLocation'>;

/** How many of these filters are set — for the "N filters" count and "is anything refined". */
export function activeGrainBinRefineCount(r: GrainBinRefine | null | undefined): number {
  if (!r) return 0;
  return [
    (r.grainSoldOver ?? 0) > 0,
    !!r.hasGrainSold,
    !!r.hasLastBid,
    r.lastBidOver != null,
    r.lastBidUnder != null,
    !!r.hasBinSites,
    !!r.noBinSites,
    (r.binCapacityOver ?? 0) > 0,
    !!r.binSiteNameContains?.trim(),
    !!r.binSitesWithLocation,
    !!r.binSitesMissingLocation,
  ].filter(Boolean).length;
}

/** Applies these filters. `grainRowsFor` returns the producer's grain rows to judge (crop-scoped). */
export function applyGrainBinRefinements<T extends Customer>(
  list: T[],
  r: GrainBinRefine,
  grainRowsFor: (c: T) => readonly GrainOnFarmItem[],
): T[] {
  let out = list;
  // ── Grain on farm: Sold ──
  if ((r.grainSoldOver ?? 0) > 0) {
    out = out.filter(c => grainRowsFor(c).reduce((sum, g) => sum + (g.bushelsSold ?? 0), 0) > r.grainSoldOver!);
  }
  if (r.hasGrainSold) {
    out = out.filter(c => grainRowsFor(c).some(g => (g.bushelsSold ?? 0) > 0));
  }
  // ── Grain on farm: Last Bid (signed — a basis bid can be negative or zero) ──
  if (r.hasLastBid) {
    out = out.filter(c => grainRowsFor(c).some(g => g.lastBid != null));
  }
  if (r.lastBidOver != null) {
    out = out.filter(c => grainRowsFor(c).some(g => g.lastBid != null && g.lastBid >= r.lastBidOver!));
  }
  if (r.lastBidUnder != null) {
    out = out.filter(c => grainRowsFor(c).some(g => g.lastBid != null && g.lastBid <= r.lastBidUnder!));
  }
  // ── Bin sites ──
  if (r.hasBinSites) {
    out = out.filter(c => (c.binSites?.length ?? 0) > 0);
  }
  if (r.noBinSites) {
    out = out.filter(c => (c.binSites?.length ?? 0) === 0);
  }
  if ((r.binCapacityOver ?? 0) > 0) {
    // The producer's total storage: the sum of their sites' capacities.
    out = out.filter(c => (c.binSites ?? []).reduce((sum, s) => sum + (s.capacity ?? 0), 0) > r.binCapacityOver!);
  }
  const nameNeedle = r.binSiteNameContains?.trim().toLowerCase();
  if (nameNeedle) {
    out = out.filter(c => (c.binSites ?? []).some(s => (s.name ?? '').toLowerCase().includes(nameNeedle)));
  }
  if (r.binSitesWithLocation) {
    out = out.filter(c => (c.binSites ?? []).some(s => binSiteHasCoordinates(s)));
  }
  if (r.binSitesMissingLocation) {
    // Producers with a site that still needs its latitude/longitude filled in.
    out = out.filter(c => (c.binSites ?? []).some(s => !binSiteHasCoordinates(s)));
  }
  return out;
}
