import { describe, it, expect } from 'vitest';
import { EnrollableRecord, ProgramEnrollment } from '@models';
import { AttestationStatement, blankAttestation, enrollmentBlockers, formatEnrollmentId } from './program-enrollment';

const statements: AttestationStatement[] = [
  { key: 'notEnrolledElsewhere', label: 'Not enrolled elsewhere.', short: '"not enrolled elsewhere" confirmation' },
  { key: 'consent', label: 'Consents to audit.', short: 'consent to audit' },
];

const record = (overrides: Partial<EnrollableRecord> = {}): EnrollableRecord => ({
  recordId: 'r1', seasonId: 's1', fieldKey: 'f1', fieldName: 'North 80', cropLabel: 'Corn', year: 2026, acres: 80, status: 'Final', ...overrides,
});

const enrollment = (overrides: Partial<ProgramEnrollment> = {}): ProgramEnrollment => ({
  key: 'k1', programKey: 'p', enrollmentId: null, customerId: 9, year: 2026, status: 'Draft', recordIds: ['r1'],
  attestation: { ...blankAttestation(statements), signerName: 'Pat', signedOn: '2026-11-02', confirmations: { notEnrolledElsewhere: true, consent: true } },
  ...overrides,
});

describe('program enrollment rules', () => {
  it('should pass a signed enrollment of finalized fields', () => {
    expect(enrollmentBlockers(enrollment(), [record()], [], statements)).toEqual([]);
  });

  it('should list each unconfirmed statement from the program, unfinalized fields and the signature', () => {
    const e = enrollment({ attestation: { ...blankAttestation(statements), method: 'Paper' } });
    expect(enrollmentBlockers(e, [record({ status: 'Ready' })], [], statements)).toEqual([
      'finalize North 80', 'who signed', 'date signed', 'the signed form\'s document reference',
      '"not enrolled elsewhere" confirmation', 'consent to audit',
    ]);
    expect(enrollmentBlockers(enrollment(), [], [], statements)).toEqual(['at least one field']);
  });

  it('should block a field already in another attested enrollment of the same program and year only', () => {
    const other = enrollment({ key: 'k2', enrollmentId: 'CI-2026-000001', customerId: 10, status: 'Attested', snapshot: [record()] });
    expect(enrollmentBlockers(enrollment(), [record()], [other], statements)).toEqual(['North 80 is already in CI-2026-000001']);
    expect(enrollmentBlockers(enrollment(), [record()], [{ ...other, programKey: 'other' }], statements)).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [record()], [{ ...other, year: 2025 }], statements)).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [record()], [{ ...other, status: 'Withdrawn' }], statements)).toEqual([]);
  });

  it('should format IDs with the program\'s prefix', () => {
    expect(formatEnrollmentId('CI', 2026, 123)).toBe('CI-2026-000123');
  });
});
