import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogComponent, DialogContentComponent, DialogDescriptionComponent, DialogFooterComponent, DialogHeaderComponent, DialogTitleComponent } from '@shared/components/dialog/dialog.component';
import { BesideMockService, PriorPractices } from './beside-mock.service';
import { copiesAllPractices, practicesToCopy } from '@shared/utils/ci-copy-forward';
import { CoverCrop, Customer, FdCicCrop, FieldSeason, ManureApplication, PlantingIntention, ProducerField, Tillage } from './model';
import { COVER_LABELS, TILLAGE_LABELS, estimateCi, missingInputs, nationalAverage, seasonStatus, summarizeIntention } from '@shared/utils/ci-illustrative';
import { CiPreviewPanelComponent } from '../../field-plan/ci-preview-panel.component';
import { CiIntakeSectionsComponent } from '../../field-plan/ci-intake-sections.component';
import { cloneIntake, finalizeBlockers } from '@shared/utils/ci-enrollment';

/**
 * The "45Z Field Data" dialog for one planting intention: the producer's fields assigned to it
 * (left), one field's practices (middle) and that field's CI (right). Edits save as they are made,
 * so there is no Save button to forget; Finalize is the only deliberate commit.
 */
@Component({
  selector: 'app-demo-beside-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonComponent, CiPreviewPanelComponent, CiIntakeSectionsComponent,
    DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent,
  ],
  templateUrl: './ci-field-dialog.component.html',
  styles: [`
    .ci-input {
      display: block; width: 100%; margin-top: 0.25rem; padding: 0.5rem 0.75rem;
      border: 1px solid #d1d5db; border-radius: 0.375rem; background: #fff; color: #111827; font-size: 0.875rem;
    }
    .ci-input:focus { outline: 2px solid var(--color-scoular-green-accessible, #2e7d32); outline-offset: 0; }
    .ci-input:disabled { background: #f3f4f6; color: #6b7280; }
    .ci-input.ci-missing { border-color: #f59e0b; background: #fffbeb; }
    .ci-sample {
      display: inline-block; margin-left: 0.375rem; padding: 0 0.375rem; border-radius: 9999px; vertical-align: middle;
      font-size: 0.625rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
      background: #ede9fe; color: #5b21b6;
    }
    :host-context(.dark) .ci-sample { background: rgba(91, 33, 182, 0.35); color: #ddd6fe; }
    :host-context(.dark) .ci-input { border-color: #4b5563; background: #1f2937; color: #f9fafb; }
    :host-context(.dark) .ci-input:disabled { background: #111827; color: #9ca3af; }
    :host-context(.dark) .ci-input.ci-missing { border-color: #b45309; background: rgba(120, 53, 15, 0.25); }
  `],
})
export class BesideFieldDialogComponent {
  readonly ci = inject(BesideMockService);

  readonly isOpen = input(false);
  readonly customer = input.required<Customer>();
  readonly intention = input.required<PlantingIntention>();
  readonly cropLabel = input.required<string>();
  readonly crop = input.required<FdCicCrop>();
  readonly close = output<void>();

  readonly tillageOptions: { value: Tillage; label: string; help: string }[] = [
    { value: 'NoTill', label: TILLAGE_LABELS.NoTill, help: 'Planted straight into last year\'s residue. No tillage passes all year.' },
    { value: 'ReducedTill', label: TILLAGE_LABELS.ReducedTill, help: 'One or two light passes (vertical till, field cultivator). Most residue stays on top.' },
    { value: 'Conventional', label: TILLAGE_LABELS.Conventional, help: 'Chisel, disk or moldboard plow. Residue mostly turned under.' },
  ];
  readonly coverOptions: { value: CoverCrop; label: string; help: string }[] = [
    { value: 'None', label: COVER_LABELS.None, help: 'Nothing planted between cash crops.' },
    { value: 'CoverCrop', label: COVER_LABELS.CoverCrop, help: 'A cover (rye, oats, radish…) grown after harvest and not grazed.' },
    { value: 'CoverCropGrazed', label: COVER_LABELS.CoverCropGrazed, help: 'A cover crop that livestock grazed.' },
  ];
  readonly manureTypes: ManureApplication['type'][] = ['Beef', 'Dairy', 'Swine', 'Poultry'];

  readonly selectedSeasonId = signal<string | null>(null);
  /** Editable copies of the selected season and its field; every change is written straight back. */
  draft: FieldSeason | null = null;
  draftField: ProducerField | null = null;
  showFieldMore = false;
  showManure = false;

  readonly seasons = computed(() => this.ci.seasonsForIntention(this.intention().id));
  readonly selectedSeason = computed(() => this.seasons().find(s => s.id === this.selectedSeasonId()) ?? null);
  readonly selectedField = computed(() => this.fieldFor(this.selectedSeason()?.fieldKey));
  readonly selectedResult = computed(() => {
    const s = this.selectedSeason();
    return s ? estimateCi(this.crop(), s) : null;
  });
  readonly summary = computed(() => summarizeIntention(this.crop(), this.intention(), this.seasons()));
  readonly unassignedAcres = computed(() => this.intention().acres - this.summary().assignedAcres);
  readonly national = computed(() => nationalAverage(this.crop()));
  readonly isFinal = computed(() => this.selectedSeason()?.status === 'Final');

