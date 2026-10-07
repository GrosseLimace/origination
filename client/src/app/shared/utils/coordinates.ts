import type { ProducerBinSiteItem } from '@models';

/**
 * Bin-site coordinate rules — North American latitude/longitude.
 *
 * Latitude must be north (positive) and longitude west (negative). Those two sign rules also catch
 * the two common entry mistakes: swapped values and a dropped minus sign. The box runs from Panama
 * (~7°N) to the Canadian Arctic (~84°N) and from the end of the Aleutians (-180°) to Newfoundland
 * (~-52°).
 *
 * Precision: users never round by hand. A Google Maps paste ("41.39034548435109, -95.00754031349179")
 * is kept and stored exactly as entered, and the map link uses all of it. Only the profile display
 * is shortened, to six places (~0.1 m) — see formatCoordinatePair.
 *
 * Mirrored server-side by BinSiteRules (api/.../Data/Entities/ProducerBinSite.cs) — keep in step.
 */
export const BIN_SITE_BOUNDS = { minLat: 7, maxLat: 84, minLng: -180, maxLng: -52 } as const;
export const MAX_BIN_SITES = 3;
export const BIN_SITE_NAME_MAX_LENGTH = 100;
/** Places shown on the profile. Display only — storage keeps the full value. */
export const DISPLAY_DECIMALS = 6;

export const COORDINATE_EXAMPLE = '39.115876, -95.143955';

export type CoordinateParseResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; error: string };

// Two signed decimals separated by a comma and/or whitespace — the shape Google Maps copies.
const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)`;
const PAIR = new RegExp(String.raw`^\s*(${NUMBER})\s*(?:,\s*|\s+)(${NUMBER})\s*$`);

function inBounds(lat: number, lng: number): boolean {
  return latInBounds(lat) && lngInBounds(lng);
}

function latInBounds(lat: number): boolean {
  return lat >= BIN_SITE_BOUNDS.minLat && lat <= BIN_SITE_BOUNDS.maxLat;
}

function lngInBounds(lng: number): boolean {
  return lng >= BIN_SITE_BOUNDS.minLng && lng <= BIN_SITE_BOUNDS.maxLng;
}

/**
 * Parses a "latitude, longitude" string and enforces the North American rules. The values come
 * back at full precision — nothing is rounded. Each failure gets its own message so the user knows
 * what to fix, not just that something is wrong.
 */
export function parseCoordinatePair(text: string): CoordinateParseResult {
  const match = PAIR.exec(text ?? '');
  if (!match) {
    return { ok: false, error: `Enter latitude, then longitude — e.g. ${COORDINATE_EXAMPLE}` };
  }
  const lat = Number(match[1]);
  const lng = Number(match[2]);

  if (inBounds(lat, lng)) return { ok: true, lat, lng };

  if (inBounds(lng, lat)) {
    return { ok: false, error: 'Latitude and longitude look swapped — latitude comes first.' };
  }
  if (lng > 0 && latInBounds(lat) && lngInBounds(-lng)) {
    return { ok: false, error: 'Longitude must be negative (west) — is the minus sign missing?' };
  }
  if (!latInBounds(lat)) {
    return { ok: false, error: `Latitude must be between ${BIN_SITE_BOUNDS.minLat} and ${BIN_SITE_BOUNDS.maxLat} (North America).` };
  }
  return { ok: false, error: `Longitude must be between ${BIN_SITE_BOUNDS.minLng} and ${BIN_SITE_BOUNDS.maxLng} (North America).` };
}

/** Display form, shortened to six places: "41.390345, -95.007540". */
export function formatCoordinatePair(lat: number, lng: number): string {
  return `${lat.toFixed(DISPLAY_DECIMALS)}, ${lng.toFixed(DISPLAY_DECIMALS)}`;
}

/** Full-precision form, exactly as stored: "41.39034548435109, -95.00754031349179". Used for the
 *  edit field and the hover text, so nothing the user pasted is lost. */
export function formatCoordinatePairFull(lat: number, lng: number): string {
  return `${lat}, ${lng}`;
}

/** "Site Name: 41.390345, -95.007540", or just the coordinates when the site is unnamed. */
export function formatBinSiteLabel(site: ProducerBinSiteItem): string {
  const coords = formatCoordinatePair(site.latitude, site.longitude);
  const name = site.name?.trim();
  return name ? `${name}: ${coords}` : coords;
}

/** Hover text for a bin-site link: the full-precision coordinates. */
export function formatBinSiteTitle(site: ProducerBinSiteItem): string {
  const coords = formatCoordinatePairFull(site.latitude, site.longitude);
  const name = site.name?.trim();
  return `${name ? `${name}: ` : ''}${coords} — open in Google Maps`;
}
