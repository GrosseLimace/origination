import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldPlanStore } from '../store/field-plan.store';
import { OFFICIAL_STATUS_TEXT, ProgramRecordStatus, ProgramScore } from '../../../models/field-plan.model';
import { ProgramRegistry } from './program-registry';
import { FieldResult } from './program-def';
import { LadderRow, atOrBelowTarget, ciLadder } from './ci-ladder';
import { downloadCsv } from '@shared/utils/csv';
import { ledgerCsv, ledgerFileName } from './fd-cic/mass-balance-ledger';
import { FdCicDocumentsDialogComponent } from './fd-cic/fd-cic-documents-dialog.component';
import { HasPermissionDirective } from '@core/access/has-permission.directive';
import { FD_CIC_PROGRAM_KEY } from './fd-cic/fd-cic.program';
import { FieldPlanDocumentsService } from '../store/field-plan-documents.service';

/** One field in the card: its program record's acres and status, plus its score and bushels. */
interface CardField {
  recordId: string;
  fieldName: string;
  /** The field's enrollment ID in the program for the year, derived from split ID + crop year. */
  enrollmentId: string;
  cropLabel: string;
  acres: number | null;
  status: ProgramRecordStatus;
  score?: ProgramScore;
  /** Why there is no score yet when the inputs are in, e.g. "calculating…" (see the program's previewNote). */
  scoreNote?: string;
  result: FieldResult;
  official: string;
  confirmed: boolean;
}

/**
 * A producer's summary for one sustainability program and year, above the planting table. It is shown when
 * the producer has fields in the program that year, each with its own derived ID (e.g. CI-2026-TATOB43;
 * nobody types one). The card holds:
 *
 * - "bushels by CI": per crop, the scored fields lowest CI first with their bushels and a running total,
 *   and a target box ("at or below 3,000 g/bu → 69,000 bu"). Never one producer-wide average:
 *   downstream opportunities set different CI targets, so field-level CI and bushels are what matter;
 * - the fields not scored yet.
 *
 * After harvest each field is reviewed with its CTRM tickets and confirmed on its own (the field dialog's
 * Review), which locks it with the confirmed CI. Every CI here is a planning estimate until then; then the
 * confirmed CI and its ticket bushels show, and the card downloads the confirmed fields as the Mass Balance
 * Ledger (one row per field).
 *
 * PROTOTYPE ONLY (in memory).
 */
@Component({
  selector: 'app-program-enrollment-card',
  standalone: true,
  imports: [CommonModule, FormsModule, FdCicDocumentsDialogComponent, HasPermissionDirective],
  styleUrl: '../field-plan.css',
  templateUrl: './program-enrollment-card.component.html',
})
export class ProgramEnrollmentCardComponent {
  private readonly store = inject(FieldPlanStore);
  private readonly registry = inject(ProgramRegistry);

  readonly programKey = input.required<string>();
  readonly customerId = input.required<number>();
  readonly year = input.required<number>();
  /** The producer's CTRM code and name, for the Mass Balance Ledger. */
  readonly producer = input<{ code: string; name: string } | null>(null);

  /** The program, if it gives its fields IDs (otherwise the card shows nothing). */
  readonly program = computed(() => {
    const def = this.registry.get(this.programKey());
    return def?.enrollment ? def : undefined;
  });

  /** Every record the producer has in this program for the year, with its season and field. */
  private readonly items = computed(() => {
    const customerId = this.customerId();
    const year = this.year();
    const program = this.program();
    return this.store.records().flatMap(record => {
      if (!program || record.programKey !== program.key) return [];
      const season = this.store.season(record.seasonId);
      const field = season && this.store.field(season.fieldKey);
      return season && field && field.customerId === customerId && season.year === year ? [{ record, season, field }] : [];
    });
  });

  /** The producer's fields in the program this year, with each one's score and bushels. */
  readonly records = computed<CardField[]>(() => {
    const program = this.program()!;
    const results = new Map((program.fieldResults?.(this.items()) ?? []).map(r => [r.recordId, r]));
    return this.items().map(({ record: r, season, field }) => ({
      recordId: r.id, fieldName: field.name, enrollmentId: this.store.enrollmentIdOf(r) ?? '',
      cropLabel: season.cropLabel, acres: season.acres, status: r.status,
      score: r.frozen?.score ?? program.preview(r.data, season, field) ?? undefined,
      scoreNote: program.previewNote?.(r.data, season, field) ?? undefined,
      result: results.get(r.id) ?? { recordId: r.id, group: season.cropLabel, value: null, unitShort: '', bushels: null, projected: true },
      official: OFFICIAL_STATUS_TEXT[r.official?.status ?? 'NotStarted'],
      confirmed: r.official?.status === 'Documented',
    }));
  });

  readonly confirmedCount = computed(() => this.records().filter(r => r.confirmed).length);

  /** 45Z documents in Doc Store (attestation, Biofuel Feedstock Reports) for the producer and year; needs the API field plan. */
  readonly documentsEnabled = inject(FieldPlanDocumentsService).enabled;
  readonly fdCicKey = FD_CIC_PROGRAM_KEY;
  readonly documentsOpen = signal(false);

  /** The Mass Balance Ledger: one row per confirmed field, with its confirmed bushels and CI. */
  downloadLedger(): void {
    const producer = this.producer();
    if (!producer) return;
    const fields = this.items()
      .filter(i => i.record.official?.status === 'Documented')
      .map(i => ({ ...i, enrollmentId: this.store.enrollmentIdOf(i.record) }));
    downloadCsv(ledgerCsv(producer, fields), ledgerFileName(producer.code, this.year(), new Date()));
  }

  /** Per group (45Z: crop), the scored fields as a ladder, lowest CI first, with the range and total bushels. */
  readonly groups = computed(() => {
    const byGroup = new Map<string, CardField[]>();
    for (const r of this.records()) {
      if (r.result.value === null) continue;
      byGroup.set(r.result.group, [...(byGroup.get(r.result.group) ?? []), r]);
    }
    return [...byGroup].sort(([a], [b]) => a.localeCompare(b)).map(([group, fields]) => {
      const ladder: LadderRow<CardField>[] = ciLadder(fields.map(item => ({ item, value: item.result.value!, bushels: item.result.bushels ?? 0 })));
      const low = Math.round(ladder[0].value), high = Math.round(ladder[ladder.length - 1].value);
      return {
        group, ladder, unitShort: fields[0].result.unitShort,
        range: low === high ? low.toLocaleString() : `${low.toLocaleString()}–${high.toLocaleString()}`,
        bushels: ladder[ladder.length - 1].atOrBelow,
      };
    });
  });

  readonly unscored = computed(() => this.records().filter(r => r.result.value === null));

  /** A CI target per group, typed in to see the bushels at or below it. Screen state only. */
  readonly targets = signal<Record<string, number | null>>({});

  setTarget(group: string, value: number | string | null): void {
    const n = value === null || value === '' ? null : Number(value);
    this.targets.update(t => ({ ...t, [group]: n !== null && Number.isFinite(n) && n > 0 ? n : null }));
  }

  targetResult(g: { group: string; ladder: LadderRow<CardField>[] }): { bushels: number; fields: number } | null {
    const target = this.targets()[g.group];
    return target ? atOrBelowTarget(g.ladder, target) : null;
  }

  /** Where a field's CI sits against the group's typed target; null while there's no target. */
  targetSide(group: string, value: number): 'at-or-below' | 'above' | null {
    const target = this.targets()[group];
    if (!target) return null;
    return value <= target ? 'at-or-below' : 'above';
  }

  open = false;
}
