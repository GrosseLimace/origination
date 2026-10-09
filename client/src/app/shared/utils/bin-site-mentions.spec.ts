import { describe, it, expect } from 'vitest';
import { binSiteMentionPattern, binSiteNames, notesMentioningBinSites, splitByBinSiteNames } from './bin-site-mentions';

const note = (id: number, content: string, createdAt: string, isPinned = false) => ({ id, content, createdAt: new Date(createdAt), isPinned });

describe('binSiteNames', () => {
  it('keeps named sites once each, trimmed, in order', () => {
    expect(binSiteNames([{ name: ' North Bins ' }, { name: '' }, { name: null }, { name: 'north bins' }, { name: 'Bin 1' }]))
      .toEqual(['North Bins', 'Bin 1']);
    expect(binSiteNames(undefined)).toEqual([]);
  });
});

describe('binSiteMentionPattern', () => {
  it('matches the whole name, any case, with flexible spacing', () => {
    const re = binSiteMentionPattern('North Bins');
    expect(re.test('Checked north bins today')).toBe(true);
    expect(re.test('NORTH   BINS are full')).toBe(true);
    expect(re.test('northbins')).toBe(false);
  });

  it('does not match inside a longer word or number', () => {
    const re = binSiteMentionPattern('Bin 1');
    expect(re.test('bin 1 is full')).toBe(true);
    expect(re.test('(Bin 1)')).toBe(true);
    expect(re.test('bin 10 is full')).toBe(false);
    expect(binSiteMentionPattern('Home').test('homestead')).toBe(false);
  });

  it('treats regex characters in a name literally', () => {
    expect(binSiteMentionPattern('Bins (East)').test('moved corn to bins (east)')).toBe(true);
    expect(binSiteMentionPattern('A+B').test('AAB')).toBe(false);
  });

  it('a hyphen or slash in a name compiles under the u flag and matches literally', () => {
    expect(() => binSiteMentionPattern('Hwy-30 Bins')).not.toThrow();
    expect(binSiteMentionPattern('Hwy-30 Bins').test('corn at hwy-30 bins')).toBe(true);
    expect(binSiteMentionPattern('Hwy-30 Bins').test('hwy 30 bins')).toBe(false);
    expect(binSiteMentionPattern('North/South').test('the north/south site')).toBe(true);
  });
});

describe('notesMentioningBinSites', () => {
  const notes = [
    note(1, 'Called about price', '2026-10-01'),
    note(2, 'North Bins about full, Home Place empty', '2026-10-05'),
    note(3, 'Loaded out of home place', '2026-10-08'),
    note(4, 'Pinned: north bins aeration', '2026-09-01', true),
  ];

  it('returns the notes naming a site, pinned first then newest, and which sites came up', () => {
    const result = notesMentioningBinSites(notes, ['North Bins', 'Home Place', 'East Quarter']);
    expect(result?.notes.map(n => n.id)).toEqual([4, 3, 2]);
    expect(result?.sites).toEqual(['North Bins', 'Home Place']);
  });

  it('is null when nothing mentions a site, or there are no sites', () => {
    expect(notesMentioningBinSites(notes, ['East Quarter'])).toBeNull();
    expect(notesMentioningBinSites(notes, [])).toBeNull();
  });
});

describe('splitByBinSiteNames', () => {
  it('marks each run naming a site, longest name first, keeping the text exactly', () => {
    const text = 'North Bins full, north side empty; moved to bin 1 not bin 10';
    const runs = splitByBinSiteNames(text, ['North', 'North Bins', 'Bin 1']);
    expect(runs.map(r => r.text).join('')).toBe(text);
    expect(runs.filter(r => r.bin).map(r => r.text)).toEqual(['North Bins', 'north', 'bin 1']);
  });

  it('returns the text as one plain run with no sites, and nothing for empty text', () => {
    expect(splitByBinSiteNames('hello', [])).toEqual([{ text: 'hello', bin: false }]);
    expect(splitByBinSiteNames('', ['North Bins'])).toEqual([]);
  });
});
