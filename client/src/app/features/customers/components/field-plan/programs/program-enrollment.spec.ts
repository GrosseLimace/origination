import { describe, it, expect } from 'vitest';
import { EnrollableRecord, ProgramEnrollment } from '@models';
import { AttestationStatement, blankAttestation, deliveryCheck, enrollmentBlockers, formatEnrollmentId, fsaKey } from './program-enrollment';

const statements: AttestationStatement[] = [
  { key: 'notEnrolledElsewhere', label: 'Not enrolled elsewhere.', short: '"not enrolled elsewhere" confirmation' },
  { key: 'consent', label: 'Consents to audit.', short: 'consent to audit' },
];

const record = (overrides: Partial<EnrollableRecord> = {}): EnrollableRecord => ({
  recordId: 'r1', seasonId: 's1', fieldKey: 'f1', fieldName: 'Penka #1', fsa: '1234/5678/3', cropLabel: 'Corn', year: 2026, acres: 80, status: 'Ready', ...overrides,
});

const enrollment = (overrides: Partial<ProgramEnrollment> = {}): ProgramEnrollment => ({
  key: 'k1', programKey: 'p', enrollmentId: 'CI-2026-000002', customerId: 9, year: 2026, status: 'Open',
  attestation: { ...blankAttestation(statements), signerName: 'Pat', signedOn: '2026-05-02', confirmations: { notEnrolledElsewhere: true, consent: true } },
  ...overrides,
});

describe('program enrollment rules', () => {
  it('should let the producer attest before harvest, once every field is scored', () => {
    expect(enrollmentBlockers(enrollment(), [record()], [], statements)).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [record({ status: 'Final' })], [], statements)).toEqual([]);
  });

  it('should list each unconfirmed statement from the program, unscored fields and the signature', () => {
    const e = enrollment({ attestation: { ...blankAttestation(statements), method: 'Paper' } });
    expect(enrollmentBlockers(e, [record({ status: 'Draft' })], [], statements)).toEqual([
      'finish the inputs for Penka #1', 'who signed', 'date signed', 'the signed form\'s document reference',
      '"not enrolled elsewhere" confirmation', 'consent to audit',
    ]);
    expect(enrollmentBlockers(enrollment(), [], [], statements)).toEqual(['at least one field']);
  });

  it('should need FSA numbers on every field before the producer attests', () => {
    expect(enrollmentBlockers(enrollment(), [record({ fsa: '' })], [], statements)).toEqual(['FSA numbers for Penka #1']);
  });

  it('should block a field already in another attested enrollment of the same program and year, by field or FSA numbers', () => {
    const other = enrollment({ key: 'k2', enrollmentId: 'CI-2026-000001', customerId: 10, status: 'Attested', snapshot: [record({ fieldKey: 'landlord-f' })] });
    // A landlord's field with the same FSA numbers.
    expect(enrollmentBlockers(enrollment(), [record()], [other], statements)).toEqual(['Penka #1 is already in CI-2026-000001']);
    expect(enrollmentBlockers(enrollment(), [record({ fsa: '1234/5678/4' })], [other], statements)).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [record()], [{ ...other, programKey: 'other' }], statements)).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [record()], [{ ...other, year: 2025 }], statements)).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [record()], [{ ...other, status: 'Withdrawn' }], statements)).toEqual([]);
  });

  it('should format IDs with the program\'s prefix, and FSA keys only when complete', () => {
    expect(formatEnrollmentId('CI', 2026, 123)).toBe('CI-2026-000123');
    expect(fsaKey({ fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo: '3' })).toBe('1234/5678/3');
    expect(fsaKey({ fsaFarmNo: '1234', fsaTractNo: ' ', fsaFieldNo: '3' })).toBe('');
  });
});

describe('deliveryCheck', () => {
  it('should compare ticket bushels with the fields\' production and flag a gap over 10%', () => {
    expect(deliveryCheck([8000, 8000], [16400])).toMatchObject({ delivered: 16000, production: 16400, flagged: false });
    expect(deliveryCheck([19000], [16400]).flagged).toBe(true);
    expect(deliveryCheck([12000], [16400]).flagged).toBe(true);
  });

  it('should leave fields without an actual yield out, and not flag before any production is known', () => {
    expect(deliveryCheck([16000], [16400, null])).toMatchObject({ production: 16400, fieldsWithout: 1, flagged: false });
    expect(deliveryCheck([5000], [null, undefined])).toMatchObject({ gap: null, flagged: false, fieldsWithout: 2 });
  });
});
