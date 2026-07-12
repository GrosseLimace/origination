import { Customer } from '@models';

/**
 * Shared address-resolution helpers for client-side geocoding of a Customer's address.
 * Originally lived only in `CustomerMapComponent` (Build List map); extracted here so
 * `CustomerFieldsComponent` (Customer Profile → Fields tab) can resolve + cache-key an
 * address the same way, keeping both features aligned with the shared
 * `AppStateService.mapGeocodeCache` (one cache entry per address, however it was reached).
 */

export interface ResolvedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  county: string;
}

/** Maps state abbreviations to their full names for Nominatim geocoding requests. */
const STATE_ABBREV_TO_FULL: { [abbr: string]: string } = {
  'al': 'Alabama', 'ak': 'Alaska', 'az': 'Arizona', 'ar': 'Arkansas', 'ca': 'California',
  'co': 'Colorado', 'ct': 'Connecticut', 'de': 'Delaware', 'fl': 'Florida', 'ga': 'Georgia',
  'hi': 'Hawaii', 'id': 'Idaho', 'il': 'Illinois', 'in': 'Indiana', 'ia': 'Iowa',
  'ks': 'Kansas', 'ky': 'Kentucky', 'la': 'Louisiana', 'me': 'Maine', 'md': 'Maryland',
  'ma': 'Massachusetts', 'mi': 'Michigan', 'mn': 'Minnesota', 'ms': 'Mississippi',
  'mo': 'Missouri', 'mt': 'Montana', 'ne': 'Nebraska', 'nv': 'Nevada', 'nh': 'New Hampshire',
  'nj': 'New Jersey', 'nm': 'New Mexico', 'ny': 'New York', 'nc': 'North Carolina',
  'nd': 'North Dakota', 'oh': 'Ohio', 'ok': 'Oklahoma', 'or': 'Oregon', 'pa': 'Pennsylvania',
  'ri': 'Rhode Island', 'sc': 'South Carolina', 'sd': 'South Dakota', 'tn': 'Tennessee',
  'tx': 'Texas', 'ut': 'Utah', 'vt': 'Vermont', 'va': 'Virginia', 'wa': 'Washington',
  'wv': 'West Virginia', 'wi': 'Wisconsin', 'wy': 'Wyoming', 'dc': 'District of Columbia'
};

/** Expands a state abbreviation to its full name; returns value unchanged if already full. */
export function expandStateAbbrev(state: string): string {
  const lower = state.toLowerCase().trim();
  return STATE_ABBREV_TO_FULL[lower] ?? state;
}

/**
 * Resolves the best address for a customer using Extended fields with Merchandising fallback.
 */
export function resolveCustomerAddress(customer: Customer): ResolvedAddress {
  const street = customer.extendedAddressLine1
    || customer.extendedAddressLine2
    || customer.extendedAddressLine3
    || customer.extendedAddressLine4
    || customer.addressLine1
    || '';
  const city = customer.extendedCity || customer.location || '';
  const state = customer.extendedStateProvince || customer.stateProvince || '';
  const zip = customer.extendedPostalCode || customer.postalCode || '';
  const county = customer.extendedCountry || '';
  return { street, city, state, zip, county };
}

/**
 * Builds a geocode cache key from resolved address parts.
 * Includes street when available for street-level precision; falls back to city+state+zip.
 */
export function geocodeCacheKey(addr: { street: string; city: string; state: string; zip: string }): string {
  const parts = [addr.street, addr.city, addr.state, addr.zip]
    .map(p => p.toLowerCase().trim())
    .filter(Boolean);
  return parts.join(',');
}
