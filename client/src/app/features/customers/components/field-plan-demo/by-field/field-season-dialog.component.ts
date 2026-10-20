import { Component, computed, effect, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogComponent, DialogContentComponent, DialogDescriptionComponent, DialogFooterComponent, DialogHeaderComponent, DialogTitleComponent } from '@shared/components/dialog/dialog.component';
import { ByFieldMockService } from './by-field-mock.service';
import { CoverCrop, FALLOW, FieldSeason, ManureApplication, ProducerField, Tillage } from './model';
import { COVER_LABELS, TILLAGE_LABELS, estimateCi, fdCicCropFor, missingInputs } from '@shared/utils/ci-illustrative';
import { copiesAllPractices, practicesToCopy } from '@shared/utils/ci-copy-forward';
import { CiPreviewPanelComponent } from '../../field-plan/ci-preview-panel.component';
import { CiIntakeSectionsComponent } from '../../field-plan/ci-intake-sections.component';
import { cloneIntake } from '@shared/utils/ci-enrollment';
import { environment } from '@env/environment';

/**
 * One field in one crop year: the field's lasting details, this year's acres, and — for a crop the
 * USDA 45Z calculator scores — the practices and CI. Edits save as they are made; Finalize is the
 * only deliberate commit.
 */
@Component({
  selector: 'app-demo-byfield-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonComponent, CiPreviewPanelComponent, CiIntakeSectionsComponent,
    DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent,
  ],
  templateUrl: './field-season-dialog.component.html',
  styleUrl: '../../field-plan/field-plan.css',
})
export class ByFieldSeasonDialogComponent {
  readonly plan = inject(ByFieldMockService);
  readonly carbonIntensityEnabled = environment.carbonIntensityEnabled;

  readonly seasonId = input.required<string>();
  readonly tradeUnitOptions = input<string[]>([]);
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

  readonly season = computed(() => this.plan.season(this.seasonId()));
  readonly field = computed(() => this.plan.field(this.season()?.fieldKey ?? ''));
  /** The FD-CIC crop when this season is scored for 45Z, else null (fallow, wheat, flag off…). */
  readonly ciCrop = computed(() => {
    const s = this.season();
    if (!this.carbonIntensityEnabled || !s || s.crop === FALLOW) return null;
    return fdCicCropFor(s.cropLabel);
  });
  readonly result = computed(() => {
    const s = this.season();
    const crop = this.ciCrop();
    return s && crop ? estimateCi(crop, s) : null;
  });
  readonly isFinal = computed(() => this.season()?.status === 'Final');
  readonly prior = computed(() => {
    const s = this.season();
    return s ? this.plan.priorSeason(s.fieldKey, s.year) : undefined;
  });

  /** Editable copies; every change is written straight back. */
  draft: FieldSeason | null = null;
  draftField: ProducerField | null = null;
  showFieldMore = false;

  constructor() {
    effect(() => {
      const s = this.season();
      if (s?.id !== this.draft?.id || s?.status !== this.draft?.status) {
        this.draft = s ? { ...s, manure: s.manure.map(m => ({ ...m })), ...cloneIntake(s) } : null;
      }
      const f = this.field();
      if (f?.fieldKey !== this.draftField?.fieldKey) this.draftField = f ? { ...f } : null;
    });
  }

  missing(): string[] {
    return this.draft ? missingInputs(this.draft) : [];
  }

  saveSeason(): void {
    if (this.draft) this.plan.updateSeason(this.draft);
  }

  saveField(): void {
    if (this.draftField && this.draft) this.plan.updateField(this.draftField, this.draft.year);
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

  /** Last year's practices onto this year: everything for the same crop, tillage and cover only across crops. */
  copyPrior(): void {
    const prior = this.prior();
    const crop = this.ciCrop();
    const priorCrop = prior ? fdCicCropFor(prior.cropLabel) : null;
    if (!this.draft || !prior || !crop || this.isFinal()) return;
    Object.assign(this.draft, priorCrop
      ? practicesToCopy(prior, priorCrop, crop)
      : { tillage: prior.tillage, coverCrop: prior.coverCrop });
    this.saveSeason();
  }

  copyPriorLabel(): string {
    const prior = this.prior();
    const crop = this.ciCrop();
    const priorCrop = prior ? fdCicCropFor(prior.cropLabel) : null;
    if (!prior || !crop) return '';
    return priorCrop && copiesAllPractices(priorCrop, crop)
      ? `Copy ${prior.year} practices`
      : `Copy ${prior.year} tillage & cover (${prior.cropLabel})`;
  }

  // ── Finalize / reopen ──────────────────────────────────────────────────────
  showFinalize = false;
  finalizeYield: number | null = null;
  finalizeAttested = false;

  openFinalize(): void {
    this.finalizeYield = this.season()?.actualYield ?? null;
    this.finalizeAttested = false;
    this.showFinalize = true;
  }

  get finalizePreview() {
    const s = this.season();
    const crop = this.ciCrop();
    if (!s || !crop || !this.finalizeYield) return null;
    return estimateCi(crop, { ...s, actualYield: this.finalizeYield });
  }

  get canFinalize(): boolean {
    return !!this.finalizeYield && this.finalizeYield > 0 && this.finalizeAttested && !!this.result();
  }

  confirmFinalize(): void {
    const s = this.season();
    if (!s || !this.canFinalize) return;
    this.plan.finalizeSeason(s.id, this.finalizeYield!);
    this.showFinalize = false;
  }

  showReopen = false;
  reopenReason = '';

  confirmReopen(): void {
    const s = this.season();
    if (!s || !this.reopenReason.trim()) return;
    this.plan.reopenSeason(s.id);
    this.showReopen = false;
    this.reopenReason = '';
  }

  countiesFor(state: string): string[] {
    return this.plan.countiesByState[state] ?? [];
  }
}
