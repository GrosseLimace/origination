import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldPlanStore } from '../store/field-plan.store';
import { OFFICIAL_STATUS_TEXT, ProgramRecordStatus, ProgramScore } from '@models';
import { ProgramRegistry } from './program-registry';
import { FieldResult } from './program-def';
import { LadderRow, atOrBelowTarget, ciLadder } from './ci-ladder';
import { downloadCsv } from '@shared/utils/csv';
import { ledgerCsv, ledgerFileName } from './fd-cic/mass-balance-ledger';
import { FdCicDocumentsDialogComponent } from './fd-cic/fd-cic-documents-dialog.component';
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
  imports: [CommonModule, FormsModule, FdCicDocumentsDialogComponent],
  styleUrl: '../field-plan.css',
  template: `
    @if (program(); as p) {
    @if (records().length) {
    <div class="rounded-lg border border-scoular-green-accessible/40 dark:border-scoular-green/40 bg-white dark:bg-gray-800">
      <!-- One short line: program, ID, and each crop's CI range and bushels -->
      <button type="button" class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 bg-transparent border-0 px-4 py-2.5 text-left text-sm" (click)="open = !open">
        <span class="w-3 text-gray-400">{{ open ? '▾' : '▸' }}</span>
        <span class="font-semibold text-gray-900 dark:text-white">🌱 {{ p.shortLabel }} · {{ year() }}</span>
        <span class="text-xs text-gray-600 dark:text-gray-300">{{ records().length }} field{{ records().length === 1 ? '' : 's' }}</span>
        @if (confirmedCount()) { <span class="text-xs text-gray-500 dark:text-gray-400">{{ confirmedCount() }} of {{ records().length }} confirmed</span> }
        @for (g of groups(); track g.group) {
          <span class="text-gray-800 dark:text-gray-100">
            <span class="font-semibold">{{ g.group }} {{ g.range }} {{ g.unitShort }}</span>
            <span class="text-gray-600 dark:text-gray-300"> · {{ g.bushels | number:'1.0-0' }} bu</span>
          </span>
        }
      </button>

      @if (open) {
        <div class="space-y-5 border-t border-gray-100 dark:border-gray-700 px-4 py-4 text-sm">
          @if (p.official; as o) {
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs text-gray-500 dark:text-gray-400">Planning estimates from the {{ p.shortLabel }} calculator. {{ o.requirementsNote }}</p>
              <div class="flex flex-wrap gap-2">
                @if (documentsEnabled && p.key === fdCicKey) {
                  <button type="button" class="h-8 rounded-md px-3 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible"
                          (click)="documentsOpen.set(true)" data-testid="open-45z-documents">📄 45Z documents</button>
                }
                @if (confirmedCount() && producer()) {
                  <button type="button" class="h-8 rounded-md px-3 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible"
                          (click)="downloadLedger()">Download Mass Balance Ledger · {{ confirmedCount() }} field{{ confirmedCount() === 1 ? '' : 's' }}</button>
                }
              </div>
            </div>
          }
          <!-- Bushels by CI, one ladder per crop -->
          @for (g of groups(); track g.group) {
            <div>
              <div class="flex flex-wrap items-end justify-between gap-2">
                <div class="font-medium text-gray-900 dark:text-white">{{ g.group }} · bushels by CI</div>
                <label class="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">At or below
                  <input type="number" min="0" class="ci-input ci-compact !w-24 text-right" placeholder="target"
                         [ngModel]="targets()[g.group] ?? null" (ngModelChange)="setTarget(g.group, $event)" [attr.aria-label]="g.group + ' CI target'" />
                  {{ g.unitShort }}
                  @if (targetResult(g); as t) {
                    <span class="ml-1 font-medium text-gray-900 dark:text-white">→ {{ t.bushels | number:'1.0-0' }} bu from {{ t.fields }} field{{ t.fields === 1 ? '' : 's' }}</span>
                  }
                </label>
              </div>
              <table class="mt-1 w-full text-left">
                <thead class="text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr><th class="py-1 text-right pr-4">CI {{ g.unitShort }}</th><th>Field</th><th>Enrollment ID</th><th class="text-right">Acres</th><th class="text-right">Bushels</th><th class="text-right">At or below this CI</th>@if (p.official) { <th class="text-right">Confirmed</th> }</tr>
                </thead>
                <tbody>
                  @for (row of g.ladder; track row.item.recordId) {
                    <tr class="border-t border-gray-100 dark:border-gray-700">
                      <td class="py-1 pr-4 text-right tabular-nums">
                        <!-- Against the typed target only: green at or below it, red above. No target, no colour. -->
                        @switch (targetSide(g.group, row.value)) {
                          @case ('at-or-below') {
                            <div class="font-semibold text-green-700 dark:text-green-400" [title]="'At or below the ' + (targets()[g.group] | number) + ' target'">{{ row.value | number:'1.0-0' }}</div>
                          }
                          @case ('above') {
                            <div class="font-semibold text-red-700 dark:text-red-400" [title]="'Above the ' + (targets()[g.group] | number) + ' target'">{{ row.value | number:'1.0-0' }}</div>
                          }
                          @default {
                            <div class="font-semibold text-gray-900 dark:text-white">{{ row.value | number:'1.0-0' }}</div>
                          }
                        }
                        <!-- Confirmed after the review; otherwise locked, or actual or projected by the yield the score used. -->
                        <div class="whitespace-nowrap text-xs text-gray-500">{{ row.item.confirmed ? 'confirmed' : 'estimate · ' + (row.item.status === 'Locked' ? 'locked' : row.item.result.projected ? 'projected' : 'actual') }}</div>
                      </td>
                      <td class="text-gray-900 dark:text-white">{{ row.item.fieldName }}</td>
                      <td class="whitespace-nowrap text-gray-600 dark:text-gray-300">{{ row.item.enrollmentId }}</td>
                      <td class="text-right text-gray-600 dark:text-gray-300">{{ row.item.acres | number }}</td>
                      <td class="text-right tabular-nums text-gray-600 dark:text-gray-300">
                        @if (row.item.result.bushels !== null) {
                          {{ row.bushels | number:'1.0-0' }}@if (row.item.result.projected) { <span class="text-xs text-gray-500"> projected</span> }
                        } @else { <span class="text-gray-400">no yield</span> }
                      </td>
                      <td class="text-right tabular-nums text-gray-900 dark:text-white">{{ row.atOrBelow | number:'1.0-0' }}</td>
                      @if (p.official) { <td class="text-right text-xs text-gray-500 dark:text-gray-400">{{ row.item.official }}</td> }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          @if (unscored().length) {
            <div>
              <div class="font-medium text-gray-900 dark:text-white">Not scored yet</div>
              <ul class="mt-1 space-y-0.5 text-gray-600 dark:text-gray-300">
                @for (r of unscored(); track r.recordId) {
                  <li>{{ r.fieldName }} ({{ r.enrollmentId }}) · {{ r.cropLabel }} · {{ r.acres | number }} ac ·
                    <span class="text-amber-700 dark:text-amber-400">{{ r.scoreNote ?? 'needs inputs' }}</span></li>
                }
              </ul>
            </div>
          }
        </div>
      }
    </div>
    @if (documentsOpen()) {
      <app-fd-cic-documents-dialog [customerId]="customerId()" [year]="year()" [producerName]="producer()?.name ?? ''" (close)="documentsOpen.set(false)" />
    }
    }
    }
  `,
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
