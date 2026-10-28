import { Component, inject, signal, computed, input, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { InputComponent } from '@shared/components/input/input.component';
import { SelectComponent } from '@shared/components/select/select.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingCurrencyPipe } from '@shared/pipes/accounting-currency.pipe';
import { ToastService } from '@core/services/toast.service';

import { GRAIN_COMMODITIES, GrainCommodity, ProfitabilityInputs, ProfitabilityResult } from '../models/calculator.model';
import { computeProfitability } from '../profitability.calc';
import { ProfitabilityReportService } from '../services/profitability-report.service';

/** String-backed form state for one crop (parsed to numbers on compute, mirroring the app's
 *  edit-dialog convention). */
interface CropForm {
  farmName: string;
  commodity: GrainCommodity;
  totalAcres: string;
  yieldPerAcre: string;
  pricePerBushel: string;
  fertilizer: string;
  pesticides: string;
  seed: string;
  drying: string;
  storage: string;
  cropInsurance: string;
  rent: string;
  harvesting: string;
  freightPerBushel: string;
  repairs: string;
}

type CropNumericKey = Exclude<keyof CropForm, 'farmName' | 'commodity'>;

interface CropView {
  form: CropForm;
  result: ProfitabilityResult;
  missing: CropNumericKey[];
}

function blankCrop(): CropForm {
  return {
    farmName: '', commodity: 'corn',
    totalAcres: '', yieldPerAcre: '', pricePerBushel: '',
    fertilizer: '', pesticides: '', seed: '', drying: '', storage: '',
    cropInsurance: '', rent: '', harvesting: '', freightPerBushel: '', repairs: '',
  };
}

@Component({
  selector: 'app-profitability-calculator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AccountingCurrencyPipe, InputComponent, SelectComponent, ButtonComponent],
  templateUrl: './profitability-calculator.component.html',
})
export class ProfitabilityCalculatorComponent implements OnInit {
  private readonly report = inject(ProfitabilityReportService);
  private readonly toast = inject(ToastService);

  /** Name of the producer the calculator was opened for — prefilled into Farm Name (editable). */
  readonly producerName = input<string>('');

  readonly commodities = GRAIN_COMMODITIES;

  /** Per-acre cost fields rendered in one loop to keep the template DRY. */
  readonly costFields: readonly { key: CropNumericKey; label: string }[] = [
    { key: 'fertilizer', label: 'Fertilizer ($/acre)' },
    { key: 'pesticides', label: 'Pesticides ($/acre)' },
    { key: 'seed', label: 'Seed ($/acre)' },
    { key: 'drying', label: 'Drying ($/acre)' },
    { key: 'storage', label: 'Storage ($/acre)' },
    { key: 'cropInsurance', label: 'Crop Insurance ($/acre)' },
    { key: 'rent', label: 'Rent ($/acre)' },
    { key: 'harvesting', label: 'Harvesting ($/acre)' },
    { key: 'freightPerBushel', label: 'Freight ($/bushel)' },
    { key: 'repairs', label: 'Repairs & Misc ($ total)' },
  ];

  private readonly crops = signal<CropForm[]>([blankCrop()]);

  /** One view per crop: the form, its live result, and any missing required fields. */
  readonly views = computed<CropView[]>(() =>
    this.crops().map(form => {
      const inputs = this.parse(form);
      return { form, result: computeProfitability(inputs), missing: this.missingRequired(form) };
    }),
  );

  readonly isValid = computed(() => this.views().every(v => v.missing.length === 0));

  ngOnInit(): void {
    // Prefill the first crop's Farm Name with the selected producer (still editable).
    const name = this.producerName();
    if (name) {
      this.crops.update(list => list.map((c, i) => (i === 0 && !c.farmName ? { ...c, farmName: name } : c)));
    }
  }

  setField(index: number, key: keyof CropForm, value: string): void {
    this.crops.update(list =>
      list.map((crop, i) => (i === index ? { ...crop, [key]: value } : crop)),
    );
  }

  /** On blur, rewrite a leading-minus entry to accounting parentheses so everything reads the
   *  same on screen and in the PDF: "-40" → "(40)". Positives/blanks are left untouched. */
  normalizeField(index: number, key: CropNumericKey): void {
    const raw = (this.crops()[index]?.[key] ?? '').trim();
    const rest = raw.slice(1).trim();
    if (raw.startsWith('-') && rest) {
      this.setField(index, key, `(${rest})`);
    }
  }

  addCrop(): void {
    this.crops.update(list => [...list, this.makeCrop()]);
  }

  /** A fresh crop form, seeded with the producer name (matches the first crop's prefill). */
  private makeCrop(): CropForm {
    const name = this.producerName();
    return name ? { ...blankCrop(), farmName: name } : blankCrop();
  }

  removeCrop(index: number): void {
    this.crops.update(list => (list.length > 1 ? list.filter((_, i) => i !== index) : list));
  }

  isMissing(index: number, key: CropNumericKey): boolean {
    return this.views()[index]?.missing.includes(key) ?? false;
  }

  async downloadPdf(): Promise<void> {
    if (!this.isValid()) {
      this.toast.error('Enter Total Acres, Yield, and Sale Price before exporting.');
      return;
    }
    try {
      await this.report.download(this.views().map(v => ({ input: this.parse(v.form), result: v.result })));
    } catch {
      this.toast.error('Could not generate the PDF report. Please try again.');
    }
  }

  private parse(form: CropForm): ProfitabilityInputs {
    return {
      farmName: form.farmName.trim(),
      commodity: form.commodity,
      totalAcres: this.num(form.totalAcres),
      yieldPerAcre: this.num(form.yieldPerAcre),
      pricePerBushel: this.num(form.pricePerBushel),
      fertilizer: this.num(form.fertilizer),
      pesticides: this.num(form.pesticides),
      seed: this.num(form.seed),
      drying: this.num(form.drying),
      storage: this.num(form.storage),
      cropInsurance: this.num(form.cropInsurance),
      rent: this.num(form.rent),
      harvesting: this.num(form.harvesting),
      freightPerBushel: this.num(form.freightPerBushel),
      repairs: this.num(form.repairs),
    };
  }

  private missingRequired(form: CropForm): CropNumericKey[] {
    return (['totalAcres', 'yieldPerAcre', 'pricePerBushel'] as CropNumericKey[])
      .filter(key => this.num(form[key]) === 0);
  }

  /** Parse a possibly-formatted numeric string to a number; blank/invalid → 0.
   *  Accepts accounting notation: parentheses mean negative, e.g. "(40)" === "-40". */
  private num(value: string): number {
    const raw = (value ?? '').trim();
    const parenNegative = /^\(.*\)$/.test(raw);
    const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ''));
    if (isNaN(parsed)) return 0;
    return parenNegative ? -Math.abs(parsed) : parsed;
  }
}
