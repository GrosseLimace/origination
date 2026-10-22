import { Component, computed, effect, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CoverCrop, FdCicData, FieldProgramRecord, FieldSeason, ManureApplication, ManureForm, ManureType, ProducerField, Tillage } from '@models';
import { COVER_LABELS, TILLAGE_LABELS, estimateCi, fdCicCropFor, missingInputs } from '@shared/utils/ci-illustrative';
import { CiPreviewPanelComponent } from '../../ci-preview-panel.component';
import { ProgramIntake } from '../program-def';
import { ProgramRecordMockService } from '../program-record-mock.service';import { MANURE_OPTIONS, fdCicScorable } from './fd-cic.data';

const cloneData = (d: FdCicData): FdCicData => ({ ...d, manure: d.manure.map(m => ({ ...m })) });

/**
 * The 45Z inputs for one field, in the order and wording of the USDA FD-CIC v1.2 "Crop Inputs" tab.
 * State, county and acres come from the field, so they are not asked again; the workbook's defaults
 * are preselected, so expected yield and total N are all a field needs to score. Edits save as they
 * are made, and the CI beside the form moves with every change.
 */
@Component({
  selector: 'app-fd-cic-intake',
  standalone: true,
  imports: [CommonModule, FormsModule, CiPreviewPanelComponent],
  templateUrl: './fd-cic-intake.component.html',
  styleUrl: '../../field-plan.css',
})
export class FdCicIntakeComponent implements ProgramIntake {
  private readonly records = inject(ProgramRecordMockService);

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

  /** Editable copy of the stored data; every change is written straight back. */
  draft: FdCicData | null = null;
  private _draftOf: string | null = null;

  readonly crop = computed(() => fdCicCropFor(this.season().cropLabel));
  readonly stored = computed(() => this.record().data as FdCicData);
  readonly result = computed(() => {
    const crop = this.crop();
    return crop ? estimateCi(crop, fdCicScorable(this.stored(), this.season())) : null;
  });
  readonly missing = computed(() => missingInputs({ ...this.stored(), acres: this.season().acres }));
  readonly isFinal = computed(() => this.record().status === 'Final');

  constructor() {
    effect(() => {
      const r = this.record();
      const key = `${r.id}|${r.status}`;
      if (key !== this._draftOf) {
        this.draft = cloneData(r.data as FdCicData);
        this._draftOf = key;
      }
    });
  }

  save(): void {
    if (!this.draft || this.disabled()) return;
    this.records.update({ ...this.record(), data: cloneData(this.draft) });
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
