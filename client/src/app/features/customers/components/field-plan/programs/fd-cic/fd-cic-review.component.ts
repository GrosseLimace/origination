import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent, DialogContentComponent, DialogDescriptionComponent, DialogFooterComponent, DialogHeaderComponent, DialogTitleComponent } from '@shared/components/dialog/dialog.component';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { ToastService } from '@core/services/toast.service';
import { TDiscApiService } from '@core/services/tdisc-api.service';
import { FdCicData, FieldTicket, FieldTickets, TDiscPass, TDiscResult, Tillage } from '@models';
import { downloadCsv } from '@shared/utils/csv';
import { FieldPlanStore } from '../../store/field-plan.store';
import { COVER_LABELS, TILLAGE_LABELS, fdCicRequest, tillageFromLabel } from './fd-cic.data';
import { DESIGNATION_LABELS, designationOf, passesProblem, rateTDisc, supportedTillage, tDiscNeeded } from './fd-cic-tdisc';
import { recordkeepingFor } from './fd-cic-recordkeeping';
import { ledgerCsv, ledgerFileName } from './mass-balance-ledger';
import { feedstockReport } from './feedstock-report';
import { FeedstockReportService } from './feedstock-report.service';
import { ReviewTicketTableComponent } from './review/review-ticket-table.component';
import { ReviewRecordkeepingComponent } from './review/review-recordkeeping.component';
import { ReviewTDiscComponent } from './review/review-tdisc.component';

type TicketsState = { status: 'loading' } | { status: 'done'; data: FieldTickets } | { status: 'error'; message: string };

/** Included bushels ÷ acres, to one decimal: the actual yield the review suggests. Null without both. */
export function yieldFromTickets(bushels: number, acres: number | null): number | null {
  return acres && acres > 0 && bushels > 0 ? Math.round((bushels / acres) * 10) / 10 : null;
}

/** The API's limit on the actual yield (ConfirmFieldProgramRecordRequest). */
const MAX_YIELD = 1000;

export const REVIEW_STEPS = [
  { n: 1, label: 'Inputs' },
  { n: 2, label: 'T-DISC' },
  { n: 3, label: 'Tickets & yield' },
  { n: 4, label: 'Recordkeeping' },
  { n: 5, label: 'Confirm' },
] as const;

/**
 * The 45Z review: once a field has an estimated CI, the originator steps through it with the producer after
 * harvest. ① the calculator inputs; ② for no till or reduced till, the field's passes rated with USDA T-DISC
 * (a rating that doesn't support the tillage steps it down, and the CI is rescored at it); ③ the CTRM tickets
 * (delivered under the split ID, for its crop and crop year, settled or not) and the actual yield they give
 * (included tickets ÷ acres, editable); ④ the records the producer keeps, acknowledged; ⑤ confirm. The server
 * rescores, locks, and keeps the confirmed CI with its bushels and tickets: the official result the Biofuel
 * Feedstock Report and the Mass Balance Ledger are built from.
 *
 * Each step's Next waits on that step's own check. A confirmed field opens on ⑤, every step read-only.
 */
@Component({
  selector: 'app-fd-cic-review',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent,
    ReviewTicketTableComponent, ReviewRecordkeepingComponent, ReviewTDiscComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../field-plan.css',
  templateUrl: './fd-cic-review.component.html',
})
export class FdCicReviewComponent implements OnInit {
  private readonly store = inject(FieldPlanStore);
  private readonly fdCic = inject(FdCicApiService);
  private readonly toast = inject(ToastService);
  private readonly reports = inject(FeedstockReportService);
  private readonly tDiscApi = inject(TDiscApiService);

  readonly recordId = input.required<string>();
  /** The producer's CTRM code and name, for the report and ledger. Without it they are on the program card only. */
  readonly producer = input<{ code: string; name: string; primaryContact?: string | null } | null>(null);
  readonly close = output<void>();

  readonly steps = REVIEW_STEPS;
  /** Confirm: the last step. */
  readonly lastStep = REVIEW_STEPS.length;
  readonly step = signal(1);

