import { describe, it, expect } from 'vitest';
import type { Customer } from '@models';

import { resolveCustomerAddress, formatAddressLine, googleMapsSearchUrl, googleMapsCoordinatesUrl } from './address';

/** Minimal Customer — only the address fields matter here. */
function customer(fields: Partial<Customer>): Customer {
  return fields as unknown as Customer;
}

describe('resolveCustomerAddress', () => {
  it('prefers the Extended fields over Merchandising', () => {
    // Extended is the more accurate physical location; the map has always resolved it this way.
    const parts = resolveCustomerAddress(customer({
      extendedAddressLine1: '1234 County Rd 12',
      extendedCity: 'Hastings',
      extendedStateProvince: 'NE',
      extendedPostalCode: '68901',
      addressLine1: 'PO Box 5',
      location: 'Omaha',
      stateProvince: 'IA',
      postalCode: '51501',
    }));

    expect(parts).toEqual({ street: '1234 County Rd 12', city: 'Hastings', state: 'NE', zip: '68901' });
  });

  it('falls back to Merchandising when Extended is absent', () => {
    const parts = resolveCustomerAddress(customer({
      addressLine1: 'PO Box 5',
      location: 'Omaha',
      stateProvince: 'NE',
      postalCode: '68102',
    }));

    expect(parts).toEqual({ street: 'PO Box 5', city: 'Omaha', state: 'NE', zip: '68102' });
  });

  it('takes the first populated Extended street line', () => {
    // ODS does not guarantee line 1 is the populated one.
    const parts = resolveCustomerAddress(customer({ extendedAddressLine3: 'Rural Route 2' }));

    expect(parts.street).toBe('Rural Route 2');
  });

  it('returns empty strings rather than undefined for a customer with no address', () => {
    expect(resolveCustomerAddress(customer({}))).toEqual({ street: '', city: '', state: '', zip: '' });
  });
});

describe('formatAddressLine', () => {
  it('joins the ZIP to the state with a space, not a comma', () => {
    expect(formatAddressLine({ street: '1234 County Rd 12', city: 'Hastings', state: 'NE', zip: '68901' }))
      .toBe('1234 County Rd 12, Hastings, NE 68901');
  });

  it('omits missing parts without leaving stray separators', () => {
    expect(formatAddressLine({ street: '', city: 'Hastings', state: 'NE', zip: '' })).toBe('Hastings, NE');
    expect(formatAddressLine({ street: '', city: '', state: '', zip: '' })).toBe('');
  });
});

describe('googleMapsSearchUrl', () => {
  it('builds a Maps URLs API search link', () => {
    const url = googleMapsSearchUrl({ street: '1234 County Rd 12', city: 'Hastings', state: 'NE', zip: '68901' });

    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=1234%20County%20Rd%2012%2C%20Hastings%2C%20NE%2068901');
  });

  it('percent-encodes characters that would otherwise break the query', () => {
    const url = googleMapsSearchUrl({ street: '5 A&W Rd #3', city: 'Hastings', state: 'NE', zip: '' });

    // '&' and '#' must not terminate or fragment the query string.
    expect(url).toContain('5%20A%26W%20Rd%20%233');
    expect(url).not.toContain('#');
  });

  it('returns null when there is no street or city to search on', () => {
    // A state alone would pin the middle of the state — worse than no link.
    expect(googleMapsSearchUrl({ street: '', city: '', state: 'NE', zip: '' })).toBeNull();
    expect(googleMapsSearchUrl({ street: '', city: '', state: '', zip: '' })).toBeNull();
  });

  it('links on city alone when no street is known', () => {
    expect(googleMapsSearchUrl({ street: '', city: 'Hastings', state: 'NE', zip: '' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=Hastings%2C%20NE');
  });
});

describe('googleMapsCoordinatesUrl', () => {
  it('builds a Maps search link on the exact point', () => {
    expect(googleMapsCoordinatesUrl(39.115876, -95.143955))
      .toBe('https://www.google.com/maps/search/?api=1&query=39.115876%2C-95.143955');
  });

  it('uses the full pasted precision, not the shortened display form', () => {
    expect(googleMapsCoordinatesUrl(41.39034548435109, -95.00754031349179))
      .toContain('query=41.39034548435109%2C-95.00754031349179');
  });
});
