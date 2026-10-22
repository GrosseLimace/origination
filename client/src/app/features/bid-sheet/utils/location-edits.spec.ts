import { describe, expect, it } from 'vitest';
import { BidSheetLocation, BidSheetLocationBid } from '@models';
import { locationUpdate, withoutCropBids, withoutLocation, withScoularFlag } from './location-edits';

const bid = (locationId: number, commodityCode: string): BidSheetLocationBid =>
  ({ id: 0, locationId, commodityCode, cropYear: 2026, month: 0, bid: '1', createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z' });
const ALPHA: BidSheetLocation = {
  id: 1, name: 'Alpha', address: '1 Main', city: 'Pratt', state: 'KS', latitude: 37.6, longitude: -98.7, elevatorCode: 'ALP',
  tradeUnitCode: '2040', groupName: 'Kansas', isScoularFacility: false, createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z',
  bids: [bid(1, 'YC'), bid(1, 'SB'), bid(1, 'YC')],
};
const BRAVO: BidSheetLocation = { id: 2, name: 'Bravo', tradeUnitCode: '2040', createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z', bids: [bid(2, 'YC')] };
const LOCS = [ALPHA, BRAVO];

describe('locationUpdate', () => {
  it('carries every editable field over with the new name and Scoular flag', () => {
    expect(locationUpdate(ALPHA, 'Alpha West', true)).toEqual({
      name: 'Alpha West', address: '1 Main', city: 'Pratt', state: 'KS', latitude: 37.6, longitude: -98.7,
      elevatorCode: 'ALP', tradeUnitCode: '2040', groupName: 'Kansas', isScoularFacility: true,
    });
  });

  it('never sends bids or audit fields', () => {
    const payload = locationUpdate(ALPHA, 'Alpha', false);
    expect(Object.keys(payload)).not.toContain('bids');
    expect(Object.keys(payload)).not.toContain('createdBy');
    expect(Object.keys(payload)).not.toContain('id');
  });
});

describe('cache edits', () => {
  it('withoutLocation drops only that id', () => {
    expect(withoutLocation(LOCS, 1)).toEqual([BRAVO]);
    expect(withoutLocation(LOCS, 9)).toEqual(LOCS);
  });

  it('withoutCropBids removes every bid for the crop from that location only', () => {
    const next = withoutCropBids(LOCS, 1, 'YC');
    expect(next[0].bids.map(b => b.commodityCode)).toEqual(['SB']);
    expect(next[1]).toBe(BRAVO);
    expect(ALPHA.bids).toHaveLength(3); // input untouched
  });

  it('withScoularFlag sets the flag on that location only', () => {
    const next = withScoularFlag(LOCS, 2, true);
    expect(next[1].isScoularFacility).toBe(true);
    expect(next[0]).toBe(ALPHA);
    expect(BRAVO.isScoularFacility).toBeUndefined();
  });
});
