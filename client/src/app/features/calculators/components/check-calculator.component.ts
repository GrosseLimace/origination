import { Component, inject, signal, computed, input, output, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';

import { InputComponent } from '@shared/components/input/input.component';
import { SelectComponent } from '@shared/components/select/select.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingCurrencyPipe } from '@shared/pipes/accounting-currency.pipe';
import { ToastService } from '@core/services/toast.service';
import { ApiService } from '@core/services/api.service';
import { Commodity } from '@models';
import { AppStateService } from '@core/services/app-state.service';
import { scopeCommodities } from '@shared/utils/commodity-scope';

import { CheckInputs, CheckResult, CheckOffMode, DEFAULT_DAILY_DP_FEE } from '../models/calculator.model';
import { computeCheck } from '../check.calc';
import { CheckReportService } from '../services/check-report.service';

/** String-backed form state for one commodity's settlement check. */
interface CheckForm {
  commodity: string;
  bushels: string;
  basis: string;
  futurePrice: string;
  checkOffMode: CheckOffMode;
  checkOffValue: string;      // percent number (e.g. "2") in percent mode, or the decimal (e.g. "0.02") in $ mode
  avgDeliveryDate: string;    // ISO yyyy-MM-dd
  settlementDate: string;     // ISO yyyy-MM-dd
  freightPerBushel: string;
  dailyDpFee: string;
}

interface CheckView {
  form: CheckForm;
  result: CheckResult;
}

/** Today as ISO yyyy-MM-dd (local date). */
function todayIso(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function blankCommodity(): CheckForm {
  return {
    commodity: '', bushels: '', basis: '', futurePrice: '',
    checkOffMode: 'percent', checkOffValue: '',
    avgDeliveryDate: '', settlementDate: todayIso(),
    freightPerBushel: '', dailyDpFee: `${DEFAULT_DAILY_DP_FEE}`,
  };
}

@Component({
  selector: 'app-check-calculator',
  standalone: true,
  imports: [FormsModule, DecimalPipe, AccountingCurrencyPipe, InputComponent, SelectComponent, ButtonComponent],
  templateUrl: './check-calculator.component.html',
})
export class CheckCalculatorComponent implements OnInit {
  private readonly report = inject(CheckReportService);
  private readonly toast = inject(ToastService);
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly destroyRef = inject(DestroyRef);

  /** Name of the producer the calculator was opened for — prefilled into Producer (editable). */
  readonly producerName = input<string>('');

  /** Emits the number of commodity columns so the host widget can auto-size to fit them. */
  readonly columnCount = output<number>();

  /** Producer this check is for; prefilled from the selected customer, shown on the printed report. */
  readonly producer = signal<string>('');

  private readonly items = signal<CheckForm[]>([blankCommodity()]);

  /** Commodity list for the searchable picker — the same curated planting-intentions list (HRWW, YC…). */
  private readonly commodityOptions = signal<Commodity[]>([]);
  /** Which commodity column currently has its suggestions dropdown open (null = none). */
  readonly openSuggestIndex = signal<number | null>(null);

  /** Suggestions for the open column, filtered by its typed code/name (top 10). */
  readonly activeSuggestions = computed<Commodity[]>(() => {
    const idx = this.openSuggestIndex();
    if (idx === null) return [];
    const query = (this.items()[idx]?.commodity ?? '').trim().toLowerCase();
    // Hide commodities scoped to a trade group the user isn't in (organics). Covers the
    // full-list fallback too, since it lands in the same signal.
    const list = scopeCommodities(this.commodityOptions(), { groupNames: this.appState.inScopeGroupNames(), tradeUnitCodes: this.appState.inScopeTradeUnitCodes() });
    const matches = query
      ? list.filter(c => c.code.toLowerCase().includes(query) || c.name.toLowerCase().includes(query))
      : list;
    return matches.slice(0, 10);
  });

  constructor() {
    // Curated crop list drives the search; fall back to the full commodity list if it's empty.
    this.apiService.getPlantingCommodities()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.commodityOptions.set(list?.length ? list : []),
        error: () => this.loadFullCommodities(),
      });
  }

  readonly views = computed<CheckView[]>(() =>
    this.items().map(form => ({ form, result: computeCheck(this.parse(form)) })),
  );

  ngOnInit(): void {
    // Prefill the producer with the selected customer (still editable).
    if (this.producerName()) {
      this.producer.set(this.producerName());
    }
  }

  setField(index: number, key: keyof CheckForm, value: string): void {
    this.items.update(list => list.map((c, i) => (i === index ? { ...c, [key]: value } : c)));
  }

  /** On blur, rewrite a leading-minus entry to accounting parentheses so everything reads the
   *  same on screen and in the PDF: "-0.70" → "(0.70)". Positives/blanks are left untouched. */
  normalizeField(index: number, key: keyof CheckForm): void {
    const raw = (this.items()[index]?.[key] ?? '').trim();
    const rest = raw.slice(1).trim();
    if (raw.startsWith('-') && rest) {
      this.setField(index, key, `(${rest})`);
    }
  }

  addCommodity(): void {
    this.items.update(list => [...list, blankCommodity()]);
    this.columnCount.emit(this.items().length);
  }

  removeCommodity(index: number): void {
    this.items.update(list => (list.length > 1 ? list.filter((_, i) => i !== index) : list));
    this.columnCount.emit(this.items().length);
  }

  openSuggest(index: number): void {
    this.openSuggestIndex.set(index);
  }

  /** Close the dropdown shortly after blur so a suggestion mousedown still registers. */
  closeSuggestSoon(): void {
    setTimeout(() => this.openSuggestIndex.set(null), 150);
  }

  pickCommodity(index: number, code: string): void {
    this.setField(index, 'commodity', code);
    this.openSuggestIndex.set(null);
  }

  private loadFullCommodities(): void {
    this.apiService.getCommodities()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (list) => this.commodityOptions.set(list ?? []), error: () => {} });
  }

  async downloadPdf(): Promise<void> {
    try {
      await this.report.download(
        this.producer(),
        this.views().map(v => ({ input: this.parse(v.form), result: v.result })),
      );
    } catch {
      this.toast.error('Could not generate the PDF report. Please try again.');
    }
  }

  private parse(form: CheckForm): CheckInputs {
    const rawCheckOff = this.signed(form.checkOffValue);
    return {
      commodity: form.commodity.trim(),
      bushels: this.signed(form.bushels),
      basis: this.signed(form.basis),
      futurePrice: this.signed(form.futurePrice),
      checkOffMode: form.checkOffMode,
      // Percent mode: the user types a percent (e.g. 2) → store as a fraction (0.02).
      checkOffValue: form.checkOffMode === 'percent' ? rawCheckOff / 100 : rawCheckOff,
      avgDeliveryDate: form.avgDeliveryDate,
      settlementDate: form.settlementDate,
      freightPerBushel: this.signed(form.freightPerBushel),
      dailyDpFee: this.signed(form.dailyDpFee),
    };
  }

  /** Parse a numeric string that may be negative/decimal; blank/invalid → 0.
   *  Accepts accounting notation: parentheses mean negative, e.g. "(0.70)" === "-0.70". */
  private signed(value: string): number {
    const raw = (value ?? '').trim();
    const parenNegative = /^\(.*\)$/.test(raw);
    const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ''));
    if (isNaN(parsed)) return 0;
    return parenNegative ? -Math.abs(parsed) : parsed;
  }
}
