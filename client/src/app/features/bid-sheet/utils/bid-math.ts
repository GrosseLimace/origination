/**
 * Bid sheet data derivation.
 *
 * Pure functions behind the page's bid comparison: flattening locations into one entry per bid,
 * the latest-bid lookup every view reads, bid → status grading against the session reference, and
 * the rows of the side panel (the location list and the open location's crop rows). The page keeps
 * the signals and feeds them in; nothing here reads state or calls the API.
 */
import { BidSheetEntry, BidSheetLocation } from '@models';

/** Status for a bid value vs the session reference. */
export type BidStatus = 'reference' | 'beating' | 'matching' | 'none';

/** Row in the panel list view (`filteredBidItems`). */
export interface BidSheetPanelItem {
  type: 'entry';
  name: string;
  isScoular: boolean;
  isRef: boolean;
  latitude: number | null;
  longitude: number | null;
  oldBid: string;
  newBid: string;
  oldStatus?: BidStatus;
  newStatus?: BidStatus;
  status: BidStatus;
}

/** A (month, crop year) period; month 0 = the yearly bid. */
export interface BidPeriod {
  month: number;
  year: number;
}

/** Month name abbreviations, indexed 1–12 (0 is the yearly bid and has no name). */
export const MONTH_ABBREVIATIONS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Returns "Mar 26" / "Apr 26" / "2025" / "2026" depending on month context. */
export function formatMonthYear(month: number, year: number | null): string {
  if (year == null) return '';
  if (month === 0) return year.toString();
  return `${MONTH_ABBREVIATIONS[month]} ${year.toString().slice(-2)}`;
}

/** Flattened view of locations — one entry per bid, carrying its location's fields. */
export function flattenBidEntries(locations: BidSheetLocation[]): BidSheetEntry[] {
  return locations.flatMap(loc =>
    (loc.bids ?? []).map(bid => ({
      id: bid.id,
      locationId: loc.id,
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      latitude: loc.latitude,
      longitude: loc.longitude,
      elevatorCode: loc.elevatorCode,
      tradeUnitCode: loc.tradeUnitCode,
      groupName: loc.groupName,
      commodityCode: bid.commodityCode,
      commodityName: bid.commodityName,
      commodityCategory: bid.commodityCategory,
      cropYear: bid.cropYear,
      month: bid.month,
      bid: bid.bid,
      createdBy: bid.createdBy,
      createdAt: bid.createdAt,
      modifiedBy: bid.modifiedBy,
      modifiedAt: bid.modifiedAt
    }))
  );
}

/** Lookup key for one bid cell: "name|commodityCode|cropYear|month". */
export function bidLookupKey(name: string, commodityCode: string, cropYear: number, month: number): string {
  return `${name}|${commodityCode}|${cropYear}|${month}`;
}

/** "name|commodityCode|cropYear|month" → latest BidSheetEntry (by modifiedAt then createdAt). O(1) lookups instead of repeated filter+sort. */
export function buildBidLookup(entries: BidSheetEntry[]): Map<string, BidSheetEntry> {
  const lookup = new Map<string, BidSheetEntry>();
  for (const e of entries) {
    const key = bidLookupKey(e.name, e.commodityCode, e.cropYear, e.month);
    const existing = lookup.get(key);
    if (!existing || new Date(e.modifiedAt || e.createdAt).getTime() > new Date(existing.modifiedAt || existing.createdAt).getTime()) {
      lookup.set(key, e);
    }
  }
  return lookup;
}

/** The latest bid text for a cell, or '' when there is none (or no year / crop to look up). */
export function lookupBid(lookup: ReadonlyMap<string, BidSheetEntry>, name: string, year: number | null, commodityCode: string, month: number): string {
  if (!year || !commodityCode) return '';
  return lookup.get(bidLookupKey(name, commodityCode, year, month))?.bid ?? '';
}

export function parseBid(bid: string): number | null {
  const n = parseFloat(bid);
  return isNaN(n) ? null : n;
}

