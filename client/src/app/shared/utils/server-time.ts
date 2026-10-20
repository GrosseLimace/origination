/**
 * Parses a timestamp from the API. The server stores DateTime.UtcNow and serialises it without a
 * zone suffix, so a bare ISO string has to be read as UTC, or the browser reads it as local time
 * and every "days since" is off by the UTC offset. A string that already carries Z or an offset,
 * and a value that is already a Date, pass through unchanged.
 *
 * Takes `Date | string` because models such as Note declare `createdAt: Date` while the JSON
 * actually delivers a string.
 */
export function parseServerTime(value: Date | string): Date {
  const raw = typeof value === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value + 'Z' : value;
  return new Date(raw);
}
