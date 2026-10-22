import { Component, computed, effect, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { TicketFeedMockService } from '@core/services/ticket-feed-mock.service';
import { EnrollableRecord, ProgramEnrollment } from '@models';
import { ProgramRegistry } from './program-registry';
import { ProgramRecordMockService } from './program-record-mock.service';
import { ProgramEnrollmentMockService } from './program-enrollment-mock.service';
import { DELIVERY_TOLERANCE, deliveryCheck, fsaKey } from './program-enrollment';

/**
 * A producer's enrollment in one sustainability program for one year, above the planting table. The
 * ID is issued with the producer's first field in the program, so incoming tickets can be assigned it
 * from the first delivery; every field they have in the program that year is in it. The card holds:
 *
 * - the fields, each with its projected or final result and its FSA numbers;
 * - the producer's signed attestation (statements from the program), recordable before harvest;
 * - the tickets assigned the ID, checked against the fields' production (acres × actual yield);
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
      <button type="button" class="flex w-full flex-wrap items-center justify-between gap-2 bg-transparent border-0 px-4 py-3 text-left" (click)="open = !open">
        <span class="text-sm font-semibold text-gray-900 dark:text-white">🌱 {{ p.shortLabel }} enrollment · {{ year() }}</span>
        <span class="text-sm">
          @if (e) {
            <span class="rounded-full bg-scoular-green-accessible/15 px-2 py-0.5 font-semibold text-scoular-green-accessible dark:text-scoular-green">{{ e.enrollmentId }}</span>
            <span class="ml-2 text-gray-600 dark:text-gray-300">{{ records().length }} field{{ records().length === 1 ? '' : 's' }} ·</span>
            @if (e.status === 'Attested') {
              <span class="text-gray-600 dark:text-gray-300">attested {{ e.attestation.signedOn }}</span>
            } @else {
              <span class="text-amber-700 dark:text-amber-400">not yet attested</span>
            }
            @if (e.harvestCompleteAt) { <span class="ml-1 text-gray-600 dark:text-gray-300">· harvest complete</span> }
            @if (check()?.flagged) { <span class="ml-1 font-semibold text-red-700 dark:text-red-400">· ⚠ tickets don't match production</span> }
          } @else {
            <span class="text-amber-700 dark:text-amber-400">{{ withFsaCount() ? 'No live enrollment' : 'No enrollment ID yet: fields need FSA numbers' }}</span>
          }
          <span class="ml-2 text-gray-400">{{ open ? '▾' : '▸' }}</span>
        </span>
      </button>

      @if (open) {
        <div class="space-y-4 border-t border-gray-100 dark:border-gray-700 px-4 py-4 text-sm">
          @if (!e) {
            @if (!withFsaCount()) {
              <p class="text-gray-600 dark:text-gray-300">Add FSA farm, tract and field numbers to a field in {{ p.shortLabel }} to issue this producer's enrollment ID.</p>
            } @else {
              <p class="text-gray-600 dark:text-gray-300">The last enrollment was withdrawn. Issue a new ID for this producer's {{ withFsaCount() }} field(s) in {{ p.shortLabel }}.</p>
              <button type="button" class="rounded-md bg-scoular-green-accessible px-3 py-1.5 text-white border-0" (click)="issueNew()">Issue a new enrollment ID</button>
            }
          } @else {
            <p class="text-gray-600 dark:text-gray-300">
              Incoming tickets for this producer's {{ p.shortLabel }} grain are assigned <span class="font-semibold">{{ e.enrollmentId }}</span>.
              @if (e.status === 'Open') { Until the producer attests, bushels under it shouldn't be counted toward the program. }
            </p>

            <!-- Fields -->
            <div>
              <div class="font-medium text-gray-900 dark:text-white">Fields</div>
              <table class="mt-1 w-full text-left">
                <thead class="text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr><th class="py-1">Field</th><th>FSA farm/tract/field</th><th>Crop</th><th class="text-right">Acres</th><th class="text-right">Production (bu)</th><th class="text-right">{{ p.shortLabel }} result</th></tr>
                </thead>
                <tbody>
                  @for (r of records(); track r.recordId) {
                    <tr class="border-t border-gray-100 dark:border-gray-700">
                      <td class="py-1 text-gray-900 dark:text-white">{{ r.fieldName }}</td>
                      <td [class]="r.fsa ? 'text-gray-600 dark:text-gray-300' : 'text-amber-700 dark:text-amber-400'">{{ r.fsa || 'FSA # needed' }}</td>
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
                          <span class="text-amber-700 dark:text-amber-400">needs inputs</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (e.status === 'Attested' && unattestedCount()) {
                <p class="mt-1 text-xs text-amber-700 dark:text-amber-400">{{ unattestedCount() }} field(s) added since the producer attested; they aren't covered by the signed attestation.</p>
              }
            </div>

            <!-- Producer attestation -->
            @if (draft) {
              <fieldset [disabled]="e.status !== 'Open'" class="space-y-3">
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
                  @for (s of p.enrollment!.statements; track s.key) {
                    <label class="flex items-start gap-2"><input type="checkbox" class="mt-1" [(ngModel)]="draft.attestation.confirmations[s.key]" (ngModelChange)="save()" />
                      {{ s.label }}</label>
                  }
                </div>
              </fieldset>
            }

            @if (e.status === 'Open') {
              @if (blockers().length) {
                <div class="rounded-md bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-amber-900 dark:text-amber-200">Still needed: {{ blockers().join('; ') }}.</div>
              }
              <button type="button" class="rounded-md bg-scoular-green-accessible px-3 py-1.5 text-white border-0 disabled:opacity-50"
                      [disabled]="blockers().length > 0" (click)="attest()">Record producer attestation</button>
            } @else {
              <div class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-blue-50 dark:bg-blue-900/30 px-3 py-2 text-blue-900 dark:text-blue-200">
                <span>🔒 {{ e.enrollmentId }} attested by {{ e.attestedBy }}. {{ p.enrollment!.attestedNote }}</span>
                <button type="button" class="underline bg-transparent border-0 p-0" (click)="showWithdraw = true">Withdraw…</button>
              </div>
            }

            <!-- Tickets assigned this ID, checked against production; harvest complete finalizes -->
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-medium text-gray-900 dark:text-white">Tickets assigned {{ e.enrollmentId }}</span>
                <span class="text-gray-700 dark:text-gray-300">{{ tickets().length }} ticket{{ tickets().length === 1 ? '' : 's' }} · {{ check()?.delivered | number:'1.0-0' }} bu</span>
              </div>
              @if (tickets().length) {
                <table class="w-full text-left">
                  <thead class="text-xs uppercase text-gray-500 dark:text-gray-400">
                    <tr><th class="py-1">Ticket</th><th>Date</th><th>Enrollment ID</th><th class="text-right">Net bu</th><th class="w-8"></th></tr>
                  </thead>
                  <tbody>
                    @for (t of tickets(); track t.ticketNo) {
                      <tr class="border-t border-gray-100 dark:border-gray-700">
                        <td class="py-1">{{ t.ticketNo }}</td>
                        <td>{{ t.date | date:'MM/dd/yy' }}</td>
                        <td>{{ t.enrollmentId }}</td>
                        <td class="text-right tabular-nums">{{ t.netBushels | number:'1.0-0' }}</td>
                        <td class="text-right">
                          @if (!e.harvestCompleteAt) {
                            <button type="button" class="text-gray-400 hover:text-red-600 bg-transparent border-0 p-0" (click)="removeTicket(t.ticketNo)" [attr.aria-label]="'Remove ' + t.ticketNo">✕</button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
              @if (check(); as c) {
                <div [class]="c.flagged ? 'rounded-md bg-red-50 dark:bg-red-900/30 px-3 py-2 text-red-800 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'">
                  Delivered {{ c.delivered | number:'1.0-0' }} bu against {{ c.production | number:'1.0-0' }} bu produced (acres × actual yield)
                  @if (c.gap !== null) { · {{ c.gap >= 0 ? '+' : '' }}{{ c.gap | percent:'1.0-1' }} }
                  @if (c.flagged) { — more than {{ tolerance | percent }} off. Check the tickets and the fields' actual yields. }
                  @if (c.fieldsWithout) { <span class="text-gray-500"> · {{ c.fieldsWithout }} field(s) still need an actual yield.</span> }
                </div>
              }
              @if (e.harvestCompleteAt) {
                <div class="text-gray-700 dark:text-gray-300">Harvest marked complete {{ e.harvestCompleteAt | date:'MM/dd/yy' }}.</div>
              } @else {
                <div class="flex flex-wrap items-end gap-2">
                  <label class="block text-xs text-gray-600 dark:text-gray-300">Net bushels
                    <input type="number" min="0" class="ci-input ci-compact !w-28 text-right" [(ngModel)]="newTicketBushels" (keydown.enter)="addTicket()" /></label>
                  <button type="button" class="h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 disabled:opacity-50"
                          [disabled]="!newTicketBushels" (click)="addTicket()">Add ticket</button>
                  <button type="button" class="h-8 rounded-md px-3 font-medium text-white bg-scoular-green-accessible hover:bg-scoular-green border-0"
                          (click)="completeHarvest()">Mark harvest complete</button>
                </div>
              }
              @for (o of harvestLeftOpen; track o.fieldName) {
                <div class="text-amber-800 dark:text-amber-300">{{ o.fieldName }} couldn't be finalized: still needs {{ o.missing.join(', ') }}.</div>
              }
            </div>

            @if (showWithdraw) {
              <div class="space-y-2">
                <label class="block"><span class="text-gray-700 dark:text-gray-300">Why is it being withdrawn?</span>
                  <textarea rows="2" class="ci-input" [(ngModel)]="withdrawReason"></textarea></label>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ e.enrollmentId }} and anything attested are kept; the ID is never reissued.</p>
                <div class="flex gap-2">
                  <button type="button" class="rounded-md border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-1" (click)="showWithdraw = false">Cancel</button>
                  <button type="button" class="rounded-md bg-red-600 px-3 py-1 text-white border-0 disabled:opacity-50" [disabled]="!withdrawReason.trim()" (click)="withdraw()">Withdraw</button>
                </div>
              </div>
            } @else if (e.status === 'Open') {
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
  private readonly service = inject(ProgramEnrollmentMockService);
  private readonly recordStore = inject(ProgramRecordMockService);
  private readonly plan = inject(FieldPlanMockService);
  private readonly registry = inject(ProgramRegistry);
  private readonly ticketFeed = inject(TicketFeedMockService);

  readonly programKey = input.required<string>();
  readonly customerId = input.required<number>();
  readonly year = input.required<number>();

  readonly tolerance = DELIVERY_TOLERANCE;
  /** The program, if it has a producer-level enrollment (otherwise the card shows nothing). */
  readonly program = computed(() => {
    const def = this.registry.get(this.programKey());
    return def?.enrollment ? def : undefined;
  });

  /** Every record the producer has in this program for the year: the enrollment's fields. */
  readonly records = computed<EnrollableRecord[]>(() => {
    const customerId = this.customerId();
    const year = this.year();
    const program = this.program();
    return this.recordStore.records().flatMap(r => {
      if (!program || r.programKey !== program.key) return [];
      const season = this.plan.season(r.seasonId);
      const field = season && this.plan.field(season.fieldKey);
      if (!season || !field || field.customerId !== customerId || season.year !== year) return [];
      return [{
        recordId: r.id, seasonId: season.id, fieldKey: field.fieldKey, fieldName: field.name, fsa: fsaKey(field),
        cropLabel: season.cropLabel, year, acres: season.acres, status: r.status,
        score: r.frozen?.score ?? program.preview(r.data, season, field) ?? undefined,
        production: program.production ? program.production(r.data, season) : undefined,
      }];
    });
  });

  readonly enrollment = computed(() => {
    this.service.enrollments();
    return this.service.current(this.programKey(), this.customerId(), this.year());
  });
  /** Fields in the program with all three FSA numbers: the ones that can join the enrollment. */
  readonly withFsaCount = computed(() => this.records().filter(r => !!r.fsa).length);
  readonly withdrawn = computed(() => {
    this.service.enrollments();
    return this.service.withdrawn(this.programKey(), this.customerId(), this.year());
  });
  readonly blockers = computed(() => {
    const e = this.enrollment();
    return e ? this.service.blockers(e, this.records()) : [];
  });
  /** Fields added after the producer signed. */
  readonly unattestedCount = computed(() => {
    const signed = new Set((this.enrollment()?.snapshot ?? []).map(r => r.recordId));
    return this.records().filter(r => !signed.has(r.recordId)).length;
  });

  readonly tickets = computed(() => {
    const e = this.enrollment();
    return e ? this.ticketFeed.forEnrollment(e.enrollmentId) : [];
  });
  /** Ticket bushels against the fields' production; null for a program that doesn't reconcile deliveries. */
  readonly check = computed(() => {
    if (!this.program()?.production) return null;
    return deliveryCheck(this.tickets().map(t => t.netBushels), this.records().map(r => r.production));
  });

  open = false;
  draft: ProgramEnrollment | null = null;
  showWithdraw = false;
  withdrawReason = '';
  newTicketBushels: number | null = null;
  harvestLeftOpen: { fieldName: string; missing: string[] }[] = [];

  constructor() {
    effect(() => {
      const e = this.enrollment();
      if (e?.key !== this.draft?.key || e?.status !== this.draft?.status) {
        this.draft = e ? { ...e, attestation: { ...e.attestation, confirmations: { ...e.attestation.confirmations } } } : null;
      }
    });
  }

  save(): void {
    if (this.draft) this.service.update(this.draft);
  }

  attest(): void {
    const e = this.enrollment();
    if (e) this.service.attest(e.key, this.records());
  }

  addTicket(): void {
    const e = this.enrollment();
    if (!e || !this.newTicketBushels || this.newTicketBushels <= 0 || e.harvestCompleteAt) return;
    this.ticketFeed.add(e.enrollmentId, this.newTicketBushels);
    this.newTicketBushels = null;
  }

  removeTicket(ticketNo: string): void {
    this.ticketFeed.remove(ticketNo);
  }

  completeHarvest(): void {
    const e = this.enrollment();
    if (!e) return;
    const names = new Map(this.records().map(r => [r.recordId, r.fieldName]));
    this.harvestLeftOpen = this.recordStore.completeHarvest(e)
      .map(o => ({ fieldName: names.get(o.recordId) ?? 'A field', missing: o.missing }));
  }

  withdraw(): void {
    const e = this.enrollment();
    if (!e) return;
    this.service.withdraw(e.key, this.withdrawReason);
    this.showWithdraw = false;
    this.withdrawReason = '';
  }

  issueNew(): void {
    this.service.ensureFor(this.programKey(), this.customerId(), this.year());
  }
}
