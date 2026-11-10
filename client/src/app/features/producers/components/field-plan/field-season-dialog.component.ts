import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule, NgComponentOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogComponent, DialogContentComponent, DialogDescriptionComponent, DialogFooterComponent, DialogHeaderComponent, DialogTitleComponent } from '@shared/components/dialog/dialog.component';
import { FieldPlanStore } from './store/field-plan.store';
import { FdCicApiService } from '../../data-access/fd-cic-api.service';
import { ToastService } from '@core/services/toast.service';
import { PermissionService } from '@core/access/permission.service';
import { FieldProgramRecord, FieldSeason, OFFICIAL_STATUS_TEXT, ProducerField } from '@models';
import { ProgramRegistry } from './programs/program-registry';
import { FD_CIC_PROGRAM_KEY } from './programs/fd-cic/fd-cic.program';
import { FdCicReviewComponent } from './programs/fd-cic/fd-cic-review.component';
import { feedstockReport } from './programs/fd-cic/feedstock-report';
import { FeedstockReportService } from './programs/fd-cic/feedstock-report.service';

/**
 * One field on one crop row: its CTRM split (ID, name, split %) and location, its acres this year, and the
 * sustainability programs it takes part in. Each program brings its own form (rendered from the
 * program registry) and shows the producer's enrollment ID for that program. A 45Z field is locked by
 * confirming it in the review after harvest. Edits save as they are made. A user who may not change field plans
 * sees it all read-only.
 */
@Component({
  selector: 'app-field-season-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, NgComponentOutlet, ButtonComponent, FdCicReviewComponent,
    DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent,
  ],
  templateUrl: './field-season-dialog.component.html',
  styleUrl: './field-plan.css',
})
export class FieldSeasonDialogComponent {
  readonly store = inject(FieldPlanStore);
  private readonly registry = inject(ProgramRegistry);
  private readonly fdCic = inject(FdCicApiService);
  private readonly toast = inject(ToastService);
  private readonly reports = inject(FeedstockReportService);
  private readonly permissions = inject(PermissionService);
  /** Changing the field, its programs and their inputs is for a user who may change field plans. */
  readonly canEdit = computed(() => this.permissions.has('field-plans:write'));

  readonly seasonId = input.required<string>();
  /** Opens straight onto this program, adding it to the field if it isn't there yet. */
  readonly startProgram = input<string | null>(null);
  readonly close = output<void>();
  /** The producer's CTRM code and name, for the Biofuel Feedstock Report and the Mass Balance Ledger. */
  readonly producer = input<{ code: string; name: string; primaryContact?: string | null } | null>(null);
  /** The 45Z review open over this dialog, by record id. */
  readonly reviewRecordId = signal<string | null>(null);
  readonly fdCicKey = FD_CIC_PROGRAM_KEY;

  /** A confirmed 45Z field's Biofuel Feedstock Report, as a PDF. */
  async generateReport(record: FieldProgramRecord): Promise<void> {
    const producer = this.producer(), season = this.season(), field = this.field();
    if (!producer || !season || !field) return;
    const report = feedstockReport({ producer, field, season, record, enrollmentId: this.store.enrollmentIdOf(record), generatedAt: new Date() });
    if (report) await this.reports.download(report);
  }

  readonly season = computed(() => this.store.season(this.seasonId()));
  readonly field = computed(() => this.store.field(this.season()?.fieldKey ?? ''));

  // ── Programs on this field ─────────────────────────────────────────────────
  readonly programRecords = computed(() =>
    this.store.forSeason(this.seasonId()).map(record => ({ record, def: this.registry.get(record.programKey)! })).filter(p => p.def));
  /** Programs that apply to this crop and aren't on the field yet. */
  readonly addable = computed(() => {
    const s = this.season();
    const added = new Set(this.programRecords().map(p => p.record.programKey));
    return s ? this.registry.eligible(s.cropLabel).filter(d => !added.has(d.key)) : [];
  });
  readonly activeKey = signal<string | null>(null);
  readonly active = computed(() => {
    const all = this.programRecords();
    return all.find(p => p.record.programKey === this.activeKey()) ?? (all.length ? all[0] : null);
  });
  /** The active program's enrollment ID for this field, derived from its split ID and the crop year. */
  readonly enrollmentId = computed(() => {
    const a = this.active();
    return a ? this.store.enrollmentIdOf(a.record) ?? '' : '';
  });
  /** A locked program froze this season's acres and location, so they can't change under it. */
  readonly seasonLocked = computed(() => this.store.hasLocked(this.seasonId()));
  /** The field's location and acres can't change: a locked program froze them, or the user may not change field plans. */
  readonly fieldReadOnly = computed(() => this.seasonLocked() || !this.canEdit());
  readonly intakeInputs = computed(() => {
    const a = this.active();
    const s = this.season();
    const f = this.field();
    return a && s && f ? { record: a.record, season: s, field: f, disabled: a.record.status === 'Locked' || !this.canEdit() } : null;
  });

  /** Editable copies of the generic parts; every change is written straight back. */
  draftSeason: FieldSeason | null = null;
  draftField: ProducerField | null = null;

