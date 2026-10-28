import { describe, it, expect } from 'vitest';
import { Customer } from '@models';
import { binNoteContentAny, planBinSiteNoteChunks } from './bin-site-notes';

const customer = (id: number, ...sites: string[]): Customer => ({
  id, name: `P${id}`, scoularId: `C${id}`, farm: '', location: '', phone: '', email: '', totalAcres: 0,
  linkedProducerIds: [], eSignEnabled: false, achEnabled: false,
  binSites: sites.map((name, i) => ({ siteKey: `${id}-${i}`, name })),
});

describe('planBinSiteNoteChunks', () => {
  it('one chunk for small requests, skipping producers with no named sites and keys already fetched', () => {
    const chunks = planBinSiteNoteChunks(
      [customer(1, 'North', 'South'), customer(2), customer(3, 'North'), customer(4, 'Barn')],
      new Set(['4:barn']), 1500);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].ids).toEqual([1, 3]);
    expect(chunks[0].keys).toEqual(['1:north|south', '3:north']);
    expect([...chunks[0].names]).toEqual(['North', 'South']);
    // id + 3 per producer, encoded name + 3 per NEW name: (1+3 + 8+8) + (1+3 + 0)
    expect(chunks[0].length).toBe(24);
  });

  it('starts a new chunk before the budget would be passed', () => {
    const chunks = planBinSiteNoteChunks([customer(1, 'aaaa'), customer(2, 'bbbb'), customer(3, 'cccc')], new Set(), 22);
    expect(chunks.map(ch => ch.ids)).toEqual([[1, 2], [3]]);
    expect(chunks.map(ch => ch.length)).toEqual([22, 11]);
  });

  it('counts URL-encoded length, and gives an over-budget producer a chunk of its own', () => {
    const chunks = planBinSiteNoteChunks([customer(1, 'a b'), customer(2, 'x'.repeat(40))], new Set(), 20);
    expect(chunks[0].length).toBe(1 + 3 + 5 + 3);
    expect(chunks.map(ch => ch.ids)).toEqual([[1], [2]]);
    expect(chunks[1].length).toBeGreaterThan(20);
  });

  it('returns no chunks when nothing needs fetching', () => {
    expect(planBinSiteNoteChunks([customer(1)], new Set(), 1500)).toEqual([]);
  });
});

describe('binNoteContentAny', () => {
  it('sends the names unless the chunk alone is over budget', () => {
    const chunk = { ids: [1], keys: ['1:a'], names: new Set(['A', 'B']), length: 30 };
    expect(binNoteContentAny(chunk, 30)).toEqual(['A', 'B']);
    expect(binNoteContentAny(chunk, 29)).toBeUndefined();
  });
});