  readonly record = computed(() => this.store.record(this.recordId()));
  readonly season = computed(() => this.store.season(this.record()?.seasonId ?? ''));
  readonly field = computed(() => this.store.field(this.season()?.fieldKey ?? ''));
  private readonly data = computed(() => this.record()?.data as FdCicData | undefined);
  /** The confirmed CI, once there is one. */
  readonly confirmed = computed(() => (this.record()?.official?.status === 'Documented' ? this.record()!.official! : null));

  // ── ② T-DISC ──
  /** The tillage on the estimate. Once confirmed, the data holds the confirmed tillage; the official result keeps both. */
  readonly estimateTillage = computed((): Tillage =>
    tillageFromLabel(this.confirmed()?.tDisc?.estimatedTillage) ?? this.data()?.tillage ?? 'NoneOfTheAbove');
  readonly needsTDisc = computed(() => tDiscNeeded(this.estimateTillage()));
  /** USDA T-DISC's windows and implements; loaded only for a field that needs them. */
  readonly tDiscOptions = computed(() => (this.needsTDisc() && !this.confirmed() ? this.tDiscApi.options() : null));
  readonly tDiscOptionsError = computed(() => this.tDiscApi.error());
  /** The field's passes, saved with its data as they're entered. */
  readonly tDiscPasses = signal<TDiscPass[]>([]);
  /** The worksheet: the server's once confirmed, else the live one (the server rates the passes again at confirm). */
  readonly tDiscResult = computed((): TDiscResult | null => {
    const t = this.confirmed()?.tDisc;
    if (this.confirmed()) {
      return t?.windows && t.passes
        ? { rating: t.rating, designation: designationOf(tillageFromLabel(t.designation) ?? 'NoneOfTheAbove'), windows: t.windows, passes: t.passes }
        : null;
    }
    const options = this.tDiscOptions();
    return options ? rateTDisc(options, this.tDiscPasses()) : null;
  });
  readonly tDiscRating = computed(() => this.tDiscResult()?.rating ?? null);
  readonly designationText = computed(() => {
    const r = this.tDiscResult();
    return r ? DESIGNATION_LABELS[r.designation].toLowerCase() : '';
  });
  /** The tillage the CI is confirmed at: the estimate's, unless the rating only supports less. */
  readonly confirmedTillage = computed((): Tillage => {
    if (this.confirmed()) return this.data()?.tillage ?? 'NoneOfTheAbove';
    const r = this.tDiscResult();
    return this.needsTDisc() && r ? supportedTillage(this.estimateTillage(), r.designation) : this.estimateTillage();
  });
  readonly tillageStepsDown = computed(() => this.confirmedTillage() !== this.estimateTillage());
  /** Reduced till rated as no till. Never stepped up: no till also takes a 4-of-5-years promise the producer didn't make. */
  readonly tDiscSupportsNoTill = computed(() =>
    !this.confirmed() && this.estimateTillage() === 'ReducedTill' && this.tDiscResult()?.designation === 'NT');

  // ── ③ Tickets ──
  readonly tickets = signal<TicketsState>({ status: 'loading' });
  readonly ticketData = computed(() => { const t = this.tickets(); return t.status === 'done' ? t.data : null; });
  readonly ticketsError = computed(() => { const t = this.tickets(); return t.status === 'error' ? t.message : ''; });
  /** The split's other tickets for the crop the originator added from outside the crop year. */
  readonly added = signal(new Set<string>());
  readonly showOthers = signal(false);
  /** The table: the crop year's tickets, then the added ones. */
  readonly rows = computed(() => {
    const t = this.ticketData();
    return t ? [...t.tickets, ...(t.others ?? []).filter(o => this.added().has(o.ticketKey))] : [];
  });
  /** Other tickets not added yet, offered under the table. */
  readonly addable = computed(() => (this.ticketData()?.others ?? []).filter(o => !this.added().has(o.ticketKey)));
  /**
   * Tickets left out. Every countable ticket starts included; one with no bushel figure, or already in
   * another year's confirmed CI, starts out and can't be confirmed.
   */
  readonly excluded = signal(new Set<string>());
  readonly included = computed(() => this.rows().filter(t => !this.excluded().has(t.ticketKey)));
  readonly includedBushels = computed(() => this.included().reduce((sum, t) => sum + (t.netBushels ?? 0), 0));
  /** The tickets the header box ticks: those that can be counted. */
  private readonly countable = computed(() => this.rows().filter(t => this.canCount(t)));
  readonly allIncluded = computed(() => this.countable().length > 0 && this.countable().every(t => !this.excluded().has(t.ticketKey)));
  /** Whether any ticket can be counted; with none, the header box is off. */
  readonly anyCountable = computed(() => this.countable().length > 0);
  readonly someIncluded = computed(() => !this.allIncluded() && this.included().length > 0);

