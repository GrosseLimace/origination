import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent, DialogContentComponent, DialogDescriptionComponent, DialogFooterComponent, DialogHeaderComponent, DialogTitleComponent } from '@shared/components/dialog/dialog.component';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { ToastService } from '@core/services/toast.service';
import { FdCicData, FieldTickets } from '@models';
import { downloadCsv } from '@shared/utils/csv';
import { FieldPlanStore } from '../../store/field-plan.store';
import { COVER_LABELS, TILLAGE_LABELS, fdCicRequest } from './fd-cic.data';
import { confirmedCiCsv, confirmedCiFileName } from './confirmed-ci-export';

type TicketsState = { status: 'loading' } | { status: 'done'; data: FieldTickets } | { status: 'error'; message: string };

/** Included bushels ÷ acres, to one decimal: the actual yield the review suggests. Null without both. */
export function yieldFromTickets(bushels: number, acres: number | null): number | null {
  return acres && acres > 0 && bushels > 0 ? Math.round((bushels / acres) * 10) / 10 : null;
}

const TICK_REASON = 'Tick that you reviewed this with the producer after harvest.';
/** The API's limit on the actual yield (ConfirmFieldProgramRecordRequest). */
const MAX_YIELD = 1000;

/**
 * The 45Z review: once a field has an estimated CI, the originator goes over its inputs and its CTRM tickets
 * (delivered under the split ID, for its crop and crop year, settled or not) with the producer. After harvest
 * they confirm: the actual yield (suggested from the included tickets ÷ acres, editable) and the tickets kept.
 * The server rescores, locks, and keeps the confirmed CI with its bushels and tickets: the official result the
 * Bins' CSV is built from.
 *
 * Laid out as three steps (check inputs, pick tickets, confirm) under one summary strip that answers the
 * question first: the estimate, the CI at the confirmed yield, and the bushels. Signals throughout: the
 * dialog sits under an OnPush parent.
 */
