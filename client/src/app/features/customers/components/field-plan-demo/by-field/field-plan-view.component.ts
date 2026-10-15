import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ByFieldMockService, SimulatedTotal } from './by-field-mock.service';
import { Commodity, Customer, FALLOW, FieldSeason, IrrigationType, PlantingIntention, ProducerField } from './model';
import { plantingCategory, commodityPlantingCategory } from '@shared/utils/planting-category';
import { estimateCi, fdCicCropFor, seasonStatus } from '@shared/utils/ci-illustrative';
import { otherAcres, planKeyId, rotationSuggestion } from './field-plan-rollup';
import { environment } from '@env/environment';
import { ByFieldSeasonDialogComponent } from './field-season-dialog.component';

interface FieldRow {
  field: ProducerField;
  prior?: FieldSeason;
  main?: FieldSeason;
  second?: FieldSeason;
  suggestion: { code: string; label: string } | null;
}

/**
 * "Plan by field": one row per field, pick this year's crop (the rotation is suggested), and the
 * producer's crop totals — the planting intentions the dashboard counts — follow. Acres placed in a
 * field come out of the crop's "other acres" first, so a crop already planned is never counted twice.
 */
@Component({
  selector: 'app-demo-byfield-view',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ByFieldSeasonDialogComponent],
  templateUrl: './field-plan-view.component.html',
  styleUrl: '../../field-plan/field-plan.css',
})
export class ByFieldViewComponent {
  readonly plan = inject(ByFieldMockService);
  readonly carbonIntensityEnabled = environment.carbonIntensityEnabled;
  readonly FALLOW = FALLOW;

  readonly customer = input.required<Customer>();
  readonly intentions = input<PlantingIntention[]>([]);
  readonly year = input.required<number>();
  readonly plantingCommodities = input<Commodity[]>([]);
  readonly allCommodities = input<Commodity[]>([]);
  readonly tradeUnitOptions = input<string[]>([]);

  constructor() {
    // Load once the crop list is in, so the sample fields' history resolves to real crop codes.
    effect(() => {
      if (this.plantingCommodities().length === 0 && this.allCommodities().length === 0) return;
      this.plan.load(this.customer().id, this.intentions(), this.year(), this.customer().stateProvince,
        this.tradeUnitOptions()[0] ?? '', label => this.resolveCrop(label));
    });
  }

  // ── Crops ───────────────────────────────────────────────────────────────────
  readonly cropOptions = computed(() => {
    const source = this.plantingCommodities().length > 0 ? this.plantingCommodities() : this.allCommodities();
    return [...source].sort((a, b) => a.name.localeCompare(b.name));
  });

  /** "Corn" → the first planting crop grouped under Corn. */
  resolveCrop(label: string): { code: string; label: string } | null {
    const wanted = label.toLowerCase();
    const source = this.plantingCommodities().length > 0 ? this.plantingCommodities() : this.allCommodities();
    const c = source.find(x => (commodityPlantingCategory(x) || '').toLowerCase() === wanted);
    return c ? { code: c.code, label: commodityPlantingCategory(c) || c.name } : null;
  }

  cropLabel(code: string): string {
    if (code === FALLOW) return 'Not planted';
    const commodity = this.allCommodities().find(c => c.code === code) ?? this.plantingCommodities().find(c => c.code === code);
    return plantingCategory({ crop: code, category: undefined }, commodity);
  }

  // ── Rows ────────────────────────────────────────────────────────────────────
  readonly rows = computed<FieldRow[]>(() => {
    this.plan.seasons(); // track
    return this.plan.fieldsFor(this.customer().id).map(field => {
      const thisYear = this.plan.seasonsFor(field.fieldKey, this.year());
      const prior = this.plan.priorSeason(field.fieldKey, this.year());
      let suggestion: FieldRow['suggestion'] = null;
      if (prior && prior.crop !== FALLOW) {
        const rotated = rotationSuggestion(prior.cropLabel);
        suggestion = rotated ? this.resolveCrop(rotated) : { code: prior.crop, label: prior.cropLabel };
      }
      return {
        field, prior, suggestion,
        main: thisYear.find(s => s.sortOrder === 1),
        second: thisYear.find(s => s.sortOrder === 2),
      };
    });
  });

  readonly unplannedWithSuggestion = computed(() => this.rows().filter(r => !r.main && r.suggestion));
  readonly unplannedWithPrior = computed(() => this.rows().filter(r => !r.main && r.prior));

  ci(season: FieldSeason | undefined) {
    if (!this.carbonIntensityEnabled || !season || season.crop === FALLOW) return null;
    const crop = fdCicCropFor(season.cropLabel);
    if (!crop) return null;
    return { result: estimateCi(crop, season), status: seasonStatus(season) };
  }

  /** One-line notice per field after a crop is picked: where its acres came from. */
  readonly notices = signal<Record<string, string>>({});

