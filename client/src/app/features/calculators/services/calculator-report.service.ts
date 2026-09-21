import { Injectable } from '@angular/core';
// Type-only import (erased at build) so the ~800 kB jspdf/html2canvas bundle stays out of the
// eager home-page chunk; the runtime libs are dynamically imported on demand in download().
import type { jsPDF } from 'jspdf';
import { formatAccountingMoney } from '@shared/utils/accounting-money';

const INK: [number, number, number] = [17, 24, 39];          // near-black — values & title
const HEADER_GREY: [number, number, number] = [55, 65, 81];  // dark grey — column-header fill
const LINE_GREY: [number, number, number] = [203, 213, 225]; // light grey — separators
const SCOULAR_LOGO = 'assets/images/scoular-logo-dark.webp';

/** jspdf-autotable records the last table's geometry on the doc; its type augmentation isn't
 *  always visible to the compiler, so we access it through this narrow typed view. */
interface AutoTableDoc extends jsPDF {
  lastAutoTable?: { finalY: number };
}

/** One table in the report: a first-column label header plus rows of `[label, ...perColumnValues]`. */
export interface ReportTable {
  firstColumnHeader: string;
  rows: string[][];
}

export interface CalculatorReportOptions {
  title: string;
  /** Optional centered line under the title (e.g. the producer the check is for). */
  subtitle?: string;
  filename: string;
  /** Per-instance column headers (e.g. commodity/crop names) shown above each value column. */
  columnHeaders: string[];
  tables: ReportTable[];
}

/**
 * Shared branded-PDF renderer for the originator calculators. Draws the centered Scoular logo +
 * report title, then one grid table per section with each instance as a centered value column.
 * Tables are built from typed string arrays (no HTML/innerHTML — user values can't inject markup).
 * jspdf + jspdf-autotable are lazy-loaded; the logo is embedded from the app's own asset (CSP-safe).
 */
@Injectable({ providedIn: 'root' })
export class CalculatorReportService {
  async download(opts: CalculatorReportOptions): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageCenter = pageWidth / 2;

    // ── Header: centered Scoular logo + centered report title ──
    const logoTop = 30;
    const logo = await this.loadLogo();
    let titleY: number;
    if (logo) {
      const logoH = 30;
      const logoW = logoH * logo.ratio;
      doc.addImage(logo.dataUrl, 'PNG', pageCenter - logoW / 2, logoTop, logoW, logoH);
      titleY = logoTop + logoH + 22;
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(...INK);
      doc.text('SCOULAR', pageCenter, logoTop + 20, { align: 'center' });
      titleY = logoTop + 44;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...INK);
    doc.text(opts.title, pageCenter, titleY, { align: 'center' });

    let ruleOffset = 12;
    if (opts.subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(...HEADER_GREY);
      doc.text(opts.subtitle, pageCenter, titleY + 16, { align: 'center' });
      ruleOffset = 28;
    }

    doc.setDrawColor(...LINE_GREY);
    doc.setLineWidth(1);
    const ruleY = titleY + ruleOffset;
    doc.line(margin, ruleY, pageWidth - margin, ruleY);

    // ── Tables ──
    let startY = ruleY + 20;
    for (const table of opts.tables) {
      autoTable(doc, {
        startY,
        head: [[table.firstColumnHeader, ...opts.columnHeaders]],
        body: table.rows,
        theme: 'grid',
        headStyles: { fillColor: HEADER_GREY, textColor: 255, fontStyle: 'bold', halign: 'center' },
        columnStyles: this.columnStyles(opts.columnHeaders.length),
        styles: { fontSize: 9.5, cellPadding: 4, textColor: INK, lineColor: LINE_GREY, lineWidth: 0.5 },
        margin: { left: margin, right: margin },
      });
      startY = ((doc as AutoTableDoc).lastAutoTable?.finalY ?? startY) + 18;
    }

    doc.save(opts.filename);
  }

  /** Left-align the label column; center the values under each instance's column header. */
  private columnStyles(count: number): Record<number, { halign: 'left' | 'center' }> {
    const styles: Record<number, { halign: 'left' | 'center' }> = { 0: { halign: 'left' } };
    for (let i = 1; i <= count; i++) {
      styles[i] = { halign: 'center' };
    }
    return styles;
  }

  /** Loads the app's Scoular logo (same-origin webp) as a PNG data URL for jsPDF, which doesn't
   *  reliably embed webp. Same-origin → canvas isn't tainted → toDataURL works. Null on failure
   *  (a text wordmark is used as fallback). */
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
}

/** Accounting-style money for reports: `$ 40.00` / `$ (40.00)` (parentheses for negatives).
 *  Delegates to the shared formatter that AccountingCurrencyPipe also uses — this held its own
 *  identical copy, with a comment saying it matched the pipe, which is how they'd have drifted. */
export function reportMoneyAccounting(n: number, maxFractionDigits = 2): string {
  return formatAccountingMoney(n, maxFractionDigits);
}
