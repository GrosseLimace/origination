import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EnrollableSeason } from '@models';
import { CiEnrollmentMockService } from './ci-enrollment-mock.service';

const north: EnrollableSeason = {
  seasonId: 's1', fieldKey: 'f1', fieldName: 'North 80', fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo: '3',
  cropLabel: 'Corn', cropYear: 2026, acres: 80, actualYield: 205, status: 'Final', finalCiGPerBu: 4100,
};
const signed = {
  signerName: 'Pat Producer', signedOn: '2026-11-02', method: 'eSign' as const, documentRef: '',
  notEnrolledElsewhere: true, recordsAccurate: true, consentToThirdPartyAudit: true, firstPointOfAggregationAck: true,
};

describe('CiEnrollmentMockService (prototype)', () => {
  let enrollments: CiEnrollmentMockService;

  beforeEach(() => {
    enrollments = TestBed.inject(CiEnrollmentMockService);
  });

  it('should issue an Enrollment ID only once the attestation is complete, and lock the seasons', () => {
    const draft = enrollments.start(9, 2026, ['s1']);
    expect(enrollments.attest(draft.key, [north])).toBeUndefined();

    enrollments.update({ ...draft, attestation: signed });
    const attested = enrollments.attest(draft.key, [north])!;
    expect(attested.enrollmentId).toBe('CI-2026-000001');
    expect(attested.snapshot).toEqual([north]);
    expect(enrollments.lockedBy('s1')?.enrollmentId).toBe('CI-2026-000001');
  });

  it('should keep a withdrawn enrollment and never reuse its ID', () => {
    const first = enrollments.start(9, 2026, ['s1']);
    enrollments.update({ ...first, attestation: signed });
    enrollments.attest(first.key, [north]);
    enrollments.withdraw(first.key, 'Producer enrolled with another buyer');
    expect(enrollments.lockedBy('s1')).toBeUndefined();
    expect(enrollments.withdrawn(9, 2026)[0].withdrawnReason).toBe('Producer enrolled with another buyer');

    const second = enrollments.start(9, 2026, ['s1']);
    enrollments.update({ ...second, attestation: signed });
    expect(enrollments.attest(second.key, [north])?.enrollmentId).toBe('CI-2026-000002');
  });

  it('should refuse the same field for a second producer the same crop year', () => {
    const owner = enrollments.start(9, 2026, ['s1']);
    enrollments.update({ ...owner, attestation: signed });
    enrollments.attest(owner.key, [north]);

    const tenant = enrollments.start(10, 2026, ['t1']);
    enrollments.update({ ...tenant, attestation: signed });
    const sameFsa = { ...north, seasonId: 't1', fieldKey: 'tenant-f', fieldName: 'Rented 80' };
    expect(enrollments.blockers(enrollments.current(10, 2026)!, [sameFsa])).toEqual(['Rented 80 is already in CI-2026-000001']);
    expect(enrollments.attest(tenant.key, [sameFsa])).toBeUndefined();
  });
});
