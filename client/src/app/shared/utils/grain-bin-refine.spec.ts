import { describe, it, expect } from 'vitest';
import { Customer, GrainOnFarmItem, ProducerBinSiteItem } from '@models';
import { activeGrainBinRefineCount, applyGrainBinRefinements } from './grain-bin-refine';

const producer = (id: number, sites: ProducerBinSiteItem[], grain: GrainOnFarmItem[]): Customer =>
  ({ id, name: `Farm ${id}`, binSites: sites, grainOnFarm: grain } as unknown as Customer);

const north: ProducerBinSiteItem = { siteKey: 'n', name: 'North Bins', capacity: 50000, latitude: 41.39, longitude: -95.01 };
const home: ProducerBinSiteItem = { siteKey: 'h', name: 'Home Place', capacity: 20000 };
const bin1: ProducerBinSiteItem = { siteKey: 'b', name: 'Bin 1', capacity: 5000 };

const a = producer(1, [north, home], [
  { commodityCode: 'YC', bushelsOnHand: 30000, bushelsSold: 10000, lastBid: -0.35 },
  { commodityCode: 'SB', bushelsOnHand: 12500, lastBid: 10.5 },
]);
const b = producer(2, [bin1], [{ commodityCode: 'YC', bushelsOnHand: 5000, lastBid: 0 }]);
const c = producer(3, [], []);
const all = [a, b, c];
const rows = (x: Customer) => x.grainOnFarm ?? [];
const ids = (r: object, scoped = rows) => applyGrainBinRefinements(all, r, scoped).map(x => x.id);

describe('applyGrainBinRefinements — grain on farm', () => {
  it('Sold: total sold over N, and has any sold', () => {
    expect(ids({ grainSoldOver: 5000 })).toEqual([1]);
    expect(ids({ grainSoldOver: 10000 })).toEqual([]);
    expect(ids({ hasGrainSold: true })).toEqual([1]);
  });

  it('Last bid: has one, over / under — signed, and $0.00 counts as a bid', () => {
    expect(ids({ hasLastBid: true })).toEqual([1, 2]);
    expect(ids({ lastBidOver: 0 })).toEqual([1, 2]);        // 10.50 and 0.00
    expect(ids({ lastBidUnder: -0.30 })).toEqual([1]);      // -0.35
    expect(ids({ lastBidUnder: 0 })).toEqual([1, 2]);
  });

  it('judges only the crop-scoped rows the caller passes', () => {
    const cornOnly = (x: Customer) => rows(x).filter(g => g.commodityCode === 'YC');
    expect(ids({ lastBidOver: 5 }, cornOnly)).toEqual([]);  // the 10.50 bid is on SB
  });
});

describe('applyGrainBinRefinements — bin sites', () => {
  it('total capacity over N', () => {
    expect(ids({ binCapacityOver: 60000 })).toEqual([1]);   // 50,000 + 20,000
    expect(ids({ binCapacityOver: 4000 })).toEqual([1, 2]);
  });

  it('site name contains (any case), with / missing a map location', () => {
    expect(ids({ binSiteNameContains: 'north' })).toEqual([1]);
    expect(ids({ binSiteNameContains: '  bin ' })).toEqual([1, 2]); // "North Bins", "Bin 1"
    expect(ids({ binSitesWithLocation: true })).toEqual([1]);
    expect(ids({ binSitesMissingLocation: true })).toEqual([1, 2]); // Home Place, Bin 1
  });
});

describe('activeGrainBinRefineCount', () => {
  it('counts set filters; zero and blank are off except a signed last bid', () => {
    expect(activeGrainBinRefineCount({})).toBe(0);
    expect(activeGrainBinRefineCount({ grainSoldOver: 0, binSiteNameContains: '  ' })).toBe(0);
    expect(activeGrainBinRefineCount({ lastBidOver: 0, hasGrainSold: true, binSitesWithLocation: true })).toBe(3);
  });
});
