import { Component, computed, inject, input, output, signal } from '@angular/core';
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

/**
 * The 45Z review: once a field has an estimated CI, the originator goes over its inputs and its CTRM tickets
 * (delivered under the split ID, for its crop and crop year, settled or not) with the producer. After harvest
 * they confirm: the actual yield (suggested from the included tickets ÷ acres, editable) and the tickets kept.
 * The server rescores, locks, and keeps the confirmed CI with its bushels and tickets: the official result the
 * Bins' CSV is built from. Signals throughout: the dialog sits under an OnPush parent.
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
    <app-dialog-description>
      {{ season()!.cropLabel }} · Split {{ field()!.splitId }} · {{ season()!.acres ?? 0 | number }} ac.
      Go over the inputs and tickets with the producer; confirm after harvest.
    </app-dialog-description>
  </app-dialog-header>

  <app-dialog-content>
    <div class="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <!-- The 45Z inputs as entered -->
      <section>
        <h4 class="font-semibold text-gray-900 dark:text-white">45Z inputs</h4>
        <dl class="mt-2 space-y-1 text-sm">
          @for (row of inputRows(); track row[0]) {
            <div class="flex justify-between gap-3"><dt class="text-gray-500 dark:text-gray-400">{{ row[0] }}</dt><dd class="text-gray-900 dark:text-white text-right">{{ row[1] }}</dd></div>
          }
        </dl>
        <div class="mt-3 rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm">
          <div class="text-gray-500 dark:text-gray-400">Estimated CI</div>
          <div class="text-lg font-semibold text-gray-900 dark:text-white">{{ estimatedCi() !== null ? (estimatedCi()! | number:'1.0-0') + ' g CO₂e/bu' : 'not scored' }}</div>
        </div>
        @if (!confirmed()) {
          <button type="button" class="mt-2 text-sm text-scoular-green-accessible bg-transparent border-0 p-0 hover:underline" (click)="close.emit()">Edit inputs</button>
        }
      </section>

      <!-- The field's CTRM tickets -->
      <section>
        <h4 class="font-semibold text-gray-900 dark:text-white">Tickets in CTRM</h4>
        @if (confirmed(); as o) {
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">Confirmed {{ o.documentedAt | date:'MM/dd/yy' }} by {{ o.documentedBy }}: these tickets are the field's confirmed bushels.</p>
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
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Delivered under {{ t.splitId }}{{ t.cropGroup ? ', ' + t.cropGroup : '' }}, crop year {{ t.cropYear }}: on a {{ t.cropYear }} contract,
                  or BL-dated {{ t.windowFrom | date:'MM/dd/yy' }}–{{ t.windowTo | date:'MM/dd/yy' }}. Settled tickets included. Untick any that aren't this field's.
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
          <thead><tr class="text-left text-xs text-gray-500 dark:text-gray-400">
            @if (pick) { <th class="py-1 pr-2"><span class="sr-only">Include</span></th> }
            <th class="py-1 pr-3">Ticket #</th><th class="py-1 pr-3">BL date</th><th class="py-1 pr-3">Location</th>
            <th class="py-1 pr-3">Contract</th><th class="py-1 pr-3 text-right">Net bu</th><th class="py-1">Status</th>
          </tr></thead>
          <tbody>
            @for (tk of rows; track tk.ticketKey) {
              <tr class="border-t border-gray-100 dark:border-gray-800" [class.opacity-50]="pick && excluded().has(tk.ticketKey)">
                @if (pick) {
                  <td class="py-1 pr-2"><input type="checkbox" [checked]="!excluded().has(tk.ticketKey)" (change)="toggle(tk.ticketKey)"
                    [attr.aria-label]="'Include ticket ' + tk.ticketNumber" /></td>
                }
                <td class="py-1 pr-3 font-medium text-gray-900 dark:text-white">{{ tk.ticketNumber }}</td>
                <td class="py-1 pr-3">{{ tk.blDate | date:'MM/dd/yy' }}</td>
                <td class="py-1 pr-3">{{ tk.location ?? '' }}</td>
                <td class="py-1 pr-3">{{ tk.contractNumber ?? 'none' }}<span class="text-xs text-gray-500"> · {{ tk.cropYearMatch === 'contract' ? 'contract year' : 'date window' }}</span></td>
                <td class="py-1 pr-3 text-right">{{ tk.netBushels !== null ? (tk.netBushels | number:'1.0-2') : '?' }}</td>
                <td class="py-1">{{ tk.settled ? 'Settled ' + (tk.settledDate ? (tk.settledDate | date:'MM/dd/yy') : '') : 'Open' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </ng-template>

    <!-- Confirmation -->
    <div class="mt-6 rounded-md border border-gray-200 dark:border-gray-700 px-4 py-3">
      @if (confirmed(); as o) {
        <div class="text-sm text-gray-900 dark:text-white">
          <span class="font-semibold">Confirmed CI {{ o.score?.value | number:'1.0-0' }} g CO₂e/bu</span>
          · {{ o.bushels | number:'1.0-0' }} bu from {{ o.tickets?.length ?? 0 }} tickets · actual yield {{ o.actualYield | number:'1.0-1' }} bu/ac · {{ o.method }}
        </div>
        @if (producer(); as p) {
          <button type="button" class="mt-2 h-8 rounded-md px-3 text-sm border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible"
                  (click)="downloadCsv()">Download confirmed CI (CSV)</button>
        }
      } @else {
        <div class="flex flex-wrap items-end gap-4 text-sm">
          <div><div class="text-gray-500 dark:text-gray-400">Included</div>
            <div class="font-medium text-gray-900 dark:text-white">{{ included().length }} tickets · {{ includedBushels() | number:'1.0-0' }} bu</div></div>
          <label class="block"><span class="text-gray-500 dark:text-gray-400">Actual yield (bu/ac)</span>
            <input type="number" min="0" step="0.1" class="ci-input ci-compact !w-28 text-right" [ngModel]="actualYield()" (ngModelChange)="yieldTyped.set($event)" /></label>
          <div class="text-xs text-gray-500 dark:text-gray-400 pb-1">
            @if (suggestedYield() !== null) { Tickets ÷ acres: {{ suggestedYield() | number:'1.0-1' }} bu/ac }
            @if (yieldTyped() !== null) { · <button type="button" class="bg-transparent border-0 p-0 underline text-inherit" (click)="yieldTyped.set(null)">use it</button> }
          </div>
          <div><div class="text-gray-500 dark:text-gray-400">CI at this yield</div>
            <div class="font-semibold text-gray-900 dark:text-white">{{ rescoreText() }}</div></div>
        </div>
        <label class="mt-3 flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" class="mt-0.5" [checked]="reviewed()" (change)="reviewed.set(!reviewed())" />
          Reviewed these inputs and tickets with the producer after harvest.
        </label>
        @if (blocker(); as b) { <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ b }}</p> }
      }
    </div>
  </app-dialog-content>

  <app-dialog-footer>
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
export class FdCicReviewComponent {
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
  /** Tickets the originator left out. Everything starts included. */
  readonly excluded = signal(new Set<string>());
  readonly included = computed(() => (this.ticketData()?.tickets ?? []).filter(t => !this.excluded().has(t.ticketKey)));
  readonly includedBushels = computed(() => this.included().reduce((sum, t) => sum + (t.netBushels ?? 0), 0));

  /** What the originator typed; null follows the tickets. */
  readonly yieldTyped = signal<number | null>(null);
  readonly suggestedYield = computed(() => yieldFromTickets(this.includedBushels(), this.season()?.acres ?? null));
  readonly actualYield = computed(() => this.yieldTyped() ?? this.suggestedYield());
  readonly reviewed = signal(false);
  readonly saving = signal(false);

  constructor() {
    queueMicrotask(() => this.loadTickets());
  }

  async loadTickets(): Promise<void> {
    if (this.confirmed()) return;
    this.tickets.set({ status: 'loading' });
    try {
      this.tickets.set({ status: 'done', data: await this.store.fieldTickets(this.recordId()) });
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

  readonly inputRows = computed((): [string, string][] => {
    const d = this.data();
    if (!d) return [];
    const n = (v: number | null, unit: string) => (v === null ? 'not entered' : `${v.toLocaleString()} ${unit}`);
    return [
      ['Expected yield', n(d.expectedYield, 'bu/ac')],
      ['Actual yield (entered)', n(d.actualYield, 'bu/ac')],
      ['Nitrogen', n(d.syntheticN, 'lb N/ac')],
      ['Inhibitor', `${Math.round(d.niFraction * 100)}% of N`],
      ['Tillage', TILLAGE_LABELS[d.tillage]],
      ['Cover crop', COVER_LABELS[d.coverCrop]],
      ['Manure', d.manure.length ? `${d.manure.length} application${d.manure.length > 1 ? 's' : ''}` : 'none'],
    ];
  });

  /** The CI now: the locked estimate, else the live score of the inputs as entered. */
  readonly estimatedCi = computed(() => {
    const r = this.record(), s = this.season(), f = this.field();
    if (!r || !s || !f) return null;
    if (r.frozen?.score) return r.frozen.score.value;
    const req = fdCicRequest(r.data as FdCicData, s, f);
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

  readonly rescoreText = computed(() => {
    const st = this.rescore();
    if (!st) return '—';
    if (st.status === 'loading') return 'calculating…';
    if (st.status === 'error') return 'can\'t score';
    return st.score.scorable && st.score.ci !== null ? `${Math.round(st.score.ci).toLocaleString()} g CO₂e/bu` : 'no USDA data';
  });

  /** Why Confirm is off, in order; null when it can go. */
  readonly blocker = computed((): string | null => {
    if (this.tickets().status !== 'done') return 'Waiting for the tickets.';
    if (!this.included().length) return 'Include at least one ticket.';
    const y = this.actualYield();
    if (!y || y <= 0) return 'Enter the actual yield.';
    const st = this.rescore();
    if (st?.status !== 'done' || !st.score.scorable) return 'Waiting for the CI at this yield.';
    if (!this.reviewed()) return 'Tick that you reviewed this with the producer after harvest.';
    return null;
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
