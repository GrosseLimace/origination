import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldPlanStore } from '../store/field-plan.store';
import { EnrollableRecord } from '@models';
import { ProgramRegistry } from './program-registry';

/**
 * A producer's enrollment in one sustainability program for one year, above the planting table. The
 * ID is issued with the producer's first field in the program; every field they have in the program
 * that year is in it. The card holds:
 *
 * - the fields, each with its CTRM split ID, its projected or final result and its production;
 * - "harvest complete", which finalizes every field that has its actual yield.
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
      <!-- One short line: program, ID and each crop's CI; units, field counts and status are inside -->
      <button type="button" class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 bg-transparent border-0 px-4 py-2.5 text-left text-sm" (click)="open = !open">
        <span class="w-3 text-gray-400">{{ open ? '▾' : '▸' }}</span>
        <span class="font-semibold text-gray-900 dark:text-white">🌱 {{ p.shortLabel }} · {{ year() }}</span>
        @if (e) {
          <span class="rounded-full bg-scoular-green-accessible/15 px-2 py-0.5 text-xs font-semibold text-scoular-green-accessible dark:text-scoular-green">{{ e.enrollmentId }}</span>
          @if (e.harvestCompleteAt) { <span class="text-xs text-gray-500 dark:text-gray-400" title="Harvest marked complete">✓ harvest</span> }
        } @else {
          <span class="text-amber-700 dark:text-amber-400">{{ records().length ? 'No live enrollment' : 'No enrollment ID yet' }}</span>
        }
        @for (s of summaries(); track s.text) {
          <span class="text-gray-800 dark:text-gray-100" [title]="s.text + (s.change ? ', ' + s.change.text : '') + ' (bushel-weighted)'">
            <span class="font-semibold">{{ s.short ?? s.text }}</span>
            @if (s.change; as ch) {
              <span class="ml-1 font-medium" [class]="ch.better ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">{{ ch.short ?? ch.text }}</span>
            }
          </span>
        }
      </button>

      @if (open) {
        <div class="space-y-4 border-t border-gray-100 dark:border-gray-700 px-4 py-4 text-sm">
          @if (summaries().length) {
            <p class="text-gray-600 dark:text-gray-300">
              {{ scoredCount() }} of {{ records().length }} field{{ records().length === 1 ? '' : 's' }} scored. Bushel-weighted:
              @for (s of summaries(); track s.text; let last = $last) {
                <span class="font-medium text-gray-900 dark:text-white">{{ s.text }}</span>@if (s.change) { ({{ s.change.text }}) }@if (!last) {; }
              }
            </p>
          }
          @if (!e) {
            @if (records().length) {
              <p class="text-gray-600 dark:text-gray-300">The last enrollment was withdrawn. Issue a new ID for this producer's {{ records().length }} field(s) in {{ p.shortLabel }}.</p>
              <button type="button" class="rounded-md bg-scoular-green-accessible px-3 py-1.5 text-white border-0" (click)="issueNew()">Issue a new enrollment ID</button>
            }
          } @else {
            <!-- Fields -->
            <div>
              <div class="font-medium text-gray-900 dark:text-white">Fields</div>
              <table class="mt-1 w-full text-left">
                <thead class="text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr><th class="py-1">Field</th><th>Split ID</th><th>Crop</th><th class="text-right">Acres</th><th class="text-right">Production (bu)</th><th class="text-right">{{ p.shortLabel }} result</th></tr>
                </thead>
                <tbody>
                  @for (r of records(); track r.recordId) {
                    <tr class="border-t border-gray-100 dark:border-gray-700">
                      <td class="py-1 text-gray-900 dark:text-white">{{ r.fieldName }}</td>
                      <td class="text-gray-600 dark:text-gray-300">{{ r.splitId }}</td>
                      <td class="text-gray-600 dark:text-gray-300">{{ r.cropLabel }}</td>
                      <td class="text-right text-gray-600 dark:text-gray-300">{{ r.acres | number }}</td>
                      <td class="text-right text-gray-600 dark:text-gray-300">
                        @if (r.production) { {{ r.production | number:'1.0-0' }} } @else { <span class="text-gray-400">no actual yield</span> }
                      </td>
                      <td class="text-right">
                        @if (r.score) {
                          <span class="font-semibold text-gray-900 dark:text-white">{{ r.score.value | number:'1.0-0' }}</span>
                          <span class="text-gray-500"> {{ r.score.unitShort }} · {{ r.status === 'Final' ? 'final' : 'projected' }}</span>
                        } @else {
                          <span class="text-amber-700 dark:text-amber-400">{{ r.scoreNote ?? 'needs inputs' }}</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <!-- Producer attestation: to be designed; the service still supports it (attest, statements). -->

            <!-- Harvest complete finalizes every field that has its actual yield -->
            <div class="space-y-2">
              @if (e.harvestCompleteAt) {
                <div class="text-gray-700 dark:text-gray-300">Harvest marked complete {{ e.harvestCompleteAt | date:'MM/dd/yy' }}.</div>
              } @else {
                <button type="button" class="h-8 rounded-md px-3 font-medium text-white bg-scoular-green-accessible hover:bg-scoular-green border-0"
                        (click)="completeHarvest()">Mark harvest complete</button>
              }
              @for (o of harvestLeftOpen(); track o.fieldName) {
                <div class="text-amber-800 dark:text-amber-300">{{ o.fieldName }} couldn't be finalized: still needs {{ o.missing.join(', ') }}.</div>
              }
            </div>

            @if (showWithdraw) {
              <div class="space-y-2">
                <label class="block"><span class="text-gray-700 dark:text-gray-300">Why is it being withdrawn?</span>
                  <textarea rows="2" class="ci-input" [(ngModel)]="withdrawReason"></textarea></label>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ e.enrollmentId }} is kept on record and never reissued.</p>
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
            <div class="text-xs text-gray-500 dark:text-gray-400">Withdrawn: {{ w.enrollmentId }} · {{ w.withdrawnReason }}</div>
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

  /** The enrollment's fields, as listed in the card. */
  readonly records = computed<EnrollableRecord[]>(() => {
    const program = this.program()!;
    return this.items().map(({ record: r, season, field }) => ({
      recordId: r.id, seasonId: season.id, fieldKey: field.fieldKey, fieldName: field.name, splitId: field.splitId,
      cropLabel: season.cropLabel, year: season.year, acres: season.acres, status: r.status,
      score: r.frozen?.score ?? program.preview(r.data, season, field) ?? undefined,
      scoreNote: program.previewNote?.(r.data, season, field) ?? undefined,
      production: program.production ? program.production(r.data, season) : undefined,
    }));
  });

  /** The producer's figures across all their fields in the program (45Z: bushel-weighted CI per crop). */
  readonly summaries = computed(() => this.program()?.enrollmentSummary?.(this.items()) ?? []);
  readonly scoredCount = computed(() => this.records().filter(r => !!r.score).length);

  readonly enrollment = computed(() => this.store.current(this.programKey(), this.customerId(), this.year()));
  readonly withdrawn = computed(() => this.store.withdrawn(this.programKey(), this.customerId(), this.year()));

  open = false;
  showWithdraw = false;
  withdrawReason = '';
  /** Set after the save, so a signal: this card sits under an OnPush table. */
  readonly harvestLeftOpen = signal<{ fieldName: string; missing: string[] }[]>([]);

  async completeHarvest(): Promise<void> {
    const e = this.enrollment();
    if (!e) return;
    const names = new Map(this.records().map(r => [r.recordId, r.fieldName]));
    const leftOpen = await this.store.completeHarvest(e);
    this.harvestLeftOpen.set(leftOpen.map(o => ({ fieldName: names.get(o.recordId) ?? 'A field', missing: o.missing })));
  }

  async withdraw(): Promise<void> {
    const e = this.enrollment();
    if (!e || !this.withdrawReason.trim()) return;
    const reason = this.withdrawReason;
    this.showWithdraw = false;
    this.withdrawReason = '';
    await this.store.withdraw(e.key, reason);
  }

  async issueNew(): Promise<void> {
    await this.store.ensureEnrollment(this.programKey(), this.customerId(), this.year());
  }
}
