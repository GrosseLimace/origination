import { Component, computed, effect, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CiEnrollmentMockService } from '@core/services/ci-enrollment-mock.service';
import { CiEnrollment, EnrollableSeason } from '@models';
import { fsaKey } from '@shared/utils/ci-enrollment';

/**
 * A producer's 45Z enrollment for one crop year, above the planting table in every field-plan
 * option: which finalized fields are in it, each with its frozen field-level CI, and the producer's
 * signed attestation. Attesting issues the Enrollment ID that delivery lots in the CI ledger will
 * carry. PROTOTYPE ONLY (CiEnrollmentMockService, in memory).
 */
@Component({
  selector: 'app-ci-enrollment-card',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './field-plan.css',
  template: `
    @let e = enrollment();
    <div class="rounded-lg border border-scoular-green-accessible/40 dark:border-scoular-green/40 bg-white dark:bg-gray-800">
      <button type="button" class="flex w-full flex-wrap items-center justify-between gap-2 bg-transparent border-0 px-4 py-3 text-left" (click)="open = !open">
        <span class="text-sm font-semibold text-gray-900 dark:text-white">🌱 45Z enrollment · {{ cropYear() }} crop</span>
        <span class="text-sm">
          @if (e?.status === 'Attested') {
            <span class="rounded-full bg-scoular-green-accessible/15 px-2 py-0.5 font-semibold text-scoular-green-accessible dark:text-scoular-green">{{ e!.enrollmentId }}</span>
            <span class="ml-2 text-gray-600 dark:text-gray-300">{{ e!.fieldSeasonIds.length }} field{{ e!.fieldSeasonIds.length === 1 ? '' : 's' }} · attested {{ e!.attestation.signedOn }}</span>
          } @else if (e) {
            <span class="text-amber-700 dark:text-amber-400">Draft · no Enrollment ID yet</span>
          } @else {
            <span class="text-gray-500 dark:text-gray-400">Not enrolled · {{ finalCount() }} of {{ seasons().length }} scored field{{ seasons().length === 1 ? '' : 's' }} finalized</span>
          }
          <span class="ml-2 text-gray-400">{{ open ? '▾' : '▸' }}</span>
        </span>
      </button>

      @if (open) {
        <div class="space-y-4 border-t border-gray-100 dark:border-gray-700 px-4 py-4 text-sm">
          @if (!e) {
            <p class="text-gray-600 dark:text-gray-300">
              One enrollment per producer per crop year. It lists finalized fields, each carrying its own CI score, under
              the producer's signed attestation. Its ID is what scored deliveries are recorded against in the CI ledger.
            </p>
            <button type="button" class="rounded-md bg-scoular-green-accessible px-3 py-1.5 text-white border-0 disabled:opacity-50"
                    [disabled]="seasons().length === 0" (click)="startEnrollment()">Start {{ cropYear() }} enrollment</button>
            @if (seasons().length === 0) {
              <span class="ml-2 text-gray-500 dark:text-gray-400">Add fields to a scored crop row first.</span>
            }
          } @else {
            <!-- Fields -->
            <div>
              <div class="font-medium text-gray-900 dark:text-white">Fields</div>
              <table class="mt-1 w-full text-left">
                <thead class="text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr><th class="w-8"></th><th class="py-1">Field</th><th>Crop</th><th>FSA farm/tract/field</th><th class="text-right">Acres</th><th class="text-right">Final CI (g CO₂e/bu)</th></tr>
                </thead>
                <tbody>
                  @for (s of rows(); track s.seasonId) {
                    <tr class="border-t border-gray-100 dark:border-gray-700">
                      <td class="py-1">
                        <input type="checkbox" [disabled]="e.status !== 'Draft'" [ngModel]="draft?.fieldSeasonIds?.includes(s.seasonId) ?? true"
                               (ngModelChange)="toggleSeason(s.seasonId, $event)" [attr.aria-label]="'Include ' + s.fieldName" />
                      </td>
                      <td class="py-1 text-gray-900 dark:text-white">{{ s.fieldName }}</td>
                      <td class="text-gray-600 dark:text-gray-300">{{ s.cropLabel }}</td>
                      <td class="text-gray-600 dark:text-gray-300">{{ fsa(s) }}</td>
                      <td class="text-right text-gray-600 dark:text-gray-300">{{ s.acres | number }}</td>
                      <td class="text-right">
                        @if (s.status === 'Final' && s.finalCiGPerBu !== undefined) {
                          <span class="font-semibold text-gray-900 dark:text-white">{{ s.finalCiGPerBu | number:'1.0-0' }}</span>
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
                  <label class="flex items-start gap-2"><input type="checkbox" class="mt-1" [(ngModel)]="draft.attestation.notEnrolledElsewhere" (ngModelChange)="save()" />
                    None of these fields is enrolled with another buyer or program for the {{ cropYear() }} crop year.</label>
                  <label class="flex items-start gap-2"><input type="checkbox" class="mt-1" [(ngModel)]="draft.attestation.recordsAccurate" (ngModelChange)="save()" />
                    The practices, yields and records provided are accurate.</label>
                  <label class="flex items-start gap-2"><input type="checkbox" class="mt-1" [(ngModel)]="draft.attestation.consentToThirdPartyAudit" (ngModelChange)="save()" />
                    Scoular, the receiving plant and a third-party auditor may review the supporting records.</label>
                  <label class="flex items-start gap-2"><input type="checkbox" class="mt-1" [(ngModel)]="draft.attestation.firstPointOfAggregationAck" (ngModelChange)="save()" />
                    Scoular, as first point of aggregation, holds and allocates the CI of this grain; the producer makes no other claim on it.</label>
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
                <span>🔒 {{ e.enrollmentId }} attested by {{ e.attestedBy }}. Delivery lots will carry this ID.</span>
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
            <div class="text-xs text-gray-500 dark:text-gray-400">Withdrawn: {{ w.enrollmentId }} ({{ w.fieldSeasonIds.length }} fields) · {{ w.withdrawnReason }}</div>
          }
        </div>
      }
    </div>
  `,
})
export class CiEnrollmentCardComponent {
  private readonly service = inject(CiEnrollmentMockService);

