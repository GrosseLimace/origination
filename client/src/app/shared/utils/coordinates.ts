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
/** Not a product limit — users add as many as they need. Mirrors the server's sanity ceiling
 *  (BinSiteRules.MaxPerCustomer) so the dialog can never build a request the API would reject. */
export const MAX_BIN_SITES = 100;
export const BIN_SITE_NAME_MAX_LENGTH = 100;
/** Per-site storage capacity ceiling in bushels — the same as the producer-level Bin Capacity
 *  (BinSiteRules.MaxCapacity server-side). */
export const MAX_BIN_SITE_CAPACITY = 100_000_000;
/** Places shown on the profile. Display only — storage keeps the full value. */
export const DISPLAY_DECIMALS = 6;

export const COORDINATE_EXAMPLE = '39.115876, -95.143955';

export type CoordinateParseResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; error: string };

const ENTRY_HINT = `Enter latitude, then longitude — e.g. ${COORDINATE_EXAMPLE}`;

type Hemisphere = 'N' | 'S' | 'E' | 'W';
type Mark = '°' | "'" | '"';
type Token = { spaceBefore: boolean } & (
  | { kind: 'num'; value: number }
  | { kind: 'sign'; negative: boolean }
  | { kind: 'mark'; mark: Mark }
  | { kind: 'hemi'; hemi: Hemisphere }
  | { kind: 'sep' }
);

/**
 * Folds the ways people actually type coordinates onto one alphabet: upper case, "Lat:"/"Long:"
 * labels dropped, the word "deg" as °, typographic minus/dashes as "-", and curly or doubled
 * quotes as minute/second marks (Google Maps' side panel shows 41°23'25.2"N 95°00'27.1"W).
 */
