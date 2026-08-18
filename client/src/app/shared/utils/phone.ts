/**
 * Shared US phone formatting. Numbers are STORED formatted ("(XXX) XXX-XXXX") as entered; the
 * backend strips punctuation when searching, so display and storage use the same shape.
 */

/**
 * Progressive input mask for a phone field — call on every keystroke.
 * "4025551" → "(402) 555-1"; caps at 10 digits.
 */
export function formatPhoneProgressive(value: string): string {
  const d = (value ?? '').replace(/\D/g, '').slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Display formatting for a stored phone — exactly 10 digits renders "(XXX) XXX-XXXX",
 * anything else (extensions, international, already-formatted) is returned as-is.
 */
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return '';
  const d = value.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return value;
}
