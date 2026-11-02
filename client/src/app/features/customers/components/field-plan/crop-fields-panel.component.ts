import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldPlanStore } from './store/field-plan.store';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { CtrmSplitApiService } from '@core/services/ctrm-split-api.service';
import { CtrmSplit, Customer, FieldSeason, PlantingIntention } from '@models';
import { ProgramRegistry } from './programs/program-registry';
import { FieldSeasonDialogComponent } from './field-season-dialog.component';

/**
 * The split the add-field type-ahead text points at: its ID typed or picked ("TATOB43 · JARBOE WEST",
 * any case), or its exact field name. Undefined when it's none of the given splits.
 */
export function splitFromText(text: string, splits: readonly CtrmSplit[]): CtrmSplit | undefined {
  const t = text.trim().toUpperCase();
  if (!t) return undefined;
  const id = t.split(/[\s·]/)[0];
  return splits.find(s => s.splitId === id || s.fieldName.toUpperCase() === t);
}

/**
 * A split ID as CTRM writes customer codes: 1 to 7 letters or digits, upper-cased (e.g. "TATOB43").
 * Undefined when the text can't be one.
 */
export function splitIdFromText(text: string): string | undefined {
  const id = text.trim().toUpperCase().split(/[\s·]/)[0];
  return /^[A-Z0-9]{1,7}$/.test(id) ? id : undefined;
}