  constructor() {
    effect(() => {
      const s = this.season();
      if (s?.id !== this.draftSeason?.id) this.draftSeason = s ? { ...s } : null;
      const f = this.field();
      if (f?.fieldKey !== this.draftField?.fieldKey) this.draftField = f ? { ...f } : null;
    });
    // Open on startProgram once per season. Reading the store here would re-run this on every record
    // change, so removing that program put it straight back (audit 2026-11-05) — hence untracked, and
    // the season+program it was applied to is remembered.
    effect(() => {
      const key = this.startProgram();
      const season = this.season();
      if (!key) return;
      if (!season) { this.activeKey.set(key); return; }
      const applied = `${season.id}|${key}`;
      if (applied === this._startApplied) return;
      this._startApplied = applied;
      untracked(() => {
        if (this.store.find(this.seasonId(), key)) this.activeKey.set(key);
        else this.addProgram(key);
      });
    });
  }

  private _startApplied: string | null = null;

  saveSeason(): void {
    if (this.draftSeason && !this.fieldReadOnly()) {
      this.store.updateSeason(this.draftSeason);
    }
  }

  saveField(): void {
    if (!this.draftField || this.fieldReadOnly()) return;
    // A share typed by hand must be a real share; the API refuses anything else.
    const share = this.draftField.splitPercent;
    if (!(share > 0 && share <= 100)) return;
    this.store.updateField(this.draftField);
  }

  /** States and counties as USDA's FD-CIC county table names them, so a field's location can be scored. */
  states(): string[] {
    return this.fdCic.states();
  }

  countiesFor(state: string): string[] {
    return this.fdCic.counties(state);
  }

  async addProgram(key: string): Promise<void> {
    // Opening the dialog on a program the field hasn't got adds it, so the check is here as well as in the template.
    if (!this.canEdit()) return;
    if (await this.store.addRecord(this.seasonId(), key)) this.activeKey.set(key);
  }

  async removeProgram(): Promise<void> {
    const a = this.active();
    if (!a || a.record.status === 'Locked') return;
    await this.store.removeRecord(a.record.id);
    this.activeKey.set(null);
  }

  // ── Copy inputs from / to the producer's other fields this year ────────────
  /** Other fields whose inputs for the active program can be copied onto this one. */
  readonly copySources = computed(() => {
    const a = this.active();
    return a && a.record.status !== 'Locked' ? this.store.copySources(this.seasonId(), a.record.programKey) : [];
  });
  /** Other fields this field's inputs for the active program can be copied onto. */
  readonly copyTargets = computed(() => {
    const a = this.active();
    return a && a.record.status !== 'Locked' ? this.store.copyTargets(a.record.id) : [];
  });
  /** The source picked in "Copy from", waiting for the replace confirmation. Signals: the dialog sits under an OnPush table. */
  readonly pendingCopyFrom = signal<string | null>(null);
  readonly showCopyTo = signal(false);
  readonly copyToPicked = signal<ReadonlySet<string>>(new Set());
  readonly copying = signal(false);

  /** Picking a source copies at once onto a field with no inputs yet, and asks first otherwise. */
  pickCopySource(recordId: string): void {
    const a = this.active();
    if (!a || !recordId) return;
    const def = this.registry.get(a.record.programKey);
    const hasInputs = !!def && JSON.stringify(a.record.data) !== JSON.stringify(def.blankData());
    if (hasInputs) this.pendingCopyFrom.set(recordId);
    else void this.copyFrom(recordId);
  }

  async copyFrom(recordId: string): Promise<void> {
    this.pendingCopyFrom.set(null);
    this.copying.set(true);
    try {
      const { copied } = await this.store.copyInputs(recordId, [this.seasonId()]);
      if (copied) this.toast.success('Inputs copied. Edit what\'s different.');
    } finally {
      this.copying.set(false);
    }
  }

  toggleCopyTo(seasonId: string): void {
    this.copyToPicked.update(set => {
      const next = new Set(set);
      if (next.has(seasonId)) next.delete(seasonId);
      else next.add(seasonId);
      return next;
    });
  }

  async copyTo(): Promise<void> {
    const a = this.active();
    const picked = [...this.copyToPicked()];
    if (!a || !picked.length) return;
    this.copying.set(true);
    try {
      const { copied, skipped } = await this.store.copyInputs(a.record.id, picked);
      if (copied) this.toast.success(`Copied to ${copied} field${copied === 1 ? '' : 's'}${skipped ? `; ${skipped} skipped` : ''}.`);
      this.showCopyTo.set(false);
      this.copyToPicked.set(new Set());
    } finally {
      this.copying.set(false);
    }
  }

  /** A 45Z field can be reviewed with its tickets once it has an estimated CI (or a locked one). */
  canReview(record: FieldProgramRecord): boolean {
    if (record.programKey !== FD_CIC_PROGRAM_KEY) return false;
    if (record.frozen?.score) return true;
    const def = this.registry.get(record.programKey), season = this.season(), field = this.field();
    return !!def && !!season && !!field && def.preview(record.data, season, field) !== null;
  }

  officialStatus(record: FieldProgramRecord): string {
    return OFFICIAL_STATUS_TEXT[record.official?.status ?? 'NotStarted'];
  }

  // ── Unlock a confirmed CI (the same for every program) ──────────
  showReopen = false;
  reopenReason = '';

  async confirmReopen(): Promise<void> {
    const a = this.active();
    if (!a || !this.reopenReason.trim()) return;
    // Closed before the save: this view sits under an OnPush table, so only signals redraw after an await.
    // If the backend refuses, the store says why.
    const reason = this.reopenReason;
    this.showReopen = false;
    this.reopenReason = '';
    await this.store.reopen(a.record.id, reason);
  }
}
