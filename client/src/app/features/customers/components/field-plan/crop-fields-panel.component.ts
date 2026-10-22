import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { Customer, FieldSeason, PlantingIntention } from '@models';
import { ProgramRegistry } from './programs/program-registry';
import { ProgramRecordMockService } from './programs/program-record-mock.service';
import { fsaKey } from './programs/program-enrollment';
import { FieldSeasonDialogComponent } from './field-season-dialog.component';

/**
 * The fields under one crop row. A field is a name plus its FSA farm/tract/field numbers, entered once
 * and picked by name after that. The row's acres stay the total (what the
 * dashboard counts); fields break it down. Adding a field pre-fills the acres not yet in a field, so a crop on one field needs
 * no extra typing. When the fields add up to more than the total, the row offers to update it — the
 * only way field data ever changes an intention, and it goes through the normal Edit dialog.
 *
 * Each field shows a chip per sustainability program it takes part in; the programs themselves come
 * from the program registry, so nothing here is specific to 45Z.
 */
@Component({
  selector: 'app-crop-fields-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldSeasonDialogComponent],
  templateUrl: './crop-fields-panel.component.html',
  styleUrl: './field-plan.css',
})
export class CropFieldsPanelComponent {
  readonly plan = inject(FieldPlanMockService);
  private readonly records = inject(ProgramRecordMockService);
  private readonly registry = inject(ProgramRegistry);
  private readonly fdCic = inject(FdCicApiService);

  readonly intention = input.required<PlantingIntention>();
  readonly customer = input.required<Customer>();
  readonly cropLabel = input.required<string>();
  /** Asks the table to open its Edit dialog with the total set to the field acres. */
  readonly updateTotal = output<number>();

  readonly expanded = signal(false);
  readonly seasons = computed(() => this.plan.seasonsForIntention(this.intention().id));
  readonly inFields = computed(() => this.seasons().reduce((sum, s) => sum + (s.acres ?? 0), 0));
  readonly remaining = computed(() => this.intention().acres - this.inFields());

  /** Programs that apply to this crop row. */
  readonly programs = computed(() => this.registry.eligible(this.cropLabel()));
  /** One roll-up line per program with records on this row (45Z: the row's CI). */
  readonly summaries = computed(() => this.programs().flatMap(program => {
    const items = this.seasons().flatMap(season => {
      const record = this.records.find(season.id, program.key);
      const field = this.plan.field(season.fieldKey);
      return record && field ? [{ season, record, field }] : [];
    });
    const summary = items.length && program.rowSummary ? program.rowSummary(items, this.intention()) : null;
    return summary ? [{ programKey: program.key, label: program.shortLabel, ...summary }] : [];
  }));

  /** Tells the table this crop row is the one being worked on, so it can highlight it. */
  readonly expandedChange = output<boolean>();

  toggle(): void {
    this.expanded.update(e => !e);
    this.expandedChange.emit(this.expanded());
    this.adding.set(false);
  }

  fieldName(s: FieldSeason): string {
    return this.plan.field(s.fieldKey)?.name ?? 'Field';
  }

  /** "FSA 1234/5678/3", or a prompt while any of the three is missing. */
  fieldFsa(s: FieldSeason): string {
    const f = this.plan.field(s.fieldKey);
    const fsa = f ? fsaKey(f) : '';
    return fsa ? `FSA ${fsa}` : 'FSA # needed';
  }

  fieldPlace(s: FieldSeason): string {
    const f = this.plan.field(s.fieldKey);
    return f ? `${f.county}, ${f.state}` : '';
  }

  /** The field's programs as chips: short label, then its score (45Z) or its own short text (GrainCraft), and status. */
  chips(s: FieldSeason) {
    const field = this.plan.field(s.fieldKey);
    return this.records.forSeason(s.id).flatMap(record => {
      const program = this.registry.get(record.programKey);
      if (!program || !field) return [];
      const score = record.frozen?.score ?? program.preview(record.data, s, field);
      const text = score ? null : (program.chipText?.(record.data) ?? program.previewNote?.(record.data, s, field) ?? null);
      return [{ programKey: program.key, label: program.shortLabel, status: record.status, score, text }];
    });
  }

  /** Programs that apply to this crop and aren't on the field yet: the "Add program" menu. */
  addable(s: FieldSeason) {
    return this.programs().filter(p => !this.records.find(s.id, p.key));
  }