  readonly customerId = input.required<number>();
  readonly cropYear = input.required<number>();
  /** The producer's scored field seasons for the crop year, from whichever field-plan option is showing. */
  readonly seasons = input.required<EnrollableSeason[]>();

  readonly enrollment = computed(() => {
    this.service.enrollments();
    return this.service.current(this.customerId(), this.cropYear());
  });
  readonly withdrawn = computed(() => {
    this.service.enrollments();
    return this.service.withdrawn(this.customerId(), this.cropYear());
  });
  readonly finalCount = computed(() => this.seasons().filter(s => s.status === 'Final').length);
  /** Attested: the snapshot as signed. Draft: every scored season, to tick in or out. */
  readonly rows = computed(() => {
    const e = this.enrollment();
    return e?.status === 'Attested' ? (e.snapshot ?? []) : this.seasons();
  });
  readonly listed = computed(() => {
    const ids = new Set(this.enrollment()?.fieldSeasonIds ?? []);
    return this.seasons().filter(s => ids.has(s.seasonId));
  });
  readonly blockers = computed(() => {
    const e = this.enrollment();
    return e ? this.service.blockers(e, this.listed()) : [];
  });

  open = false;
  draft: CiEnrollment | null = null;
  showWithdraw = false;
  withdrawReason = '';

  constructor() {
    effect(() => {
      const e = this.enrollment();
      if (e?.key !== this.draft?.key || e?.status !== this.draft?.status) {
        this.draft = e ? { ...e, fieldSeasonIds: [...e.fieldSeasonIds], attestation: { ...e.attestation } } : null;
      }
    });
  }

  fsa(s: EnrollableSeason): string {
    return fsaKey(s) ?? '—';
  }

  startEnrollment(): void {
    this.service.start(this.customerId(), this.cropYear(), this.seasons().filter(s => s.status === 'Final').map(s => s.seasonId));
    this.open = true;
  }

  toggleSeason(seasonId: string, included: boolean): void {
    if (!this.draft) return;
    const ids = this.draft.fieldSeasonIds.filter(id => id !== seasonId);
    this.draft.fieldSeasonIds = included ? [...ids, seasonId] : ids;
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
