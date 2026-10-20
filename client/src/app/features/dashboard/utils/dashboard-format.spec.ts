import { describe, it, expect } from 'vitest';

import { Customer } from '@models';
import { dashboardCropKey, formatAcres, formatK, getFormattedLocation, getInitials, toTitleCase } from './dashboard-format';

function customer(over: Partial<Customer>): Customer {
  return {
    id: 1, name: '', farm: '', location: '', phone: '', email: '', totalAcres: 0,
    linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

describe('formatAcres', () => {
  it('keeps values under a thousand as is, including zero', () => {
    expect(formatAcres(0)).toBe('0');
    expect(formatAcres(999)).toBe('999');
  });

  it('rounds thousands to K and millions to one decimal of M', () => {
    expect(formatAcres(1_000)).toBe('1K');
    expect(formatAcres(1_499)).toBe('1K');
    expect(formatAcres(1_500)).toBe('2K');
    expect(formatAcres(999_999)).toBe('1000K');
    expect(formatAcres(1_000_000)).toBe('1.0M');
    expect(formatAcres(2_360_000)).toBe('2.4M');
  });
});

describe('formatK', () => {
  it('reads zero as "--" rather than a real zero', () => {
    expect(formatK(0)).toBe('--');
  });

  it('otherwise formats like formatAcres', () => {
    expect(formatK(42)).toBe('42');
    expect(formatK(13_000)).toBe('13K');
    expect(formatK(1_250_000)).toBe('1.3M');
  });
});

describe('getInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(getInitials('alpha farms')).toBe('AF');
    expect(getInitials('Bravo  Ag  Partners')).toBe('BA');
  });

  it('takes the first two letters of a one-word name, and ?? when there is nothing to use', () => {
    expect(getInitials('Zed')).toBe('ZE');
    expect(getInitials('Z')).toBe('??');
    expect(getInitials('   ')).toBe('??');
  });
});

describe('getFormattedLocation', () => {
  it('prefers the extended city/state pair, then the legacy pair', () => {
    expect(getFormattedLocation(customer({ extendedCity: 'Garden City', extendedStateProvince: 'KS', location: 'Pratt', stateProvince: 'NE' })))
      .toBe('Garden City, KS');
    expect(getFormattedLocation(customer({ extendedCity: 'Garden City', location: 'Pratt', stateProvince: 'NE' }))).toBe('Pratt, NE');
  });

  it('falls back to whichever single part exists, or empty', () => {
    expect(getFormattedLocation(customer({ extendedCity: 'Garden City', location: 'Pratt' }))).toBe('Garden City');
    expect(getFormattedLocation(customer({ location: 'Pratt' }))).toBe('Pratt');
    expect(getFormattedLocation(customer({ stateProvince: 'OK' }))).toBe('OK');
    expect(getFormattedLocation(customer({}))).toBe('');
    expect(getFormattedLocation(undefined)).toBe('');
  });
});

describe('toTitleCase', () => {
  it('title-cases ODS all-caps and lower-case strings, keeping hyphenated words readable', () => {
    expect(toTitleCase('WHEAT')).toBe('Wheat');
    expect(toTitleCase('hard red winter wheat')).toBe('Hard Red Winter Wheat');
    expect(toTitleCase('CO-PRODUCT')).toBe('Co-Product');
    expect(toTitleCase('')).toBe('');
  });
});

describe('dashboardCropKey', () => {
  it('prefixes the planting type when there is one', () => {
    expect(dashboardCropKey('Irrigated', 'Corn')).toBe('Irrigated Corn');
    expect(dashboardCropKey('Double Crop', 'Soybeans')).toBe('Double Crop Soybeans');
    expect(dashboardCropKey(undefined, 'Corn')).toBe('Corn');
    expect(dashboardCropKey('', 'Corn')).toBe('Corn');
  });
});
