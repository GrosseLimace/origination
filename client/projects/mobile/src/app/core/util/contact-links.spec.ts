import { describe, expect, it } from 'vitest';

import { formatPhone, mailtoHref, mapsAddressHref, mapsCoordinatesHref, telHref } from './contact-links';

describe('contact-links', () => {
  it('normalises a formatted US number to +1 and digits only', () => {
    expect(telHref('(402) 555-0100')).toBe('tel:+14025550100');
    expect(telHref('402.555.0100')).toBe('tel:+14025550100');
  });

  it('keeps an explicit country code', () => {
    expect(telHref('+1 402 555 0100')).toBe('tel:+14025550100');
    expect(telHref('+44 20 7946 0958')).toBe('tel:+442079460958');
  });

  it('does not invent a country code for non-10-digit numbers', () => {
    expect(telHref('555-0100')).toBe('tel:5550100');
  });

  it('shows ten-digit numbers as (xxx) xxx-xxxx, like the desktop, and anything else as stored', () => {
    expect(formatPhone('4025550100')).toBe('(402) 555-0100');
    expect(formatPhone('402.555.0100')).toBe('(402) 555-0100');
    expect(formatPhone('+1 402 555 0100')).toBe('+1 402 555 0100');
    expect(formatPhone('555-0100')).toBe('555-0100');
    expect(formatPhone(null)).toBe('');
  });

  it('builds a mailto link', () => {
    expect(mailtoHref(' producer@example.com ')).toBe('mailto:producer@example.com');
  });

  it('builds the same Google Maps address link as the desktop profile', () => {
    expect(mapsAddressHref('123 Main St', 'Pratt', 'KS', '67124'))
      .toBe('https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Pratt%2C%20KS%2067124');
  });

  it('gives no address link without a street or a city', () => {
    expect(mapsAddressHref(null, null, 'KS', '67124')).toBeNull();
  });

  it('pins bin-site coordinates exactly', () => {
    expect(mapsCoordinatesHref(41.2, -96.1)).toBe('https://www.google.com/maps/search/?api=1&query=41.2%2C-96.1');
  });
});
