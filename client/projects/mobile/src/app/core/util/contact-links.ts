/**
 * Native-app links for card #642. Calls go through the phone's dialer, never Teams: Travis was
 * explicit that call reliability on poor signal beats caller-id consistency.
 */

/** `tel:` wants digits and a leading + only. Ten US digits get a +1 so the dialer never guesses. */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  const normalised = /^\d{10}$/.test(digits) ? `+1${digits}` : digits;
  return `tel:${normalised}`;
}

/**
 * "(402) 555-0100" for display — the desktop's rule (shared/utils/phone.ts formatPhoneDisplay): exactly ten
 * digits are formatted; anything else (extensions, international, 7 digits) shows as stored.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '';
  const d = value.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return value;
}

export function mailtoHref(email: string): string {
  return `mailto:${email.trim()}`;
}

/**
 * Google Maps search link for an address — the same link the desktop profile uses
 * (client/src/app/shared/utils/address.ts): no API key, and on a phone it opens the Maps app.
 * Null unless there is a street or a city: a state-only search would drop a pin mid-state.
 */
export function mapsAddressHref(street?: string | null, city?: string | null, state?: string | null, zip?: string | null): string | null {
  if (!street && !city) return null;
  const stateZip = [state, zip].filter(Boolean).join(' ');
  const query = [street, city, stateZip].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** The same link for a bin site's saved coordinates: Maps pins the exact point. */
export function mapsCoordinatesHref(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}
