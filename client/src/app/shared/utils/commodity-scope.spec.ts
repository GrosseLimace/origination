import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scopeCommodities } from './commodity-scope';

interface Row { code: string; tradeGroupScope?: string | null }

const YC: Row = { code: 'YC' };
const HRWW: Row = { code: 'HRWW', tradeGroupScope: null };
const SOR: Row = { code: 'SOR', tradeGroupScope: '   ' };
const YCO: Row = { code: 'YCO', tradeGroupScope: 'Organics' };
const HRWO: Row = { code: 'HRWO', tradeGroupScope: 'Organics' };

const CONVENTIONAL = ['Corn Belt', 'Feed'];
const ORGANICS = ['Organics & IP'];

describe('commodity-scope', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('always keeps unscoped commodities, even with no groups at all', () => {
    // Null, absent and whitespace-only all mean "everyone" — the state of every row but the organics.
    expect(scopeCommodities([YC, HRWW, SOR], []).map(c => c.code)).toEqual(['YC', 'HRWW', 'SOR']);
  });

  it('hides scoped commodities from a group that does not match', () => {
    expect(scopeCommodities([YC, YCO, HRWO], CONVENTIONAL).map(c => c.code)).toEqual(['YC']);
  });

  it('matches the seeded "Organics" against the real group name "Organics & IP"', () => {
    // The scope value is deliberately shorter than the group name so a rename to
    // "Organics and IP" or "Organics & IP Desk" keeps resolving.
    expect(scopeCommodities([YC, YCO], ORGANICS).map(c => c.code)).toEqual(['YC', 'YCO']);
    expect(scopeCommodities([YCO], ['Organics and IP']).map(c => c.code)).toEqual(['YCO']);
  });

  it('matches case-insensitively in both directions', () => {
    expect(scopeCommodities([{ code: 'YCO', tradeGroupScope: 'ORGANICS' }], ['organics & ip'])).toHaveLength(1);
    expect(scopeCommodities([{ code: 'YCO', tradeGroupScope: 'organics' }], ['ORGANICS & IP'])).toHaveLength(1);
  });

  it('is additive on a mixed selection — one Organics group is enough', () => {
    // Selecting an Organics trade unit alongside a Corn Belt one shows organics AND everything else.
    const mixed = ['Corn Belt', 'Organics & IP'];
    expect(scopeCommodities([YC, HRWW, YCO, HRWO], mixed).map(c => c.code))
      .toEqual(['YC', 'HRWW', 'YCO', 'HRWO']);
  });

  it('warns once so an unmatched scope is diagnosable rather than silently empty', () => {
    // A scope matching no group looks identical to a typo or an upstream group rename.
    const rows = [{ code: 'XYZ', tradeGroupScope: 'ScopeNobodyHas' }];
    scopeCommodities(rows, CONVENTIONAL);
    scopeCommodities(rows, CONVENTIONAL);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('leaves an all-unscoped list untouched', () => {
    const list = [YC, HRWW];
    expect(scopeCommodities(list, [])).toBe(list);
  });
});
