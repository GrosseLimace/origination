import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldPlanStore } from '../store/field-plan.store';
import { EnrollableRecord, OFFICIAL_STATUS_TEXT } from '@models';
import { ProgramRegistry } from './program-registry';
import { FieldResult } from './program-def';
import { LadderRow, atOrBelowTarget, ciLadder } from './ci-ladder';
import { downloadCsv } from '@shared/utils/csv';
import { confirmedCiCsv, confirmedCiFileName } from './fd-cic/confirmed-ci-export';

/** One field in the card: what the enrollment lists, plus its score and bushels. */
type CardField = EnrollableRecord & { result: FieldResult; official: string; confirmed: boolean };

/**
 * A producer's enrollment in one sustainability program for one year, above the planting table. It starts
 * with the producer's first field in the program, and every field they have in the program that year is
 * in it, each with its own derived ID (e.g. CI-2026-TATOB43; nobody types one). The card holds:
 *
 * - "bushels by CI": per crop, the scored fields lowest CI first with their bushels and a running total,
 *   and a target box ("at or below 3,000 g/bu → 69,000 bu"). Never one producer-wide average:
 *   downstream opportunities set different CI targets, so field-level CI and bushels are what matter;
 * - the fields not scored yet.
 *
 * There's no producer-level "harvest complete": after harvest each field is reviewed with its CTRM tickets
 * and confirmed on its own (the field dialog's Review), which locks it with the confirmed CI.
 *
 * Every CI here is a planning estimate until the field is reviewed with the producer and its CTRM tickets after
 * harvest and confirmed; then the confirmed CI and its ticket bushels show, and the card downloads the
 * confirmed fields as the Bins' CSV (one row per ticket).
 *
 * Shows nothing until the producer has a field in the program. PROTOTYPE ONLY (in memory).
 */
