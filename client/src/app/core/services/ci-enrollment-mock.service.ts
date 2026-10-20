import { Injectable, signal } from '@angular/core';
import { CiEnrollment, EnrollableSeason } from '@models';
import { blankAttestation, enrollmentBlockers, formatEnrollmentId } from '@shared/utils/ci-enrollment';

/**
 * PROTOTYPE ONLY: in-memory stand-in for 45Z enrollments, one live enrollment per producer per crop
 * year. Attesting issues the Enrollment ID that delivery lots in the CI ledger will point back to, and
 * locks the listed field seasons. Nothing is persisted: a reload starts over.
 */
@Injectable({ providedIn: 'root' })
export class CiEnrollmentMockService {
  readonly enrollments = signal<CiEnrollment[]>([]);
  private _nextSeq = 1;

  /** The producer's live (Draft or Attested) enrollment for the crop year. */
  current(customerId: number, cropYear: number): CiEnrollment | undefined {
    return this.enrollments().find(e => e.customerId === customerId && e.cropYear === cropYear && e.status !== 'Withdrawn');
  }

  withdrawn(customerId: number, cropYear: number): CiEnrollment[] {
    return this.enrollments().filter(e => e.customerId === customerId && e.cropYear === cropYear && e.status === 'Withdrawn');
  }

  /** The attested enrollment holding this season, if any. Its seasons can't be reopened. */
  lockedBy(seasonId: string): CiEnrollment | undefined {
    return this.enrollments().find(e => e.status === 'Attested' && e.fieldSeasonIds.includes(seasonId));
  }

  start(customerId: number, cropYear: number, fieldSeasonIds: string[]): CiEnrollment {
    const existing = this.current(customerId, cropYear);
    if (existing) return existing;
    const created: CiEnrollment = {
      key: crypto.randomUUID(), enrollmentId: null, customerId, cropYear, status: 'Draft',
      fieldSeasonIds, attestation: blankAttestation(),
    };
    this.enrollments.update(es => [...es, created]);
    return created;
  }

  /** Saves a draft's field list and attestation. An attested enrollment only changes by withdrawal. */
  update(enrollment: CiEnrollment): void {
    this.enrollments.update(es => es.map(e => (e.key === enrollment.key && e.status === 'Draft'
      ? { ...enrollment, fieldSeasonIds: [...enrollment.fieldSeasonIds], attestation: { ...enrollment.attestation } }
      : e)));
  }

  blockers(enrollment: CiEnrollment, listed: readonly EnrollableSeason[]): string[] {
    return enrollmentBlockers(enrollment, listed, this.enrollments());
  }

  /** Records the attestation and issues the Enrollment ID. Refused while anything is outstanding. */
  attest(key: string, listed: readonly EnrollableSeason[]): CiEnrollment | undefined {
    const e = this.enrollments().find(x => x.key === key);
    if (!e || e.status !== 'Draft' || this.blockers(e, listed).length > 0) return undefined;
    const attested: CiEnrollment = {
      ...e, status: 'Attested', enrollmentId: formatEnrollmentId(e.cropYear, this._nextSeq++),
      attestedBy: 'you', attestedAt: new Date().toISOString(), snapshot: listed.map(s => ({ ...s })),
    };
    this.enrollments.update(es => es.map(x => (x.key === key ? attested : x)));
    return attested;
  }

  /** Withdraws an enrollment with a reason. The ID and snapshot are kept and the ID is never reissued. */
  withdraw(key: string, reason: string): void {
    if (!reason.trim()) return;
    this.enrollments.update(es => es.map(e => (e.key === key && e.status === 'Attested'
      ? { ...e, status: 'Withdrawn', withdrawnReason: reason.trim() }
      : e)));
  }
}