export function computeItemStatus(bidStr: string, isRef: boolean, refBid: number | null): BidStatus {
  if (isRef) return 'reference';
  const num = parseBid(bidStr);
  if (refBid !== null && num !== null) {
    if (num > refBid) return 'beating';
    if (num === refBid) return 'matching';
  }
  return 'none';
}

/**
 * "All Producers" mode has no trade unit, so the per-TU bid load (which fills crops/cropYears)
 * is skipped. The crop + crop-year lists are derived from every location's bids instead, sorted.
 */
export function deriveAllProducersFilters(locations: BidSheetLocation[]): { crops: string[]; years: number[] } {
  const bids = locations.flatMap(l => l.bids ?? []);
  const crops = [...new Set(bids.map(b => b.commodityCode).filter((c): c is string => !!c))].sort();
  const years = [...new Set(bids.map(b => b.cropYear).filter((y): y is number => y != null))].sort((a, b) => a - b);
  return { crops, years };
}

export interface PanelItemsInput {
  /** True when any trade units are active. */
  hasTu: boolean;
  /** True when crop-year data exists (a loaded TU, or All Producers derived from every location). */
  hasCropYears: boolean;
  /** Status filter: 'all' or a BidStatus. */
  basis: string;
  crop: string;
  oldD: BidPeriod;
  newD: BidPeriod;
  /** The period picked in the filter bar (drives `status`). */
  selected: BidPeriod;
  /** Session reference location name ('' = none). */
  refName: string;
  entries: BidSheetEntry[];
  lookup: ReadonlyMap<string, BidSheetEntry>;
  allMapLocations: BidSheetLocation[];
  bidLocations: BidSheetLocation[];
}

/** The panel's location list: one row per location with old/new bids and statuses, reference first. */
export function buildPanelItems(input: PanelItemsInput): BidSheetPanelItem[] {
  const hasTu = input.hasTu;
  // Comparison/status applies for a single TU AND for All Producers (view-only) — both derive
  // crop-year data, so the reference/beating/matching logic runs identically; only editing differs.
  const hasIndividualTu = input.hasTu || input.hasCropYears;
  const basis = input.basis;
  const getBid = (name: string, year: number | null, crop: string, month: number) => lookupBid(input.lookup, name, year, crop, month);

  let items: BidSheetPanelItem[] = [];

  // Show the bid comparison whenever we have crop-year data — for a single TU, or for
  // All Producers (where crops/years are derived from every location's bids). Only fall back
  // to the name-only list when there's no bid data to compare yet.
  const canCompare = hasTu || input.hasCropYears;

  if (!canCompare) {
    // No data yet — show all locations by name, no bid values
    const seen = new Set<string>();
    for (const loc of input.allMapLocations) {
      if (seen.has(loc.name)) continue;
      seen.add(loc.name);
      items.push({
        type: 'entry',
        name: loc.name,
        isScoular: !!loc.isScoularFacility,
        isRef: false,
        latitude: loc.latitude ?? null,
        longitude: loc.longitude ?? null,
        oldBid: '',
        newBid: '',
        status: 'none'
      });
    }
  } else {
    const crop = input.crop;
    const oldD = input.oldD;
    const newD = input.newD;

    // Compute reference bids per period for status comparison
    const refName = input.refName;
    const selectedYr = input.selected.year;
    const month = input.selected.month;
    let oldRefBid: number | null = null;
    let newRefBid: number | null = null;
    let selectedRefBid: number | null = null;
    if (hasIndividualTu && refName) {
      oldRefBid = parseBid(getBid(refName, oldD.year, crop, oldD.month));
      newRefBid = parseBid(getBid(refName, newD.year, crop, newD.month));
      selectedRefBid = parseBid(getBid(refName, selectedYr, crop, month));
    }

    // Add location entries — filter by crop if one is selected
    const entries = crop
      ? input.entries.filter(e => e.commodityCode === crop)
      : input.entries;
    const uniqueNames = new Set(entries.map(e => e.name));

    // Ensure reference location always appears even if it has no bid for the selected crop
    if (hasIndividualTu && refName && !uniqueNames.has(refName)) {
      uniqueNames.add(refName);
    }

    for (const name of uniqueNames) {
      const oldBid = getBid(name, oldD.year, crop, oldD.month);
      const newBid = getBid(name, newD.year, crop, newD.month);
      const selectedBid = getBid(name, selectedYr, crop, month);
      const entryWithCoords = input.entries.find(e => e.name === name);
      const isRef = hasIndividualTu && name === refName;

      const locForScoular = input.allMapLocations.find(l => l.name === name);
      items.push({
        type: 'entry',
        name,
        isScoular: !!locForScoular?.isScoularFacility,
        isRef,
        latitude: entryWithCoords?.latitude ?? null,
        longitude: entryWithCoords?.longitude ?? null,
        oldBid,
        newBid,
        oldStatus: isRef ? 'reference' : (hasIndividualTu ? computeItemStatus(oldBid, false, oldRefBid) : 'none'),
        newStatus: isRef ? 'reference' : (hasIndividualTu ? computeItemStatus(newBid, false, newRefBid) : 'none'),
        status: isRef ? 'reference' : (hasIndividualTu ? computeItemStatus(selectedBid, false, selectedRefBid) : 'none')
      });
    }

    // Include locations with no bids yet (only when no crop filter is active)
    if (!crop) {
      for (const loc of input.bidLocations) {
        if (uniqueNames.has(loc.name)) continue;
        const isRef = hasIndividualTu && loc.name === refName;
        items.push({
          type: 'entry',
          name: loc.name,
          isScoular: !!loc.isScoularFacility,
          isRef,
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
          oldBid: '',
          newBid: '',
          oldStatus: 'none',
          newStatus: 'none',
          status: isRef ? 'reference' : 'none'
        });
      }
    }
  }

  // Status (basis) filter — always keep the reference item
  if (basis !== 'all') {
    items = items.filter(item => item.status === 'reference' || item.status === basis);
  }

  // Sort: reference first, then alphabetical
  items.sort((a, b) => {
    if (a.isRef) return -1;
    if (b.isRef) return 1;
    return a.name.localeCompare(b.name);
  });

  return items;
}