@Component({
  selector: 'app-program-enrollment-card',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: '../field-plan.css',
  template: `
    @let e = enrollment();
    @if (program(); as p) {
    @if (records().length || e || withdrawn().length) {
    <div class="rounded-lg border border-scoular-green-accessible/40 dark:border-scoular-green/40 bg-white dark:bg-gray-800">
      <!-- One short line: program, ID, and each crop's CI range and bushels -->
      <button type="button" class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 bg-transparent border-0 px-4 py-2.5 text-left text-sm" (click)="open = !open">
        <span class="w-3 text-gray-400">{{ open ? '▾' : '▸' }}</span>
        <span class="font-semibold text-gray-900 dark:text-white">🌱 {{ p.shortLabel }} · {{ year() }}</span>
        @if (e) {
          <span class="text-xs text-gray-600 dark:text-gray-300">{{ records().length }} field{{ records().length === 1 ? '' : 's' }}</span>
          @if (confirmedCount()) { <span class="text-xs text-gray-500 dark:text-gray-400">{{ confirmedCount() }} of {{ records().length }} confirmed</span> }
        } @else {
          <span class="text-amber-700 dark:text-amber-400">{{ records().length ? 'Withdrawn' : 'Not enrolled yet' }}</span>
        }
        @for (g of groups(); track g.group) {
          <span class="text-gray-800 dark:text-gray-100">
            <span class="font-semibold">{{ g.group }} {{ g.range }} {{ g.unitShort }}</span>
            <span class="text-gray-600 dark:text-gray-300"> · {{ g.bushels | number:'1.0-0' }} bu</span>
          </span>
        }
      </button>

      @if (open) {
        <div class="space-y-5 border-t border-gray-100 dark:border-gray-700 px-4 py-4 text-sm">
          @if (!e) {
            @if (records().length) {
              <p class="text-gray-600 dark:text-gray-300">This producer's {{ p.shortLabel }} enrollment was withdrawn. Re-enrolling makes their {{ records().length }} field(s) live again under the same IDs.</p>
              <button type="button" class="rounded-md bg-scoular-green-accessible px-3 py-1.5 text-white border-0" (click)="reEnroll()">Re-enroll</button>
            }
          } @else {
            @if (p.official; as o) {
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-xs text-gray-500 dark:text-gray-400">Planning estimates from the {{ p.shortLabel }} calculator. {{ o.requirementsNote }}</p>
                @if (confirmedCount() && producer()) {
                  <button type="button" class="h-8 rounded-md px-3 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible"
                          (click)="downloadConfirmed()">Download confirmed CI (CSV) · {{ confirmedCount() }} field{{ confirmedCount() === 1 ? '' : 's' }}</button>
                }
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
                      <tr class="border-t border-gray-100 dark:border-gray-700" [class]="withinTarget(g.group, row.value) ? 'bg-gray-100 dark:bg-gray-700/50' : ''">
                        <td class="py-1 pr-4 text-right tabular-nums">
                          <div class="font-semibold text-gray-900 dark:text-white">{{ row.value | number:'1.0-0' }}</div>
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
            <!-- Producer attestation: to be designed; the service still supports it (attest, statements). -->

            @if (showWithdraw) {
              <div class="space-y-2">
                <label class="block"><span class="text-gray-700 dark:text-gray-300">Why is it being withdrawn?</span>
                  <textarea rows="2" class="ci-input" [(ngModel)]="withdrawReason"></textarea></label>
                <p class="text-xs text-gray-500 dark:text-gray-400">The withdrawal and its reason are kept. Re-enrolling later uses the same field IDs.</p>
                <div class="flex gap-2">
                  <button type="button" class="rounded-md border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-1" (click)="showWithdraw = false">Cancel</button>
                  <button type="button" class="rounded-md bg-red-600 px-3 py-1 text-white border-0 disabled:opacity-50" [disabled]="!withdrawReason.trim()" (click)="withdraw()">Withdraw</button>
                </div>
              </div>
            } @else {
              <button type="button" class="text-xs text-gray-500 underline bg-transparent border-0 p-0" (click)="showWithdraw = true">Withdraw this enrollment…</button>
            }
          }

          @for (w of withdrawn(); track w.key) {
            <div class="text-xs text-gray-500 dark:text-gray-400">Withdrawn earlier: {{ w.withdrawnReason }}</div>
          }
        </div>
      }
    </div>
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
  /** The producer's CTRM code and name, for the confirmed-CI CSV. */
  readonly producer = input<{ code: string; name: string } | null>(null);

  /** The program, if it has a producer-level enrollment (otherwise the card shows nothing). */
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

  /** The enrollment's fields, with each one's score and bushels. */
  readonly records = computed<CardField[]>(() => {
    const program = this.program()!;
    const results = new Map((program.fieldResults?.(this.items()) ?? []).map(r => [r.recordId, r]));
    return this.items().map(({ record: r, season, field }) => ({
      recordId: r.id, seasonId: season.id, fieldKey: field.fieldKey, fieldName: field.name, splitId: field.splitId, enrollmentId: this.store.enrollmentIdOf(r) ?? '',
      cropLabel: season.cropLabel, year: season.year, acres: season.acres, status: r.status,
      score: r.frozen?.score ?? program.preview(r.data, season, field) ?? undefined,
      scoreNote: program.previewNote?.(r.data, season, field) ?? undefined,
      production: program.production ? program.production(r.data, season) : undefined,
      result: results.get(r.id) ?? { recordId: r.id, group: season.cropLabel, value: null, unitShort: '', bushels: null, projected: true },
      official: OFFICIAL_STATUS_TEXT[r.official?.status ?? 'NotStarted'],
      confirmed: r.official?.status === 'Documented',
    }));
  });

  readonly confirmedCount = computed(() => this.records().filter(r => r.confirmed).length);

  /** The Bins' mass balance ledger file: every confirmed field's tickets, one row each, with its confirmed CI. */
  downloadConfirmed(): void {
    const producer = this.producer();
    if (!producer) return;
    const fields = this.items()
      .filter(i => i.record.official?.status === 'Documented')
      .map(i => ({ ...i, enrollmentId: this.store.enrollmentIdOf(i.record) }));
    downloadCsv(confirmedCiCsv(producer, fields), confirmedCiFileName(producer.code, this.year(), new Date()));
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

  withinTarget(group: string, value: number): boolean {
    const target = this.targets()[group];
    return !!target && value <= target;
  }

  readonly enrollment = computed(() => this.store.current(this.programKey(), this.customerId(), this.year()));
  readonly withdrawn = computed(() => this.store.withdrawn(this.programKey(), this.customerId(), this.year()));

  open = false;
  showWithdraw = false;
  withdrawReason = '';
  async withdraw(): Promise<void> {
    const e = this.enrollment();
    if (!e || !this.withdrawReason.trim()) return;
    const reason = this.withdrawReason;
    this.showWithdraw = false;
    this.withdrawReason = '';
    await this.store.withdraw(e.key, reason);
  }

  async reEnroll(): Promise<void> {
    await this.store.ensureEnrollment(this.programKey(), this.customerId(), this.year());
  }
}
