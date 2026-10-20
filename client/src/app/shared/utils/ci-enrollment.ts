import { CiEnrollment, CiIntakeFields, EnrollableSeason, EvidenceKind, NApplication, NEfficiency, NProduct, NTiming, OnFarmEnergy, ProducerAttestation } from '@models';
import { ScorableSeason, missingInputs } from './ci-illustrative';

/**
 * PROTOTYPE ONLY: the audit rules for 45Z intake, kept pure so the server can be built and tested
 * against the same cases. A field season is finalized with its records; a producer's finalized
 * fields are enrolled under one signed attestation, and the Enrollment ID is what a delivery lot
 * in the CI ledger points back to.
 */

/** Stamped on a finalized season; the real FD-CIC port replaces it with its own version. */
export const CALCULATOR_VERSION = 'illustrative-prototype';

export const N_PRODUCT_LABELS: Record<NProduct, string> = {
  Anhydrous: 'Anhydrous ammonia', UAN: 'UAN (28/32%)', Urea: 'Urea', AmmoniumNitrate: 'Ammonium nitrate',
  AmmoniumSulfate: 'Ammonium sulfate', MapDap: 'MAP / DAP', Other: 'Other',
};
export const N_TIMING_LABELS: Record<NTiming, string> = {
  Fall: 'Fall', Preplant: 'Spring preplant', AtPlant: 'At planting', Sidedress: 'Sidedress', Split: 'Split',
};
export const N_EFFICIENCY_LABELS: Record<NEfficiency, string> = {
  None: 'None', NitrificationInhibitor: 'Nitrification inhibitor', UreaseInhibitor: 'Urease inhibitor',
  Both: 'Both inhibitors', PolymerCoated: 'Polymer-coated',
};
export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  NInvoice: 'N fertilizer invoice', NApplicationRecord: 'N application record',
  YieldRecord: 'Yield record (yield monitor, scale tickets, FSA-578)', EnergyRecord: 'Fuel or energy record', Other: 'Other',
};

export function emptyEnergy(): OnFarmEnergy {
  return { dieselGal: null, gasolineGal: null, lpGal: null, naturalGasTherms: null, electricityKwh: null };
}

/** The intake fields a new season starts with. */
export function emptyIntake(): CiIntakeFields {
  return {
    nApplications: [], noNApplied: false, phosphateLbs: null, potashLbs: null, limeTons: null,
    energy: emptyEnergy(), evidence: [],
  };
}

/** Deep copy, so a draft never shares rows with the stored season. */
export function cloneIntake(s: CiIntakeFields): CiIntakeFields {
  return {
    nApplications: s.nApplications.map(a => ({ ...a })), noNApplied: s.noNApplied,
    phosphateLbs: s.phosphateLbs, potashLbs: s.potashLbs, limeTons: s.limeTons,
    energy: { ...s.energy }, evidence: s.evidence.map(e => ({ ...e })),
    finalCiGPerBu: s.finalCiGPerBu, calculatorVersion: s.calculatorVersion,
  };
}

const CARRIES_NI: ReadonlySet<NEfficiency> = new Set(['NitrificationInhibitor', 'Both']);

/**
 * The scoring inputs the application list implies: total lbs N/ac, and the share of that N carrying
 * a nitrification inhibitor. An empty list is "not entered" (null) unless the producer confirmed
 * no N went on, so a blank can never score as 0 lbs.
 */
export function nSummary(apps: readonly NApplication[], noNApplied: boolean): { syntheticN: number | null; niFraction: number } {
  if (apps.length === 0) return { syntheticN: noNApplied ? 0 : null, niFraction: 0 };
  const total = apps.reduce((sum, a) => sum + (a.lbsN ?? 0), 0);
  const ni = apps.reduce((sum, a) => sum + (CARRIES_NI.has(a.efficiency) ? (a.lbsN ?? 0) : 0), 0);
  return { syntheticN: total, niFraction: total > 0 ? ni / total : 0 };
}