export interface PanelLocationBid {
  crop: string;
  oldBid: string;
  newBid: string;
  oldStatus: BidStatus;
  newStatus: BidStatus;
}

/** All crop/bid rows for the location open in the panel, colour-coded vs the session reference. */
export function buildPanelLocationBids(
  name: string, entries: BidSheetEntry[], lookup: ReadonlyMap<string, BidSheetEntry>,
  oldD: BidPeriod, newD: BidPeriod, refName: string
): PanelLocationBid[] {
  if (!name) return [];
  const getBid = (n: string, year: number | null, crop: string, month: number) => lookupBid(lookup, n, year, crop, month);
  const locEntries = entries.filter(e => e.name === name);
  let cropSet = [...new Set(locEntries.map(e => e.commodityCode).filter(Boolean))].sort();
  // Only show crops that have bids for the displayed old/new periods
  cropSet = cropSet.filter(crop =>
    getBid(name, newD.year, crop!, newD.month) ||
    getBid(name, oldD.year, crop!, oldD.month));

  // Reference comparison — color-code each crop row vs the session reference (selectedLocationName)
  const isRef = refName === name;

  return cropSet.map(crop => {
    const oldBid = getBid(name, oldD.year, crop!, oldD.month);
    const newBid = getBid(name, newD.year, crop!, newD.month);
    // Get reference bid for this crop (if any). If reference doesn't have this crop → leave white (status 'none').
    const oldRefBid = refName && !isRef ? parseBid(getBid(refName, oldD.year, crop!, oldD.month)) : null;
    const newRefBid = refName && !isRef ? parseBid(getBid(refName, newD.year, crop!, newD.month)) : null;
    const oldStatus: BidStatus = isRef ? 'reference' : computeItemStatus(oldBid, false, oldRefBid);
    const newStatus: BidStatus = isRef ? 'reference' : computeItemStatus(newBid, false, newRefBid);
    return { crop: crop!, oldBid, newBid, oldStatus, newStatus };
  });
}
