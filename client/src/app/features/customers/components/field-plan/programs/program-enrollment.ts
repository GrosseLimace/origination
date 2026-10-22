import { EnrollableRecord, ProgramAttestation, ProgramEnrollment } from '@models';

/**
 * PROTOTYPE ONLY: the enrollment rules every program shares, kept pure so the server can be built and
 * tested against the same cases. A producer's enrollment in a program for a year gets its ID as soon
 * as their first field enters the program, so the ID can go on tickets from the first delivery; the
 * producer's signed attestation follows, and can be recorded any time before harvest.
 */

export type AttestationStatement = { key: string; label: string; short: string };

export function blankAttestation(statements: readonly AttestationStatement[]): ProgramAttestation {
  return {
    signerName: '', signedOn: '', method: 'eSign', documentRef: '',
    confirmations: Object.fromEntries(statements.map(s => [s.key, false])),
  };
}

/** "CI-2026-000123". */
export function formatEnrollmentId(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * What still stands between an open enrollment and Attested. `listed` is every record the producer
 * has in the program that year; each must be scored (Ready or Final) — harvest isn't needed. `others`
 * is every other enrollment (any producer), whose attested snapshots are checked so a field is never
 * claimed twice in the same program and year — matched by the field itself or by its FSA farm/tract/
 * field numbers, which catches a landlord and a tenant both enrolling it.
 */
export function enrollmentBlockers(
  enrollment: ProgramEnrollment,
  listed: readonly EnrollableRecord[],
  others: readonly ProgramEnrollment[],
  statements: readonly AttestationStatement[],
): string[] {
  const blockers: string[] = [];
  if (listed.length === 0) blockers.push('at least one field');
  const unscored = listed.filter(r => r.status === 'Draft');
  if (unscored.length) blockers.push(`finish the inputs for ${unscored.map(r => r.fieldName).join(', ')}`);

  const a = enrollment.attestation;
  if (!a.signerName.trim()) blockers.push('who signed');
  if (!a.signedOn) blockers.push('date signed');
  if (a.method === 'Paper' && !a.documentRef.trim()) blockers.push('the signed form\'s document reference');
  for (const s of statements) {
    if (!a.confirmations[s.key]) blockers.push(s.short);
  }

  const claims = new Map<string, string>();
  for (const o of others) {
    if (o.key === enrollment.key || o.status !== 'Attested' || o.programKey !== enrollment.programKey || o.year !== enrollment.year) continue;
    for (const r of o.snapshot ?? []) {
      claims.set(`field:${r.fieldKey}`, o.enrollmentId);
      if (r.fsa) claims.set(`fsa:${r.fsa}`, o.enrollmentId);
    }
  }
  for (const r of listed) {
    const by = claims.get(`field:${r.fieldKey}`) ?? (r.fsa ? claims.get(`fsa:${r.fsa}`) : undefined);
    if (by) blockers.push(`${r.fieldName} is already in ${by}`);
  }
  return blockers;
}

export interface FsaNumbers { fsaFarmNo: string; fsaTractNo: string; fsaFieldNo: string }

/** "farm/tract/field", or '' until all three are filled in. */
export function fsaKey(f: FsaNumbers): string {
  const parts = [f.fsaFarmNo, f.fsaTractNo, f.fsaFieldNo].map(p => (p ?? '').trim());
  return parts.every(p => p) ? parts.join('/') : '';
}

/** How far delivered bushels may differ from the fields' production before the check flags it. */
export const DELIVERY_TOLERANCE = 0.1;

export interface DeliveryCheck {
  delivered: number;
  /** Total production of the fields that have it (45Z: acres × actual yield). */
  production: number;
  /** Fields with no production figure yet (no actual yield). */
  fieldsWithout: number;
  /** delivered ÷ production − 1, or null with no production yet. */
  gap: number | null;
  flagged: boolean;
}

/**
 * The enrollment's ticket check: bushels on its tickets against what its fields produced. Tickets
 * carry the enrollment ID, not a field, so the check is for the enrollment as a whole. Flags a gap
 * beyond the tolerance either way (more delivered than produced is the one an auditor cares about).
 */
export function deliveryCheck(ticketBushels: readonly number[], fieldProduction: readonly (number | null | undefined)[]): DeliveryCheck {
  const delivered = ticketBushels.reduce((sum, b) => sum + b, 0);
  const known = fieldProduction.filter((p): p is number => typeof p === 'number' && p > 0);
  const production = known.reduce((sum, p) => sum + p, 0);
  const gap = production > 0 ? delivered / production - 1 : null;
  return {
    delivered, production, fieldsWithout: fieldProduction.length - known.length, gap,
    flagged: gap !== null && Math.abs(gap) > DELIVERY_TOLERANCE,
  };
}
