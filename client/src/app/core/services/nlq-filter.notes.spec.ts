import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService, NlqFilterContext } from './nlq-filter.service';
import { Customer, Note } from '@models';

/** Minimal customer with only the fields these filters touch. Neutral names so name-search
 *  paths can't accidentally match a keyword. */
function customer(id: number, name: string, scoularId: string): Customer {
  return {
    id, name, scoularId, farm: '', location: '', phone: '', email: '',
    totalAcres: 0, linkedProducerIds: [], eSignEnabled: false,
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

function ctx(customers: Customer[], notes: Note[]): NlqFilterContext {
  return { customers, contracts: [], tickets: [], notes, plantingIntentions: [], storedGrain: [] };
}

describe('NlqFilterService.queryInvolvesNotes', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  // TRUE — these query shapes read note data, so a caller (build-list) must have the note set
  // loaded before running them, or they'd evaluate against zero notes and flash "no results".
  it('is true for contact-phrased queries', () => {
    expect(svc.queryInvolvesNotes('producers I have not contacted in 30 days')).toBe(true);
  });
  it('is true for explicit note-search queries', () => {
    expect(svc.queryInvolvesNotes('notes mentioning drought')).toBe(true);
  });
  it('is true for general keyword queries (the supplementary note-keyword merge runs)', () => {
    expect(svc.queryInvolvesNotes('producers with milo')).toBe(true);
  });

  // FALSE — these skip the note-keyword merge entirely, so they need not wait on notes.
  it('is false for ranking queries', () => {
    expect(svc.queryInvolvesNotes('top 10 producers by bushels')).toBe(false);
  });
  it('is false for ticket queries', () => {
    expect(svc.queryInvolvesNotes('producers with unapplied tickets')).toBe(false);
  });
  it('is false for planting queries', () => {
    expect(svc.queryInvolvesNotes('producers planting corn')).toBe(false);
  });
  it('is false for grain-on-farm queries', () => {
    expect(svc.queryInvolvesNotes('producers with grain on farm')).toBe(false);
  });
});

describe('NlqFilterService — a note matches regardless of its trade-unit tag', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  // The user-facing guarantee: a producer in the working set is returned by a note query on
  // the strength of ANY of their notes — including one tagged to a trade unit the caller did
  // not select. (The server side of this — returning that foreign-tagged note at all — is
  // covered by NoteServiceTests.GetAllAsync_ReturnsAllNotes_NoEntitlementFilter.)
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
