import { EnrollableRecord, ProgramAttestation, ProgramEnrollment } from '@models';

/**
 * PROTOTYPE ONLY: the enrollment rules every program shares, kept pure so the server can be built and
 * tested against the same cases. A producer's enrollment in a program for a year gets its ID as soon
 * as their first field enters the program, before harvest; the
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
 * is every other enrollment (any producer), whose attested snapshots are checked so a field (a CTRM
 * split) is never claimed twice in the same program and year. A landlord and a tenant are expected to
 * have separate split IDs for their shares (being confirmed with the business).
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
    for (const r of o.snapshot ?? []) claims.set(r.splitId, o.enrollmentId);
  }
  for (const r of listed) {
    const by = claims.get(r.splitId);
    if (by) blockers.push(`${r.fieldName} (${r.splitId}) is already in ${by}`);
  }
  return blockers;
}