@Component({
  selector: 'app-fd-cic-review',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent],
  styleUrl: '../../field-plan.css',
  template: `
@if (record() && season() && field()) {
<app-dialog [isOpen]="true" (close)="close.emit()" size="xl" [scrollBody]="true" [closeOnBackdrop]="false">
  <app-dialog-header>
    <app-dialog-title>Review 45Z · {{ field()!.name }} · {{ season()!.year }}</app-dialog-title>
    <app-dialog-description>{{ season()!.cropLabel }} · Split {{ field()!.splitId }} · {{ season()!.acres ?? 0 | number }} ac</app-dialog-description>
  </app-dialog-header>

  <app-dialog-content>
    <!-- The answer first: the estimate, the CI at the confirmed yield, and the bushels behind it -->
    <div class="grid gap-3 rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3 sm:grid-cols-[1fr_auto_1fr_1fr] sm:items-center">
      <div>
        <div class="text-xs text-gray-500 dark:text-gray-400">Estimated CI</div>
        <div class="text-xl font-semibold text-gray-900 dark:text-white">{{ estimatedCi() !== null ? (estimatedCi()! | number:'1.0-0') : '—' }} <span class="text-sm font-normal">g CO₂e/bu</span></div>
        <div class="text-xs text-gray-500 dark:text-gray-400">at {{ expectedYield() !== null ? (expectedYield() | number:'1.0-1') + ' bu/ac expected' : 'no expected yield' }}</div>
      </div>
      <div class="hidden sm:block text-2xl text-gray-400" aria-hidden="true">→</div>
      <div>
        <div class="text-xs text-gray-500 dark:text-gray-400">{{ confirmed() ? 'Confirmed CI' : 'CI at actual yield' }}</div>
        <div class="text-xl font-semibold" [class]="confirmed() ? 'text-scoular-green-accessible dark:text-scoular-green' : 'text-gray-900 dark:text-white'">
          {{ finalCiText() }} @if (finalCi() !== null) { <span class="text-sm font-normal">g CO₂e/bu</span> }
        </div>
        <div class="text-xs text-gray-500 dark:text-gray-400">at {{ shownYield() !== null ? (shownYield() | number:'1.0-1') + ' bu/ac actual' : 'actual yield not set' }}</div>
      </div>
      <div>
        <div class="text-xs text-gray-500 dark:text-gray-400">Bushels</div>
        <div class="text-xl font-semibold text-gray-900 dark:text-white">{{ shownBushels() | number:'1.0-0' }} <span class="text-sm font-normal">bu</span></div>
        <div class="text-xs text-gray-500 dark:text-gray-400">from {{ shownTicketCount() }} ticket{{ shownTicketCount() === 1 ? '' : 's' }}</div>
      </div>
    </div>

    <div class="mt-5 grid gap-6 lg:grid-cols-[15rem_1fr]">
      <!-- ① The inputs as entered -->
      <section>
        <h4 class="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><span class="ci-step">1</span> Check inputs</h4>
        <dl class="mt-2 space-y-1.5 text-sm">
          @for (row of inputRows(); track row[0]) {
            <div class="flex justify-between gap-3"><dt class="text-gray-500 dark:text-gray-400">{{ row[0] }}</dt><dd class="text-right text-gray-900 dark:text-white">{{ row[1] }}</dd></div>
          }
        </dl>
        <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">{{ practices() }}</div>
        @if (!confirmed()) {
          <button type="button" class="mt-3 text-sm text-scoular-green-accessible dark:text-scoular-green bg-transparent border-0 p-0 hover:underline" (click)="close.emit()">Edit inputs</button>
        }
      </section>

      <!-- ② The field's CTRM tickets -->
      <section class="min-w-0">
        <h4 class="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><span class="ci-step">2</span> {{ confirmed() ? 'Confirmed tickets' : 'Pick tickets' }}</h4>
        @if (confirmed(); as o) {
          <ng-container *ngTemplateOutlet="ticketTable; context: { $implicit: o.tickets ?? [], pick: false }" />
        } @else {
          @switch (tickets().status) {
            @case ('loading') { <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">Reading the split's tickets from CTRM…</p> }
            @case ('error') {
              <p class="mt-2 text-sm text-amber-800 dark:text-amber-300">{{ ticketsError() }}
                <button type="button" class="underline bg-transparent border-0 p-0 text-inherit" (click)="loadTickets()">Try again</button></p>
            }
            @default {
              @if (ticketData(); as t) {
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                   [title]="'Delivered under ' + t.splitId + ', on a ' + t.cropYear + ' contract or BL-dated ' + (t.windowFrom | date:'MM/dd/yy') + ' to ' + (t.windowTo | date:'MM/dd/yy') + '. Untick any that are not this field\\'s.'">
                  Under {{ t.splitId }} · {{ t.cropYear }} crop year · settled included <span class="cursor-help underline decoration-dotted">how?</span>
                </p>
                @if (t.tickets.length) {
                  <ng-container *ngTemplateOutlet="ticketTable; context: { $implicit: t.tickets, pick: true }" />
                } @else {
                  <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">No tickets under {{ t.splitId }} for this crop year yet.</p>
                }
              }
            }
          }
        }
      </section>
    </div>

    <ng-template #ticketTable let-rows let-pick="pick">
      <div class="mt-2 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-gray-500 dark:text-gray-400">
              @if (pick) {
                <th class="py-1 pr-2 w-6"><input type="checkbox" [checked]="allIncluded()" [indeterminate]="someIncluded()" (change)="toggleAll()" aria-label="Include every ticket" /></th>
              }
              <th class="py-1 pr-3 font-medium">Ticket #</th>
              <th class="py-1 pr-3 font-medium">BL date</th>
              <th class="py-1 pr-3 font-medium">Location</th>
              <th class="py-1 pr-3 font-medium">Contract</th>
              <th class="py-1 pr-3 text-right font-medium">Net bu</th>
              <th class="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (tk of rows; track tk.ticketKey) {
              <tr class="border-t border-gray-100 dark:border-gray-800" [class.opacity-40]="pick && excluded().has(tk.ticketKey)">
                @if (pick) {
                  <td class="py-1.5 pr-2"><input type="checkbox" [checked]="!excluded().has(tk.ticketKey)" (change)="toggle(tk.ticketKey)" [attr.aria-label]="'Include ticket ' + tk.ticketNumber" /></td>
                }
                <td class="py-1.5 pr-3 font-medium text-gray-900 dark:text-white">{{ tk.ticketNumber }}</td>
                <td class="py-1.5 pr-3 whitespace-nowrap">{{ tk.blDate | date:'MM/dd/yy' }}</td>
                <td class="py-1.5 pr-3">{{ tk.location ?? '—' }}</td>
                <td class="py-1.5 pr-3 whitespace-nowrap">
                  {{ tk.contractNumber ?? '—' }}
                  <span class="ml-1 rounded px-1.5 py-0.5 text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                        [title]="tk.cropYearMatch === 'contract' ? 'Matched by the contract\\'s crop year' : 'Matched by its BL date in the crop year window'">
                    {{ tk.cropYearMatch === 'contract' ? 'contract yr' : 'date' }}</span>
                </td>
                <td class="py-1.5 pr-3 text-right tabular-nums">{{ tk.netBushels !== null ? (tk.netBushels | number:'1.0-0') : '?' }}</td>
                <td class="py-1.5 whitespace-nowrap">
                  @if (tk.settled) {
                    <span class="rounded-full px-2 py-0.5 text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">Settled{{ tk.settledDate ? ' ' + (tk.settledDate | date:'MM/dd') : '' }}</span>
                  } @else {
                    <span class="rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">Open</span>
                  }
                </td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
              @if (pick) { <td></td> }
              <td class="py-1.5 pr-3 text-xs text-gray-500 dark:text-gray-400" colspan="4">
                {{ pick ? included().length + ' of ' + rows.length + ' included' : rows.length + ' ticket' + (rows.length === 1 ? '' : 's') }}
              </td>
              <td class="py-1.5 pr-3 text-right font-semibold tabular-nums">{{ (pick ? includedBushels() : sumBushels(rows)) | number:'1.0-0' }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ng-template>

    <!-- ③ Confirm, or what was confirmed -->
    <section class="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
      <h4 class="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><span class="ci-step">3</span> {{ confirmed() ? 'Confirmed' : 'Confirm after harvest' }}</h4>
      @if (confirmed(); as o) {
        <p class="mt-1 text-sm text-gray-700 dark:text-gray-300">
          Confirmed {{ o.documentedAt | date:'MM/dd/yy' }} by {{ o.documentedBy }} with {{ o.method }}. These tickets are the field's confirmed bushels.
        </p>
        @if (producer()) {
          <button type="button" class="mt-2 h-8 rounded-md px-3 text-sm border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible"
                  (click)="downloadCsv()">Download confirmed CI (CSV)</button>
        }
      } @else {
        <div class="mt-2 flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
          <label class="block">
            <span class="text-gray-700 dark:text-gray-300">Actual yield (bu/ac)</span>
            <input type="number" min="0" max="1000" step="0.1" class="ci-input ci-compact mt-1 !w-28 text-right" [ngModel]="actualYield()" (ngModelChange)="yieldTyped.set($event)" />
            <span class="mt-1 block text-xs text-gray-500 dark:text-gray-400">
              @if (suggestedYield() !== null) { Tickets ÷ acres: {{ suggestedYield() | number:'1.0-1' }} }
              @if (yieldTyped() !== null && suggestedYield() !== null) {
                · <button type="button" class="bg-transparent border-0 p-0 underline text-inherit" (click)="yieldTyped.set(null)">reset</button>
              }
            </span>
          </label>
          <label class="flex max-w-md items-start gap-2 pt-6 text-gray-700 dark:text-gray-300">
            <input type="checkbox" class="mt-0.5" [checked]="reviewed()" (change)="reviewed.set(!reviewed())" />
            Reviewed these inputs and tickets with the producer after harvest.
          </label>
        </div>
      }
    </section>
  </app-dialog-content>

  <app-dialog-footer>
    @if (!confirmed() && footerReason(); as why) {
      <span class="mr-auto self-center text-xs text-gray-500 dark:text-gray-400">{{ why }}</span>
    }
    <button type="button" class="h-9 rounded-md px-4 text-sm text-gray-700 dark:text-gray-200 bg-transparent border border-gray-300 dark:border-gray-600" (click)="close.emit()">Close</button>
    @if (!confirmed()) {
      <button type="button" class="h-9 rounded-md px-4 text-sm font-medium text-white bg-scoular-green-accessible hover:bg-scoular-green disabled:opacity-50 border-0"
              [disabled]="!!blocker() || saving()" (click)="confirm()">{{ saving() ? 'Confirming…' : 'Confirm CI' }}</button>
    }
  </app-dialog-footer>
</app-dialog>
}
`,
})
export class FdCicReviewComponent implements OnInit {
  private readonly store = inject(FieldPlanStore);
  private readonly fdCic = inject(FdCicApiService);
  private readonly toast = inject(ToastService);

