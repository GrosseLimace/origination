import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService, NlqFilterContext } from './nlq-filter.service';
import { Customer, ProducerContactItem } from '@models';

/**
 * "Has / no email" and "has / no phone" must count user-entered contact rows, not just the
 * source-system fields. Producers can now have an email or number that only exists as a contact
 * (an insurance agent, Dad's cell) — reporting those as "no email" both hides them from the
 * has-email list AND wrongly surfaces them in the no-email list.
 */
function customer(
  id: number, name: string,
  over: { email?: string; supplementalEmail?: string; phone?: string; extendedPrimaryPhone?: string; contacts?: ProducerContactItem[] } = {}
): Customer {
  return {
    id, name, farm: '', location: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false,
    email: '', phone: '', ...over,
  } as Customer;
}

function ctx(customers: Customer[]): NlqFilterContext {
  return { customers, contracts: [], tickets: [], notes: [], plantingIntentions: [], storedGrain: [] };
}

describe('NlqFilterService — email/phone presence includes contact rows', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  const odsEmail = customer(1, 'Alpha Farms', { email: 'alpha@example.com' });
  const contactEmailOnly = customer(2, 'Bravo Farms', {
    contacts: [{ name: 'Acme Insurance', email: 'claims@acme.com', isPrimary: true }],
  });
  const odsPhone = customer(3, 'Charlie Farms', { phone: '(402) 555-1111' });
  const contactPhoneOnly = customer(4, 'Delta Farms', {
    contacts: [{ name: 'Dad', phone: '(402) 555-2222', isPrimary: true }],
  });
  const nothing = customer(5, 'Echo Farms');
  // A contact row with neither email nor phone must not count as either.
  const nameOnlyContact = customer(6, 'Foxtrot Farms', {
    contacts: [{ name: 'Son', isPrimary: true }],
  });

  const all = [odsEmail, contactEmailOnly, odsPhone, contactPhoneOnly, nothing, nameOnlyContact];
  const ids = (q: string) => svc.parseAndFilter(q, ctx(all)).customers.map(c => c.id).sort((a, b) => a - b);

  it('counts a contact-row email as having an email', () => {
    expect(ids('producers with an email')).toEqual([1, 2]);
  });

  it('does not report a contact-row email as missing', () => {
    expect(ids('producers with no email')).not.toContain(2);
    expect(ids('producers with no email')).toEqual([3, 4, 5, 6]);
  });

  it('counts a contact-row phone as having a phone', () => {
    expect(ids('producers with a phone number')).toEqual([3, 4]);
  });

  it('does not report a contact-row phone as missing', () => {
    expect(ids('producers with no phone number')).not.toContain(4);
  });

  it('a name-only contact counts as neither an email nor a phone', () => {
    expect(ids('producers with an email')).not.toContain(6);
    expect(ids('producers with a phone number')).not.toContain(6);
  });
});
