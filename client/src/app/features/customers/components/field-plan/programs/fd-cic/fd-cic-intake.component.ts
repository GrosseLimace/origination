import { Component, computed, effect, inject, input, linkedSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CoverCrop, FdCicComponentPart, FdCicData, FieldProgramRecord, FieldSeason, ManureApplication, ManureForm, ManureType, ProducerField, Tillage } from '@models';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { CiPreviewPanelComponent } from '../../ci-preview-panel.component';
import { ProgramIntake } from '../program-def';
import { FieldPlanStore } from '../../store/field-plan.store';
import { COVER_LABELS, MANURE_OPTIONS, TILLAGE_LABELS, fdCicScoreState, missingInputs } from './fd-cic.data';

const cloneData = (d: FdCicData): FdCicData => ({ ...d, manure: d.manure.map(m => ({ ...m })) });

/**
 * The 45Z inputs for one field, in the order and wording of the USDA FD-CIC v1.2 "Crop Inputs" tab.
 * State, county and acres come from the field, so they are not asked again; the workbook's defaults
 * are preselected, so expected yield and total N are all a field needs to score. Edits save as they
 * are made, and the USDA score beside the form follows every change.
 */
@Component({
  selector: 'app-fd-cic-intake',
  standalone: true,
  imports: [CommonModule, FormsModule, CiPreviewPanelComponent],
  templateUrl: './fd-cic-intake.component.html',
  styleUrl: '../../field-plan.css',
})
export class FdCicIntakeComponent implements ProgramIntake {
  private readonly store = inject(FieldPlanStore);
  private readonly api = inject(FdCicApiService);

  readonly record = input.required<FieldProgramRecord>();
  readonly season = input.required<FieldSeason>();
  readonly field = input.required<ProducerField>();
  readonly disabled = input(false);

  readonly coverOptions: { value: CoverCrop; label: string; help: string }[] = [
    { value: 'CoverCrop', label: COVER_LABELS.CoverCrop, help: 'Rye, oats, radish… grown and not grazed.' },
    { value: 'CoverCropGrazed', label: COVER_LABELS.CoverCropGrazed, help: 'A cover crop that livestock grazed.' },
    { value: 'None', label: COVER_LABELS.None, help: 'Nothing planted between cash crops.' },
  ];
  readonly tillageOptions: { value: Tillage; label: string; help: string }[] = [
    { value: 'ReducedTill', label: TILLAGE_LABELS.ReducedTill, help: 'STIR under 80 in USDA T-DISC.' },
    { value: 'NoTill', label: TILLAGE_LABELS.NoTill, help: 'STIR under 20 in USDA T-DISC.' },
    { value: 'NoneOfTheAbove', label: TILLAGE_LABELS.NoneOfTheAbove, help: 'Conventional tillage, or not known.' },
  ];
  readonly manureOptions = MANURE_OPTIONS;

  /**
   * Editable copy of the stored data; every change is written straight back. Taken again whenever the stored
   * data stops matching it (another record, inputs copied in, a reload after a failed save), so a keystroke
   * never writes an old draft over newer data.
   */
  draft: FdCicData | null = null;

  readonly stored = computed(() => this.record().data as FdCicData);
  /** The USDA score from the API for what's saved; it follows every edit. */
  readonly scoreState = computed(() => fdCicScoreState(this.api, this.stored(), this.season(), this.field()));
  readonly missing = computed(() => {
    const missing = missingInputs(this.stored(), this.season());
    return this.field().county ? missing : ['the field\'s county (above)', ...missing];
  });
  readonly isLocked = computed(() => this.record().status === 'Locked');

  /** The latest score's component breakdown, kept while the next one is calculated. */
  private readonly breakdown = linkedSignal<ReturnType<typeof this.scoreState>, FdCicComponentPart[]>({
    source: this.scoreState,
    computation: (state, previous) => (state?.status === 'done' ? state.score.breakdown : previous?.value ?? []),
  });

  /**
   * "Affects soil carbon, field N₂O, on-farm energy": the components an input feeds, from the calculator's
   * own breakdown for this version, so the form and the score panel always agree. Empty before a score.
   */
  affects(driver: string): string {
    const labels = this.breakdown()
      .filter(b => b.drivers.includes(driver))
      .map(b => b.label.replace(/, (direct|indirect)$/, ''));
    const unique = [...new Set(labels)];
    return unique.length ? `Affects ${unique.map(l => l.charAt(0).toLowerCase() + l.slice(1)).join(', ')}.` : '';
  }

  constructor() {
    effect(() => {
      const data = this.record().data as FdCicData;
      if (JSON.stringify(data) !== JSON.stringify(this.draft)) this.draft = cloneData(data);
    });
  }

  save(): void {
    if (!this.draft || this.disabled()) return;
    this.store.updateRecord(this.record().id, cloneData(this.draft));
  }

  get niPercent(): number {
    return Math.round((this.draft?.niFraction ?? 0) * 100);
  }
  set niPercent(value: number) {
    if (!this.draft) return;
    this.draft.niFraction = Math.min(Math.max(Number(value) || 0, 0), 100) / 100;
    this.save();
  }

  setCover(value: CoverCrop): void {
    if (!this.draft || this.disabled()) return;
    this.draft.coverCrop = value;
    this.save();
  }

  setTillage(value: Tillage): void {
    if (!this.draft || this.disabled()) return;
    this.draft.tillage = value;
    this.save();
  }

  // ── Manure: up to 3, as in the workbook ────────────────────────────────────
  manureValue(m: ManureApplication): string {
    return `${m.type}|${m.form}`;
  }

  setManureType(m: ManureApplication, value: string): void {
    const [type, form] = value.split('|') as [ManureType, ManureForm];
    m.type = type;
    m.form = form;
    this.save();
  }

  addManure(): void {
    if (!this.draft || this.draft.manure.length >= 3) return;
    this.draft.manure.push({ type: 'Swine', form: 'Liquid', amount: null, nContent: null });
    this.save();
  }

  removeManure(index: number): void {
    this.draft?.manure.splice(index, 1);
    this.save();
  }

  amountUnit(m: ManureApplication): string {
    return m.form === 'Solid' ? 'tons/ac' : '1,000 gal/ac';
  }

  nUnit(m: ManureApplication): string {
    return m.form === 'Solid' ? 'lbs N/ton' : 'lbs N/1,000 gal';
  }
}
