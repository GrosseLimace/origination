import { describe, it, expect } from 'vitest';
import { EnrollableRecord, ProgramEnrollment } from '@models';
import { AttestationStatement, blankAttestation, enrollmentBlockers, formatEnrollmentId } from './program-enrollment';

const statements: AttestationStatement[] = [
  { key: 'notEnrolledElsewhere', label: 'Not enrolled elsewhere.', short: '"not enrolled elsewhere" confirmation' },
  { key: 'consent', label: 'Consents to audit.', short: 'consent to audit' },
];

const record = (overrides: Partial<EnrollableRecord> = {}): EnrollableRecord => ({
  recordId: 'r1', seasonId: 's1', fieldKey: 'TATOB28', fieldName: 'Penka #1', splitId: 'TATOB28', cropLabel: 'Corn', year: 2026, acres: 80, status: 'Ready', ...overrides,
});

const enrollment = (overrides: Partial<ProgramEnrollment> = {}): ProgramEnrollment => ({
  key: 'k1', programKey: 'p', enrollmentId: 'CI-2026-000002', customerId: 9, year: 2026, status: 'Open',
  attestation: { ...blankAttestation(statements), signerName: 'Pat', signedOn: '2026-05-02', confirmations: { notEnrolledElsewhere: true, consent: true } },
  ...overrides,
});

describe('program enrollment rules', () => {
  it('should let the producer attest before harvest, once every field is scored', () => {
    expect(enrollmentBlockers(enrollment(), [record()], [], statements)).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [record({ status: 'Locked' })], [], statements)).toEqual([]);
  });

  it('should list each unconfirmed statement from the program, unscored fields and the signature', () => {
    const e = enrollment({ attestation: { ...blankAttestation(statements), method: 'Paper' } });
    expect(enrollmentBlockers(e, [record({ status: 'Draft' })], [], statements)).toEqual([
      'finish the inputs for Penka #1', 'who signed', 'date signed', 'the signed form\'s document reference',
      '"not enrolled elsewhere" confirmation', 'consent to audit',
    ]);
    expect(enrollmentBlockers(enrollment(), [], [], statements)).toEqual(['at least one field']);
  });

  it('should block a split already in another attested enrollment of the same program and year', () => {
    const other = enrollment({ key: 'k2', enrollmentId: 'CI-2026-000001', customerId: 10, status: 'Attested', snapshot: [record()] });
    expect(enrollmentBlockers(enrollment(), [record()], [other], statements)).toEqual(['Penka #1 (TATOB28) is already in CI-2026-000001']);
    // A landlord's and a tenant's shares are separate split IDs.
    expect(enrollmentBlockers(enrollment(), [record({ fieldKey: 'TATOB29', splitId: 'TATOB29' })], [other], statements)).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [record()], [{ ...other, programKey: 'other' }], statements)).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [record()], [{ ...other, year: 2025 }], statements)).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [record()], [{ ...other, status: 'Withdrawn' }], statements)).toEqual([]);
  });

  it('should format IDs with the program\'s prefix', () => {
    expect(formatEnrollmentId('CI', 2026, 123)).toBe('CI-2026-000123');
  });
});