  /** The season whose "Add program" menu is open. */
  menuFor: string | null = null;

  addProgram(s: FieldSeason, programKey: string): void {
    this.menuFor = null;
    this.open(s, programKey);
  }

  /** A field with a finalized program is locked: its acres are part of a frozen result. */
  locked(s: FieldSeason): boolean {
    return this.records.hasFinal(s.id);
  }

  setAcres(s: FieldSeason, value: number): void {
    if (this.locked(s)) return;
    this.plan.updateSeason({ ...s, acres: Number(value) || 0 });
  }

  remove(s: FieldSeason): void {
    if (this.locked(s)) return;
    this.records.removeForSeason(s.id);
    this.plan.removeSeason(s.id);
  }

  // ── Add a field: a name and its FSA numbers, or pick one of the producer's fields ─
  newName = '';
  newFsaFarm = '';
  newFsaTract = '';
  newFsaField = '';
  newState = 'KS';
  newCounty = '';
  newAcres: number | null = null;

  /** The producer's fields not already on this row, for the name type-ahead. */
  readonly pickable = computed(() => {
    const used = new Set(this.seasons().map(s => s.fieldKey));
    return this.plan.fieldsFor(this.customer().id).filter(f => !used.has(f.fieldKey));
  });

  private get _match() {
    const name = this.newName.trim().toLowerCase();
    return name ? this.pickable().find(f => f.name.toLowerCase() === name) : undefined;
  }

  /** A name that isn't one of the producer's fields: a new field, which needs its FSA numbers and location. */
  get isNewField(): boolean {
    return !!this.newName.trim() && !this._match;
  }

  /** The add-field inputs are open. Closed, it's just an "Add field" button, to keep the row quiet. */
  readonly adding = signal(false);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  /** Opens the add-field inputs with fresh defaults and puts the cursor in Field name. */
  startAdd(): void {
    this.openAdd();
    this.adding.set(true);
    setTimeout(() => this.nameInput()?.nativeElement.focus());
  }

  cancelAdd(): void {
    this.adding.set(false);
  }

  openAdd(): void {
    // The producer's own state to start with; the county is picked from USDA's list for it.
    this.newState = this.customer().stateProvince || 'KS';
    this.newCounty = '';
    this.newName = '';
    this.newFsaFarm = this.newFsaTract = this.newFsaField = '';
    this.newAcres = this.remaining() > 0 ? this.remaining() : null;
  }

  /** Picking a known field pre-fills its acres from last time, capped at what's left to place. */
  onNameChange(): void {
    const match = this._match;
    if (!match) return;
    const last = this.plan.lastSeason(match.fieldKey, this.intention().plantingYear)?.acres ?? null;
    const left = this.remaining() > 0 ? this.remaining() : null;
    this.newAcres = last && left ? Math.min(last, left) : (last ?? left);
  }

  get canAdd(): boolean {
    return !!this.newName.trim() && (this.newAcres ?? 0) > 0 && (!this.isNewField || !!this.newCounty);
  }

  add(): void {
    if (!this.canAdd) return;
    const field = this._match ?? this.plan.createField({
      customerId: this.customer().id, name: this.newName.trim(),
      fsaFarmNo: this.newFsaFarm.trim(), fsaTractNo: this.newFsaTract.trim(), fsaFieldNo: this.newFsaField.trim(),
      state: this.newState, county: this.newCounty,
    });
    const pi = this.intention();
    this.plan.addSeason(field.fieldKey, pi.id, pi.plantingYear, this.cropLabel(), this.newAcres!);
    this.adding.set(false); // back to the button: one field at a time keeps the row quiet
  }

  /** States and counties as USDA's FD-CIC county table names them, so a field's location can be scored. */
  states(): string[] {
    return this.fdCic.states();
  }

  countiesFor(state: string): string[] {
    return this.fdCic.counties(state);
  }

  openSeasonId: string | null = null;
  openProgram: string | null = null;

  /** Opens the field, optionally straight onto (or adding) one program. */
  open(s: FieldSeason, programKey: string | null = null): void {
    this.openSeasonId = s.id;
    this.openProgram = programKey;
  }

  absPct(fraction: number | undefined): number {
    return Math.abs(Math.round((fraction ?? 0) * 100));
  }
}
