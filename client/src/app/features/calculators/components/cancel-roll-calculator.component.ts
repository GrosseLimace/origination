import { Component, inject, signal, computed, input, output, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { InputComponent } from '@shared/components/input/input.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingCurrencyPipe } from '@shared/pipes/accounting-currency.pipe';
import { ToastService } from '@core/services/toast.service';

import { CancelRollInputs, CancelRollResult } from '../models/calculator.model';
import { computeCancelRoll } from '../cancel-roll.calc';
import { CancelRollReportService } from '../services/cancel-roll-report.service';

/** String-backed form state for the cancel-vs-roll decision. */
interface CancelRollForm {
  cashPriceToday: string;      // shared by both options
  // Option 1 — Cancelation
  contractAvgPrice: string;
  cancelFee: string;
  bushels: string;
  // Option 2 — Roll
  cashPriceNextYear: string;
  hedgeCost: string;
  contractCashPrice: string;
}

function blankForm(): CancelRollForm {
  return {
    cashPriceToday: '',
    contractAvgPrice: '', cancelFee: '', bushels: '',
    cashPriceNextYear: '', hedgeCost: '', contractCashPrice: '',
  };
}

@Component({
  selector: 'app-cancel-roll-calculator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AccountingCurrencyPipe, InputComponent, ButtonComponent],
  templateUrl: './cancel-roll-calculator.component.html',
})
export class CancelRollCalculatorComponent implements OnInit {
  private readonly report = inject(CancelRollReportService);
  private readonly toast = inject(ToastService);

  /** Name of the producer the calculator was opened for — prefilled into Producer (editable). */
  readonly producerName = input<string>('');

  /** Emits the side-by-side column count so the host widget opens wide enough for both options. */
  readonly columnCount = output<number>();

  /** Producer this analysis is for; prefilled from the selected customer, printed on the report. */
  readonly producer = signal<string>('');

  private readonly form = signal<CancelRollForm>(blankForm());

  readonly result = computed<CancelRollResult>(() => computeCancelRoll(this.parse(this.form())));

  /** Current form snapshot for the template's two-way-ish bindings. */
  readonly view = computed(() => this.form());

  ngOnInit(): void {
    if (this.producerName()) {
      this.producer.set(this.producerName());
    }
    // Two option columns — ask the widget to open wide enough to show both.
    this.columnCount.emit(2);
  }

  setField(key: keyof CancelRollForm, value: string): void {
    this.form.update(f => ({ ...f, [key]: value }));
  }

  /** On blur, rewrite a leading-minus entry to accounting parentheses so everything reads the
   *  same on screen and in the PDF: "-0.17" → "(0.17)". Positives/blanks are left untouched. */
  normalizeField(key: keyof CancelRollForm): void {
    const raw = (this.form()[key] ?? '').trim();
    const rest = raw.slice(1).trim();
    if (raw.startsWith('-') && rest) {
      this.setField(key, `(${rest})`);
    }
  }

  async downloadPdf(): Promise<void> {
    try {
      await this.report.download(this.producer(), this.parse(this.form()), this.result());
    } catch {
      this.toast.error('Could not generate the PDF report. Please try again.');
    }
  }

  private parse(form: CancelRollForm): CancelRollInputs {
    return {
      cashPriceToday: this.signed(form.cashPriceToday),
      contractAvgPrice: this.signed(form.contractAvgPrice),
      cancelFee: this.signed(form.cancelFee),
      bushels: this.signed(form.bushels),
      cashPriceNextYear: this.signed(form.cashPriceNextYear),
      hedgeCost: this.signed(form.hedgeCost),
      contractCashPrice: this.signed(form.contractCashPrice),
    };
  }

  /** Parse a numeric string that may be negative/decimal; blank/invalid → 0.
   *  Accepts accounting notation: parentheses mean negative, e.g. "(0.17)" === "-0.17". */
  private signed(value: string): number {
    const raw = (value ?? '').trim();
    const parenNegative = /^\(.*\)$/.test(raw);
    const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ''));
    if (isNaN(parsed)) return 0;
    return parenNegative ? -Math.abs(parsed) : parsed;
  }
}
