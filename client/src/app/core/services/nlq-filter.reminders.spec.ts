import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService, NlqFilterContext } from './nlq-filter.service';
import { Customer, ReminderDue } from '@models';

// The "Follow-Ups Scheduled" Build-A-List card. The literal card text is pinned below: a parser
// change that stopped recognising it would silently turn the card into "select everyone", which is
// far worse than it returning nothing.

/** The exact QueryText seeded by the AddFollowUpQueryLibraryItem migration. */
const CARD_QUERY = 'Producers with a follow-up scheduled';

function customer(id: number, name: string, scoularId: string): Customer {
  return {
    id, name, scoularId, farm: '', location: '', phone: '', email: '',
    totalAcres: 0, linkedProducerIds: [], eSignEnabled: false,
  } as unknown as Customer;
}

/** An open follow-up `days` from today. Negative is overdue. */
function reminder(id: number, customerId: number, days: number): ReminderDue {
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + days);
  return { id, customerId, customerCode: `C${customerId}`, dueAt: dueAt.toISOString() };
}

function ctx(customers: Customer[], myReminders: ReminderDue[] = []): NlqFilterContext {
  return {
    customers, contracts: [], tickets: [], notes: [], noteLastContacts: [],
    myReminders, plantingIntentions: [], storedGrain: [],
  };
}

describe('NlqFilterService — follow-up prompts', () => {
  let svc: NlqFilterService;

  const smith = customer(1, 'Smith Farms', 'C1');
  const jones = customer(2, 'Jones Grain', 'C2');
  const baker = customer(3, 'Baker Acres', 'C3');
  const all = [smith, jones, baker];

  beforeEach(() => {
    svc = new NlqFilterService();
  });

  function ids(query: string, myReminders: ReminderDue[]): number[] {
    return svc.parseAndFilter(query, ctx(all, myReminders)).customers.map(c => c.id).sort((a, b) => a - b);
  }

  it('returns only producers the user has a follow-up against', () => {
    expect(ids(CARD_QUERY, [reminder(10, 1, 3), reminder(11, 3, 7)])).toEqual([1, 3]);
  });

  it('includes overdue follow-ups — a missed one is the most worth acting on', () => {
    expect(ids(CARD_QUERY, [reminder(10, 2, -5)])).toEqual([2]);
  });

  it('includes one due today', () => {
    expect(ids(CARD_QUERY, [reminder(10, 2, 0)])).toEqual([2]);
  });

  it('lists a producer once even with several follow-ups against them', () => {
    expect(ids(CARD_QUERY, [reminder(10, 1, 1), reminder(11, 1, 4), reminder(12, 1, 9)])).toEqual([1]);
  });

  it('returns nobody rather than everybody when the user has no follow-ups', () => {
    expect(ids(CARD_QUERY, [])).toEqual([]);
  });

  it('returns nobody when the feature is off and the reminder feed is absent', () => {
    const withoutField = { ...ctx(all), myReminders: undefined };
    expect(svc.parseAndFilter(CARD_QUERY, withoutField).customers).toEqual([]);
  });

  it('reports a matched pattern, so a saved list built from the card is cached', () => {
    const result = svc.parseAndFilter(CARD_QUERY, ctx(all, [reminder(10, 1, 3)]));
    expect(result.matchedPatterns).toContain('has_follow_up');
  });

  it('recognises the ways someone would actually phrase it', () => {
    const mine = [reminder(10, 1, 2)];
    for (const phrasing of [
      CARD_QUERY,
      'producers with a follow-up',
      'producers with follow ups',
      'growers who have a follow up',
      'my follow-ups',
      'upcoming follow-ups',
      'producers with follow-ups due',
    ]) {
      expect(ids(phrasing, mine), phrasing).toEqual([1]);
    }
  });

  it('leaves contact-history prompts alone', () => {
    // "needs follow up" is rewritten into a recency query upstream, and must not be captured here:
    // with no notes at all, every producer counts as not contacted.
    expect(ids('producers that need follow up', [])).toEqual([1, 2, 3]);
  });

  it('does not narrow an unrelated prompt', () => {
    expect(ids('all producers', [])).toEqual([1, 2, 3]);
  });
});
