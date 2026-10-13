import { describe, it, expect } from 'vitest';
import { COMMODITY_ALIAS_MAP, expandCommodityAliases, expandSearchWithAliases } from './commodity-aliases';

/**
 * Commodity search treats crop synonyms as equivalent ("milo" finds sorghum, "beans" finds soybeans).
 * This pins exact-key expansion, the prefix expansion that lets a half-typed word ("mi") pull in the
 * whole synonym set, normalisation of case/whitespace, and pass-through of non-aliased terms.
 */
describe('COMMODITY_ALIAS_MAP', () => {
  it('is all lowercase so consumers can lowercase input once and look up', () => {
    for (const [key, terms] of Object.entries(COMMODITY_ALIAS_MAP)) {
      expect(key).toBe(key.toLowerCase());
      for (const t of terms) expect(t).toBe(t.toLowerCase());
    }
  });

  it('every key appears in its own synonym set', () => {
    for (const [key, terms] of Object.entries(COMMODITY_ALIAS_MAP)) {
      expect(terms).toContain(key);
    }
  });
});

describe('expandCommodityAliases', () => {
  it('expands an aliased term to its full synonym set', () => {
    expect(expandCommodityAliases('milo')).toEqual(['milo', 'sorghum', 'sor', 'sg']);
    expect(expandCommodityAliases('sorghum')).toEqual(['milo', 'sorghum', 'sor', 'sg']);
    expect(expandCommodityAliases('corn')).toEqual(['yc', 'corn', 'yellow corn']);
  });

  it('normalises case and surrounding whitespace before lookup', () => {
    expect(expandCommodityAliases('  BeAnS ')).toEqual(['beans', 'soybeans', 'soy', 'sb']);
  });

  it('returns a non-aliased term on its own, normalised', () => {
    expect(expandCommodityAliases(' Canola ')).toEqual(['canola']);
  });

  it('does not prefix-match — a partial word is not expanded', () => {
    expect(expandCommodityAliases('mi')).toEqual(['mi']);
  });
});

describe('expandSearchWithAliases', () => {
  it('returns the alias set for an exact key hit, case-insensitively', () => {
    expect(expandSearchWithAliases('Soy')).toEqual(['beans', 'soybeans', 'soy', 'sb']);
  });

  it('expands a prefix of an alias key into that whole synonym set, keeping the typed text first', () => {
    const terms = expandSearchWithAliases('mi');
    expect(terms[0]).toBe('mi');
    expect(new Set(terms)).toEqual(new Set(['mi', 'milo', 'sorghum', 'sor', 'sg']));
  });

  it('merges every synonym set whose key starts with the prefix, deduplicated', () => {
    // 'h' hits 'hrw', 'hw' and 'hard red winter' — all wheat, so no duplicates may survive the merge.
    const terms = expandSearchWithAliases('h');
    expect(terms.length).toBe(new Set(terms).size);
    expect(new Set(terms)).toEqual(new Set(['h', 'hrw', 'wheat', 'hard red winter', 'hw']));
  });

  it('pulls in more than one crop when the prefix is ambiguous', () => {
    // 's' starts sorghum/sor/sg AND soybeans/soy/sb.
    const terms = expandSearchWithAliases('s');
    expect(terms).toEqual(expect.arrayContaining(['sorghum', 'milo', 'soybeans', 'beans']));
    expect(terms).not.toContain('corn');
  });

  it('passes an unknown term through alone', () => {
    expect(expandSearchWithAliases('Canola')).toEqual(['canola']);
  });

  it('returns a single empty term for blank input rather than expanding every alias', () => {
    expect(expandSearchWithAliases('   ')).toEqual(['']);
  });
});
