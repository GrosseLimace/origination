import { Injectable, inject } from '@angular/core';

import { UsageTrackingService } from '@core/services/usage-tracking.service';

import { GRAIN_COMMODITIES, ProfitabilityInputs, ProfitabilityResult } from '../models/calculator.model';
import { CalculatorReportService, ReportTable, reportMoneyAccounting } from './calculator-report.service';

export interface ProfitabilityReportCrop {
  input: ProfitabilityInputs;
  result: ProfitabilityResult;
}

/**
 * Builds the Farm Profitability PDF by mapping each crop to report rows and delegating rendering
 * to the shared CalculatorReportService (centered Scoular logo, Input table + Totals table with
 * each crop as a centered column headed by its commodity).
 */
@Injectable({ providedIn: 'root' })
export class ProfitabilityReportService {
  private readonly report = inject(CalculatorReportService);
  private readonly usageTracking = inject(UsageTrackingService);

  async download(crops: ProfitabilityReportCrop[]): Promise<void> {
    const columnHeaders = crops.map(c => this.commodityLabel(c.input.commodity));
    const money = reportMoneyAccounting;
    const num = (n: number) => n.toLocaleString('en-US');

    const inputRows: [string, (i: ProfitabilityInputs) => string][] = [
      ['Farm Name', i => i.farmName || 'N/A'],
      ['Commodity', i => this.commodityLabel(i.commodity)],
      ['Total Number of Acres', i => num(i.totalAcres)],
      ['Expected Yield per Acre (bu)', i => num(i.yieldPerAcre)],
      ['Expected Sale Price per Bushel', i => money(i.pricePerBushel)],
      ['Fertilizer ($/acre)', i => money(i.fertilizer)],
      ['Pesticides ($/acre)', i => money(i.pesticides)],
      ['Seed ($/acre)', i => money(i.seed)],
      ['Drying ($/acre)', i => money(i.drying)],
      ['Storage ($/acre)', i => money(i.storage)],
      ['Crop Insurance ($/acre)', i => money(i.cropInsurance)],
      ['Rent per Acre ($)', i => money(i.rent)],
      ['Harvesting ($/acre)', i => money(i.harvesting)],
      ['Freight ($/bushel)', i => money(i.freightPerBushel)],
      ['Repairs & Misc ($ total)', i => money(i.repairs)],
    ];

    const summaryRows: [string, (r: ProfitabilityResult) => string][] = [
      ['Total Revenue', r => money(r.totalRevenue)],
      ['Revenue per Acre', r => money(r.revenuePerAcre)],
      ['Total Variable Cost', r => money(r.totalVariableCost)],
      ['Variable Cost per Acre', r => money(r.variableCostPerAcre)],
      ['Total Fixed Cost', r => money(r.totalFixedCost)],
      ['Fixed Cost per Acre', r => money(r.fixedCostPerAcre)],
      ['Total Cost', r => money(r.totalCost)],
      ['Cost per Acre', r => money(r.costPerAcre)],
      ['Profit', r => money(r.profit)],
      ['Profit per Acre', r => money(r.profitPerAcre)],
      ['Breakeven $/Bushel', r => money(r.breakevenPerBushel, 4)],
    ];

    const tables: ReportTable[] = [
      { firstColumnHeader: 'Input', rows: inputRows.map(([label, fn]) => [label, ...crops.map(c => fn(c.input))]) },
      { firstColumnHeader: 'Category', rows: summaryRows.map(([label, fn]) => [label, ...crops.map(c => fn(c.result))]) },
    ];

    await this.report.download({
      title: 'Farm Profitability Report',
      filename: 'Farm_Profitability_Report.pdf',
      columnHeaders,
      tables,
    });

    // Only after the file is actually produced — a failed render shouldn't count as an export.
    this.usageTracking.postClickEvent('interaction', 'calculators', 'profitability-pdf');
  }

  private commodityLabel(value: string): string {
    return GRAIN_COMMODITIES.find(c => c.value === value)?.label ?? value;
  }
}
