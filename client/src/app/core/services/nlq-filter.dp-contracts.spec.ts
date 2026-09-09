import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService, NlqFilterContext } from './nlq-filter.service';
import { Customer, DpContract } from '@models';

/**
 * Neutral names (Alpha/Bravo/…) so the engine's name-search paths can't match crop words.
 *
 * `commodities` is populated on every customer deliberately: a query naming a crop also runs the
 * engine's generic commodity filter against customer.commodities, so leaving it empty would filter
 * everyone out before the DP logic under test ever ran.
 */
function customer(id: number, name: string): Customer {
  return {
    id, name, farm: '', location: '', phone: '', email: '',
    totalAcres: 0, linkedProducerIds: [], eSignEnabled: false,
    commodities: ['Corn', 'Soybeans'],
  } as Customer;
}

/**
 * One DP charge row. Real DP deliveries emit TWO rows (flat initial charge + accruing storage rate)
 * that repeat the same quantity — `delivery()` below builds that pair, which is what the bushel
 * de-duplication has to survive.
 */
function row(over: Partial<DpContract> = {}): DpContract {
  return {
    id: 'r1', ticketKey: 't1', ticketNumber: '100', contractNumber: 'PCPL84649',
    contractPrefixType: 'P', contractPrefixCommodity: 'C', contractSuffix: 'A', ticketStatus: 'U/L',
    customerId: 1, customerCode: 'ABCFARM', tradeUnitCode: '1340', crop: 'YC',
    quantity: 1000, grossQuantity: 1000, quantityUom: 'BU', bushels: 1000,
    storageDays: 100, decideFreeDays: 0, storageRate: 0.3,
    receivableAmount: 100, prepaidAmount: 0, unearnedStorageAmount: 0, unpaidHandlingAmount: 0,
    storageStartDate: new Date('2025-08-20T00:00:00'), chargedFromDate: new Date('2025-08-20T00:00:00'),
    chargedThruDate: new Date('2025-12-31T00:00:00'), paidThruDate: null,
    bolDate: new Date('2025-08-20T00:00:00'), status: '2',
    statusDescription: 'INITIAL CHARGE 2 - CHARGE/BU/D', storageProgramCode: 'D25',
    storageErrorFlag: '', storageErrorDescription: '',
    ...over,
  };
}

/** A physical delivery: two charge rows sharing a ticketKey and repeating the same quantity. */
function delivery(
  customerId: number,
  key: string,
  opts: { crop?: string; bushels?: number; days?: number; initial?: number; accrued?: number; contract?: string } = {}
): DpContract[] {
  const base = {
    customerId, ticketKey: key, ticketNumber: key, crop: opts.crop ?? 'YC',
    bushels: opts.bushels ?? 1000, quantity: opts.bushels ?? 1000,
    storageDays: opts.days ?? 100, contractNumber: opts.contract ?? 'PCPL84649',
  };
  return [
    row({ ...base, id: `${key}|2`, status: '2', receivableAmount: opts.initial ?? 100 }),
    row({ ...base, id: `${key}|S`, status: 'S', receivableAmount: opts.accrued ?? 50 }),
  ];
}

function ctx(customers: Customer[], dpContracts: DpContract[]): NlqFilterContext {
  return { customers, contracts: [], tickets: [], notes: [], plantingIntentions: [], storedGrain: [], dpContracts };
}