  // ── ③ Tickets and yield, ④ recordkeeping ──
  /** What the originator typed; null follows the tickets. */
  /** What the originator typed: undefined until they type (the suggestion shows), null once they clear the box. */
  readonly yieldTyped = signal<number | null | undefined>(undefined);
  readonly suggestedYield = computed(() => yieldFromTickets(this.includedBushels(), this.season()?.acres ?? null));
  readonly actualYield = computed(() => { const typed = this.yieldTyped(); return typed === undefined ? this.suggestedYield() : typed; });
  readonly recordkeeping = computed(() => {
    const d = this.data();
    return d ? recordkeepingFor(d, this.confirmedTillage()) : [];
  });
  readonly reviewed = signal(false);
  readonly saving = signal(false);

  ngOnInit(): void {
    this.tDiscPasses.set([...(this.data()?.tDiscPasses ?? [])]);
    if (this.confirmed()) {
      this.step.set(this.lastStep);
      return;
    }
    void this.loadTickets();
  }

  async loadTickets(): Promise<void> {
    if (this.confirmed()) return;
    this.tickets.set({ status: 'loading' });
    try {
      const data = await this.store.fieldTickets(this.recordId());
      this.excluded.set(new Set(data.tickets.filter(t => !this.canCount(t)).map(t => t.ticketKey)));
      this.added.set(new Set());
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

  /** The header box: include every countable ticket, or (when they're all in) none. */
  toggleAll(): void {
    const all = this.rows();
    const leaveOut = this.allIncluded() ? all : all.filter(t => !this.canCount(t));
    this.excluded.set(new Set(leaveOut.map(t => t.ticketKey)));
  }

  /** A ticket can be counted when it has a bushel figure and no other confirmed CI counts it. */
  canCount(t: FieldTicket): boolean {
    return t.netBushels !== null && t.confirmedFor == null;
  }

  canAdd(t: FieldTicket): boolean {
    return this.canCount(t);
  }

  /** Adds one of the split's other tickets to this crop year's, included. */
  addTicket(key: string): void {
    this.added.update(s => new Set(s).add(key));
    this.excluded.update(s => { const next = new Set(s); next.delete(key); return next; });
  }

  removeAdded(key: string): void {
    this.added.update(s => { const next = new Set(s); next.delete(key); return next; });
    this.excluded.update(s => { const next = new Set(s); next.delete(key); return next; });
  }

  /** Why an other ticket is outside the crop year, and why it can't be added when it can't. */
  addNote(t: FieldTicket): string {
    if (t.confirmedFor != null) return `Already in the ${t.confirmedFor} confirmed CI`;
    if (t.netBushels === null) return 'No bushel figure';
    return t.note ?? '';
  }

  /** Loads USDA T-DISC again after it failed; the pass table appears once it arrives. */
  retryTDisc(): void {
    void this.tDiscApi.load().catch(() => undefined);
  }

  /** Keeps the passes, and saves them with the field's data so closing the review doesn't lose them. */
  setPasses(passes: TDiscPass[]): void {
    this.tDiscPasses.set(passes);
    const d = this.data();
    if (d && !this.confirmed()) this.store.updateRecord(this.recordId(), { ...d, tDiscPasses: passes });
  }

  /** The producer's promise that the field meets the no-till rules, ticked before switching to No till here. */
  readonly noTillPromised = signal(false);

  /** The no-till note sits below the worksheet: brought into view when it appears, so it isn't missed. */
  private readonly noTillNote = viewChild<ElementRef<HTMLElement>>('noTillNote');
  private readonly showNoTillNote = effect(() => this.noTillNote()?.nativeElement.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }));

