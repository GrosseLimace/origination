/**
 * Bid sheet location edits from the side panel.
 *
 * Pure helpers for the panel's rename / Scoular toggle / delete actions: the update payload the API
 * expects, and the optimistic changes applied to a cached location list once the API confirms.
 */
import { BidSheetLocation } from '@models';

/**
 * Full update payload for a location: every editable field carried over unchanged, with the new
 * name and Scoular flag. The API replaces the row, so nothing may be left out.
 */
export function locationUpdate(loc: BidSheetLocation, name: string, isScoularFacility: boolean): Partial<BidSheetLocation> {
  return {
    name,
    address: loc.address,
    city: loc.city,
    state: loc.state,
    latitude: loc.latitude,
    longitude: loc.longitude,
    elevatorCode: loc.elevatorCode,
    tradeUnitCode: loc.tradeUnitCode,
    groupName: loc.groupName,
    isScoularFacility
  };
}

/** The list without the location. */
export function withoutLocation(locs: BidSheetLocation[], id: number): BidSheetLocation[] {
  return locs.filter(l => l.id !== id);
}

/** The list with every bid for `crop` removed from one location. */
export function withoutCropBids(locs: BidSheetLocation[], id: number, crop: string): BidSheetLocation[] {
  return locs.map(l =>
    l.id === id ? { ...l, bids: (l.bids ?? []).filter(b => b.commodityCode !== crop) } : l
  );
}

/** The list with one location's Scoular flag set. */
export function withScoularFlag(locs: BidSheetLocation[], id: number, isScoularFacility: boolean): BidSheetLocation[] {
  return locs.map(l =>
    l.id === id ? { ...l, isScoularFacility } : l
  );
}
