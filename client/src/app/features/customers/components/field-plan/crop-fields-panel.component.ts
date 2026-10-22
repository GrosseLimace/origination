import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { CtrmSplitMockService } from '@core/services/ctrm-split-mock.service';
import { CtrmSplit, Customer, FieldSeason, PlantingIntention } from '@models';
import { ProgramRegistry } from './programs/program-registry';
import { ProgramRecordMockService } from './programs/program-record-mock.service';
import { FieldSeasonDialogComponent } from './field-season-dialog.component';

/**
 * The fields under one crop row. A field is one of the producer's CTRM split IDs, looked up rather than
 * typed, because tickets are delivered under the split. The row's acres stay the total (what the
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
  private readonly ctrmSplits = inject(CtrmSplitMockService);

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
      return record ? [{ season, record }] : [];
    });
    const text = items.length && program.rowSummary ? program.rowSummary(items, this.intention()) : null;
    return text ? [{ programKey: program.key, label: program.shortLabel, text }] : [];
  }));

  toggle(): void {
    this.expanded.update(e => !e);
  }

  fieldName(s: FieldSeason): string {
    return this.plan.field(s.fieldKey)?.name ?? 'Field';
  }

  fieldPlace(s: FieldSeason): string {
    const f = this.plan.field(s.fieldKey);
    return f ? `${f.county}, ${f.state}` : '';
  }

  /** The field's programs as chips: short label, score and status. */
  chips(s: FieldSeason) {
    const field = this.plan.field(s.fieldKey);
    return this.records.forSeason(s.id).flatMap(record => {
      const program = this.registry.get(record.programKey);
      if (!program || !field) return [];
      const score = record.frozen?.score ?? program.preview(record.data, s, field);
      return [{ programKey: program.key, label: program.shortLabel, status: record.status, score }];
    });
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

  // ── Add a field: look up one of the producer's CTRM split IDs ───────────────
  newSplit = '';
  newState = 'KS';
  newCounty = '';
  newAcres: number | null = null;

  /**
   * The producer's CTRM splits for the type-ahead: expired splits and splits already on this row are
   * left out. Bin-site splits are listed (so nobody wonders where they went) but can't be added.
   */
  readonly splitOptions = computed(() => {
    const used = new Set(this.seasons().map(s => s.fieldKey));
    return this.ctrmSplits.splitsFor(this.customer())
      .filter(sp => !sp.expired && !used.has(sp.splitId))
      .map(split => ({
        split,
        label: split.kind === 'Bin'
          ? `${split.splitId} · ${split.fieldName} · bin site, not a field`
          : `${split.splitId} · ${split.fieldName} · ${split.splitPercent}%`,
      }));
  });

  /** The split the type-ahead text points at: its ID typed or picked, or its exact field name. */
  get pickedSplit(): CtrmSplit | undefined {
    const text = this.newSplit.trim().toUpperCase();
    if (!text) return undefined;
    const id = text.split(/[\s·]/)[0];
    return this.splitOptions().find(o => o.split.splitId === id || o.split.fieldName === text)?.split;
  }

  /** A split this producer hasn't used as a field before: ask for its location once. */
  get isNewField(): boolean {
    const sp = this.pickedSplit;
    return !!sp && sp.kind === 'Field' && !this.plan.field(sp.splitId);
  }

  openAdd(): void {
    const st = this.customer().stateProvince;
    this.newState = st && this.plan.countiesByState[st] ? st : 'KS';
    this.newCounty = this.plan.countiesByState[this.newState][0];
    this.newSplit = '';
    this.newAcres = this.remaining() > 0 ? this.remaining() : null;
  }

  /** Picking a field used before pre-fills its acres from last time, capped at what's left to place. */
  onSplitChange(): void {
    const sp = this.pickedSplit;
    if (!sp || !this.plan.field(sp.splitId)) return;
    const last = this.plan.lastSeason(sp.splitId, this.intention().plantingYear)?.acres ?? null;
    const left = this.remaining() > 0 ? this.remaining() : null;
    this.newAcres = last && left ? Math.min(last, left) : (last ?? left);
  }

  get canAdd(): boolean {
    const sp = this.pickedSplit;
    return !!sp && sp.kind === 'Field' && (this.newAcres ?? 0) > 0 && (!this.isNewField || !!this.newCounty);
  }

  add(): void {
    const sp = this.pickedSplit;
    if (!this.canAdd || !sp) return;
    const field = this.plan.field(sp.splitId) ?? this.plan.createField({
      splitId: sp.splitId, customerId: this.customer().id, name: sp.fieldName,
      splitPercent: sp.splitPercent, effectiveDate: sp.effectiveDate, state: this.newState, county: this.newCounty,
    });
    const pi = this.intention();
    this.plan.addSeason(field.fieldKey, pi.id, pi.plantingYear, this.cropLabel(), this.newAcres!);
    this.openAdd(); // ready for the next field
  }

  countiesFor(state: string): string[] {
    return this.plan.countiesByState[state] ?? [];
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