  /**
   * Changes the field's tillage to No till from the review, once the passes rate No till and the producer meets the
   * no-till rules (no till 4 of 5 years). The estimate and the recordkeeping follow; the passes are kept.
   */
  switchToNoTill(): void {
    const d = this.data();
    if (!d || !this.tDiscSupportsNoTill() || !this.noTillPromised()) return;
    this.store.updateRecord(this.recordId(), { ...d, tillage: 'NoTill', tDiscPasses: this.tDiscPasses() });
    this.noTillPromised.set(false);
    this.toast.success(`${this.field()?.name ?? 'Field'}: tillage changed to No till.`);
  }

  tillageLabel(t: Tillage): string {
    return TILLAGE_LABELS[t];
  }

  readonly expectedYield = computed(() => this.data()?.expectedYield ?? null);

  /** The calculator inputs as entered. The actual yield isn't here: the review sets it. */
  readonly inputRows = computed((): [string, string][] => {
    const d = this.data(), f = this.field(), s = this.season();
    if (!d || !f || !s) return [];
    const n = (v: number | null, unit: string) => (v === null ? 'not entered' : `${v.toLocaleString()} ${unit}`);
    const manure = d.manure.length ? `${d.manure.length} application${d.manure.length > 1 ? 's' : ''}` : 'None';
    return [
      ['Crop', s.cropLabel],
      ['Location', `${f.county ?? '—'} County, ${f.state ?? '—'}`],
      ['Acres', n(s.acres, 'ac')],
      ['Expected yield', n(d.expectedYield, 'bu/ac')],
      ['Synthetic nitrogen', n(d.syntheticN, 'lb N/ac')],
      ['Nitrification inhibitor', `${Math.round(d.niFraction * 100)}% of N`],
      ['Cover crop', COVER_LABELS[d.coverCrop]],
      ['Tillage', TILLAGE_LABELS[d.tillage]],
      ['Manure', manure],
    ];
  });

  /** The planning estimate: the inputs scored at the expected yield (projected), whatever actual yield is set. */
  readonly estimatedCi = computed(() => {
    const r = this.record(), s = this.season(), f = this.field();
    if (!r || !s || !f) return null;
    const req = fdCicRequest({ ...(r.data as FdCicData), actualYield: null, tillage: this.estimateTillage() }, s, f);
    const state = req ? this.fdCic.score(s.year, req) : null;
    return state?.status === 'done' && state.score.scorable ? state.score.ci : null;
  });

