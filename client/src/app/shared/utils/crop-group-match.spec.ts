import { describe, it, expect } from 'vitest';
import { buildCropGroupLookup, buildCropSelection, matchesCropSelection, resolveCropGroup } from './crop-group-match';
import { Commodity } from '@models';

function commodity(code: string, name: string, category?: string): Commodity {
  return { id: 0, code, name, category, isActive: true };
}

describe('crop-group-match — table-driven codes verified against real TU-scoped commodities', () => {
  // Commodities.category is what availableCrops() groups by — these rows mirror the shape a
  // real Commodities sync produces (Category derived from Contracts.CommodityGroup).
  const table: Commodity[] = [
    commodity('WHTO', 'Wheat - Organic', 'Wheat'),
    commodity('SRWW', 'Soft Red Winter Wheat', 'Wheat'),
    commodity('SWW', 'Soft White Wheat', 'Wheat'),
    commodity('HADW', 'Hard Amber Durum Wheat', 'Wheat'),
    commodity('DNSW', 'Dark Northern Spring Wheat', 'Wheat'),
    commodity('CWRS', 'Canada Western Red Spring', 'Wheat'),
    commodity('FDWT', 'Feed Wheat', 'Wheat'),
    commodity('WHFG', 'Wheat Feed Grade', 'Wheat'),
    commodity('DNGS', 'Non-GMO Soybeans', 'Soybeans'),
    commodity('DOSB', 'Organic Soybeans', 'Soybeans'),
    commodity('YSBO', 'Yellow Soybeans Organic', 'Soybeans'),
    commodity('YC', 'Yellow Corn', 'Corn'),
    commodity('BLY', 'Barley', 'Barley'),
    commodity('CANP', 'Canola', 'Canola'),
    commodity('SUNFL', 'Sunflower', 'Sunflower'),
  ];
  const lookup = buildCropGroupLookup(table);
  const wheat = buildCropSelection(['Wheat'], lookup);
  const soybeans = buildCropSelection(['Soybeans'], lookup);

  it('every verified wheat code resolves under the Wheat chip', () => {
    for (const code of ['WHTO', 'SRWW', 'SWW', 'HADW', 'DNSW', 'CWRS', 'FDWT', 'WHFG']) {
      expect(matchesCropSelection(code, wheat, lookup), `${code} should match Wheat`).toBe(true);
    }
  });

  it('every verified soybean code resolves under the Soybeans chip', () => {
    for (const code of ['DNGS', 'DOSB', 'YSBO']) {
      expect(matchesCropSelection(code, soybeans, lookup), `${code} should match Soybeans`).toBe(true);
    }
  });

  it('alias-less groups (Barley, Canola, Sunflower) resolve via Commodities.category', () => {
    const barley = buildCropSelection(['Barley'], lookup);
    const canola = buildCropSelection(['Canola'], lookup);
    const sunflower = buildCropSelection(['Sunflower'], lookup);
    expect(matchesCropSelection('BLY', barley, lookup)).toBe(true);
    expect(matchesCropSelection('CANP', canola, lookup)).toBe(true);
    expect(matchesCropSelection('SUNFL', sunflower, lookup)).toBe(true);
  });

  it('does not cross-match a wheat code against the Corn chip', () => {
    const corn = buildCropSelection(['Corn'], lookup);
    expect(matchesCropSelection('WHTO', corn, lookup)).toBe(false);
    expect(matchesCropSelection('YC', wheat, lookup)).toBe(false);
  });
});

describe('crop-group-match — the round-trip invariant (chip label matches what it filters)', () => {
  it('a chip resolved from Commodity.category matches the code that produced it', () => {
    const lookup = buildCropGroupLookup([commodity('WHTO', 'Wheat - Organic', 'Wheat')]);
    const group = resolveCropGroup('WHTO', lookup);
    expect(group).toBe('wheat');
    const sel = buildCropSelection([group!], lookup);
    expect(matchesCropSelection('WHTO', sel, lookup)).toBe(true);
  });
});

describe('crop-group-match — null-category fallback (ticket-only codes)', () => {
  it('falls through to the token map when Commodity.category is null', () => {
    // A code that only ever appears on a ticket syncs with no category — the lookup must NOT
    // treat it as its own one-member group; it should fall through to CROP_CODE_MAP instead.
    const lookup = buildCropGroupLookup([commodity('YCNG', 'Yellow Corn NGMO', undefined)]);
    expect(resolveCropGroup('YCNG', lookup)).toBe('corn');
  });
});

describe('crop-group-match — literal fallback (empty lookup, saved lists with raw codes)', () => {
  it('matches an exact literal even with no lookup at all', () => {
    const sel = buildCropSelection(['YC']);
    expect(matchesCropSelection('YC', sel)).toBe(true);
    expect(matchesCropSelection('yc', sel)).toBe(true); // case-insensitive
  });

  it('a lowercase group name (older saved lists) still matches via the token map', () => {
    const sel = buildCropSelection(['corn']);
    expect(matchesCropSelection('YC', sel)).toBe(true); // corn -> yc via CROP_CODE_MAP
  });
});

describe('crop-group-match — bug-fix regressions', () => {
  const sel = buildCropSelection(['Soybeans', 'Corn']);

  it('a blank/whitespace value never matches (the old bidirectional-substring matcher treated "" as matching anything)', () => {
    expect(matchesCropSelection('', sel)).toBe(false);
    expect(matchesCropSelection(null, sel)).toBe(false);
    expect(matchesCropSelection(undefined, sel)).toBe(false);
    expect(matchesCropSelection('   ', sel)).toBe(false);
  });

  it('short 2-letter values no longer false-positive via alias substring matching', () => {
    // Old matcher: 'be'.includes(...) / (...).includes('be') against the 'beans' alias made
    // "BE" match Soybeans, and "OR" matched Corn via 'corn'/'sor' overlap-style bugs.
    expect(matchesCropSelection('BE', sel)).toBe(false);
    expect(matchesCropSelection('OR', sel)).toBe(false);
  });

  it('an empty selection matches everything (no crop filter applied)', () => {
    const empty = buildCropSelection([]);
    expect(matchesCropSelection('anything', empty)).toBe(true);
    expect(matchesCropSelection('', empty)).toBe(true);
  });

  it('a long free-text value still resolves via bounded token containment', () => {
    const wheat = buildCropSelection(['Wheat']);
    expect(matchesCropSelection('HRW WHEAT 11.5PRO', wheat)).toBe(true);
  });
});
