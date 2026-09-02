import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scopeCommodities, CommodityScopeContext } from './commodity-scope';

interface Row { code: string; tradeGroupScope?: string | null; tradeUnitScope?: string | null }

// Unscoped — visible to everyone. This is every row in the table bar a handful.
const YC: Row = { code: 'YC' };
const HRWW: Row = { code: 'HRWW', tradeGroupScope: null };
const SOR: Row = { code: 'SOR', tradeGroupScope: '   ', tradeUnitScope: '  ' };
// Group-scoped — the Organics & IP crops.
const YCO: Row = { code: 'YCO', tradeGroupScope: 'Organics' };
const HRWO: Row = { code: 'HRWO', tradeGroupScope: 'Organics' };
// Unit-scoped — the specialty soy/corn grades for three of the six Organics units.
const DNGS: Row = { code: 'DNGS', tradeUnitScope: '2090,2291,2295' };
const DOSB: Row = { code: 'DOSB', tradeUnitScope: '2090,2291,2295' };

function ctx(groupNames: string[], tradeUnitCodes: string[]): CommodityScopeContext {
  return { groupNames, tradeUnitCodes };
}

const CONVENTIONAL = ctx(['Corn Belt', 'Feed'], ['2115', '2190']);
const ORGANICS_SUBSET = ctx(['Organics & IP'], ['2090']);
const ORGANICS_OTHER = ctx(['Organics & IP'], ['2080']);

describe('commodity-scope', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('always keeps unscoped commodities, even with nothing in scope', () => {
    expect(scopeCommodities([YC, HRWW, SOR], ctx([], [])).map(c => c.code)).toEqual(['YC', 'HRWW', 'SOR']);
  });

  it('hides both kinds of scoped row from a conventional user', () => {
    expect(scopeCommodities([YC, YCO, DNGS], CONVENTIONAL).map(c => c.code)).toEqual(['YC']);
  });

  // --- group scope: substring, so a rename doesn't silently hide the crops -------------------
  it('matches the seeded "Organics" against the real group name "Organics & IP"', () => {
    expect(scopeCommodities([YCO], ORGANICS_SUBSET).map(c => c.code)).toEqual(['YCO']);
    expect(scopeCommodities([YCO], ctx(['Organics and IP'], [])).map(c => c.code)).toEqual(['YCO']);
  });

  it('matches group scope case-insensitively in both directions', () => {
    expect(scopeCommodities([{ code: 'X', tradeGroupScope: 'ORGANICS' }], ctx(['organics & ip'], []))).toHaveLength(1);
    expect(scopeCommodities([{ code: 'X', tradeGroupScope: 'organics' }], ctx(['ORGANICS & IP'], []))).toHaveLength(1);
  });

  // --- unit scope: EXACT, because substring on numeric codes is dangerous --------------------
  it('shows unit-scoped rows only for a listed trade unit', () => {
    expect(scopeCommodities([DNGS, DOSB], ORGANICS_SUBSET).map(c => c.code)).toEqual(['DNGS', 'DOSB']);
  });

  it('hides unit-scoped rows from an Organics unit that is NOT in the list', () => {
    // 2080 is Organics & IP but outside the 2090/2291/2295 subset. This is the case group-level
    // scoping could not express, and the whole reason TradeUnitScope exists.
    expect(scopeCommodities([DNGS], ORGANICS_OTHER)).toHaveLength(0);
    // ...while group-scoped organics crops still reach it.
    expect(scopeCommodities([HRWO], ORGANICS_OTHER).map(c => c.code)).toEqual(['HRWO']);
  });

  it('does NOT treat a unit code as a substring — "209" must not match 2090', () => {
    // Substring matching (which group scope uses) would match 2090, 2093 and 2094 here.
    expect(scopeCommodities([DNGS], ctx([], ['209']))).toHaveLength(0);
    expect(scopeCommodities([{ code: 'X', tradeUnitScope: '209' }], ctx([], ['2090']))).toHaveLength(0);
  });

  it('tolerates whitespace in the stored code list', () => {
    expect(scopeCommodities([{ code: 'X', tradeUnitScope: ' 2090 , 2291 ' }], ctx([], ['2291']))).toHaveLength(1);
  });

  // --- the two scopes OR together -----------------------------------------------------------
  it('shows a doubly-scoped row when EITHER the group or a unit matches', () => {
    const both: Row = { code: 'BOTH', tradeGroupScope: 'Organics', tradeUnitScope: '2090' };
    expect(scopeCommodities([both], ctx(['Organics & IP'], ['9999']))).toHaveLength(1); // group only
    expect(scopeCommodities([both], ctx(['Corn Belt'], ['2090']))).toHaveLength(1);      // unit only
    expect(scopeCommodities([both], ctx(['Corn Belt'], ['2115']))).toHaveLength(0);      // neither
  });

  it('is additive on a mixed selection', () => {
    const mixed = ctx(['Corn Belt', 'Organics & IP'], ['2115', '2090']);
    expect(scopeCommodities([YC, YCO, DNGS], mixed).map(c => c.code)).toEqual(['YC', 'YCO', 'DNGS']);
  });

  it('warns once so an unmatched scope is diagnosable rather than silently empty', () => {
    const rows = [{ code: 'XYZ', tradeGroupScope: 'ScopeNobodyHas' }];
    scopeCommodities(rows, CONVENTIONAL);
    scopeCommodities(rows, CONVENTIONAL);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('leaves an all-unscoped list untouched', () => {
    const list = [YC, HRWW];
    expect(scopeCommodities(list, ctx([], []))).toBe(list);
  });
});