  constructor() {
    // On open, seed the producer and select the first field; keep the drafts in step with the selection.
    effect(() => {
      if (!this.isOpen()) return;
      this.ci.ensureLoaded(this.customer().id, this.customer().stateProvince);
      const first = this.ci.seasonsForIntention(this.intention().id)[0];
      if (!this.selectedSeasonId() && first) this.selectedSeasonId.set(first.id);
    });
    effect(() => {
      const s = this.selectedSeason();
      // Re-copy only when the selection changes, not on every save, so typing isn't interrupted.
      if (s?.id !== this.draft?.id) {
        this.draft = s ? { ...s, manure: s.manure.map(m => ({ ...m })), ...cloneIntake(s) } : null;
        this.showManure = (s?.manure.length ?? 0) > 0;
        this.showFieldMore = false;
      }
      const f = this.selectedField();
      if (f?.fieldKey !== this.draftField?.fieldKey) this.draftField = f ? { ...f } : null;
    });
  }

  fieldFor(fieldKey: string | undefined): ProducerField | undefined {
    return fieldKey ? this.ci.fields().find(f => f.fieldKey === fieldKey) : undefined;
  }

  seasonCi(season: FieldSeason): number | null {
    return estimateCi(this.crop(), season)?.ciGPerBu ?? null;
  }

  seasonMissing(season: FieldSeason): string[] {
    return missingInputs(season);
  }

  statusOf(season: FieldSeason) {
    return seasonStatus(season);
  }

  /** Fields still missing inputs, for the footer's "jump to" links. */
  readonly incomplete = computed(() => this.seasons()
    .filter(s => s.status !== 'Final')
    .map(s => ({ season: s, name: this.fieldFor(s.fieldKey)?.name ?? 'Field', missing: missingInputs(s) }))
    .filter(x => x.missing.length > 0));

  select(seasonId: string): void {
    this.selectedSeasonId.set(seasonId);
  }

  // ── Editing ────────────────────────────────────────────────────────────
  saveSeason(): void {
    if (this.draft) this.ci.updateSeason(this.draft);
  }

  saveField(): void {
    if (this.draftField) this.ci.updateField(this.draftField);
  }

  setTillage(value: Tillage): void {
    if (!this.draft || this.isFinal()) return;
    this.draft.tillage = value;
    this.saveSeason();
  }

  setCover(value: CoverCrop): void {
    if (!this.draft || this.isFinal()) return;
    this.draft.coverCrop = value;
    this.saveSeason();
  }

  addManure(): void {
    if (!this.draft || this.draft.manure.length >= 3) return;
    this.draft.manure.push({ type: 'Swine', form: 'Liquid', amount: null, nContent: null });
    this.showManure = true;
    this.saveSeason();
  }

  removeManure(index: number): void {
    this.draft?.manure.splice(index, 1);
    this.saveSeason();
  }

  manureAmountUnit(m: ManureApplication): string {
    return m.form === 'Solid' ? 'tons/ac' : '1,000 gal/ac';
  }

  manureNUnit(m: ManureApplication): string {
    return m.form === 'Solid' ? 'lbs N/ton' : 'lbs N/1,000 gal';
  }

  get priorForSelected() {
    const s = this.selectedSeason();
    return s ? this.ci.priorPractices(s.fieldKey) : undefined;
  }

  copyPrior(): void {
    const prior = this.priorForSelected;
    if (!this.draft || !prior || this.isFinal()) return;
    Object.assign(this.draft, practicesToCopy(prior.season, prior.crop, this.crop()));
    this.showManure = this.draft.manure.length > 0;
    this.saveSeason();
  }

  /** "Copies 2025 practices (Corn)", or for a crop change, only what carries across. */
  copyLabel(prior: PriorPractices): string {
    return copiesAllPractices(prior.crop, this.crop())
      ? `Copies ${prior.year} practices (${prior.cropLabel})`
      : `Copies ${prior.year} tillage & cover crop only (was ${prior.cropLabel})`;
  }

  // ── Apply to other fields ─────────────────────────────────────────────────
  showApply = false;
  applyTargets = new Set<string>();

  openApply(): void {
    this.applyTargets = new Set();
    this.showApply = true;
  }

  toggleApplyTarget(seasonId: string): void {
    this.applyTargets.has(seasonId) ? this.applyTargets.delete(seasonId) : this.applyTargets.add(seasonId);
  }

