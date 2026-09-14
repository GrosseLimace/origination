import { describe, it, expect } from 'vitest';
import { buildCropGroupLookup, buildCropSelection, matchesCropSelection, resolveCropGroup, CROP_CHIP_GROUPS } from './crop-group-match';
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

describe('CROP_CHIP_GROUPS — what the Crops refine chip is allowed to offer', () => {
  it('is exactly the 6 field-crop categories, not the ~90 categories dbo.Commodities actually has', () => {
    // Pinned per explicit confirmation: dbo.Commodities is a company-wide master shared with
    // Scoular's other business lines (marine protein, animal feed ingredients, freight,
    // "Processed Co-Product" — 972 codes of custom feed blends — etc.). Without this allowlist,
    // availableCrops() surfaced whatever category a producer's commodity code happened to map
    // to, including those, as if they were crops.
    expect([...CROP_CHIP_GROUPS].sort()).toEqual(['barley', 'canola', 'corn', 'sorghum', 'soybeans', 'wheat']);
  });

  it('excludes real non-crop categories a producer\'s commodity code can legitimately carry', () => {
    for (const nonCrop of ['processed co-product', 'fishmeal', 'petfood', 'freight', 'tallow', 'miscellaneous']) {
      expect(CROP_CHIP_GROUPS.has(nonCrop)).toBe(false);
    }
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

/**
 * The Crops refine chips are commodity CODES (YC, HRWW), not categories. A code chip must stay
 * precise — widening it to its crop group would make every code in that group return identical
 * results, which is the entire reason for showing codes. Group chips (what saved lists stored
 * before codes existed) must keep behaving exactly as they always did.
 */
describe('crop-group-match — code chips are precise, group chips still widen', () => {
  const lookup = buildCropGroupLookup([
    commodity('HRWW', 'Hard Red Winter Wheat', 'Wheat'),
    commodity('SRWW', 'Soft Red Winter Wheat', 'Wheat'),
    commodity('YC', 'Yellow Corn', 'Corn'),
    commodity('YCO', 'Yellow Corn Organic', 'Corn'),
    // Ticket-only codes sync with a null Category — a code chip must still work for them.
    commodity('DMGC', 'Damaged Corn', undefined),
  ]);

  it('a code chip matches its own code and not a sibling code in the same group', () => {
    const sel = buildCropSelection(['HRWW'], lookup);
    expect(matchesCropSelection('HRWW', sel, lookup)).toBe(true);
    expect(matchesCropSelection('SRWW', sel, lookup)).toBe(false);
  });

  it('a code chip matches the commodity name as well as the code', () => {
    const sel = buildCropSelection(['YC'], lookup);
    expect(matchesCropSelection('Yellow Corn', sel, lookup)).toBe(true);
    expect(matchesCropSelection('Yellow Corn Organic', sel, lookup)).toBe(false);
  });

  it('a code chip does NOT match a bare group label on a row that also carries a code', () => {
    // A contract exposes commodityCode AND commodityGroup; matching the group would let an HRWW
    // chip pull in every wheat contract.
    const sel = buildCropSelection(['HRWW'], lookup);
    expect(matchesCropSelection('Wheat', sel, lookup)).toBe(false);
  });

  it('a code chip DOES match a group-only value when the caller opts in (grain on farm)', () => {
    const sel = buildCropSelection(['HRWW'], lookup);
    expect(matchesCropSelection('Wheat', sel, lookup, { groupOnlyValue: true })).toBe(true);
    expect(matchesCropSelection('Corn', sel, lookup, { groupOnlyValue: true })).toBe(false);
  });

  it('works for a code whose Category is null (ticket-only codes)', () => {
    const sel = buildCropSelection(['DMGC'], lookup);
    expect(matchesCropSelection('DMGC', sel, lookup)).toBe(true);
    expect(matchesCropSelection('YC', sel, lookup)).toBe(false);
  });

  it('selecting several codes matches any of them, still without widening', () => {
    const sel = buildCropSelection(['HRWW', 'YC'], lookup);
    expect(matchesCropSelection('HRWW', sel, lookup)).toBe(true);
    expect(matchesCropSelection('YC', sel, lookup)).toBe(true);
    expect(matchesCropSelection('SRWW', sel, lookup)).toBe(false);
    expect(matchesCropSelection('YCO', sel, lookup)).toBe(false);
  });

  it('a legacy group chip still widens to every code in that group', () => {
    const sel = buildCropSelection(['Wheat'], lookup);
    expect(matchesCropSelection('HRWW', sel, lookup)).toBe(true);
    expect(matchesCropSelection('SRWW', sel, lookup)).toBe(true);
    expect(matchesCropSelection('YC', sel, lookup)).toBe(false);
  });

  it('a mixed selection keeps each chip on its own rules', () => {
    const sel = buildCropSelection(['Wheat', 'YC'], lookup);
    expect(matchesCropSelection('SRWW', sel, lookup)).toBe(true);  // via the group chip
    expect(matchesCropSelection('YC', sel, lookup)).toBe(true);    // via the code chip
    expect(matchesCropSelection('YCO', sel, lookup)).toBe(false);  // corn, but not the picked code
  });
});
