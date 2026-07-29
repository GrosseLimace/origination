import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService, NlqFilterContext } from './nlq-filter.service';
import { Customer, Note, NoteLastContact } from '@models';

/** Minimal customer with only the fields these filters touch. Neutral names so name-search
 *  paths can't accidentally match a keyword. */
function customer(id: number, name: string, scoularId: string, linkedProducerIds: string[] = []): Customer {
  return {
    id, name, scoularId, farm: '', location: '', phone: '', email: '',
    totalAcres: 0, linkedProducerIds, eSignEnabled: false,
  } as unknown as Customer;
}

/** `tradeUnit` is set to a value the caller would NOT have selected on purpose: a note's
 *  trade-unit tag must never affect matching. Trade-unit scoping is by producer (server-side),
 *  not by note tag — so a producer in the working set is matched on any of their notes. */
function note(id: number, customerId: number, customerCode: string, content: string, tradeUnit?: string): Note {
  return {
    id, customerId, customerName: '', customerCode, tradeUnit,
    content, isPinned: false, createdBy: 'rep@scoular.com', createdAt: '2026-06-01T00:00:00Z',
  } as unknown as Note;
}

/** One row of the lightweight last-contact aggregate (customerCode + latest note time). */
function lastContact(customerId: number, customerCode: string, daysAgo: number): NoteLastContact {
  return {
    customerId, customerCode,
    lastNoteAt: new Date(Date.now() - daysAgo * 86400000).toISOString() as unknown as Date,
  };
}

function ctx(customers: Customer[], notes: Note[], noteLastContacts: NoteLastContact[] = []): NlqFilterContext {
  return { customers, contracts: [], tickets: [], notes, noteLastContacts, plantingIntentions: [], storedGrain: [] };
}

describe('NlqFilterService.queryNeedsFullNotes', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  // TRUE — these read note BODIES / authors / pinned flags / counts, so the full note set must
  // be loaded before they run.
  it('is true for note-content search', () => {
    expect(svc.queryNeedsFullNotes('notes mentioning drought')).toBe(true);
  });
  it('is true for note-author search', () => {
    expect(svc.queryNeedsFullNotes('notes by Caden')).toBe(true);
  });
  it('is true for author-scoped contact', () => {
    expect(svc.queryNeedsFullNotes('producers contacted by Caden this week')).toBe(true);
  });
  it('is true for pinned-note queries', () => {
    expect(svc.queryNeedsFullNotes('producers with pinned notes')).toBe(true);
  });
  it('is true for the "with notes" boolean', () => {
    expect(svc.queryNeedsFullNotes('customers with notes')).toBe(true);
  });
  it('is true for "most notes" rankings', () => {
    expect(svc.queryNeedsFullNotes('top 10 by notes')).toBe(true);
  });

  // FALSE — recency resolves from the last-contact aggregate; everything else is structured-only.
  it('is false for recency/contact queries (they use the aggregate)', () => {
    expect(svc.queryNeedsFullNotes('producers I have not contacted in 30 days')).toBe(false);
    expect(svc.queryNeedsFullNotes('never contacted producers')).toBe(false);
  });
  it('is false for general keyword queries (no more note-keyword merge)', () => {
    expect(svc.queryNeedsFullNotes('producers with milo')).toBe(false);
  });
  it('is false for contracts / tickets / planting / storage / grain-on-farm / ranking', () => {
    expect(svc.queryNeedsFullNotes('producers with active contracts')).toBe(false);
    expect(svc.queryNeedsFullNotes('producers with unapplied tickets')).toBe(false);
    expect(svc.queryNeedsFullNotes('producers planting corn')).toBe(false);
    expect(svc.queryNeedsFullNotes('producers with grain in storage')).toBe(false);
    expect(svc.queryNeedsFullNotes('producers with grain on farm')).toBe(false);
    expect(svc.queryNeedsFullNotes('top 10 producers by bushels')).toBe(false);
  });
});

