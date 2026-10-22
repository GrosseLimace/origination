import { EnrollableRecord, ProgramAttestation, ProgramEnrollment } from '@models';

/**
 * PROTOTYPE ONLY: the enrollment rules every program shares, kept pure so the server can be built and
 * tested against the same cases. A producer's finalized field records for one program and year are
 * enrolled under one signed attestation, and attesting issues the Enrollment ID.
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
 * What still stands between a draft enrollment and Attested. `listed` is the enrollment's records as
 * they are now; `others` is every other enrollment (any producer), whose attested snapshots are
 * checked so a field is never claimed twice in the same program and year. A field another buyer or
 * program holds is covered by the producer's own attestation.
 */
export function enrollmentBlockers(
  enrollment: ProgramEnrollment,
  listed: readonly EnrollableRecord[],
  others: readonly ProgramEnrollment[],
  statements: readonly AttestationStatement[],
): string[] {
  const blockers: string[] = [];
  if (listed.length === 0) blockers.push('at least one field');
  const notFinal = listed.filter(r => r.status !== 'Final');
  if (notFinal.length) blockers.push(`finalize ${notFinal.map(r => r.fieldName).join(', ')}`);

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
    for (const r of o.snapshot ?? []) claims.set(r.fieldKey, o.enrollmentId!);
  }
  for (const r of listed) {
    const by = claims.get(r.fieldKey);
    if (by) blockers.push(`${r.fieldName} is already in ${by}`);
  }
  return blockers;
}
