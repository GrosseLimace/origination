import { describe, it, expect } from 'vitest';
import { CiEnrollment, EnrollableSeason, FieldSeason, NApplication } from '@models';
import { blankAttestation, emptyIntake, enrollmentBlockers, finalizeBlockers, formatEnrollmentId, fsaKey, nSummary } from './ci-enrollment';

const app = (lbsN: number | null, efficiency: NApplication['efficiency'] = 'None'): NApplication =>
  ({ product: 'Anhydrous', lbsN, timing: 'Preplant', efficiency });

function season(overrides: Partial<FieldSeason> = {}): FieldSeason {
  return {
    id: 's1', fieldKey: 'f1', plantingIntentionId: 1, year: 2026, cropLabel: 'Corn', acres: 100,
    expectedYield: 200, actualYield: null, syntheticN: 180, niFraction: 0,
    tillage: 'NoTill', coverCrop: 'None', manure: [], status: 'Projected',
    ...emptyIntake(),
    nApplications: [app(180)],
    evidence: [
      { id: 'e1', kind: 'NInvoice', reference: 'Co-op 48812', addedBy: 'you', addedAt: '2026-11-01' },
      { id: 'e2', kind: 'YieldRecord', reference: 'FSA-578', addedBy: 'you', addedAt: '2026-11-01' },
    ],
    ...overrides,
  };
}

const FSA = { fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo: '3' };

function enrollable(overrides: Partial<EnrollableSeason> = {}): EnrollableSeason {
  return {
    seasonId: 's1', fieldKey: 'f1', fieldName: 'North 80', ...FSA, cropLabel: 'Corn', cropYear: 2026,
    acres: 80, actualYield: 205, status: 'Final', finalCiGPerBu: 4100, ...overrides,
  };
}

function enrollment(overrides: Partial<CiEnrollment> = {}): CiEnrollment {
  return {
    key: 'k1', enrollmentId: null, customerId: 9, cropYear: 2026, status: 'Draft', fieldSeasonIds: ['s1'],
    attestation: {
      ...blankAttestation(), signerName: 'Pat Producer', signedOn: '2026-11-02', notEnrolledElsewhere: true,
      recordsAccurate: true, consentToThirdPartyAudit: true, firstPointOfAggregationAck: true,
    },
    ...overrides,
  };
}

describe('nSummary', () => {
  it('should total the N and give the share carrying a nitrification inhibitor', () => {
    expect(nSummary([app(120, 'NitrificationInhibitor'), app(40), app(40, 'Both')], false))
      .toEqual({ syntheticN: 200, niFraction: 0.8 });
  });

  it('should not count a urease inhibitor or polymer coating as a nitrification inhibitor', () => {
    expect(nSummary([app(100, 'UreaseInhibitor'), app(100, 'PolymerCoated')], false).niFraction).toBe(0);
  });

  it('should leave N unentered for an empty list unless the producer confirmed none', () => {
    expect(nSummary([], false).syntheticN).toBeNull();
    expect(nSummary([], true).syntheticN).toBe(0);
  });
});

describe('finalizeBlockers', () => {
  it('should pass a scored season with records, actual yield and FSA numbers', () => {
    expect(finalizeBlockers(season(), FSA, 205)).toEqual([]);
  });

  it('should ask for actual yield, FSA numbers and records', () => {
    expect(finalizeBlockers(season({ evidence: [] }), { fsaFarmNo: '1234' }, null)).toEqual([
      'actual yield', 'FSA farm, tract and field numbers', 'a yield record', 'an N invoice or application record',
    ]);
  });

  it('should ask for N applications, or a no-N confirmation, rather than a bare rate', () => {
    const blank = season({ nApplications: [], syntheticN: null });
    expect(finalizeBlockers(blank, FSA, 205)).toContain('nitrogen applications (or confirm none applied)');
    // No N applied: no N record is needed, only the yield record.
    const none = season({ nApplications: [], noNApplied: true, syntheticN: 0, evidence: [season().evidence[1]] });
    expect(finalizeBlockers(none, FSA, 205)).toEqual([]);
  });

  it('should require pounds on every application', () => {
    expect(finalizeBlockers(season({ nApplications: [app(180), app(null)] }), FSA, 205)).toContain('pounds of N on every application');
  });
});

describe('enrollmentBlockers', () => {
  it('should pass a signed enrollment of finalized fields', () => {
    expect(enrollmentBlockers(enrollment(), [enrollable()], [])).toEqual([]);
  });

  it('should need finalized fields and a complete attestation', () => {
    const e = enrollment({ attestation: { ...blankAttestation(), method: 'Paper' } });
    expect(enrollmentBlockers(e, [enrollable({ status: 'Projected', finalCiGPerBu: undefined })], [])).toEqual([
      'finalize North 80', 'who signed', 'date signed', 'the signed form\'s document reference',
      '"not enrolled elsewhere" confirmation', '"records are accurate" confirmation',
      'consent to third-party audit', 'first-point-of-aggregation acknowledgment',
    ]);
    expect(enrollmentBlockers(enrollment(), [], [])).toEqual(['at least one field']);
  });

  it('should block a field already in another attested enrollment the same crop year, by field or FSA numbers', () => {
    const other = enrollment({
      key: 'k2', enrollmentId: 'CI-2026-000001', customerId: 10, status: 'Attested',
      snapshot: [enrollable({ fieldKey: 'landlord-f' })],
    });
    expect(enrollmentBlockers(enrollment(), [enrollable()], [other])).toEqual(['North 80 is already in CI-2026-000001']);

    // Withdrawn, another year, or different FSA numbers: no conflict.
    expect(enrollmentBlockers(enrollment(), [enrollable()], [{ ...other, status: 'Withdrawn' }])).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [enrollable()], [{ ...other, cropYear: 2025 }])).toEqual([]);
    expect(enrollmentBlockers(enrollment(), [enrollable({ fsaFieldNo: '4' })], [other])).toEqual([]);
  });
});

describe('ids', () => {
  it('should format enrollment IDs and FSA keys', () => {
    expect(formatEnrollmentId(2026, 123)).toBe('CI-2026-000123');
    expect(fsaKey(FSA)).toBe('1234/5678/3');
    expect(fsaKey({ fsaFarmNo: '1234', fsaTractNo: ' ', fsaFieldNo: '3' })).toBeNull();
  });
});
