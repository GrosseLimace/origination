import type { Customer } from '@models';

/**
 * Shared producer-address resolution and formatting.
 *
 * ODS gives us two address sets per customer: the Merchandising fields (`addressLine1`,
 * `location`, `stateProvince`, `postalCode`) and the Extended fields. The Extended set is the
 * more accurate physical location, so it wins wherever both are present — the producer map has
 * always resolved addresses this way, and this module is that logic lifted out so the map and
 * the profile agree on which address they trust.
 */

export interface AddressParts {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Best-known physical address for a customer: Extended fields preferred, Merchandising as
 * fallback. Extended street data is spread across four lines in ODS with no guarantee that line 1
 * is populated, so take the first non-empty one.
 */
export function resolveCustomerAddress(customer: Customer): AddressParts {
  const street = customer.extendedAddressLine1
    || customer.extendedAddressLine2
    || customer.extendedAddressLine3
    || customer.extendedAddressLine4
    || customer.addressLine1
    || '';
  const city = customer.extendedCity || customer.location || '';
  const state = customer.extendedStateProvince || customer.stateProvince || '';
  const zip = customer.extendedPostalCode || customer.postalCode || '';
  return { street, city, state, zip };
}

/**
 * US display order — "1234 County Rd 12, Hastings, NE 68901". The ZIP belongs to the state, so it
 * is joined with a space rather than becoming its own comma-separated element. Returns '' when
 * nothing is known.
 */
export function formatAddressLine(parts: AddressParts): string {
  const stateZip = [parts.state, parts.zip].filter(Boolean).join(' ');
  return [parts.street, parts.city, stateZip].filter(Boolean).join(', ');
}

/**
 * Google Maps "search" deep link for an address, via the documented Maps URLs API — no API key and
 * no SDK, and it hands off to the native Maps app on mobile.
 *
 * Returns null unless there is a street or a city to search on: a state-only record would drop a
 * pin in the middle of Nebraska, which is worse than showing no link at all.
 */
export function googleMapsSearchUrl(parts: AddressParts): string | null {
  if (!parts.street && !parts.city) return null;
  const query = formatAddressLine(parts);
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * The same Maps URLs search link for a latitude/longitude pair (a bin site) — Maps drops a pin on
 * the exact point rather than geocoding text. Uses the full stored precision, not the shortened
 * display form, so the pin lands exactly where the user copied it from.
 */
export function googleMapsCoordinatesUrl(lat: number, lng: number): string {
  const query = `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
