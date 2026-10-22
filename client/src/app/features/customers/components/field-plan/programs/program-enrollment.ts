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
 * is every other enrollment (any producer), whose attested snapshots are checked so a field (split) is
 * never claimed twice in the same program and year.
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
    for (const r of o.snapshot ?? []) claims.set(r.fieldKey, o.enrollmentId);
  }
  for (const r of listed) {
    const by = claims.get(r.fieldKey);
    if (by) blockers.push(`${r.fieldName} is already in ${by}`);
  }
  return blockers;
}

/** Whether a ticket's keyed enrollment ID matches the enrollment its split belongs to. */
export function ticketEnrollmentMismatch(keyed: string, expected: string | undefined): boolean {
  return !!expected && keyed.trim().toUpperCase() !== expected.toUpperCase();
}
