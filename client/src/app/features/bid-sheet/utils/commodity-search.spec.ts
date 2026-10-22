import { describe, expect, it } from 'vitest';
import { Commodity } from '@models';
import { MAX_COMMODITY_RESULTS, searchCommodities } from './commodity-search';

const commodity = (code: string, name: string, category: string, over: Partial<Commodity> = {}): Commodity =>
  ({ id: 0, code, name, category, isActive: true, ...over });
const NO_SCOPE = { groupNames: [], tradeUnitCodes: [] };

const LIST: Commodity[] = [
  commodity('YC', 'Yellow Corn', 'Corn'),
  commodity('WC', 'White Corn', 'Corn'),
  commodity('CORNX', 'Corn Exotic', 'Corn'),
  commodity(' YSB ', ' Yellow Soybeans ', 'Soybeans'),
  commodity('YC', 'Yellow Corn Duplicate', 'Corn'),
  commodity('USD', 'Dollar Corn', 'currency'),
  commodity('FRT', 'Corn Freight', 'Transportation'),
  commodity('MEAL', 'Corn Meal', 'Feed &Fert Ingredients'),
  commodity('OC', 'Organic Corn', 'Corn', { tradeGroupScope: 'Organics' }),
  commodity('', 'Codeless Corn', 'Corn'),
  commodity('NN', '', 'Corn'),
];
const search = (q: string, curated = LIST, full: Commodity[] = [], scope = NO_SCOPE) => searchCommodities(q, curated, full, scope);

describe('searchCommodities', () => {
  it('returns nothing for a blank query', () => {
    expect(search('')).toEqual([]);
    expect(search('  ')).toEqual([]);
  });

  it('ranks exact code, then code prefix, then name prefix, then contains — ties by label', () => {
    expect(search('corn').map(r => r.code)).toEqual(['CORNX', 'WC', 'YC']);
    expect(search('yc')).toEqual([{ code: 'YC', name: 'YELLOW CORN (YC)' }]);
    expect(search('yellow')).toEqual([{ code: 'YC', name: 'YELLOW CORN (YC)' }, { code: 'YSB', name: 'YELLOW SOYBEANS (YSB)' }]);
  });

  it('requires every word somewhere in the code or name (not the category)', () => {
    expect(search('yellow corn').map(r => r.code)).toEqual(['YC']);
    expect(search('corn soy')).toEqual([]);
    expect(search('soybeans').map(r => r.code)).toEqual(['YSB']);
    expect(search('nn')).toEqual([{ code: 'NN', name: 'CORN (NN)' }]); // unnamed → category in the label
  });

  it('skips codeless rows, duplicate codes and non-crop categories (case-insensitive)', () => {
    const codes = search('corn').map(r => r.code);
    for (const excluded of ['USD', 'FRT', 'MEAL', '']) expect(codes).not.toContain(excluded);
    // The first MATCHING row per code wins; a later row with the same code is skipped.
    expect(search('yellow corn')).toEqual([{ code: 'YC', name: 'YELLOW CORN (YC)' }]);
    expect(search('duplicate')).toEqual([{ code: 'YC', name: 'YELLOW CORN DUPLICATE (YC)' }]);
  });

  it('drops commodities scoped to a trade group the user is not in', () => {
    expect(search('organic')).toEqual([]);
    expect(search('organic', LIST, [], { groupNames: ['Organics & IP'], tradeUnitCodes: [] })).toEqual([{ code: 'OC', name: 'ORGANIC CORN (OC)' }]);
  });

  it('falls back to the full list (still scoped) when the curated list is empty', () => {
    expect(search('corn', [], LIST).map(r => r.code)).toEqual(['CORNX', 'WC', 'YC']);
    expect(search('organic', [], LIST)).toEqual([]);
  });

  it('caps the results', () => {
    const many = Array.from({ length: 30 }, (_, i) => commodity(`W${i}`, `Wheat ${i}`, 'Wheat'));
    expect(search('wheat', many)).toHaveLength(MAX_COMMODITY_RESULTS);
  });
});
