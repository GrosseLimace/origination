import { Injectable, inject } from '@angular/core';

import { UsageTrackingService } from '@core/services/usage-tracking.service';

import { CancelRollInputs, CancelRollResult } from '../models/calculator.model';
import { CalculatorReportService, ReportTable, reportMoneyAccounting } from './calculator-report.service';

/**
 * Builds the Cancel-vs-Roll PDF: one table per option (Cancelation, Roll), each a label→value list,
 * delegating rendering to the shared CalculatorReportService (centered Scoular logo + producer line).
 */
@Injectable({ providedIn: 'root' })
export class CancelRollReportService {
  private readonly report = inject(CalculatorReportService);
  private readonly usageTracking = inject(UsageTrackingService);

  async download(producer: string, input: CancelRollInputs, result: CancelRollResult): Promise<void> {
    const money = reportMoneyAccounting;
    const num = (n: number) => n.toLocaleString('en-US');

    const cancelRows: string[][] = [
      ['Cash Price Today', money(input.cashPriceToday, 4)],
      ['Contract Avg / Cash Price', money(input.contractAvgPrice, 4)],
      ['Cancellation Fee', money(input.cancelFee, 4)],
      ['Bushels', num(input.bushels)],
      ['Cost to Cancel', money(result.costToCancel, 4)],
      ['$ to Buy Out', money(result.buyOut)],
    ];

    const rollRows: string[][] = [
      ['Cash Price Today', money(input.cashPriceToday, 4)],
      ['Cash Price Next Year', money(input.cashPriceNextYear, 4)],
      ['Cost to Service Hedge', money(input.hedgeCost, 4)],
      ['Contract Cash Price', money(input.contractCashPrice, 4)],
      ['Cost to Roll', money(result.costToRoll, 4)],
      ['New Cash Price Next Year', money(result.newCashPriceNextYear, 4)],
    ];

    const tables: ReportTable[] = [
      { firstColumnHeader: 'Option 1 — Contract Cancelation', rows: cancelRows },
      { firstColumnHeader: 'Option 2 — Roll (Risky)', rows: rollRows },
    ];

    await this.report.download({
      title: 'Cancel vs. Roll Analysis',
      subtitle: producer.trim() ? `Producer: ${producer.trim()}` : undefined,
      filename: 'Cancel_vs_Roll_Analysis.pdf',
      columnHeaders: ['Value'],
      tables,
    });

    // Only after the file is actually produced — a failed render shouldn't count as an export.
    this.usageTracking.postClickEvent('interaction', 'calculators', 'cancel-roll-pdf');
  }
}