  /** The live score at the review's actual yield and confirmed tillage (the server rescores the same way). */
  private readonly rescore = computed(() => {
    const d = this.data(), s = this.season(), f = this.field(), y = this.actualYield();
    if (!d || !s || !f || !y || y <= 0) return null;
    const req = fdCicRequest({ ...d, actualYield: y, tillage: this.confirmedTillage() }, s, f);
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

  /** ⑤'s summary of what is (or was) confirmed. */
  readonly summaryRows = computed((): [string, string][] => {
    const o = this.confirmed();
    const est = this.estimatedCi();
    const live = this.tDiscResult();
    const tDisc = o ? o.tDisc ?? null : this.needsTDisc() && live
      ? { rating: live.rating, designation: '', estimatedTillage: TILLAGE_LABELS[this.estimateTillage()], confirmedTillage: TILLAGE_LABELS[this.confirmedTillage()] }
      : null;
    const tillage = tDisc && tDisc.estimatedTillage !== tDisc.confirmedTillage
      ? `${tDisc.confirmedTillage} (estimated as ${tDisc.estimatedTillage})` : tDisc?.confirmedTillage ?? TILLAGE_LABELS[this.estimateTillage()];
    const yieldShown = this.shownYield();
    return [
      ['Estimated CI', est !== null ? `${Math.round(est).toLocaleString()} g CO₂e/bu` : '—'],
      [o ? 'Confirmed CI' : 'CI to confirm', this.finalCi() !== null ? `${this.finalCiText()} g CO₂e/bu` : this.finalCiText()],
      ['Actual yield', yieldShown !== null ? `${yieldShown.toLocaleString()} bu/ac` : '—'],
      ['Bushels', `${Math.round(this.shownBushels()).toLocaleString()} bu from ${this.shownTicketCount()} ticket${this.shownTicketCount() === 1 ? '' : 's'}`],
      ['Tillage', tillage],
      ...(tDisc ? [['T-DISC rating', tDisc.rating.toFixed(3)] as [string, string]] : []),
    ];
  });

  /** Why a step isn't done yet, or null when it is. */
  stepBlocker(n: number): string | null {
    switch (n) {
      case 1: {
        const r = this.record(), s = this.season(), f = this.field();
        return r && s && f && fdCicRequest(r.data as FdCicData, s, f) ? null : 'This field\'s inputs are incomplete; edit them first.';
      }
      case 2:
        if (!this.needsTDisc()) return null;
        if (!this.tDiscOptions()) return this.tDiscOptionsError() || 'Waiting for USDA T-DISC.';
        return passesProblem(this.tDiscOptions()!, this.tDiscPasses());
      case 3: {
        if (this.tickets().status !== 'done') return 'Waiting for the tickets.';
        if (!this.included().length) return 'Include at least one ticket.';
        const unweighed = this.included().find(t => t.netBushels === null);
        if (unweighed) return `Ticket ${unweighed.ticketNumber} has no bushel figure; leave it out.`;
        const counted = this.included().find(t => t.confirmedFor != null);
        if (counted) return `Ticket ${counted.ticketNumber} is already in the ${counted.confirmedFor} confirmed CI; leave it out.`;
        const y = this.actualYield();
        if (!y || y <= 0) return 'Enter the actual yield.';
        if (y > MAX_YIELD) return `An actual yield over ${MAX_YIELD} bu/ac can't be right; check it.`;
        const st = this.rescore();
        return st?.status === 'done' && st.score.scorable ? null : 'Waiting for the CI at this yield.';
      }
      case 4:
        return this.reviewed() ? null : 'Tick that you reviewed the record requirements with the producer.';
      default:
        return null;
    }
  }

  /** A step shows as done once it and every step before it are. */
  isDone(n: number): boolean {
    return !!this.confirmed() || (n < this.lastStep && this.canOpen(n + 1));
  }

  /** A step opens once every step before it is done; a confirmed review opens any step. */
  canOpen(n: number): boolean {
    if (n < 1 || n > REVIEW_STEPS.length) return false;
    if (this.confirmed()) return true;
    for (let i = 1; i < n; i++) if (this.stepBlocker(i) !== null) return false;
    return true;
  }

  /** Why Confirm is off: the first unfinished step's reason; null when it can go. */
  readonly blocker = computed((): string | null => {
    for (let i = 1; i < REVIEW_STEPS.length; i++) {
      const why = this.stepBlocker(i);
      if (why) return why;
    }
    return null;
  });

  next(): void {
    if (this.canOpen(this.step() + 1)) this.step.update(s => s + 1);
  }

  back(): void {
    this.step.update(s => Math.max(1, s - 1));
  }

  async confirm(): Promise<void> {
    if (this.blocker() || this.saving()) return;
    this.saving.set(true);
    try {
      const done = await this.store.confirm(this.recordId(), this.actualYield()!, this.included().map(t => t.ticketKey), {
        tDiscPasses: this.needsTDisc() ? this.tDiscPasses() : null,
        recordkeepingReviewed: this.reviewed(),
      });
      if (done) this.toast.success(`${this.field()!.name}: CI confirmed.`);
    } finally {
      this.saving.set(false);
    }
  }

  async generateReport(): Promise<void> {
    const p = this.producer(), r = this.record(), s = this.season(), f = this.field();
    if (!p || !r || !s || !f) return;
    const report = feedstockReport({ producer: p, field: f, season: s, record: r, enrollmentId: this.store.enrollmentIdOf(r), generatedAt: new Date() });
    if (report) await this.reports.download(report);
  }

  downloadLedger(): void {
    const p = this.producer(), r = this.record(), s = this.season(), f = this.field();
    if (!p || !r || !s || !f) return;
    const csv = ledgerCsv(p, [{ field: f, season: s, record: r, enrollmentId: this.store.enrollmentIdOf(r) }]);
    downloadCsv(csv, ledgerFileName(p.code, s.year, new Date()));
  }
}
