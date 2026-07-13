import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService, NlqFilterContext } from './nlq-filter.service';
import { Customer } from '@models';

/** Minimal customer with just the fields the ACH filter reads. Neutral names so name-search can't interfere. */
function customer(id: number, name: string, achEnabled: boolean): Customer {
  return {
    id, name, farm: '', location: '', phone: '', email: '',
    totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, achEnabled,
  } as Customer;
}

function ctx(customers: Customer[]): NlqFilterContext {
  return { customers, contracts: [], tickets: [], notes: [], plantingIntentions: [], storedGrain: [] };
}

describe('NlqFilterService — ACH payment', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  const alpha = customer(1, 'Alpha Farms', true);
  const bravo = customer(2, 'Bravo Farms', false);
  const charlie = customer(3, 'Charlie Farms', true);
  const all = [alpha, bravo, charlie];

  it('"Producers with ACH payment" → only ACH-enabled producers', () => {
    const r = svc.parseAndFilter('Producers with ACH payment', ctx(all));
    expect(r.customers.map(c => c.id).sort((a, b) => a - b)).toEqual([1, 3]);
    expect(r.matchedPatterns).toContain('ach_payment');
  });

  it('negation ("no ACH") → producers without ACH', () => {
    const r = svc.parseAndFilter('producers with no ach', ctx(all));
    expect(r.customers.map(c => c.id)).toEqual([2]);
  });

  it('does not trigger on words that merely contain "ach" (reach/each/attach)', () => {
    // Word-bounded \bach\b must not fire for these — otherwise the list would wrongly narrow to ACH.
    for (const q of ['producers to reach out to', 'each producer', 'attach a note']) {
      expect(svc.parseAndFilter(q, ctx(all)).matchedPatterns).not.toContain('ach_payment');
    }
  });
});