describe('NlqFilterService.refineFiltersNeedFullNotes', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  it('is true for content/pinned/author/count refines', () => {
    expect(svc.refineFiltersNeedFullNotes({ noteKeyword: 'drought' } as never)).toBe(true);
    expect(svc.refineFiltersNeedFullNotes({ hasPinnedNotes: true } as never)).toBe(true);
    expect(svc.refineFiltersNeedFullNotes({ contactedByMeOnly: true } as never)).toBe(true);
    expect(svc.refineFiltersNeedFullNotes({ contactedMoreThan5: true } as never)).toBe(true);
  });
  it('is false for recency refines (they use the aggregate) and empty/undefined', () => {
    expect(svc.refineFiltersNeedFullNotes({ neverContacted: true } as never)).toBe(false);
    expect(svc.refineFiltersNeedFullNotes({ notContactedDays: 30 } as never)).toBe(false);
    expect(svc.refineFiltersNeedFullNotes({ notesInLastDays: 7 } as never)).toBe(false);
    expect(svc.refineFiltersNeedFullNotes(null)).toBe(false);
  });
});

describe('NlqFilterService — general/keyword prompts no longer merge note-content matches', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  it('does NOT return a producer whose ONLY milo association is a note (merge removed)', () => {
    const alpha = customer(1, 'Alpha Farms', 'A001'); // milo appears only in a note, no contract/commodity
    const notes = [note(1, 1, 'A001', 'discussed selling milo next week')];
    const ids = svc.parseAndFilter('producers with milo', ctx([alpha], notes))
      .customers.map(c => c.id);
    expect(ids).not.toContain(1);
  });
});

describe('NlqFilterService — recency filters resolve from the last-contact aggregate (no full notes)', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  it('"not contacted in 30 days" uses the aggregate even when the full note set is empty', () => {
    const recent = customer(1, 'Recent Farms', 'A001');
    const stale = customer(2, 'Stale Farms', 'B002');
    const never = customer(3, 'Never Farms', 'C003');
    const aggregate = [lastContact(1, 'A001', 5), lastContact(2, 'B002', 90)]; // no row for #3
    const ids = svc.parseAndFilter('producers not contacted in 30 days', ctx([recent, stale, never], [], aggregate))
      .customers.map(c => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([2, 3]); // stale (90d) + never (no contact); recent (5d) excluded
  });

  it('rolls latest contact up through linked producers (aggregate, no full notes)', () => {
    // Alpha has no direct contact, but is linked to Bravo who was contacted 5 days ago.
    const alpha = customer(1, 'Alpha Farms', 'A001', ['B002']);
    const bravo = customer(2, 'Bravo Farms', 'B002');
    const charlie = customer(3, 'Charlie Farms', 'C003'); // no contact anywhere
    const aggregate = [lastContact(2, 'B002', 5)]; // only Bravo has a row
    const ids = svc.parseAndFilter('producers not contacted in 30 days', ctx([alpha, bravo, charlie], [], aggregate))
      .customers.map(c => c.id).sort((a, b) => a - b);
    // Alpha inherits Bravo's recent contact via the link → excluded; only Charlie remains.
    expect(ids).toEqual([3]);
  });
});

describe('NlqFilterService — a note matches regardless of its trade-unit tag', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  // The user-facing guarantee: a producer in the working set is returned by a note-CONTENT query
  // on the strength of ANY of their notes — including one tagged to a trade unit the caller did
  // not select. (The server side — returning that foreign-tagged note at all — is covered by
  // NoteServiceTests.GetAllAsync_ReturnsAllNotes_NoEntitlementFilter.)
  it('returns the producer whose note mentions the term, even when the note is tagged to another trade unit', () => {
    const alpha = customer(1, 'Alpha Farms', 'A001');   // has the matching note (tagged elsewhere)
    const bravo = customer(2, 'Bravo Farms', 'B002');   // no matching note
    const notes = [
      note(1, 1, 'A001', 'discussed selling milo next week', 'SOME-OTHER-TU'),
      note(2, 2, 'B002', 'talked about corn basis', 'B002'),
    ];
    const ids = svc.parseAndFilter('notes mentioning milo', ctx([alpha, bravo], notes))
      .customers.map(c => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([1]); // Alpha only; Bravo has no milo note; Alpha's foreign tag is irrelevant
  });
});
