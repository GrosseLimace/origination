import { describe, it, expect } from 'vitest';
import { COMMODITY_ALIAS_MAP, expandCommodityAliases, expandSearchWithAliases } from './commodity-aliases';
import { CROP_CODE_MAP } from './crop-group-match';

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
  it('expands an aliased term to its words first, then the crop codes', () => {
    expect(expandCommodityAliases('milo')).toEqual(['milo', 'sorghum', 'sor', 'sg', 'soro', 'csor', 'ro98']);
    expect(expandCommodityAliases('sorghum')).toEqual(expandCommodityAliases('milo'));
    expect(expandCommodityAliases('corn')).toEqual(['yc', 'corn', 'yellow corn', 'yco', 'ycng', 'ckyc', 'ycck', 'dmgc']);
  });

  it('normalises case and surrounding whitespace before lookup', () => {
    expect(expandCommodityAliases('  BeAnS ')).toEqual(expandCommodityAliases('beans'));
    expect(expandCommodityAliases('beans').slice(0, 4)).toEqual(['beans', 'soybeans', 'soy', 'sb']);
  });

  // The Tickets table searches the product code only, so a crop word has to expand to every code
  // Build a List knows for that crop, or those tickets cannot be found by crop at all.
  it.each([
    ['wheat', 'wheat'], ['corn', 'corn'], ['beans', 'soybeans'], ['milo', 'sorghum'],
  ] as const)('%s reaches every %s code Build a List knows', (word, group) => {
    const terms = expandCommodityAliases(word);
    for (const code of CROP_CODE_MAP[group]) expect(terms).toContain(code);
  });

  it('finds the wheat tickets it used to miss', () => {
    const terms = expandCommodityAliases('wheat');
    for (const code of ['SRWW', 'SWW', 'HADW', 'DNSW', 'CWRS', 'FDWT', 'WHTO', 'WHFG']) {
      expect(terms.some(t => code.toLowerCase().includes(t))).toBe(true);
    }
  });

  it('keeps the hard-red-winter keys specific to that class', () => {
    expect(expandCommodityAliases('hrw')).toEqual(['hrw', 'wheat', 'hard red winter', 'hw']);
    expect(expandCommodityAliases('hrw')).not.toContain('srww');
  });

  it('leaves barley, canola, oats and sunflower unaliased, whose short codes would match unrelated text', () => {
    expect(expandCommodityAliases('barley')).toEqual(['barley']);
    expect(expandCommodityAliases('oats')).toEqual(['oats']);
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
    expect(expandSearchWithAliases('Soy')).toEqual(expandCommodityAliases('soy'));
  });

  it('expands a prefix of an alias key into that whole synonym set, keeping the typed text first', () => {
    const terms = expandSearchWithAliases('mi');
    expect(terms[0]).toBe('mi');
    expect(new Set(terms)).toEqual(new Set(['mi', ...expandCommodityAliases('milo')]));
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
