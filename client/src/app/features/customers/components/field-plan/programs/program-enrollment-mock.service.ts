import { Injectable, inject, signal } from '@angular/core';
import { EnrollableRecord, ProgramEnrollment } from '@models';
import { ProgramRegistry } from './program-registry';
import { blankAttestation, enrollmentBlockers, formatEnrollmentId } from './program-enrollment';

/**
 * PROTOTYPE ONLY: in-memory program enrollments, one live enrollment per producer per program per
 * year. The ID is issued the moment the producer's first field enters the program, so incoming
 * tickets can be assigned it; attesting records the producer's signature. Nothing is persisted.
 */
@Injectable({ providedIn: 'root' })
export class ProgramEnrollmentMockService {
  private readonly registry = inject(ProgramRegistry);
  readonly enrollments = signal<ProgramEnrollment[]>([]);
  /** Per program, so each program's IDs run from 000001. */
  private readonly _nextSeq = new Map<string, number>();

  /** The producer's live (Open or Attested) enrollment in a program for the year. */
  current(programKey: string, customerId: number, year: number): ProgramEnrollment | undefined {
    return this.enrollments().find(e => e.programKey === programKey && e.customerId === customerId && e.year === year && e.status !== 'Withdrawn');
  }

  withdrawn(programKey: string, customerId: number, year: number): ProgramEnrollment[] {
    return this.enrollments().filter(e => e.programKey === programKey && e.customerId === customerId && e.year === year && e.status === 'Withdrawn');
  }

  /** The live enrollment, or a new one with its ID issued now. */
  ensureFor(programKey: string, customerId: number, year: number): ProgramEnrollment | undefined {
    const existing = this.current(programKey, customerId, year);
    const def = this.registry.get(programKey);
    if (existing || !def) return existing;
    const seq = this._nextSeq.get(programKey) ?? 1;
    this._nextSeq.set(programKey, seq + 1);
    const created: ProgramEnrollment = {
      key: crypto.randomUUID(), programKey, enrollmentId: formatEnrollmentId(def.enrollment.idPrefix, year, seq),
      customerId, year, status: 'Open', attestation: blankAttestation(def.enrollment.statements),
    };
    this.enrollments.update(es => [...es, created]);
    return created;
  }

  /** The attested enrollment whose signed snapshot holds this record. A finalized record in it can't be reopened. */
  lockedBy(recordId: string): ProgramEnrollment | undefined {
    return this.enrollments().find(e => e.status === 'Attested' && (e.snapshot ?? []).some(r => r.recordId === recordId));
  }

  /** Saves an open enrollment's attestation. An attested enrollment only changes by withdrawal. */
  update(enrollment: ProgramEnrollment): void {
    this.enrollments.update(es => es.map(e => (e.key === enrollment.key && e.status === 'Open'
      ? { ...e, attestation: { ...enrollment.attestation, confirmations: { ...enrollment.attestation.confirmations } } }
      : e)));
  }

  blockers(enrollment: ProgramEnrollment, listed: readonly EnrollableRecord[]): string[] {
    const statements = this.registry.get(enrollment.programKey)?.enrollment.statements ?? [];
    return enrollmentBlockers(enrollment, listed, this.enrollments(), statements);
  }

  /** Records the producer's attestation over the listed records. Refused while anything is outstanding. */
  attest(key: string, listed: readonly EnrollableRecord[]): ProgramEnrollment | undefined {
    const e = this.enrollments().find(x => x.key === key);
    if (!e || e.status !== 'Open' || this.blockers(e, listed).length > 0) return undefined;
    const attested: ProgramEnrollment = {
      ...e, status: 'Attested', attestedBy: 'you', attestedAt: new Date().toISOString(), snapshot: listed.map(r => ({ ...r })),
    };
    this.enrollments.update(es => es.map(x => (x.key === key ? attested : x)));
    return attested;
  }

  /** Records (or clears) harvest complete for the enrollment. Finalizing its fields is ProgramRecordMockService's job. */
  setHarvestComplete(key: string, complete: boolean): void {
    this.enrollments.update(es => es.map(e => (e.key === key
      ? { ...e, harvestCompleteAt: complete ? new Date().toISOString() : undefined }
      : e)));
  }

  /**
   * Withdraws an enrollment with a reason. Its ID and snapshot are kept and the ID is never reissued;
   * the producer's next program input starts a new enrollment with a new ID.
   */
  withdraw(key: string, reason: string): void {
    if (!reason.trim()) return;
    this.enrollments.update(es => es.map(e => (e.key === key && e.status !== 'Withdrawn'
      ? { ...e, status: 'Withdrawn', withdrawnReason: reason.trim() }
      : e)));
  }
}
