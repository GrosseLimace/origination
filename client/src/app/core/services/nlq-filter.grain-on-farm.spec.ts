import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService, NlqFilterContext } from './nlq-filter.service';
import { Customer } from '@models';

/** Minimal customer with just the fields the grain-on-farm filters read. Names are intentionally
 *  neutral (Alpha/Bravo/…) so the engine's name-search paths can't accidentally match crop words. */
function customer(
  id: number,
  name: string,
  grainOnFarm: { commodityCode: string; bushelsOnHand?: number; targetBushels?: number; grade?: string }[]
): Customer {
  return {
    id, name, farm: '', location: '', phone: '', email: '',
    totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, grainOnFarm,
  } as Customer;
}

function ctx(customers: Customer[]): NlqFilterContext {
  return { customers, contracts: [], tickets: [], notes: [], plantingIntentions: [], storedGrain: [] };
}

describe('NlqFilterService — grain on farm + target', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  // Alpha: corn 80k @ $5.50, grade "4.4%" | Bravo: wheat 20k, no target | Charlie: soybeans 5k @ $12.25 | Delta: none
  const alpha = customer(1, 'Alpha Farms', [{ commodityCode: 'Corn', bushelsOnHand: 80000, targetBushels: 5.5, grade: '4.4%' }]);
  const bravo = customer(2, 'Bravo Farms', [{ commodityCode: 'Wheat', bushelsOnHand: 20000 }]);
  const charlie = customer(3, 'Charlie Farms', [{ commodityCode: 'Soybeans', bushelsOnHand: 5000, targetBushels: 12.25 }]);
  const delta = customer(4, 'Delta Farms', []);
  const all = [alpha, bravo, charlie, delta];

  const ids = (q: string) => svc.parseAndFilter(q, ctx(all)).customers.map(c => c.id).sort((a, b) => a - b);

  it('"grain on farm" → producers with any bushels on hand', () => {
    expect(ids('producers with grain on farm')).toEqual([1, 2, 3]);
  });

  it('"producers with a grain grade" → only producers with a grade entered', () => {
    expect(ids('producers with a grain grade')).toEqual([1]); // only alpha has a grade
  });

  it('ticket grade ("grade 2") does not trigger the grain-grade filter', () => {
    // Should not narrow to grain-grade producers; grain-grade context is excluded for ticket grade.
    const r = svc.parseAndFilter('producers with grade 2 tickets', ctx(all));
    expect(r.matchedPatterns).not.toContain('grain_grade');
  });

  it('does not merge in note-keyword matches (a producer whose note says "grain" but has none stays out)', () => {
    // Regression: the supplementary note search must be skipped for grain-on-farm queries,
    // else a producer with a note mentioning "grain"/"farm" but no grain on hand gets unioned in.
    const noteCtx: NlqFilterContext = {
      ...ctx(all),
      notes: [{ id: 1, customerId: 4, customerCode: 'DELTA', description: 'has grain on the farm to sell', createdAt: '2026-06-01T00:00:00Z', createdBy: 'x' } as never],
    };
    const r = svc.parseAndFilter('producers with grain on farm', noteCtx);
    expect(r.customers.map(c => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3]); // delta (id 4) NOT merged in
  });

  it('does not over-scope plain "grain on farm" when a commodity code is a substring of the query', () => {
    // Regression: 'rai' is a substring of "g(rai)n". The old substring-based crop detection
    // wrongly scoped the filter to that bogus crop and returned zero producers.
    const commodities = [{ id: 1, code: 'rai', name: 'Bogus', category: 'Bogus', isActive: true }] as never;
    const result = svc.parseAndFilter('producers with grain on farm', { ...ctx(all), commodities });
    expect(result.customers.map(c => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('"no grain on farm" → producers with none', () => {
    expect(ids('producers with no grain on farm')).toEqual([4]);
  });

  it('"grain on farm over 50k" → totals at/above threshold', () => {
    expect(ids('grain on farm over 50k')).toEqual([1]);
  });

  it('crop-scoped "wheat on farm" → only producers with wheat on farm', () => {
    expect(ids('wheat on farm')).toEqual([2]);
  });

  it('crop-scoped "corn on farm over 10000" → corn totals at/above threshold', () => {
    expect(ids('corn on farm over 10000')).toEqual([1]);
  });

  it('"has a target" → producers with a target price set', () => {
    expect(ids('producers with a target')).toEqual([1, 3]);
  });

  it('"no target set" → has grain but no target price', () => {
    expect(ids('grain on farm with no target set')).toEqual([2]);
  });

  it('"target over $6" → target price at/above 6', () => {
    expect(ids('target over $6')).toEqual([3]);
  });

  it('"target under $6" → target set and at/under 6', () => {
    expect(ids('target under $6')).toEqual([1]);
  });

  it('a negative (basis) target counts as a target set', () => {
    const echo = customer(5, 'Echo Farms', [{ commodityCode: 'Corn', bushelsOnHand: 10000, targetBushels: -0.25 }]);
    const withEcho = (q: string) =>
      svc.parseAndFilter(q, ctx([...all, echo])).customers.map(c => c.id).sort((a, b) => a - b);
    expect(withEcho('producers with a target')).toEqual([1, 3, 5]);
    expect(withEcho('grain on farm with no target set')).toEqual([2]);
    expect(withEcho('target under $6')).toEqual([1, 5]);
  });

  it('"top producers by grain on farm" → ranked by total bushels on hand (desc), no-grain dropped', () => {
    const ordered = svc.parseAndFilter('top 25 producers by grain on farm', ctx(all)).customers.map(c => c.id);
    expect(ordered).toEqual([1, 2, 3]); // alpha 80k > bravo 20k > charlie 5k; delta (0) excluded
  });

  it('bare "Top by grain on farm" (no count) still ranks by bushels on hand (desc)', () => {
    // Regression: the prompt card's label runs without an explicit count; it must still sort,
    // not fall through unranked (which let a smaller total sit above a larger one).
    const ordered = svc.parseAndFilter('Top by grain on farm', ctx(all)).customers.map(c => c.id);
    expect(ordered).toEqual([1, 2, 3]);
  });

  it('isRankingQuery flags top/bottom/largest prompts (so callers preserve ranked order)', () => {
    expect(svc.isRankingQuery('Top by grain on farm')).toBe(true);
    expect(svc.isRankingQuery('top 10 by contract value')).toBe(true);
    expect(svc.isRankingQuery('largest producers')).toBe(true);
    expect(svc.isRankingQuery('bottom 5 by acres')).toBe(true);
    expect(svc.isRankingQuery('producers with grain on farm')).toBe(false);
  });

  it('recognizes the prompt (matchedPatterns includes grain_on_farm / grain_target)', () => {
    const r = svc.parseAndFilter('grain on farm over 50k', ctx(all));
    expect(r.matchedPatterns).toContain('grain_on_farm');
    const t = svc.parseAndFilter('target over $6', ctx(all));
    expect(t.matchedPatterns).toContain('grain_target');
  });
});

describe('NlqFilterService — grain-on-farm refinement filters', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  const alpha = customer(1, 'Alpha Farms', [{ commodityCode: 'Corn', bushelsOnHand: 80000, targetBushels: 5.5, grade: '4.4%' }]);
  const bravo = customer(2, 'Bravo Farms', [{ commodityCode: 'Wheat', bushelsOnHand: 20000 }]);
  const charlie = customer(3, 'Charlie Farms', [{ commodityCode: 'Soybeans', bushelsOnHand: 5000, targetBushels: 12.25 }]);
  const delta = customer(4, 'Delta Farms', []);
  const all = [alpha, bravo, charlie, delta];

  const refine = (f: Record<string, unknown>) =>
    svc.applyRefinementFilters(all, f as never, [], []).map(c => c.id).sort((a, b) => a - b);

  it('grainOnFarmBushelsOver filters by total bushels on hand', () => {
    expect(refine({ grainOnFarmBushelsOver: 50000 })).toEqual([1]);
  });

  it('hasGrade keeps producers with a grade entered', () => {
    expect(refine({ hasGrade: true })).toEqual([1]); // only alpha has a grade
  });

  it('gradeOver / gradeUnder compare the number parsed from the free-text grade', () => {
    expect(refine({ gradeOver: 4 })).toEqual([1]);  // alpha "4.4%" -> 4.4 >= 4
    expect(refine({ gradeOver: 5 })).toEqual([]);   // 4.4 < 5
    expect(refine({ gradeUnder: 5 })).toEqual([1]); // 4.4 <= 5
  });

  it('hasGrainTarget keeps producers with a target set', () => {
    expect(refine({ hasGrainTarget: true })).toEqual([1, 3]);
  });

  it('noGrainTarget keeps producers with grain but no target', () => {
    expect(refine({ noGrainTarget: true })).toEqual([2]);
  });

  it('grainTargetOver / grainTargetUnder bound the target price', () => {
    expect(refine({ grainTargetOver: 6 })).toEqual([3]);
    expect(refine({ grainTargetUnder: 6 })).toEqual([1]);
  });

  it('crop scopes the grain refine (corn bushels over 10k → only corn rows)', () => {
    // bravo (wheat) excluded even though 20k bu, because crop is scoped to corn
    expect(refine({ grainOnFarmBushelsOver: 10000, crops: ['corn'] })).toEqual([1]);
  });

  it('a "Wheat" chip keeps a producer whose commodityGroup is a raw code, not the group name', () => {
    // This is the bug in the exact shape a real saved list hits: grainOnFarm.commodityGroup can
    // be a raw commodity CODE (SRWW) rather than the friendly group name — the old bidirectional-
    // substring matcher had no way to resolve SRWW -> wheat without a lookup table. _promptCategory
    // is what routes crop scoping to the grainOnFarm rows instead of the generic commodities list
    // (mirrors how a real Grain on Farm library prompt stamps the category at save time).
    const echo = customer(5, 'Echo Farms', [{ commodityCode: 'SRWW', bushelsOnHand: 15000 }]);
    const commodities = [{ id: 1, code: 'SRWW', name: 'Soft Red Winter Wheat', category: 'Wheat', isActive: true }];
    const result = svc.applyRefinementFilters([...all, echo],
      { _promptCategory: 'Grain on Farm', crops: ['Wheat'] } as never, [], [], { commodities })
      .map(c => c.id).sort((a, b) => a - b);
    expect(result).toContain(5);
  });

  it('scopes a crop chip to grain rows under the renamed "Grain on Farm & Bin Sites" category too', () => {
    const echo = customer(5, 'Echo Farms', [{ commodityCode: 'SRWW', bushelsOnHand: 15000 }]);
    const commodities = [{ id: 1, code: 'SRWW', name: 'Soft Red Winter Wheat', category: 'Wheat', isActive: true }];
    const result = svc.applyRefinementFilters([...all, echo],
      { _promptCategory: 'Grain on Farm & Bin Sites', crops: ['Wheat'] } as never, [], [], { commodities })
      .map(c => c.id);
    expect(result).toContain(5);
  });
});

// Since 2026-09-23 rows hold commodity CODES. The blocks above keep crop-group values on purpose:
// they are exactly what legacy rows saved before the switch look like, and must keep working.
describe('NlqFilterService — grain on farm keyed by commodity code', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  const commodities = [
    { id: 1, code: 'YC', name: 'YELLOW CORN', category: 'Corn', isActive: true },
    { id: 2, code: 'HRWW', name: 'HARD RED WINTER WHEAT', category: 'Wheat', isActive: true },
    { id: 3, code: 'SRWW', name: 'SOFT RED WINTER WHEAT', category: 'Wheat', isActive: true },
  ];
  const foxtrot = customer(6, 'Foxtrot Farms', [{ commodityCode: 'YC', bushelsOnHand: 30000 }]);
  const golf = customer(7, 'Golf Farms', [{ commodityCode: 'HRWW', bushelsOnHand: 25000 }, { commodityCode: 'SRWW', bushelsOnHand: 4000 }]);
  const hotel = customer(8, 'Hotel Farms', [{ commodityCode: 'SRWW', bushelsOnHand: 18000 }]);
  const legacy = customer(9, 'India Farms', [{ commodityCode: 'Wheat', bushelsOnHand: 22000 }]);
  const all = [foxtrot, golf, hotel, legacy];

  const refine = (f: Record<string, unknown>) =>
    svc.applyRefinementFilters(all, f as never, [], [], { commodities } as never).map(c => c.id).sort((a, b) => a - b);

  it('a group chip scopes the bushel refine to that group\'s code rows (and legacy group rows)', () => {
    // Before the switch this path used a substring test, so a "Wheat" chip could never match HRWW.
    expect(refine({ grainOnFarmBushelsOver: 10000, crops: ['Wheat'] })).toEqual([7, 8, 9]);
    expect(refine({ grainOnFarmBushelsOver: 10000, crops: ['Corn'] })).toEqual([6]);
  });

  it('a code chip is precise: HRWW does not pick up an SRWW-only producer', () => {
    // Golf's HRWW row alone clears 20k; Hotel has only SRWW. The legacy "Wheat" row still matches
    // an HRWW chip through its group, because it has no code to be precise about.
    expect(refine({ grainOnFarmBushelsOver: 20000, crops: ['HRWW'] })).toEqual([7, 9]);
  });

  it('sums only the in-scope code rows', () => {
    // Golf holds 29k wheat in total but only 4k SRWW.
    expect(refine({ grainOnFarmBushelsOver: 10000, crops: ['SRWW'] })).toEqual([8, 9]);
  });

  it('"wheat on farm" in a prompt matches producers holding wheat codes', () => {
    const result = svc.parseAndFilter('wheat on farm', { ...ctx(all), commodities } as never);
    const ids = result.customers.map(c => c.id).sort((a, b) => a - b);
    expect(ids).toEqual(expect.arrayContaining([7, 8]));
    expect(ids).not.toContain(6);
  });
});
