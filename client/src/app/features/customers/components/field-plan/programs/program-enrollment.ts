/**
 * A field's enrollment ID in a program for a crop year, e.g. "CI-2026-TATOB43": derived from what the
 * system already has, so nobody types it. A field is in a program simply by having a record for it; the ID
 * is what downstream records (45Z: delivery lots in the CI ledger) point back to. PROVISIONAL: the exact
 * format is still to be settled in the technical design; this is the only place it lives.
 */
export function enrollmentIdFor(prefix: string, cropYear: number, splitId: string): string {
  return `${prefix}-${cropYear}-${splitId.trim().toUpperCase()}`;
}
