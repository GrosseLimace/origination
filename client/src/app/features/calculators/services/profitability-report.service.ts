import { Injectable } from '@angular/core';
// Type-only import (erased at build) so the ~800 kB jspdf/html2canvas bundle stays out of the
// eager home-page chunk; the runtime libs are dynamically imported on demand in download().
import type { jsPDF } from 'jspdf';

import { GRAIN_COMMODITIES, ProfitabilityInputs, ProfitabilityResult } from '../models/calculator.model';

export interface ProfitabilityReportCrop {
  input: ProfitabilityInputs;
  result: ProfitabilityResult;
}

/** jspdf-autotable records the last table's geometry on the doc; its type augmentation isn't
 *  always visible to the compiler, so we access it through this narrow typed view. */
interface AutoTableDoc extends jsPDF {
  lastAutoTable?: { finalY: number };
}

const INK: [number, number, number] = [17, 24, 39];          // near-black — values & title
const HEADER_GREY: [number, number, number] = [55, 65, 81];  // dark grey — column-header fill
const LINE_GREY: [number, number, number] = [203, 213, 225]; // light grey — separators
const SCOULAR_LOGO = 'assets/images/scoular-logo-dark.webp';

/**
 * Builds and downloads the branded Farm Profitability PDF. Tables are rendered from typed
 * data arrays via jspdf-autotable (text only — no HTML/innerHTML, so user-entered values like
 * Farm Name are never interpreted as markup). No external assets: the header is a text wordmark,
 * which keeps it within the app's CSP (img-src would block the external Scoular logo URL).
 */
@Injectable({ providedIn: 'root' })
export class ProfitabilityReportService {
  async download(crops: ProfitabilityReportCrop[]): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();

    // ── Header: centered Scoular logo + centered report title ──
    const pageCenter = pageWidth / 2;
    const logoTop = 30;
    const logo = await this.loadLogo();
    let titleY: number;
    if (logo) {
      const logoH = 30;
      const logoW = logoH * logo.ratio;
      doc.addImage(logo.dataUrl, 'PNG', pageCenter - logoW / 2, logoTop, logoW, logoH);
      titleY = logoTop + logoH + 22;
    } else {
      // Fallback wordmark if the logo asset can't be loaded.
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(...INK);
      doc.text('SCOULAR', pageCenter, logoTop + 20, { align: 'center' });
      titleY = logoTop + 44;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...INK);
    doc.text('Farm Profitability Report', pageCenter, titleY, { align: 'center' });

    doc.setDrawColor(...LINE_GREY);
    doc.setLineWidth(1);
    const ruleY = titleY + 12;
    doc.line(margin, ruleY, pageWidth - margin, ruleY);

    // Each crop is its own column, headed by the commodity name.
    const cropHeads = crops.map(c => this.commodityLabel(c.input.commodity));
    const tableStartY = ruleY + 20;

    // ── Inputs table ──
    autoTable(doc, {
      startY: tableStartY,
      head: [['Input', ...cropHeads]],
      body: this.inputRows(crops),
      theme: 'grid',
      headStyles: { fillColor: HEADER_GREY, textColor: 255, fontStyle: 'bold', halign: 'center' },
      columnStyles: this.columnStyles(crops.length),
      styles: { fontSize: 9.5, cellPadding: 4, textColor: INK, lineColor: LINE_GREY, lineWidth: 0.5 },
      margin: { left: margin, right: margin },
    });

    // ── Totals / summary table ──
    const afterInputs = (doc as AutoTableDoc).lastAutoTable?.finalY ?? tableStartY;
    autoTable(doc, {
      startY: afterInputs + 18,
      head: [['Category', ...cropHeads]],
      body: this.summaryRows(crops),
      theme: 'grid',
      headStyles: { fillColor: HEADER_GREY, textColor: 255, fontStyle: 'bold', halign: 'center' },
      columnStyles: this.columnStyles(crops.length),
      styles: { fontSize: 9.5, cellPadding: 4, textColor: INK, lineColor: LINE_GREY, lineWidth: 0.5 },
      margin: { left: margin, right: margin },
    });

    doc.save('Farm_Profitability_Report.pdf');
  }

  /** Loads the app's Scoular logo (same-origin webp) and returns it as a PNG data URL for jsPDF,
   *  which doesn't reliably embed webp. Same-origin → canvas isn't tainted → toDataURL works.
   *  Resolves null if the asset can't be loaded (a text wordmark is used as fallback). */
  private loadLogo(): Promise<{ dataUrl: string; ratio: number } | null> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0);
          resolve({ dataUrl: canvas.toDataURL('image/png'), ratio: img.naturalWidth / img.naturalHeight });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = SCOULAR_LOGO;
    });
  }

  private inputRows(crops: ProfitabilityReportCrop[]): string[][] {
    const money = (n: number) => this.money(n);
    const num = (n: number) => n.toLocaleString('en-US');
    const rows: [string, (i: ProfitabilityInputs) => string][] = [
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
    return rows.map(([label, fn]) => [label, ...crops.map(c => fn(c.input))]);
  }

  private summaryRows(crops: ProfitabilityReportCrop[]): string[][] {
    const money = (n: number) => this.money(n);
    const rows: [string, (r: ProfitabilityResult) => string][] = [
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
      ['Breakeven $/Bushel', r => money(r.breakevenPerBushel)],
    ];
    return rows.map(([label, fn]) => [label, ...crops.map(c => fn(c.result))]);
  }

  /** Left-align the label column; center the values under each crop's column header. */
  private columnStyles(cropCount: number): Record<number, { halign: 'left' | 'center' }> {
    const styles: Record<number, { halign: 'left' | 'center' }> = { 0: { halign: 'left' } };
    for (let i = 1; i <= cropCount; i++) {
      styles[i] = { halign: 'center' };
    }
    return styles;
  }

  private money(n: number): string {
    return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  }

  private commodityLabel(value: string): string {
    return GRAIN_COMMODITIES.find(c => c.value === value)?.label ?? value;
  }
}