describe('NlqFilterService — DP contracts', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  const alpha = customer(1, 'Alpha Farms');
  const bravo = customer(2, 'Bravo Farms');
  const charlie = customer(3, 'Charlie Farms');
  const all = [alpha, bravo, charlie];

  // Alpha: 2,000 bu corn, 300 days, $450 charges | Bravo: 500 bu soybeans, 30 days, $30 | Charlie: no DP
  const dp: DpContract[] = [
    ...delivery(1, 'a1', { crop: 'YC', bushels: 1000, days: 300, initial: 200, accrued: 100 }),
    ...delivery(1, 'a2', { crop: 'YC', bushels: 1000, days: 300, initial: 100, accrued: 50 }),
    ...delivery(2, 'b1', { crop: 'YSB', bushels: 500, days: 30, initial: 20, accrued: 10, contract: 'PCPL83903' }),
  ];

  const ids = (q: string) => svc.parseAndFilter(q, ctx(all, dp)).customers.map(c => c.id).sort((a, b) => a - b);

  describe('queryInvolvesDpContracts', () => {
    it('recognizes DP phrasings', () => {
      for (const q of ['producers with DP contracts', 'on dp over 90 days', 'delayed pricing', 'deferred pricing']) {
        expect(svc.queryInvolvesDpContracts(q)).toBe(true);
      }
    });

    it('does not fire on "dp" inside another word', () => {
      // A bare substring check would match these and trigger a needless DP fetch.
      for (const q of ['producers in Bridgeport', 'adpative growers']) {
        expect(svc.queryInvolvesDpContracts(q)).toBe(false);
      }
    });
  });

  it('"producers with DP contracts" → only producers holding DP', () => {
    expect(ids('producers with DP contracts')).toEqual([1, 2]);
  });

  it('"producers with no dp" → the inverse', () => {
    // Deliberately avoids the word "contracts", which would also engage the contract filter.
    expect(ids('producers with no dp')).toEqual([3]);
  });

  it('scopes to a commodity', () => {
    expect(ids('producers with corn on dp')).toEqual([1]);
  });

  it('filters by days on DP', () => {
    expect(ids('producers on dp over 90 days')).toEqual([1]);
  });

  it('filters by accrued charges', () => {
    // Alpha $450 total, Bravo $30 — charges are additive across charge rows.
    expect(ids('producers with dp charges over $100')).toEqual([1]);
  });

  it('filters by bushels, counting each delivery ONCE', () => {
    // Alpha holds 2,000 bu across 2 deliveries (4 rows). Summing rows would read 4,000 and would
    // wrongly match a 3,000 threshold.
    expect(ids('producers with dp over 1500 bu')).toEqual([1]);
    expect(ids('producers with dp over 3000 bu')).toEqual([]);
  });

  it('ranks by DP bushels, most first', () => {
    const result = svc.parseAndFilter('top 25 producers by dp bushels', ctx(all, dp));
    expect(result.customers.map(c => c.id).slice(0, 2)).toEqual([1, 2]);
  });

  it('excludes zero-DP producers from a DP ranking rather than padding to N', () => {
    // Charlie has no DP. A "top 25" over 3 customers would otherwise pad the list out with him.
    const result = svc.parseAndFilter('top 25 producers by dp bushels', ctx(all, dp));

    expect(result.customers.map(c => c.id)).toEqual([1, 2]);
  });

  it('caps a DP ranking at the requested count', () => {
    // 2 DP holders, asked for 1 — the larger (Alpha, 2,000 bu) wins.
    const result = svc.parseAndFilter('top 1 producers by dp bushels', ctx(all, dp));

    expect(result.customers.map(c => c.id)).toEqual([1]);
  });

  it('tags matched patterns so the UI can react', () => {
    expect(svc.parseAndFilter('producers with DP contracts', ctx(all, dp)).matchedPatterns).toContain('dp');
    expect(svc.parseAndFilter('producers with no DP contracts', ctx(all, dp)).matchedPatterns).toContain('no_dp');
    expect(svc.parseAndFilter('on dp over 90 days', ctx(all, dp)).matchedPatterns).toContain('dp_duration');
    expect(svc.parseAndFilter('dp charges over $500', ctx(all, dp)).matchedPatterns).toContain('dp_charges');
    expect(svc.parseAndFilter('top 25 producers by dp bushels', ctx(all, dp)).matchedPatterns).toContain('top_n_dp');
  });

  it('leaves the list untouched when a non-DP prompt runs', () => {
    expect(ids('all producers')).toEqual([1, 2, 3]);
  });

  it('treats missing dpContracts as no DP rather than throwing', () => {
    const noDpCtx: NlqFilterContext = { customers: all, contracts: [], tickets: [], notes: [], plantingIntentions: [], storedGrain: [] };
    expect(svc.parseAndFilter('producers with DP contracts', noDpCtx).customers).toEqual([]);
  });

  describe('refinement filters', () => {
    const refine = (f: Record<string, unknown>) =>
      svc.applyRefinementFilters(all, f as never, [], [], { dpContracts: dp })
        .map(c => c.id).sort((a, b) => a - b);

    it('hasDpContracts is inferred as the DP dimension for crop scoping', () => {
      // Crop scoping must run against DP positions, not generic customer.commodities.
      expect(refine({ hasDpContracts: true, crops: ['YC'] })).toEqual([1]);
      expect(refine({ hasDpContracts: true, crops: ['YSB'] })).toEqual([2]);
    });

    it('the DP Contracts prompt category scopes crops the same way', () => {
      expect(refine({ _promptCategory: 'DP Contracts', crops: ['YSB'] })).toEqual([2]);
    });

    it('with dimensionContext.commodities, a "Corn" chip catches a code the literal fallback alone would miss', () => {
      // YCNG isn't in the DP rows above (YC is), so this specifically exercises group resolution:
      // the chip "Corn" resolves via Commodity.category, and YCNG resolves to the same group.
      const dpWithAltCode: DpContract[] = [...dp, ...delivery(3, 'c1', { crop: 'YCNG', bushels: 400, days: 10 })];
      const commodities = [
        { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true },
        { id: 2, code: 'YCNG', name: 'Yellow Corn NGMO', category: 'Corn', isActive: true },
        { id: 3, code: 'YSB', name: 'Yellow Soybeans', category: 'Soybeans', isActive: true },
      ];
      const result = svc.applyRefinementFilters(all, { hasDpContracts: true, crops: ['Corn'] } as never, [], [],
        { dpContracts: dpWithAltCode, commodities })
        .map(c => c.id).sort((a, b) => a - b);
      expect(result).toEqual([1, 3]);
    });
  });
});