function normalize(text: string): string {
  return text
    .toUpperCase()
    .replace(/\b(LATITUDE|LAT|LONGITUDE|LONG|LNG|LON)\b\s*[:=]?/g, ' ')
    .replace(/\bDEG(REES?)?\b/g, '°')
    .replace(/[−‐-―]/g, '-')
    .replace(/[º˚]/g, '°')
    .replace(/[′‘’´`]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/''/g, '"');
}

const TOKEN = /(\s+)|(\d+(?:\.\d*)?|\.\d+)|([+-])|([°'"])|([NSEW])|([,;])/y;

/** Splits normalized text into tokens, or null on any character that isn't part of a coordinate. */
function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let spaceBefore = false;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const m = TOKEN.exec(text);
    if (!m) return null;
    if (m[1]) { spaceBefore = true; continue; }
    if (m[2]) tokens.push({ kind: 'num', value: Number(m[2]), spaceBefore });
    else if (m[3]) tokens.push({ kind: 'sign', negative: m[3] === '-', spaceBefore });
    else if (m[4]) tokens.push({ kind: 'mark', mark: m[4] as Mark, spaceBefore });
    else if (m[5]) tokens.push({ kind: 'hemi', hemi: m[5] as Hemisphere, spaceBefore });
    else tokens.push({ kind: 'sep', spaceBefore });
    spaceBefore = false;
  }
  return tokens;
}

function indexesOf(tokens: Token[], test: (t: Token) => boolean): number[] {
  return tokens.flatMap((t, i) => (test(t) ? [i] : []));
}

/**
 * Splits the tokens into the two coordinates. A comma or semicolon decides it outright. Without
 * one, two compass letters do ("41.39 N 95.01 W", "N41.39 W95.01"); otherwise the second
 * coordinate starts at its first number — the second one marked ° when degrees are marked, else
 * the second of exactly two numbers — taking a sign or a prefixed compass letter with it.
 */
function splitPair(tokens: Token[]): [Token[], Token[]] | null {
  const at = (i: number): [Token[], Token[]] => [tokens.slice(0, i), tokens.slice(i)];

  const seps = indexesOf(tokens, t => t.kind === 'sep');
  if (seps.length > 1) return null;
  if (seps.length === 1) return [tokens.slice(0, seps[0]), tokens.slice(seps[0] + 1)];

  const hemis = indexesOf(tokens, t => t.kind === 'hemi');
  if (hemis.length > 2) return null;
  if (hemis.length === 2) return at(tokens[0].kind === 'hemi' ? hemis[1] : hemis[0] + 1);

  const nums = indexesOf(tokens, t => t.kind === 'num');
  const degreeNums = nums.filter(i => {
    const next = tokens[i + 1];
    return next?.kind === 'mark' && next.mark === '°';
  });
  let start: number;
  if (degreeNums.length === 2) start = degreeNums[1];
  else if (nums.length === 2) start = nums[1];
  else return null;

  if (tokens[start - 1]?.kind === 'sign') start--;
  // A lone letter belongs to the second coordinate only when it is written onto it ("41.39 W95.01");
  // touching the first number, or spaced on both sides, it is the first one's suffix.
  const prev = tokens[start - 1];
  if (prev?.kind === 'hemi' && prev.spaceBefore && !tokens[start].spaceBefore) start--;
  return at(start);
}

interface Coordinate { value: number; hemi?: Hemisphere }

/** One coordinate: decimal degrees or degrees-minutes-seconds, an optional sign, and an optional
 *  compass letter before or after. S and W make it negative, even if the minus was also typed. */
function parseCoordinate(tokens: Token[]): Coordinate | string {
  let hemi: Hemisphere | undefined;
  let negative = false;
  const parts: number[] = [];
  for (const [i, t] of tokens.entries()) {
    switch (t.kind) {
      case 'hemi':
        if (hemi || (i !== 0 && i !== tokens.length - 1)) return ENTRY_HINT;
        hemi = t.hemi;
        break;
      case 'sign':
        if (parts.length > 0) return ENTRY_HINT;
        negative = t.negative;
        break;
      case 'num':
        if (parts.length === 3) return ENTRY_HINT;
        parts.push(t.value);
        break;
      case 'mark':
        // A mark names the number just before it: ° degrees, ' minutes, " seconds.
        if (tokens[i - 1]?.kind !== 'num' || parts.length - 1 !== ['°', "'", '"'].indexOf(t.mark)) return ENTRY_HINT;
        break;
      default:
        return ENTRY_HINT;
    }
  }
  if (parts.length === 0) return ENTRY_HINT;

  const [deg, min = 0, sec = 0] = parts;
  if (parts.length > 1 && (!Number.isInteger(deg) || min >= 60 || sec >= 60 || (parts.length === 3 && !Number.isInteger(min)))) {
    return 'For degrees-minutes-seconds use whole degrees, and minutes and seconds under 60.';
  }
  let value = deg + min / 60 + sec / 3600;
  if (hemi === 'S' || hemi === 'W') {
    value = -value;
  } else if (negative) {
    if (hemi) return 'A minus sign with N or E contradicts itself — use one or the other.';
    value = -value;
  }
  return { value, hemi };
}

function axisOf(c: Coordinate): 'lat' | 'lng' | undefined {
  if (!c.hemi) return undefined;
  return c.hemi === 'N' || c.hemi === 'S' ? 'lat' : 'lng';
}

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
 * Parses free-hand "latitude, longitude" text and enforces the North American rules. Accepts what
 * people paste or type — "41.39034548435109, -95.00754031349179", "41.39 -95.01", "41.39° N, 95.01° W",
 * "N41.39 W95.01", "41°23'25.2"N 95°00'27.1"W", "Lat: 41.39 Long: -95.01" — and returns decimal
 * degrees at full precision; nothing is rounded. Compass letters fix the axis, so
 * "95.01 W, 41.39 N" reads correctly too. Each failure gets its own message so the user knows what
 * to fix, not just that something is wrong.
 */
export function parseCoordinatePair(text: string): CoordinateParseResult {
  const fail = (error: string): CoordinateParseResult => ({ ok: false, error });

  const tokens = tokenize(normalize(text ?? ''));
  const pair = tokens && splitPair(tokens);
  if (!pair) return fail(ENTRY_HINT);
  const first = parseCoordinate(pair[0]);
  if (typeof first === 'string') return fail(first);
  const second = parseCoordinate(pair[1]);
  if (typeof second === 'string') return fail(second);

  const firstAxis = axisOf(first);
  const secondAxis = axisOf(second);
  if (firstAxis && firstAxis === secondAxis) return fail('Use N or S for latitude and E or W for longitude.');
  const [latC, lngC] = firstAxis === 'lng' || secondAxis === 'lat' ? [second, first] : [first, second];
  const lat = latC.value;
  const lng = lngC.value;

  if (inBounds(lat, lng)) return { ok: true, lat, lng };

  // Without compass letters, a pair that is valid the other way round was typed backwards.
  if (!firstAxis && !secondAxis && inBounds(lng, lat)) {
    return fail('Latitude and longitude look swapped — latitude comes first.');
  }
  if (lng > 0) {
    const missingMinus = latInBounds(lat) && lngInBounds(-lng);
    return fail('That point is outside North America — east of Greenwich (e.g. Europe or Asia).'
      + (missingMinus ? ' North American longitudes are negative — is the minus sign missing?' : ''));
  }
  if (!latInBounds(lat)) {
    return fail(`That point is outside North America — latitude must be between ${BIN_SITE_BOUNDS.minLat} and ${BIN_SITE_BOUNDS.maxLat}.`);
  }
  return fail(`That point is outside North America — longitude must be between ${BIN_SITE_BOUNDS.minLng} and ${BIN_SITE_BOUNDS.maxLng}.`);
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

/** Hover text for a bin-site link: the full-precision coordinates, and the capacity when set. */
export function formatBinSiteTitle(site: ProducerBinSiteItem): string {
  const coords = formatCoordinatePairFull(site.latitude, site.longitude);
  const name = site.name?.trim();
  const capacity = formatBinSiteCapacity(site.capacity);
  return `${name ? `${name}: ` : ''}${coords}${capacity ? ` · ${capacity}` : ''} — open in Google Maps`;
}

/** "50,000 bu", or '' when the site has no capacity. */
export function formatBinSiteCapacity(capacity: number | null | undefined): string {
  return capacity == null ? '' : `${capacity.toLocaleString('en-US')} bu`;
}

/** Reads a capacity input ("50,000", "50000 bu") as whole bushels, or null when it holds no digits. */
export function parseBinSiteCapacity(text: string): number | null {
  const digits = (text ?? '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

/** Keeps a capacity input to digits, grouped as typed: "50000" → "50,000". '' stays ''. */
export function formatBinSiteCapacityInput(text: string): string {
  const value = parseBinSiteCapacity(text);
  return value === null ? '' : value.toLocaleString('en-US');
}