/**
 * The fields under one crop row. A field is one of the producer's CTRM split IDs, because tickets are
 * delivered under the split. SPLITS-GRAPHQL: until CTRM's splits query is live the ID, field name and
 * name are typed by hand (the share is taken as 100%) (the API's "manual" source); with it they're looked up. Its location is asked
 * for the first time it's used. The row's acres stay the total (what the
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
  readonly store = inject(FieldPlanStore);
  private readonly registry = inject(ProgramRegistry);
  private readonly fdCic = inject(FdCicApiService);
  private readonly ctrmSplits = inject(CtrmSplitApiService);

  readonly intention = input.required<PlantingIntention>();
  readonly customer = input.required<Customer>();
  readonly cropLabel = input.required<string>();
  /** Asks the table to open its Edit dialog with the total set to the field acres. */
  readonly updateTotal = output<number>();

  readonly expanded = signal(false);
  /** For the confirmed-CI CSV: the producer's CTRM code and name. */
  readonly producerForExport = computed(() => ({ code: this.customer().scoularId ?? '', name: this.customer().name }));
  /** The producer's fields are in from the backend (the planting table asks for them). */
  readonly loaded = computed(() => this.store.isLoaded(this.customer().id));
  readonly loadFailed = computed(() => this.store.loadFailed(this.customer().id));
  readonly seasons = computed(() => this.store.seasonsForIntention(this.intention().id));
  readonly inFields = computed(() => this.seasons().reduce((sum, s) => sum + (s.acres ?? 0), 0));
  readonly remaining = computed(() => this.intention().acres - this.inFields());

  /** Programs that apply to this crop row. */
  readonly programs = computed(() => this.registry.eligible(this.cropLabel()));
  /** One roll-up line per program with records on this row (45Z: the row's CI). */
  readonly summaries = computed(() => this.programs().flatMap(program => {
    const items = this.seasons().flatMap(season => {
      const record = this.store.find(season.id, program.key);
      const field = this.store.field(season.fieldKey);
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
    return this.store.field(s.fieldKey)?.name ?? 'Field';
  }

  /** "TATOB43 · Pratt, KS · 50%": the split ID, where it is, and the producer's share when not all of it. */
  fieldLine(s: FieldSeason): string {
    const f = this.store.field(s.fieldKey);
    if (!f) return '';
    return [f.splitId, `${f.county}, ${f.state}`, f.splitPercent < 100 ? `${+f.splitPercent.toFixed(3)}%` : ''].filter(Boolean).join(' · ');
  }

  /** The field's programs as chips: short label, then its score (45Z) or a program's own short text, and status. */
  chips(s: FieldSeason) {
    const field = this.store.field(s.fieldKey);
    return this.store.forSeason(s.id).flatMap(record => {
      const program = this.registry.get(record.programKey);
      if (!program || !field) return [];
      const score = record.frozen?.score ?? program.preview(record.data, s, field);
      const text = score ? null : (program.chipText?.(record.data) ?? program.previewNote?.(record.data, s, field) ?? null);
      return [{ programKey: program.key, label: program.shortLabel, status: record.status, score, text, enrollmentId: this.store.enrollmentIdOf(record) ?? '' }];
    });
  }

  /** Programs that apply to this crop and aren't on the field yet: the "Add program" menu. */
  addable(s: FieldSeason) {
    return this.programs().filter(p => !this.store.find(s.id, p.key));
  }

  /** The season whose "Add program" menu is open. */
  menuFor: string | null = null;

  addProgram(s: FieldSeason, programKey: string): void {
    this.menuFor = null;
    this.open(s, programKey);
  }

  /** A field with a locked program is locked: its acres are part of a frozen result. */
  locked(s: FieldSeason): boolean {
    return this.store.hasLocked(s.id);
  }

  setAcres(s: FieldSeason, value: number): void {
    if (this.locked(s)) return;
    this.store.updateSeason({ ...s, acres: Number(value) || 0 });
  }

  remove(s: FieldSeason): void {
    if (this.locked(s)) return;
    void this.store.removeSeason(s.id);
  }

  // ── Add a field: one of the producer's split IDs, looked up or (for now) typed ──
  newSplit = '';
  /** SPLITS-GRAPHQL: the field name typed for a split entered by hand (its share is taken as 100%). */
  newName = '';
  newState = 'KS';
  newCounty = '';
  newAcres: number | null = null;

  /** The producer's CTRM splits as they load. */
  readonly splits = computed(() => this.ctrmSplits.splitsFor(this.customer().id));
  readonly splitsError = computed(() => {
    const s = this.splits();
    return s.status === 'error' ? s.message : '';
  });
  /** The API is serving sample splits until the CTRM splits query is confirmed: say so. */
  readonly sampleSplits = computed(() => {
    const s = this.splits();
    return s.status === 'done' && s.source === 'sample';
  });
  /**
   * SPLITS-GRAPHQL: a split not in a CTRM list can be typed by hand, with its field name. True
   * unless the list really is CTRM's (then the server refuses anything not in it).
   */
  readonly manualAllowed = computed(() => {
    const s = this.splits();
    return s.status === 'done' && s.source !== 'ctrm';
  });

  /**
   * The type-ahead: the producer's splits, less expired ones and those already on this row. Bin-site
   * splits are listed (so nobody wonders where they went) but can't be added: a bin isn't a field.
   */
  readonly splitOptions = computed(() => {
    const state = this.splits();
    if (state.status !== 'done') return [];
    const used = new Set(this.seasons().map(s => s.fieldKey));
    return state.splits
      .filter(sp => !sp.expired && !used.has(sp.splitId))
      .map(split => ({
        split,
        value: `${split.splitId} · ${split.fieldName}`,
        label: split.kind === 'Bin' ? 'bin site, not a field' : `${+split.splitPercent.toFixed(3)}%`,
      }));
  });

  /** The split the type-ahead text points at: its ID typed or picked, or its exact field name. */
  get pickedSplit(): CtrmSplit | undefined {
    return splitFromText(this.newSplit, this.splitOptions().map(o => o.split));
  }

  /**
   * SPLITS-GRAPHQL: the split ID typed by hand when it isn't one of the listed splits (manual source only).
   * Undefined when the text isn't a split ID, or it's a listed split.
   */
  get typedSplitId(): string | undefined {
    if (this.pickedSplit || !this.manualAllowed()) return undefined;
    return splitIdFromText(this.newSplit);
  }

  /** The field being added: a listed split, or one typed by hand. */
  private get entrySplitId(): string | undefined {
    const sp = this.pickedSplit;
    return sp ? (sp.kind === 'Field' ? sp.splitId : undefined) : this.typedSplitId;
  }

  /** A split this producer hasn't used as a field yet: its location (and, typed by hand, its name) is asked for once. */
  get isNewField(): boolean {
    const id = this.entrySplitId;
    return !!id && !this.store.field(id);
  }

  /** A new field typed by hand: ask for its name too. */
  get isNewManualField(): boolean {
    return this.isNewField && !this.pickedSplit;
  }

  retrySplits(): void {
    this.ctrmSplits.retry(this.customer().id);
  }

  /** The add-field inputs are open. Closed, it's just an "Add field" button, to keep the row quiet. */
  readonly adding = signal(false);
  private readonly splitInput = viewChild<ElementRef<HTMLInputElement>>('splitInput');

  /** Opens the add-field inputs with fresh defaults and puts the cursor in the split look-up. */
  startAdd(): void {
    this.openAdd();
    this.adding.set(true);
    setTimeout(() => this.splitInput()?.nativeElement.focus());
  }

  cancelAdd(): void {
    this.adding.set(false);
  }

  openAdd(): void {
    // The producer's own state to start with; the county is picked from USDA's list for it.
    this.newState = this.customer().stateProvince || 'KS';
    this.newCounty = '';
    this.newSplit = '';
    this.newName = '';
    this.newAcres = this.remaining() > 0 ? this.remaining() : null;
  }

  /** Picking a split that's been a field before pre-fills its acres from last time, capped at what's left to place. */
  onSplitChange(): void {
    const id = this.entrySplitId;
    if (!id || !this.store.field(id)) return;
    const last = this.store.lastSeason(id, this.intention().plantingYear)?.acres ?? null;
    const left = this.remaining() > 0 ? this.remaining() : null;
    this.newAcres = last && left ? Math.min(last, left) : (last ?? left);
  }

  get canAdd(): boolean {
    return !!this.entrySplitId && (this.newAcres ?? 0) > 0 && (!this.isNewField || !!this.newCounty);
  }

  /** An add is being saved: the form stays open and its button waits. */
  readonly saving = signal(false);

  async add(): Promise<void> {
    const id = this.entrySplitId;
    if (!this.canAdd || !id || this.saving()) return;
    const sp = this.pickedSplit;
    this.saving.set(true);
    try {
      const field = this.store.field(id) ?? await this.store.createField(sp
        ? {
          splitId: sp.splitId, customerId: this.customer().id, name: sp.fieldName,
          splitPercent: sp.splitPercent, effectiveDate: sp.effectiveDate, state: this.newState, county: this.newCounty,
          splitSource: this.manualAllowed() ? 'Manual' : 'Ctrm',
        }
        : {
          // SPLITS-GRAPHQL: typed by hand until CTRM's splits query is live.
          splitId: id, customerId: this.customer().id, name: this.newName.trim() || id,
          splitPercent: 100, effectiveDate: '', state: this.newState, county: this.newCounty,
          splitSource: 'Manual',
        });
      if (!field) return; // the store has shown why; the form keeps what was typed
      const pi = this.intention();
      const season = await this.store.addSeason(field.fieldKey, pi.id, pi.plantingYear, this.cropLabel(), this.newAcres!);
      if (season) this.adding.set(false); // back to the button: one field at a time keeps the row quiet
    } finally {
      this.saving.set(false);
    }
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

}
