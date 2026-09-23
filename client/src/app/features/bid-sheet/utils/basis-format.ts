/**
 * Basis is quoted as a signed offset against the futures board: -30 is "thirty under", +20 is
 * "twenty over". The sign is the whole meaning of the number, and a bare "20" beside a "-30" reads
 * as ambiguous at a glance -- is it over, or is it a cash price that wandered into the column?
 *
 * Negatives already carry their sign, so only positives need help.
 */

/**
 * A basis value as it should be READ: positives gain a leading "+".
 *
 * Returns the original text untouched for anything that is not a positive number, so a hand-typed
 * note survives, an empty cell stays empty, and a negative is not double-signed. Zero is left bare:
 * a zero basis is "even", and "+0" says something the trade does not.
 *
 * Display only. The stored value keeps its own sign convention -- prefixing before a save would put
 * a "+" into the database and into the next comparison that reads it back.
 */
export function formatBasis(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (value === '') return '';

  // Already signed either way: leave it. Number('+20') is 20, so without this a value that came
  // back through a round trip would collect a second plus.
  if (value.startsWith('+') || value.startsWith('-')) return value;

  const n = Number(value);
  // Number('') and Number(' ') are 0, both excluded above. Number('abc') is NaN.
  if (!Number.isFinite(n) || n <= 0) return value;

  // Prefix the ORIGINAL text rather than the parsed number: "0.4500" must not come back as "0.45",
  // and basis is written to whatever precision the originator typed.
  return `+${value}`;
}
