import { Component, computed, effect, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { EnrollableRecord, ProgramEnrollment } from '@models';
import { ProgramRegistry } from './program-registry';
import { ProgramRecordMockService } from './program-record-mock.service';
import { ProgramEnrollmentMockService } from './program-enrollment-mock.service';

/**
 * A producer's enrollment in one sustainability program for one year, above the planting table:
 * which finalized fields are in it, each with its frozen score, and the producer's signed
 * attestation (statements from the program). Attesting issues the program's Enrollment ID. Shows
 * nothing until the producer has a field in the program. PROTOTYPE ONLY (in memory).
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
      <button type="button" class="flex w-full flex-wrap items-center justify-between gap-2 bg-transparent border-0 px-4 py-3 text-left" (click)="open = !open">
        <span class="text-sm font-semibold text-gray-900 dark:text-white">🌱 {{ p.shortLabel }} enrollment · {{ year() }}</span>
        <span class="text-sm">
          @if (e?.status === 'Attested') {
            <span class="rounded-full bg-scoular-green-accessible/15 px-2 py-0.5 font-semibold text-scoular-green-accessible dark:text-scoular-green">{{ e!.enrollmentId }}</span>
            <span class="ml-2 text-gray-600 dark:text-gray-300">{{ e!.recordIds.length }} field{{ e!.recordIds.length === 1 ? '' : 's' }} · attested {{ e!.attestation.signedOn }}</span>
          } @else if (e) {
            <span class="text-amber-700 dark:text-amber-400">Draft · no Enrollment ID yet</span>
          } @else {
            <span class="text-gray-500 dark:text-gray-400">Not enrolled · {{ finalCount() }} of {{ records().length }} field{{ records().length === 1 ? '' : 's' }} finalized</span>
          }
          <span class="ml-2 text-gray-400">{{ open ? '▾' : '▸' }}</span>
        </span>
      </button>

      @if (open) {
        <div class="space-y-4 border-t border-gray-100 dark:border-gray-700 px-4 py-4 text-sm">
          @if (!e) {
            <p class="text-gray-600 dark:text-gray-300">
              One enrollment per producer per year. It lists finalized fields, each with its own frozen result, under the
              producer's signed attestation, and gets an ID when the producer attests.
            </p>
            <button type="button" class="rounded-md bg-scoular-green-accessible px-3 py-1.5 text-white border-0 disabled:opacity-50"
                    [disabled]="finalCount() === 0" (click)="startEnrollment()">Start {{ year() }} enrollment</button>
            @if (finalCount() === 0) {
              <span class="ml-2 text-gray-500 dark:text-gray-400">Finalize a field first.</span>
            }
          } @else {
            <!-- Fields -->
            <div>
              <div class="font-medium text-gray-900 dark:text-white">Fields</div>
              <table class="mt-1 w-full text-left">
                <thead class="text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr><th class="w-8"></th><th class="py-1">Field</th><th>Crop</th><th class="text-right">Acres</th><th class="text-right">Final result</th></tr>
                </thead>
                <tbody>
                  @for (r of rows(); track r.recordId) {
                    <tr class="border-t border-gray-100 dark:border-gray-700">
                      <td class="py-1">
                        <input type="checkbox" [disabled]="e.status !== 'Draft'" [ngModel]="draft?.recordIds?.includes(r.recordId) ?? true"
                               (ngModelChange)="toggleRecord(r.recordId, $event)" [attr.aria-label]="'Include ' + r.fieldName" />
                      </td>
                      <td class="py-1 text-gray-900 dark:text-white">{{ r.fieldName }}</td>
                      <td class="text-gray-600 dark:text-gray-300">{{ r.cropLabel }}</td>
                      <td class="text-right text-gray-600 dark:text-gray-300">{{ r.acres | number }}</td>
                      <td class="text-right">
                        @if (r.status === 'Final' && r.score) {
                          <span class="font-semibold text-gray-900 dark:text-white">{{ r.score.value | number:'1.0-0' }}</span>
                          <span class="text-gray-500"> {{ r.score.unitShort }}</span>
                        } @else {
                          <span class="text-amber-700 dark:text-amber-400">not finalized</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (e.status === 'Attested') {
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">As attested on {{ e.attestedAt | date:'mediumDate' }}. These fields are locked; withdraw the enrollment to correct one.</p>
              }
            </div>

            <!-- Producer attestation -->
            @if (draft) {
              <fieldset [disabled]="e.status !== 'Draft'" class="space-y-3">
                <div class="font-medium text-gray-900 dark:text-white">Producer attestation</div>
                <div class="grid gap-3 sm:grid-cols-4">
                  <label class="block"><span class="text-gray-700 dark:text-gray-300">Signed by</span>
                    <input class="ci-input" [(ngModel)]="draft.attestation.signerName" (ngModelChange)="save()" /></label>
                  <label class="block"><span class="text-gray-700 dark:text-gray-300">Date signed</span>
                    <input type="date" class="ci-input" [(ngModel)]="draft.attestation.signedOn" (ngModelChange)="save()" /></label>
                  <label class="block"><span class="text-gray-700 dark:text-gray-300">How</span>
                    <select class="ci-input" [(ngModel)]="draft.attestation.method" (ngModelChange)="save()">
                      <option value="eSign">E-signature</option><option value="Paper">Signed paper form</option>
                    </select></label>
                  <label class="block"><span class="text-gray-700 dark:text-gray-300">Document # {{ draft.attestation.method === 'Paper' ? '' : '(optional)' }}</span>
                    <input class="ci-input" [(ngModel)]="draft.attestation.documentRef" (ngModelChange)="save()" /></label>
                </div>
                <div class="space-y-1 text-gray-700 dark:text-gray-300">
                  @for (s of p.enrollment.statements; track s.key) {
                    <label class="flex items-start gap-2"><input type="checkbox" class="mt-1" [(ngModel)]="draft.attestation.confirmations[s.key]" (ngModelChange)="save()" />
                      {{ s.label }}</label>
                  }
                </div>
              </fieldset>
            }

            @if (e.status === 'Draft') {
              @if (blockers().length) {
                <div class="rounded-md bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-amber-900 dark:text-amber-200">Still needed: {{ blockers().join('; ') }}.</div>
              }
              <button type="button" class="rounded-md bg-scoular-green-accessible px-3 py-1.5 text-white border-0 disabled:opacity-50"
                      [disabled]="blockers().length > 0" (click)="attest()">Record attestation and issue Enrollment ID</button>
            } @else {
              <div class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-blue-50 dark:bg-blue-900/30 px-3 py-2 text-blue-900 dark:text-blue-200">
                <span>🔒 {{ e.enrollmentId }} attested by {{ e.attestedBy }}. {{ p.enrollment.attestedNote }}</span>
                <button type="button" class="underline bg-transparent border-0 p-0" (click)="showWithdraw = true">Withdraw…</button>
              </div>
              @if (showWithdraw) {
                <div class="space-y-2">
                  <label class="block"><span class="text-gray-700 dark:text-gray-300">Why is it being withdrawn?</span>
                    <textarea rows="2" class="ci-input" [(ngModel)]="withdrawReason"></textarea></label>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ e.enrollmentId }} and what was attested are kept; the ID is never reissued.</p>
                  <div class="flex gap-2">
                    <button type="button" class="rounded-md border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-1" (click)="showWithdraw = false">Cancel</button>
                    <button type="button" class="rounded-md bg-red-600 px-3 py-1 text-white border-0 disabled:opacity-50" [disabled]="!withdrawReason.trim()" (click)="withdraw()">Withdraw</button>
                  </div>
                </div>
              }
            }
          }

          @for (w of withdrawn(); track w.key) {
            <div class="text-xs text-gray-500 dark:text-gray-400">Withdrawn: {{ w.enrollmentId }} ({{ w.recordIds.length }} fields) · {{ w.withdrawnReason }}</div>
          }
        </div>
      }
    </div>
    }
    }
  `,
})
export class ProgramEnrollmentCardComponent {
  private readonly service = inject(ProgramEnrollmentMockService);
  private readonly recordStore = inject(ProgramRecordMockService);
  private readonly plan = inject(FieldPlanMockService);
  private readonly registry = inject(ProgramRegistry);

  readonly programKey = input.required<string>();
  readonly customerId = input.required<number>();
  readonly year = input.required<number>();

  readonly program = computed(() => this.registry.get(this.programKey()));

  /** The producer's records in this program for the year, as the enrollment lists them. */
  readonly records = computed<EnrollableRecord[]>(() => {
    const customerId = this.customerId();
    const year = this.year();
    return this.recordStore.records().flatMap(r => {
      if (r.programKey !== this.programKey()) return [];
      const season = this.plan.season(r.seasonId);
      const field = season && this.plan.field(season.fieldKey);
      if (!season || !field || field.customerId !== customerId || season.year !== year) return [];
      return [{
        recordId: r.id, seasonId: season.id, fieldKey: field.fieldKey, fieldName: field.name, cropLabel: season.cropLabel,
        year, acres: season.acres, status: r.status, score: r.frozen?.score,
      }];
    });
  });

  readonly enrollment = computed(() => {
    this.service.enrollments();
    return this.service.current(this.programKey(), this.customerId(), this.year());
  });
  readonly withdrawn = computed(() => {
    this.service.enrollments();
    return this.service.withdrawn(this.programKey(), this.customerId(), this.year());
  });
  readonly finalCount = computed(() => this.records().filter(r => r.status === 'Final').length);
  /** Attested: the snapshot as signed. Draft: every record, to tick in or out. */
  readonly rows = computed(() => {
    const e = this.enrollment();
    return e?.status === 'Attested' ? (e.snapshot ?? []) : this.records();
  });
  readonly listed = computed(() => {
    const ids = new Set(this.enrollment()?.recordIds ?? []);
    return this.records().filter(r => ids.has(r.recordId));
  });
  readonly blockers = computed(() => {
    const e = this.enrollment();
    return e ? this.service.blockers(e, this.listed()) : [];
  });

  open = false;
  draft: ProgramEnrollment | null = null;
  showWithdraw = false;
  withdrawReason = '';

  constructor() {
    effect(() => {
      const e = this.enrollment();
      if (e?.key !== this.draft?.key || e?.status !== this.draft?.status) {
        this.draft = e ? {
          ...e, recordIds: [...e.recordIds],
          attestation: { ...e.attestation, confirmations: { ...e.attestation.confirmations } },
        } : null;
      }
    });
  }

  startEnrollment(): void {
    this.service.start(this.programKey(), this.customerId(), this.year(),
      this.records().filter(r => r.status === 'Final').map(r => r.recordId));
    this.open = true;
  }

  toggleRecord(recordId: string, included: boolean): void {
    if (!this.draft) return;
    const ids = this.draft.recordIds.filter(id => id !== recordId);
    this.draft.recordIds = included ? [...ids, recordId] : ids;
    this.save();
  }

  save(): void {
    if (this.draft) this.service.update(this.draft);
  }

  attest(): void {
    const e = this.enrollment();
    if (e) this.service.attest(e.key, this.listed());
  }

  withdraw(): void {
    const e = this.enrollment();
    if (!e) return;
    this.service.withdraw(e.key, this.withdrawReason);
    this.showWithdraw = false;
    this.withdrawReason = '';
  }
}