  pickCrop(row: FieldRow, sortOrder: number, code: string): void {
    const existing = sortOrder === 1 ? row.main : row.second;
    if (!code) {
      if (existing) this.plan.removeSeason(existing.id);
      this._notice(row.field.fieldKey, '');
      return;
    }
    const label = this.cropLabel(code);
    const type = sortOrder === 2 ? 'Double Crop' : row.field.irrigation;
    const acres = existing?.acres ?? row.field.acres;
    let notice = '';
    if (code !== FALLOW && existing?.crop !== code) {
      const key = this.plan.keyFor({ crop: code, type, year: this.year(), tradeUnit: row.field.tradeUnit });
      const total = this.plan.totals()[this.plan.totalId(this.customer().id, planKeyId(key))];
      const inFields = this.plan.fieldAcresByKey(this.year(), this.customer().id).get(planKeyId(key)) ?? 0;
      const other = total ? otherAcres(total.total, inFields) : 0;
      if (other > 0) {
        const moved = Math.min(other, acres);
        notice = moved === acres
          ? `${acres} ac moved out of the ${total!.total.toLocaleString()} ac of ${label} already planned. The total stays the same.`
          : `${moved} ac moved out of the ${label} already planned; the total rises by ${acres - moved} ac.`;
      }
    }
    this.plan.setCrop(row.field, this.year(), sortOrder, code, label);
    this._notice(row.field.fieldKey, notice);
  }

  acceptAllSuggestions(): void {
    for (const r of this.unplannedWithSuggestion()) this.pickCrop(r, 1, r.suggestion!.code);
  }

  copyLastYear(): void {
    for (const r of this.unplannedWithPrior()) this.pickCrop(r, 1, r.prior!.crop);
  }

  addSecondCrop(row: FieldRow): void {
    this.showSecond = { ...this.showSecond, [row.field.fieldKey]: true };
  }
  showSecond: Record<string, boolean> = {};

  private _notice(fieldKey: string, text: string): void {
    this.notices.update(n => ({ ...n, [fieldKey]: text }));
  }

  // ── Other acres and the roll-up ───────────────────────────────────────────────
  private readonly fieldAcres = computed(() => {
    this.plan.seasons();
    return this.plan.fieldAcresByKey(this.year(), this.customer().id);
  });

  /** Totals for this producer and year, with field and other acres split out. */
  readonly rollup = computed(() => {
    this.plan.totals();
    const byKey = this.fieldAcres();
    return this.plan.totalsFor(this.customer().id, this.year())
      .map(t => {
        const inFields = byKey.get(planKeyId(t.key)) ?? 0;
        return { ...t, label: t.cropLabel || this.cropLabel(t.key.crop), inFields, other: otherAcres(t.total, inFields) };
      })
      .filter(t => t.total > 0 || t.baseline > 0)
      .sort((a, b) => b.total - a.total);
  });

  readonly otherRows = computed(() => this.rollup().filter(r => r.other > 0 || (r.inFields === 0 && r.baseline > 0)));
  readonly anyChange = computed(() => this.rollup().some(r => r.total !== r.baseline));

  setOther(row: SimulatedTotal, value: number): void {
    this.plan.setOtherAcres(this.customer().id, row.key, value);
  }

  planKeyIdOf(row: SimulatedTotal): string {
    return planKeyId(row.key);
  }

  typeLabel(type: string): string {
    return type === 'Irrigated' ? 'Irr.' : type === 'Dryland' ? 'Dry' : type;
  }

  // ── Add field ───────────────────────────────────────────────────────────────
  showAddField = false;
  newField = { name: '', acres: null as number | null, irrigation: 'Dryland' as IrrigationType, state: 'KS', county: '', tradeUnit: '' };

  openAddField(): void {
    const st = this.customer().stateProvince;
    const state = st && this.plan.countiesByState[st] ? st : 'KS';
    this.newField = { name: '', acres: null, irrigation: 'Dryland', state, county: this.plan.countiesByState[state][0], tradeUnit: this.tradeUnitOptions()[0] ?? '' };
    this.showAddField = true;
  }

  get canAddField(): boolean {
    return !!this.newField.name.trim() && (this.newField.acres ?? 0) > 0 && !!this.newField.county;
  }

  confirmAddField(): void {
    if (!this.canAddField) return;
    this.plan.createField({
      customerId: this.customer().id, name: this.newField.name.trim(), acres: this.newField.acres!,
      irrigation: this.newField.irrigation, state: this.newField.state, county: this.newField.county, tradeUnit: this.newField.tradeUnit,
    });
    this.showAddField = false;
  }

  countiesFor(state: string): string[] {
    return this.plan.countiesByState[state] ?? [];
  }

  // ── Detail ──────────────────────────────────────────────────────────────────
  openSeasonId: string | null = null;

  // ── Prototype only ───────────────────────────────────────────────────────────
  showClearAll = false;

  confirmClearAll(): void {
    this.plan.clearAll();
    this.notices.set({});
    this.showClearAll = false;
  }
}
