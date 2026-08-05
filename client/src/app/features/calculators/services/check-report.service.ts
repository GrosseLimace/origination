import { Injectable, inject } from '@angular/core';

import { CheckInputs, CheckResult } from '../models/calculator.model';
import { CalculatorReportService, ReportTable, reportMoneyAccounting } from './calculator-report.service';

export interface CheckReportCommodity {
  input: CheckInputs;
  result: CheckResult;
}

/**
 * Builds the Check Calculator PDF by mapping each commodity to report rows and delegating to the
 * shared CalculatorReportService (centered Scoular logo, Inputs table + Settlement table with each
 * commodity as a centered column).
 */
@Injectable({ providedIn: 'root' })
export class CheckReportService {
  private readonly report = inject(CalculatorReportService);

  async download(producer: string, items: CheckReportCommodity[]): Promise<void> {
    const columnHeaders = items.map((c, idx) => c.input.commodity || `Commodity ${idx + 1}`);
    const money = reportMoneyAccounting;
    const num = (n: number) => n.toLocaleString('en-US');
    // Both modes are a share of gross value; show it as a percent so the report is unambiguous.
    const checkOff = (i: CheckInputs) =>
      `${(i.checkOffValue * 100).toLocaleString('en-US', { maximumFractionDigits: 3 })}%`;

    const inputRows: [string, (i: CheckInputs) => string][] = [
      ['Bushels', i => num(i.bushels)],
      ['Basis ($/bu)', i => money(i.basis)],
      ['Future Price ($/bu)', i => money(i.futurePrice)],
      ['Check-Off', i => checkOff(i)],
      ['Average Delivery Date', i => i.avgDeliveryDate || 'N/A'],
      ["Today's Date", i => i.settlementDate || 'N/A'],
      ['Freight per Bushel', i => money(i.freightPerBushel)],
      ['Daily DP Fee', i => i.dailyDpFee.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 6 })],
    ];

    const resultRows: [string, (r: CheckResult) => string][] = [
      ['Cash Price', r => money(r.cashPrice, 4)],
      ['Total Before Fees', r => money(r.totalBeforeFees)],
      ['Days Since Delivery', r => num(r.daysSinceDelivery)],
      ['Total Check-Off', r => money(r.totalCheckOff)],
      ['Total DP Fees', r => money(r.totalDpFees)],
      ['Total Freight', r => money(r.totalFreight)],
      ['Total', r => money(r.total)],
    ];

    const tables: ReportTable[] = [
      { firstColumnHeader: 'Input', rows: inputRows.map(([label, fn]) => [label, ...items.map(c => fn(c.input))]) },
      { firstColumnHeader: 'Settlement', rows: resultRows.map(([label, fn]) => [label, ...items.map(c => fn(c.result))]) },
    ];

    await this.report.download({
      title: 'Check Calculator',
      subtitle: producer.trim() ? `Producer: ${producer.trim()}` : undefined,
      filename: 'Check_Calculator_Report.pdf',
      columnHeaders,
      tables,
    });
  }
}