/** Writes nSummary onto the season in place (drafts are edited in place, then saved). */
export function applyNSummary(s: CiIntakeFields & { syntheticN: number | null; niFraction: number }): void {
  Object.assign(s, nSummary(s.nApplications, s.noNApplied));
}

/**
 * What still stands between a scored field season and Final, in form order. Final is what the
 * enrollment and the ledger rely on, so it needs the records an auditor will ask for, not just
 * enough to score.
 */
export function finalizeBlockers(season: ScorableSeason & CiIntakeFields, actualYield: number | null): string[] {
  const blockers = [...missingInputs(season)];
  const nIdx = blockers.indexOf('nitrogen rate');
  if (nIdx >= 0) blockers.splice(nIdx, 1, 'nitrogen applications (or confirm none applied)');
  if (season.nApplications.some(a => !a.lbsN || a.lbsN <= 0)) blockers.push('pounds of N on every application');
  if (!actualYield || actualYield <= 0) blockers.push('actual yield');
  const kinds = new Set(season.evidence.map(e => e.kind));
  if (!kinds.has('YieldRecord')) blockers.push('a yield record');
  if (season.nApplications.length > 0 && !kinds.has('NInvoice') && !kinds.has('NApplicationRecord')) {
    blockers.push('an N invoice or application record');
  }
  return blockers;
}

export function blankAttestation(): ProducerAttestation {
  return {
    signerName: '', signedOn: '', method: 'eSign', documentRef: '',
    notEnrolledElsewhere: false, recordsAccurate: false, consentToThirdPartyAudit: false, firstPointOfAggregationAck: false,
  };
}

/** "CI-2026-000123". */
export function formatEnrollmentId(cropYear: number, seq: number): string {
  return `CI-${cropYear}-${String(seq).padStart(6, '0')}`;
}

/**
 * What still stands between a draft enrollment and Attested. `listed` is the enrollment's seasons as
 * they are now; `others` is every other enrollment (any producer), whose attested snapshots are
 * checked so a field is never claimed twice in a crop year. Only our own field IDs are matched: a
 * field another buyer or producer enrolls is covered by the producer's "not enrolled elsewhere" attestation.
 */
export function enrollmentBlockers(enrollment: CiEnrollment, listed: readonly EnrollableSeason[], others: readonly CiEnrollment[]): string[] {
  const blockers: string[] = [];
  if (listed.length === 0) blockers.push('at least one field');
  const notFinal = listed.filter(s => s.status !== 'Final' || s.finalCiGPerBu === undefined);
  if (notFinal.length) blockers.push(`finalize ${notFinal.map(s => s.fieldName).join(', ')}`);

  const a = enrollment.attestation;
  if (!a.signerName.trim()) blockers.push('who signed');
  if (!a.signedOn) blockers.push('date signed');
  if (a.method === 'Paper' && !a.documentRef.trim()) blockers.push('the signed form\'s document reference');
  if (!a.notEnrolledElsewhere) blockers.push('"not enrolled elsewhere" confirmation');
  if (!a.recordsAccurate) blockers.push('"records are accurate" confirmation');
  if (!a.consentToThirdPartyAudit) blockers.push('consent to third-party audit');
  if (!a.firstPointOfAggregationAck) blockers.push('first-point-of-aggregation acknowledgment');

  const claims = new Map<string, string>();
  for (const o of others) {
    if (o.key === enrollment.key || o.status !== 'Attested' || o.cropYear !== enrollment.cropYear) continue;
    for (const s of o.snapshot ?? []) {
      claims.set(`field:${s.fieldKey}`, o.enrollmentId!);
    }
  }
  for (const s of listed) {
    const by = claims.get(`field:${s.fieldKey}`);
    if (by) blockers.push(`${s.fieldName} is already in ${by}`);
  }
  return blockers;
}