  applyPractices(): void {
    const from = this.draft;
    if (!from) return;
    for (const s of this.seasons()) {
      if (!this.applyTargets.has(s.id) || s.status === 'Final') continue;
      this.ci.updateSeason({
        ...s,
        syntheticN: from.syntheticN, niFraction: from.niFraction, tillage: from.tillage,
        coverCrop: from.coverCrop, manure: from.manure.map(m => ({ ...m })),
        // Inputs, not records: each field keeps its own evidence.
        nApplications: from.nApplications.map(a => ({ ...a })), noNApplied: from.noNApplied,
        phosphateLbs: from.phosphateLbs, potashLbs: from.potashLbs, limeTons: from.limeTons, energy: { ...from.energy },
      });
    }
    this.showApply = false;
  }

  // ── Add field ───────────────────────────────────────────────────────────
  showAddField = false;
  addPick: string | null = null;
  newField = { name: '', state: '', county: '', acres: null as number | null, fsaFarmNo: '', fsaTractNo: '', fsaFieldNo: '' };
  showNewFieldMore = false;

  /** The producer's fields not yet on this intention. */
  readonly availableFields = computed(() => {
    const used = new Set(this.seasons().map(s => s.fieldKey));
    return this.ci.fieldsFor(this.customer().id).filter(f => !used.has(f.fieldKey));
  });

  openAddField(): void {
    this.addPick = null;
    this.newField = { name: '', state: this.customer().stateProvince && this.ci.countiesByState[this.customer().stateProvince!] ? this.customer().stateProvince! : 'KS', county: '', acres: null, fsaFarmNo: '', fsaTractNo: '', fsaFieldNo: '' };
    this.showNewFieldMore = false;
    this.showAddField = true;
  }

  get canAddField(): boolean {
    if (this.addPick) return true;
    return !!this.newField.name.trim() && !!this.newField.county && (this.newField.acres ?? 0) > 0;
  }

  confirmAddField(): void {
    if (!this.canAddField) return;
    let fieldKey = this.addPick;
    if (!fieldKey) {
      fieldKey = this.ci.createField({
        customerId: this.customer().id,
        name: this.newField.name.trim(),
        state: this.newField.state,
        county: this.newField.county,
        acres: this.newField.acres!,
        fsaFarmNo: this.newField.fsaFarmNo || undefined,
        fsaTractNo: this.newField.fsaTractNo || undefined,
        fsaFieldNo: this.newField.fsaFieldNo || undefined,
      }).fieldKey;
    }
    const season = this.ci.addSeason(fieldKey, this.intention().id, this.crop(), !!this.addPick);
    this.selectedSeasonId.set(season.id);
    this.showAddField = false;
  }

  removeSelected(): void {
    const s = this.selectedSeason();
    if (!s || s.status === 'Final') return;
    this.ci.removeSeason(s.id);
    this.selectedSeasonId.set(this.seasons()[0]?.id ?? null);
  }

  // ── Finalize / reopen ──────────────────────────────────────────────────────
  showFinalize = false;
  finalizeYield: number | null = null;
  finalizeAttested = false;

  openFinalize(): void {
    this.finalizeYield = this.selectedSeason()?.actualYield ?? null;
    this.finalizeAttested = false;
    this.showFinalize = true;
  }

  get finalizePreview() {
    const s = this.selectedSeason();
    if (!s || !this.finalizeYield) return null;
    return estimateCi(this.crop(), { ...s, actualYield: this.finalizeYield });
  }

  /** What the audit still needs before this field can be finalized (see finalizeBlockers). */
  get finalizeBlockerList(): string[] {
    const s = this.selectedSeason();
    return s && this.draftField ? finalizeBlockers(s, this.draftField, this.finalizeYield) : [];
  }

  get canFinalize(): boolean {
    return !!this.finalizeYield && this.finalizeYield > 0 && this.finalizeAttested && !!this.selectedResult() && this.finalizeBlockerList.length === 0;
  }

  confirmFinalize(): void {
    const s = this.selectedSeason();
    if (!s || !this.canFinalize) return;
    this.ci.finalizeSeason(s.id, this.finalizeYield!, this.finalizePreview!.ciGPerBu);
    this.draft = null; // force a fresh copy of the now-locked season
    this.showFinalize = false;
  }

  showReopen = false;
  reopenReason = '';

  confirmReopen(): void {
    const s = this.selectedSeason();
    if (!s || !this.reopenReason.trim()) return;
    this.ci.reopenSeason(s.id);
    this.draft = null; // force a fresh copy of the now-editable season
    this.showReopen = false;
    this.reopenReason = '';
  }

  // ── Prototype only ───────────────────────────────────────────────────────
  showClearAll = false;

  confirmClearAll(): void {
    this.ci.clearAll();
    this.selectedSeasonId.set(null);
    this.draft = null;
    this.draftField = null;
    this.showClearAll = false;
  }

  countiesFor(state: string): string[] {
    return this.ci.countiesByState[state] ?? [];
  }

  pct(fraction: number | null): string {
    if (fraction === null) return '';
    const p = Math.round(fraction * 100);
    return `${p < 0 ? '▼' : '▲'}${Math.abs(p)}%`;
  }
}
