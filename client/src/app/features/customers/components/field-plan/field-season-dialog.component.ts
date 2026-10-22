import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule, NgComponentOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogComponent, DialogContentComponent, DialogDescriptionComponent, DialogFooterComponent, DialogHeaderComponent, DialogTitleComponent } from '@shared/components/dialog/dialog.component';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { FieldSeason, ProducerField } from '@models';
import { ProgramRegistry } from './programs/program-registry';
import { ProgramRecordMockService } from './programs/program-record-mock.service';
import { ProgramEnrollmentMockService } from './programs/program-enrollment-mock.service';
import { fsaKey } from './programs/program-enrollment';

/**
 * One field on one crop row: its name, FSA numbers and location, its acres this year, and the
 * sustainability programs it takes part in. Each program brings its own form (rendered from the
 * program registry) and shows the producer's enrollment ID for that program. Nobody finalizes here:
 * marking the enrollment's harvest complete does. Edits save as they are made.
 */
@Component({
  selector: 'app-field-season-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, NgComponentOutlet, ButtonComponent,
    DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent,
  ],
  templateUrl: './field-season-dialog.component.html',
  styleUrl: './field-plan.css',
})
export class FieldSeasonDialogComponent {
  readonly plan = inject(FieldPlanMockService);
  private readonly records = inject(ProgramRecordMockService);
  private readonly registry = inject(ProgramRegistry);
  private readonly enrollments = inject(ProgramEnrollmentMockService);

  readonly seasonId = input.required<string>();
  /** Opens straight onto this program, adding it to the field if it isn't there yet. */
  readonly startProgram = input<string | null>(null);
  readonly close = output<void>();

  readonly season = computed(() => this.plan.season(this.seasonId()));
  readonly field = computed(() => this.plan.field(this.season()?.fieldKey ?? ''));

  // ── Programs on this field ─────────────────────────────────────────────────
  readonly programRecords = computed(() =>
    this.records.forSeason(this.seasonId()).map(record => ({ record, def: this.registry.get(record.programKey)! })).filter(p => p.def));
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
  /** The producer's enrollment for the active program: incoming tickets are assigned its ID. */
  readonly enrollment = computed(() => {
    this.enrollments.enrollments();
    const a = this.active();
    return a ? this.records.enrollmentFor(a.record) : undefined;
  });
  readonly lockedBy = computed(() => {
    const a = this.active();
    return a ? this.enrollments.lockedBy(a.record.id) : undefined;
  });
  /** All three FSA numbers are in: the field can join its program enrollments. */
  readonly hasFsa = computed(() => {
    const f = this.field();
    return !!f && !!fsaKey(f);
  });
  /** A finalized program froze this season's acres and location, so they can't change under it. */
  readonly seasonLocked = computed(() => this.records.hasFinal(this.seasonId()));
  readonly intakeInputs = computed(() => {
    const a = this.active();
    const s = this.season();
    const f = this.field();
    return a && s && f ? { record: a.record, season: s, field: f, disabled: a.record.status === 'Final' } : null;
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
    effect(() => {
      const key = this.startProgram();
      if (key && this.season() && !this.records.find(this.seasonId(), key)) this.addProgram(key);
      else if (key) this.activeKey.set(key);
    });
  }

  saveSeason(): void {
    if (this.draftSeason && !this.seasonLocked()) {
      this.plan.updateSeason(this.draftSeason);
    }
  }

  saveField(): void {
    if (!this.draftField || this.seasonLocked()) return;
    this.plan.updateField(this.draftField);
    this.records.ensureEnrollments(this.draftField.fieldKey); // FSA numbers in: the enrollment ID can be issued
  }

  countiesFor(state: string): string[] {
    return this.plan.countiesByState[state] ?? [];
  }

  addProgram(key: string): void {
    if (this.records.add(this.seasonId(), key)) this.activeKey.set(key);
  }

  removeProgram(): void {
    const a = this.active();
    if (!a || a.record.status === 'Final') return;
    this.records.remove(a.record.id);
    this.activeKey.set(null);
  }

  // ── Reopen (the same for every program) ────────────────────────────────────
  showReopen = false;
  reopenReason = '';

  confirmReopen(): void {
    const a = this.active();
    if (!a || !this.reopenReason.trim()) return;
    this.records.reopen(a.record.id);
    this.showReopen = false;
    this.reopenReason = '';
  }
}