  readonly recordId = input.required<string>();
  /** For the CSV: the producer's CTRM code and name. Without it the download is on the enrollment card only. */
  readonly producer = input<{ code: string; name: string } | null>(null);
  readonly close = output<void>();

  readonly record = computed(() => this.store.record(this.recordId()));
  readonly season = computed(() => this.store.season(this.record()?.seasonId ?? ''));
  readonly field = computed(() => this.store.field(this.season()?.fieldKey ?? ''));
  private readonly data = computed(() => this.record()?.data as FdCicData | undefined);
  /** The confirmed CI, once there is one. */
  readonly confirmed = computed(() => (this.record()?.official?.status === 'Documented' ? this.record()!.official! : null));

  readonly tickets = signal<TicketsState>({ status: 'loading' });
  readonly ticketData = computed(() => { const t = this.tickets(); return t.status === 'done' ? t.data : null; });
  readonly ticketsError = computed(() => { const t = this.tickets(); return t.status === 'error' ? t.message : ''; });
  /** Tickets left out. Every ticket with a bushel figure starts included; one without can't be counted. */
  readonly excluded = signal(new Set<string>());
  readonly included = computed(() => (this.ticketData()?.tickets ?? []).filter(t => !this.excluded().has(t.ticketKey)));
  readonly includedBushels = computed(() => this.included().reduce((sum, t) => sum + (t.netBushels ?? 0), 0));
  /** The tickets the header box ticks: those with a bushel figure. */
  private readonly countable = computed(() => (this.ticketData()?.tickets ?? []).filter(t => t.netBushels !== null));
  readonly allIncluded = computed(() => this.countable().length > 0 && this.countable().every(t => !this.excluded().has(t.ticketKey)));
  readonly someIncluded = computed(() => !this.allIncluded() && this.included().length > 0);

