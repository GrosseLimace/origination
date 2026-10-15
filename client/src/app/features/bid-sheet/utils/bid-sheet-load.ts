/**
 * Bid sheet loading and saved preferences.
 *
 * Pure decoding for what the page loads: merging the per-trade-unit fetches, choosing the crop year
 * to show, anchoring the old/new comparison window, and resolving the saved per-trade-unit and
 * global preferences. The page owns the requests and applies the results to its signals.
 */
import { BidSheetLocation } from '@models';

/** Special key used to store the user's global (cross-TU) preference. */
export const GLOBAL_PREF_KEY = '__global__';

/** The saved preference row (per trade-unit key, or the global one). */
export interface StoredBidSheetPreference {
  cropCode: string | null;
  month: number | null;
  cropYear: number | null;
  hiddenCrops: string | null;
}

/** One trade unit's fetch. */
export interface TradeUnitLoad {
  locations: BidSheetLocation[];
  cropYears: number[];
  bidCommodities: string[];
}

/** All active trade units' data combined: locations in fetch order, distinct sorted crop years
 *  (or just `currentYear` when there are none yet) and distinct sorted crops. */
export function mergeTradeUnitLoads(results: TradeUnitLoad[], currentYear: number): { locations: BidSheetLocation[]; cropYears: number[]; crops: string[] } {
  const locations = results.flatMap(r => r.locations);
  let cropYears = [...new Set(results.flatMap(r => r.cropYears))].sort((a, b) => a - b);
  const crops = [...new Set(results.flatMap(r => r.bidCommodities))].sort();
  if (cropYears.length === 0) cropYears = [currentYear];
  return { locations, cropYears, crops };
}

/** Keeps the selected year if there is data for it; otherwise the current year if there is, else the latest. */
export function pickSelectedYear(cropYears: number[], selectedYear: number, currentYear: number): number {
  if (cropYears.includes(selectedYear)) return selectedYear;
  return cropYears.includes(currentYear) ? currentYear : cropYears[cropYears.length - 1];
}

/** The year offset that puts `year` in the "new" column of the old/new comparison (0 = the latest
 *  year), or null when `year` has no data. */
export function yearOffsetFor(cropYears: number[], year: number): number | null {
  const idx = cropYears.indexOf(year);
  return idx >= 0 ? idx - (cropYears.length - 1) : null;
}

/** Crop / month / year to restore: the per-key preference wins field by field, then the global one. */
export function preferredSelection(perKey: StoredBidSheetPreference | null, global: StoredBidSheetPreference | null): { crop: string | null; month: number | null; year: number | null } {
  return {
    crop: perKey?.cropCode ?? global?.cropCode ?? null,
    month: perKey?.month ?? global?.month ?? null,
    year: perKey?.cropYear ?? global?.cropYear ?? null
  };
}

/** Saved hidden crops; none saved, or unreadable, means every crop is visible. */
export function parseHiddenCrops(json: string | null): Set<string> {
  if (!json) return new Set();
  try { return new Set(JSON.parse(json)); }
  catch { return new Set(); }
}
