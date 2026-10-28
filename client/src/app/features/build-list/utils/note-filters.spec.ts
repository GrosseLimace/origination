import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Customer, Note, RefinementFilters } from '@models';
import { buildLinkedProducerComponents } from '@shared/utils/linked-producers';
import {
  aggregateMatchingNotes, buildNoteFilterPredicate, indexMatchingNotesByCode, isNoteFilterActive, lastContactBadges,
  lastContactTimeByCustomer, noteScope, parseNoteTime, recencyWindowDays,
} from './note-filters';

const NOW = new Date('2026-10-13T12:00:00Z');
const DAY = 86400000;

const customer = (id: number, over: Partial<Customer> = {}): Customer => ({
  id, name: `P${id}`, scoularId: `C${id}`, farm: '', location: '', phone: '', email: '', totalAcres: 0,
  linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
});
const note = (id: number, over: Partial<Note> = {}): Note => ({
  id, customerId: 1, customerName: '', customerCode: 'C1', content: '', isPinned: false, createdBy: 'x',
  createdAt: '2026-10-12T00:00:00' as never, ...over,
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe('parseNoteTime', () => {
  it('reads a bare ISO string as UTC and leaves zoned strings and Dates alone', () => {
    expect(parseNoteTime('2026-10-12T10:00:00')).toBe(Date.UTC(2026, 9, 12, 10));
    expect(parseNoteTime('2026-10-12T10:00:00Z')).toBe(Date.UTC(2026, 9, 12, 10));
    expect(parseNoteTime('2026-10-12T10:00:00-05:00')).toBe(Date.UTC(2026, 9, 12, 15));
    expect(parseNoteTime(new Date(Date.UTC(2026, 0, 1)))).toBe(Date.UTC(2026, 0, 1));
  });
});

describe('isNoteFilterActive', () => {
  it('is driven by any note refinement', () => {
    expect(isNoteFilterActive({}, 'all producers')).toBe(false);
    for (const r of [{ notesInLastDays: 3 }, { noteKeyword: 'x' }, { hasPinnedNotes: true }, { contactedByMeOnly: true },
      { contactedMoreThan5: true }, { neverContacted: true }, { notContactedDays: 30 }] as RefinementFilters[]) {
      expect(isNoteFilterActive(r, '')).toBe(true);
    }
    expect(isNoteFilterActive({ noteKeyword: '  ', notContactedDays: 0 }, '')).toBe(false);
  });

  it('or by note / contact phrasing in the prompt', () => {
    expect(isNoteFilterActive({}, 'Producers contacted this week')).toBe(true);
    expect(isNoteFilterActive({}, 'Notes added today')).toBe(true);
    expect(isNoteFilterActive({}, 'Producers with pinned notes')).toBe(true);
    expect(isNoteFilterActive({}, 'Producers with notes')).toBe(true);
    expect(isNoteFilterActive({}, 'Notes mentioning drought')).toBe(true);
    expect(isNoteFilterActive({}, 'Producers with the most notes')).toBe(false);
  });
});

describe('buildNoteFilterPredicate', () => {
  const deps = (cands: string[] = ['pat']) => ({
    authorCandidates: vi.fn(() => cands),
    matchesAuthor: vi.fn((by: string | null | undefined, c: string[]) => c.includes((by ?? '').toLowerCase())),
  });
  const keep = (r: RefinementFilters, q: string, notes: Note[], d = deps()) =>
    notes.filter(buildNoteFilterPredicate(r, q, d)).map(n => n.id);

  const recent = note(1, { createdAt: new Date(NOW.getTime() - 2 * DAY) });
  const older = note(2, { createdAt: new Date(NOW.getTime() - 10 * DAY) });

  it('cuts off by the refinement window, or by the window named in the prompt', () => {
    expect(keep({ notesInLastDays: 5 }, '', [recent, older])).toEqual([1]);
    expect(keep({}, 'producers contacted in the last 7 days', [recent, older])).toEqual([1]);
    expect(keep({}, 'notes added this month', [recent, older])).toEqual([1, 2]);
    expect(keep({}, 'producers called today', [recent, older])).toEqual([]);
  });

  it('shows every note for absence prompts', () => {
    expect(keep({ notContactedDays: 5 }, 'contacted in the last 1 days', [recent, older])).toEqual([1, 2]);
    expect(keep({}, 'producers not contacted in 3 days', [recent, older])).toEqual([1, 2]);
  });

  it('keyword from the refinement, or quoted / bare in the prompt', () => {
    const a = note(1, { content: 'Drought in the north' });
    const b = note(2, { content: 'Hail' });
    expect(keep({ noteKeyword: ' DROUGHT ' }, '', [a, b])).toEqual([1]);
    expect(keep({}, 'notes mentioning "hail"', [a, b])).toEqual([2]);
    expect(keep({}, 'notes about drought', [a, b])).toEqual([1]);
  });

  it('pinned, by me (refinement or "I contacted"), by someone else', () => {
    const mine = note(1, { createdBy: 'Pat', isPinned: true });
    const theirs = note(2, { createdBy: 'Lee' });
    expect(keep({ hasPinnedNotes: true }, '', [mine, theirs])).toEqual([1]);
    expect(keep({}, 'pinned notes', [mine, theirs])).toEqual([1]);
    expect(keep({ contactedByMeOnly: true }, '', [mine, theirs])).toEqual([1]);
    expect(keep({}, 'I contacted', [mine, theirs])).toEqual([1]);
    expect(keep({ contactedBySomeoneElse: true }, '', [mine, theirs])).toEqual([2]);
  });
});

describe('matching notes by code and by customer', () => {
  const customers = [customer(1, { name: 'Alpha', linkedProducerIds: ['C2'] }), customer(2, { name: 'Bravo' }), customer(3)];
  const notes = [
    note(1, { customerCode: 'C1', createdAt: '2026-10-10T00:00:00' as never }),
    note(2, { customerCode: 'C2', createdAt: '2026-10-12T00:00:00' as never }),
    note(3, { customerCode: 'C2', createdAt: '2026-10-01T00:00:00' as never, isPinned: true }),
    note(4, { customerCode: 'C9' }),
    note(5, { customerCode: undefined }),
  ];

  it('indexes matches by code, tagged with their origin, pinned first then newest', () => {
    const byCode = indexMatchingNotesByCode(n => n.id !== 1, customers, notes);
    expect([...byCode.keys()]).toEqual(['C2', 'C9']);
    expect(byCode.get('C2')!.map(n => [n.id, n.viaName])).toEqual([[3, 'Bravo (C2)'], [2, 'Bravo (C2)']]);
    expect(byCode.get('C9')![0].viaName).toBe('(C9)');
  });

  it('aggregates over the linked component without duplicates', () => {
    const byCode = indexMatchingNotesByCode(() => true, customers, notes);
    const byCustomer = aggregateMatchingNotes(byCode, customers, buildLinkedProducerComponents(customers));
    expect(byCustomer.get(1)!.map(n => n.id)).toEqual([3, 2, 1]);
    expect(byCustomer.get(2)!.map(n => n.id)).toEqual([3, 2, 1]);
    expect(byCustomer.has(3)).toBe(false);
  });
});

describe('last contact', () => {
  it('takes the latest aggregate row across the linked component', () => {
    const customers = [customer(1, { linkedProducerIds: ['C2'] }), customer(2), customer(3), customer(4, { scoularId: undefined })];
    const times = lastContactTimeByCustomer([
      { customerId: 1, customerCode: 'C1', lastNoteAt: '2026-10-01T00:00:00' as never },
      { customerId: 2, customerCode: 'C2', lastNoteAt: '2026-10-05T00:00:00' as never },
      { customerId: 2, customerCode: 'C2', lastNoteAt: '2026-09-01T00:00:00' as never },
      { customerId: 9, lastNoteAt: '2026-10-10T00:00:00' as never },
    ], buildLinkedProducerComponents(customers), customers);
    expect([...times.entries()]).toEqual([[1, Date.UTC(2026, 9, 5)], [2, Date.UTC(2026, 9, 5)]]);
  });

  it('badges: today / yesterday / days, green under a week, yellow under 30, red after', () => {
    const at = (days: number) => NOW.getTime() - days * DAY;
    const badges = lastContactBadges(new Map([[1, at(0)], [2, at(1)], [3, at(6)], [4, at(7)], [5, at(29)], [6, at(30)]]));
    expect([...badges.values()].map(b => `${b.text}|${b.colorClass}`)).toEqual([
      'Contacted today|text-scoular-green',
      'Contacted yesterday|text-scoular-green',
      'Contacted 6 days ago|text-scoular-green',
      'Contacted 7 days ago|text-yellow-500',
      'Contacted 29 days ago|text-yellow-500',
      'Contacted 30 days ago|text-scoular-red',
    ]);
  });
});

describe('recencyWindowDays', () => {
  it('pads the window by a day', () => {
    expect(recencyWindowDays({ notesInLastDays: 7 }, '')).toBe(8);
    expect(recencyWindowDays({}, 'producers contacted in the last 14 days')).toBe(15);
    expect(recencyWindowDays({}, 'notes added today')).toBe(2);
    expect(recencyWindowDays({}, 'notes added yesterday')).toBe(3);
    expect(recencyWindowDays({}, 'contacted this week')).toBe(8);
    expect(recencyWindowDays({}, 'contacted last month')).toBe(32);
    expect(recencyWindowDays({}, 'producers with notes')).toBeNull();
  });
});

describe('noteScope', () => {
  const deps = (keywords: string[] = [], cands: string[] = ['pat', 'pat@x.com']) => ({
    searchKeywords: vi.fn(() => keywords),
    authorCandidates: vi.fn(() => cands),
  });

  it('none when nothing reads notes, without consulting the keyword extractor', () => {
    const d = deps();
    expect(noteScope({}, 'all producers', 7, d)).toEqual({ mode: 'none' });
    expect(d.searchKeywords).not.toHaveBeenCalled();
  });

  it('full for note counts, "by someone else", and absence mixed with content', () => {
    expect(noteScope({ contactedOnlyOnce: true }, '', 1, deps())).toEqual({ mode: 'full' });
    expect(noteScope({}, 'producers with notes, most notes first', 1, deps())).toEqual({ mode: 'full' });
    expect(noteScope({ contactedBySomeoneElse: true }, '', 1, deps())).toEqual({ mode: 'full' });
    expect(noteScope({ neverContacted: true, noteKeyword: 'x' }, '', 1, deps())).toEqual({ mode: 'full' });
  });

  it('batched for absence prompts and bare "with notes"', () => {
    expect(noteScope({ notContactedDays: 30 }, '', 1, deps())).toEqual({ mode: 'batched' });
    expect(noteScope({}, 'producers not contacted in 30 days', 1, deps())).toEqual({ mode: 'batched' });
    expect(noteScope({}, 'producers with notes', 1, deps())).toEqual({ mode: 'batched' });
    expect(noteScope({}, 'producers with notes by lee', 1, deps())).toEqual({ mode: 'full' });
  });

  it('scoped combines author, content, pinned and window into one keyed slice', () => {
    expect(noteScope({}, 'producers I contacted this week', 4, deps())).toEqual({
      mode: 'scoped', key: '4:author:pat|pat@x.com+w:8', opts: { authorAny: ['pat', 'pat@x.com'], sinceDays: 8 },
    });
    expect(noteScope({ noteKeyword: 'Hail', hasPinnedNotes: true }, 'notes mentioning drought', 2, deps(['drought']))).toEqual({
      mode: 'scoped', key: '2:content:drought|hail+pinned', opts: { contentAny: ['drought', 'hail'], pinnedOnly: true },
    });
  });

  it('falls back to full for a "by me" prompt with no identity', () => {
    expect(noteScope({ contactedByMeOnly: true }, '', 1, deps([], []))).toEqual({ mode: 'full' });
  });
});
