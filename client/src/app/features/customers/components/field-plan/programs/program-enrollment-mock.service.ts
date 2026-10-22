import { Injectable, inject, signal } from '@angular/core';
import { EnrollableRecord, ProgramEnrollment } from '@models';
import { ProgramRegistry } from './program-registry';
import { blankAttestation, enrollmentBlockers, formatEnrollmentId } from './program-enrollment';

/**
 * PROTOTYPE ONLY: in-memory program enrollments, one live enrollment per producer per program per
 * year. Attesting issues the program's Enrollment ID (45Z: the ID delivery lots in the CI ledger
 * carry) and locks the listed field records. Nothing is persisted: a reload starts over.
 */
@Injectable({ providedIn: 'root' })
export class ProgramEnrollmentMockService {
  private readonly registry = inject(ProgramRegistry);
  readonly enrollments = signal<ProgramEnrollment[]>([]);
  /** Per program, so each program's IDs run from 000001. */
  private readonly _nextSeq = new Map<string, number>();

  /** The producer's live (Draft or Attested) enrollment in a program for the year. */
  current(programKey: string, customerId: number, year: number): ProgramEnrollment | undefined {
    return this.enrollments().find(e => e.programKey === programKey && e.customerId === customerId && e.year === year && e.status !== 'Withdrawn');
  }

  withdrawn(programKey: string, customerId: number, year: number): ProgramEnrollment[] {
    return this.enrollments().filter(e => e.programKey === programKey && e.customerId === customerId && e.year === year && e.status === 'Withdrawn');
  }

  /** The attested enrollment holding this record, if any. Its records can't be reopened. */
  lockedBy(recordId: string): ProgramEnrollment | undefined {
    return this.enrollments().find(e => e.status === 'Attested' && e.recordIds.includes(recordId));
  }

  start(programKey: string, customerId: number, year: number, recordIds: string[]): ProgramEnrollment {
    const existing = this.current(programKey, customerId, year);
    if (existing) return existing;
    const created: ProgramEnrollment = {
      key: crypto.randomUUID(), programKey, enrollmentId: null, customerId, year, status: 'Draft', recordIds,
      attestation: blankAttestation(this.registry.get(programKey)?.enrollment.statements ?? []),
    };
    this.enrollments.update(es => [...es, created]);
    return created;
  }

  /** Saves a draft's records and attestation. An attested enrollment only changes by withdrawal. */
  update(enrollment: ProgramEnrollment): void {
    this.enrollments.update(es => es.map(e => (e.key === enrollment.key && e.status === 'Draft'
      ? {
        ...enrollment, recordIds: [...enrollment.recordIds],
        attestation: { ...enrollment.attestation, confirmations: { ...enrollment.attestation.confirmations } },
      }
      : e)));
  }

  blockers(enrollment: ProgramEnrollment, listed: readonly EnrollableRecord[]): string[] {
    const statements = this.registry.get(enrollment.programKey)?.enrollment.statements ?? [];
    return enrollmentBlockers(enrollment, listed, this.enrollments(), statements);
  }

  /** Records the attestation and issues the Enrollment ID. Refused while anything is outstanding. */
  attest(key: string, listed: readonly EnrollableRecord[]): ProgramEnrollment | undefined {
    const e = this.enrollments().find(x => x.key === key);
    const def = e && this.registry.get(e.programKey);
    if (!e || !def || e.status !== 'Draft' || this.blockers(e, listed).length > 0) return undefined;
    const seq = this._nextSeq.get(e.programKey) ?? 1;
    this._nextSeq.set(e.programKey, seq + 1);
    const attested: ProgramEnrollment = {
      ...e, status: 'Attested', enrollmentId: formatEnrollmentId(def.enrollment.idPrefix, e.year, seq),
      attestedBy: 'you', attestedAt: new Date().toISOString(), snapshot: listed.map(r => ({ ...r })),
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