  /** What the originator typed; null follows the tickets. */
  readonly yieldTyped = signal<number | null>(null);
  readonly suggestedYield = computed(() => yieldFromTickets(this.includedBushels(), this.season()?.acres ?? null));
  readonly actualYield = computed(() => this.yieldTyped() ?? this.suggestedYield());
  readonly reviewed = signal(false);
  readonly saving = signal(false);

  ngOnInit(): void {
    void this.loadTickets();
  }

  async loadTickets(): Promise<void> {
    if (this.confirmed()) return;
    this.tickets.set({ status: 'loading' });
    try {
      const data = await this.store.fieldTickets(this.recordId());
      // A ticket with no bushel figure can't be counted, so it starts left out.
      this.excluded.set(new Set(data.tickets.filter(t => t.netBushels === null).map(t => t.ticketKey)));
      this.tickets.set({ status: 'done', data });
    } catch (e) {
      this.tickets.set({ status: 'error', message: e instanceof Error ? e.message : 'The tickets couldn\'t be read from CTRM.' });
    }
  }

  toggle(key: string): void {
    this.excluded.update(s => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  /** The header box: include every ticket with a bushel figure, or (when they're all in) none. */
  toggleAll(): void {
    const all = this.ticketData()?.tickets ?? [];
    const leaveOut = this.allIncluded() ? all : all.filter(t => t.netBushels === null);
    this.excluded.set(new Set(leaveOut.map(t => t.ticketKey)));
  }

  sumBushels(rows: readonly { netBushels: number | null }[]): number {
    return rows.reduce((sum, t) => sum + (t.netBushels ?? 0), 0);
  }

  readonly expectedYield = computed(() => this.data()?.expectedYield ?? null);

  /** The inputs that drive the CI. The actual yield isn't here: the review sets it. */
  readonly inputRows = computed((): [string, string][] => {
    const d = this.data();
    if (!d) return [];
    const n = (v: number | null, unit: string) => (v === null ? 'not entered' : `${v.toLocaleString()} ${unit}`);
    return [
      ['Expected yield', n(d.expectedYield, 'bu/ac')],
      ['Nitrogen', n(d.syntheticN, 'lb N/ac')],
      ['Inhibitor', `${Math.round(d.niFraction * 100)}% of N`],
    ];
  });

  /** Tillage, cover crop and manure on one line. */
  readonly practices = computed(() => {
    const d = this.data();
    if (!d) return '';
    const manure = d.manure.length ? `${d.manure.length} manure application${d.manure.length > 1 ? 's' : ''}` : 'no manure';
    return `${TILLAGE_LABELS[d.tillage]} · ${COVER_LABELS[d.coverCrop]} · ${manure}`;
  });

  /** The planning estimate: the inputs scored at the expected yield (projected), whatever actual yield is set. */
  readonly estimatedCi = computed(() => {
    const r = this.record(), s = this.season(), f = this.field();
    if (!r || !s || !f) return null;
    const req = fdCicRequest({ ...(r.data as FdCicData), actualYield: null }, s, f);
    const state = req ? this.fdCic.score(s.year, req) : null;
    return state?.status === 'done' && state.score.scorable ? state.score.ci : null;
  });

  /** The live score at the review's actual yield (the server rescores the same way on confirm). */
  private readonly rescore = computed(() => {
    const d = this.data(), s = this.season(), f = this.field(), y = this.actualYield();
    if (!d || !s || !f || !y || y <= 0) return null;
    const req = fdCicRequest({ ...d, actualYield: y }, s, f);
    return req ? this.fdCic.score(s.year, req) : null;
  });

  /** The right-hand CI: the confirmed one once there is one, else the live score at the actual yield. */
  readonly finalCi = computed(() => {
    const o = this.confirmed();
    if (o) return o.score?.value ?? null;
    const st = this.rescore();
    return st?.status === 'done' && st.score.scorable ? st.score.ci : null;
  });

  readonly finalCiText = computed(() => {
    const ci = this.finalCi();
    if (ci !== null) return Math.round(ci).toLocaleString();
    const st = this.rescore();
    if (this.confirmed() || !st) return '—';
    if (st.status === 'loading') return 'calculating…';
    if (st.status === 'error') return 'can\'t score';
    return 'no USDA data';
  });

  readonly shownYield = computed(() => this.confirmed()?.actualYield ?? this.actualYield());
  readonly shownBushels = computed(() => this.confirmed()?.bushels ?? this.includedBushels());
  readonly shownTicketCount = computed(() => this.confirmed()?.tickets?.length ?? this.included().length);

  /** Why Confirm is off, in order; null when it can go. */
  readonly blocker = computed((): string | null => {
    if (this.tickets().status !== 'done') return 'Waiting for the tickets.';
    if (!this.included().length) return 'Include at least one ticket.';
    const unweighed = this.included().find(t => t.netBushels === null);
    if (unweighed) return `Ticket ${unweighed.ticketNumber} has no bushel figure; leave it out.`;
    const y = this.actualYield();
    if (!y || y <= 0) return 'Enter the actual yield.';
    if (y > MAX_YIELD) return `An actual yield over ${MAX_YIELD} bu/ac can't be right; check it.`;
    const st = this.rescore();
    if (st?.status !== 'done' || !st.score.scorable) return 'Waiting for the CI at this yield.';
    if (!this.reviewed()) return TICK_REASON;
    return null;
  });

  /** The reason beside the Confirm button. The review tick explains itself, so it isn't repeated. */
  readonly footerReason = computed(() => {
    const b = this.blocker();
    return b === TICK_REASON ? null : b;
  });

  async confirm(): Promise<void> {
    if (this.blocker() || this.saving()) return;
    this.saving.set(true);
    try {
      const done = await this.store.confirm(this.recordId(), this.actualYield()!, this.included().map(t => t.ticketKey));
      if (done) this.toast.success(`${this.field()!.name}: CI confirmed.`);
    } finally {
      this.saving.set(false);
    }
  }

  downloadCsv(): void {
    const p = this.producer(), r = this.record(), s = this.season(), f = this.field();
    if (!p || !r || !s || !f) return;
    const csv = confirmedCiCsv(p, [{ field: f, season: s, record: r, enrollmentId: this.store.enrollmentIdOf(r) }]);
    downloadCsv(csv, confirmedCiFileName(p.code, s.year, new Date()));
  }
}
