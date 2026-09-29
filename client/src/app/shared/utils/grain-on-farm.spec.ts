import { describe, it, expect } from 'vitest';
import { Commodity } from '@models';
import { buildCropGroupLookup, buildCropSelection, matchesCropSelection } from './crop-group-match';
import {
  buildGrainOnFarmOptions, grainOnFarmColorKey, grainOnFarmTitle, indexCommoditiesByCode, isGrainOnFarmCode, isLegacyGrainGroup,
} from './grain-on-farm';

const commodity = (code: string, name: string, category?: string): Commodity =>
  ({ id: 0, code, name, category, isActive: true });

// Rows as the Dev/QA Commodities table holds them.
const YC = commodity('YC', 'YELLOW CORN', 'Corn');
const YCNG = commodity('YCNG', 'YELLOW CORN - NON-GMO', 'Corn');
const HRWW = commodity('HRWW', 'HARD RED WINTER WHEAT', 'Wheat');
const SRWW = commodity('SRWW', 'SOFT RED WINTER WHEAT', 'Wheat');
const YSBO = commodity('YSBO', 'ORGANIC SOYBEANS', 'Soybeans');
const CANP = commodity('CANP', 'CANOLA', 'Canola');
const BLY = commodity('BLY', 'BARLEY', 'Barley'); // catalog only, never curated

const CURATED = [YC, YCNG, HRWW, SRWW, YSBO, CANP];
const CATALOG = [...CURATED, BLY];

describe('buildGrainOnFarmOptions', () => {
  const codes = (planting: Commodity[], used: string[] = []) =>
    buildGrainOnFarmOptions({ planting, used }).map(o => o.code);

  it('is one list of the planting commodities, sorted by name and labelled like the planting picker', () => {
    const r = buildGrainOnFarmOptions({ planting: CURATED, used: [] });
    expect(r.map(o => o.code)).toEqual(['CANP', 'HRWW', 'YSBO', 'SRWW', 'YC', 'YCNG']);
    expect(r.find(o => o.code === 'HRWW')!.label).toBe('HARD RED WINTER WHEAT (HRWW)');
  });

  it('excludes codes already recorded, case-insensitively', () => {
    expect(codes(CURATED, ['yc', 'CANP'])).toEqual(['HRWW', 'YSBO', 'SRWW', 'YCNG']);
  });

  it('only offers what the planting list offers', () => {
    // BLY may be on the producer from a ticket, but the planting picker doesn't offer it.
    expect(codes(CURATED)).not.toContain('BLY');
    // Trade-unit scoping happens before this helper; a scoped-out code simply isn't in the input.
    expect(codes(CURATED.filter(c => c !== YSBO))).not.toContain('YSBO');
  });

  it('dedupes and skips blank codes', () => {
    expect(codes([YC, YC, commodity(' ', 'BLANK')])).toEqual(['YC']);
  });
});

describe('legacy-row and display helpers', () => {
  const byCode = indexCommoditiesByCode(CATALOG);
  const lookup = buildCropGroupLookup(CATALOG);

  it('tells a code from a legacy crop-group row', () => {
    expect(isGrainOnFarmCode('YC', byCode)).toBe(true);
    expect(isGrainOnFarmCode('hrww', byCode)).toBe(true);
    expect(isGrainOnFarmCode('Corn', byCode)).toBe(false);
  });

  it('tags a row as legacy only when it really is a crop-group name', () => {
    expect(isLegacyGrainGroup('Corn', byCode, lookup)).toBe(true);     // catalog category
    expect(isLegacyGrainGroup('WHEAT', byCode, lookup)).toBe(true);    // PROD casing
    expect(isLegacyGrainGroup('Sorghum', byCode, lookup)).toBe(true);  // known crop group, not in this catalog
    expect(isLegacyGrainGroup('YC', byCode, lookup)).toBe(false);      // a code
    // A real code whose commodity was deactivated is missing from the catalog — not a group.
    expect(isLegacyGrainGroup('HRW2', byCode, lookup)).toBe(false);
    expect(isLegacyGrainGroup('Corn', new Map(), lookup)).toBe(false); // catalog not loaded yet
  });

  it('titles a code with its name, a legacy row with the re-pick note, and anything else with nothing', () => {
    expect(grainOnFarmTitle('YC', byCode, lookup)).toBe('YELLOW CORN');
    expect(grainOnFarmTitle('Corn', byCode, lookup)).toMatch(/recorded as a crop group/);
    expect(grainOnFarmTitle('HRW2', byCode, lookup)).toBe('');
    expect(grainOnFarmTitle('YC', new Map(), lookup)).toBe('');
  });

  it('colours codes and legacy groups of the same crop alike', () => {
    expect(grainOnFarmColorKey('YC', lookup)).toBe('corn');
    expect(grainOnFarmColorKey('YCNG', lookup)).toBe('corn');
    expect(grainOnFarmColorKey('Corn', lookup)).toBe('corn');
    expect(grainOnFarmColorKey('YSBO', lookup)).toBe('soybeans');
    expect(grainOnFarmColorKey('ZZZ', lookup)).toBe('ZZZ');
  });
});

// Build-A-List and NLQ read the stored value back through crop-group-match with groupOnlyValue.
// Lock in that code rows stay exact and legacy group rows still match.
describe('grain-on-farm values through the crop matcher', () => {
  const lookup = buildCropGroupLookup(CATALOG);
  const groupOnly = { groupOnlyValue: true };
  const matches = (value: string, chips: string[]) =>
    matchesCropSelection(value, buildCropSelection(chips, lookup), lookup, groupOnly);

  it('a group chip matches every code in the group and a legacy group row', () => {
    expect(matches('HRWW', ['Wheat'])).toBe(true);
    expect(matches('SRWW', ['Wheat'])).toBe(true);
    expect(matches('Wheat', ['Wheat'])).toBe(true);
    expect(matches('YC', ['Wheat'])).toBe(false);
  });

  it('a code chip matches its own code exactly, not a sibling code', () => {
    expect(matches('HRWW', ['HRWW'])).toBe(true);
    expect(matches('SRWW', ['HRWW'])).toBe(false);
    expect(matches('YCNG', ['YC'])).toBe(false);
  });

  it('a code chip still matches a legacy group row of its own crop', () => {
    expect(matches('Wheat', ['HRWW'])).toBe(true);
    expect(matches('Corn', ['HRWW'])).toBe(false);
  });
});
