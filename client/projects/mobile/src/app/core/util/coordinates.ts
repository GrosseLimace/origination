/**
 * Bin-site coordinates typed or pasted on a phone. Accepts what the desktop accepts in its common forms:
 * "41.2, -96.1", "41.2 -96.1", "41.2 N, 96.1 W" (letters set the sign), or a Google Maps copy
 * ("41.20000, -96.10000"). Degrees-minutes-seconds is desktop-only for now.
 *
 * Valid only inside the North American box the server enforces (BinSiteRules / MobileBinSiteLimits).
 */
export interface Coordinates { latitude: number; longitude: number }

export const LAT_MIN = 7;
export const LAT_MAX = 84;
export const LNG_MIN = -180;
export const LNG_MAX = -52;

/** Parsed coordinates; null for blank input; 'invalid' when it cannot be read or is out of range. */
export function parseCoordinates(text: string): Coordinates | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(/[,;]\s*|\s+(?=[-+]?\d)/).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return 'invalid';
  const lat = signed(parts[0], 'N', 'S');
  const lng = signed(parts[1], 'E', 'W');
  if (lat === null || lng === null) return 'invalid';
  if (lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX) return 'invalid';
  return { latitude: lat, longitude: lng };
}

/** "41.2, -96.1" for display and editing; null when either half is missing. */
export function formatCoordinates(lat: number | null | undefined, lng: number | null | undefined): string {
  return lat != null && lng != null ? `${lat}, ${lng}` : '';
}

function signed(part: string, positive: string, negative: string): number | null {
  const m = /^([-+]?\d+(?:\.\d+)?)\s*°?\s*([A-Za-z])?$/.exec(part);
  if (!m) return null;
  let value = Number(m[1]);
  const letter = m[2]?.toUpperCase();
  if (letter) {
    if (letter !== positive && letter !== negative) return null;
    value = Math.abs(value) * (letter === negative ? -1 : 1);
  }
  return Number.isFinite(value) ? value : null;
}
