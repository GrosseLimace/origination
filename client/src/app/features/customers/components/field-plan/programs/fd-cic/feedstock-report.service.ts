import { Injectable, inject } from '@angular/core';
import { ToastService } from '@core/services/toast.service';
// Type-only import (erased at build): jspdf is loaded on demand in download(), as in the calculators' reports.
import type { jsPDF } from 'jspdf';
import { loadReportLogo } from '@shared/utils/report-logo';
import { FeedstockReport } from './feedstock-report';

const INK: [number, number, number] = [17, 24, 39];
const HEADER_GREY: [number, number, number] = [55, 65, 81];
const LINE_GREY: [number, number, number] = [203, 213, 225];

interface AutoTableDoc extends jsPDF {
  lastAutoTable?: { finalY: number };
}

/**
 * Draws a 45Z Biofuel Feedstock Report (feedstock-report.ts) as a letter-size PDF and downloads it. Text is
 * drawn from typed strings only (no HTML), so a field or producer name can't inject markup. The report's text
 * is plain ASCII where it matters (CO2e, N2O): jsPDF's built-in Helvetica has no subscript digits.
 */
@Injectable({ providedIn: 'root' })
export class FeedstockReportService {
  private readonly toast = inject(ToastService);

  /** Builds and saves the PDF; a failure (e.g. the PDF library didn't load) is a message, not a silent error. */
  async download(report: FeedstockReport): Promise<void> {
    try {
      await this.draw(report);
    } catch {
      this.toast.error('The Biofuel Feedstock Report couldn\'t be built. Please try again.');
    }
  }

  private async draw(report: FeedstockReport): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const width = pageWidth - margin * 2;
    let y = 30;

    const ensure = (space: number) => {
      if (y + space > pageHeight - margin) { doc.addPage(); y = margin; }
    };
    const paragraph = (value: string, size = 10, style: 'normal' | 'bold' = 'normal') => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(...INK);
      const lines = doc.splitTextToSize(value, width) as string[];
      ensure(lines.length * size * 1.3);
      doc.text(lines, margin, y);
      y += lines.length * size * 1.3 + 4;
    };
    const heading = (value: string) => {
      ensure(30);
      y += 6;
      paragraph(value, 11, 'bold');
    };
    const table = (head: string[] | null, body: string[][], foot?: string[]) => {
      autoTable(doc, {
        startY: y,
        head: head ? [head] : undefined,
        body,
        foot: foot ? [foot] : undefined,
        footStyles: { fillColor: [241, 245, 249], textColor: INK, fontStyle: 'bold' },
        showFoot: 'lastPage',
        theme: 'grid',
        headStyles: { fillColor: HEADER_GREY, textColor: 255, fontStyle: 'bold' },
        columnStyles: head ? {} : { 0: { cellWidth: 170, fontStyle: 'bold' } },
        styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: LINE_GREY, lineWidth: 0.5, overflow: 'linebreak' },
        margin: { left: margin, right: margin },
      });
      y = ((doc as AutoTableDoc).lastAutoTable?.finalY ?? y) + 12;
    };

    // ── Header: logo, title, subtitle ──
    const logo = await loadReportLogo();
    if (logo) {
      const h = 26;
      doc.addImage(logo.dataUrl, 'PNG', pageWidth / 2 - (h * logo.ratio) / 2, y, h * logo.ratio, h);
      y += h + 22;
    } else {
      y += 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...INK);
    doc.text(report.title, pageWidth / 2, y, { align: 'center' });
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...HEADER_GREY);
    doc.text(report.subtitle, pageWidth / 2, y, { align: 'center' });
    y += 10;
    doc.setDrawColor(...LINE_GREY);
    doc.line(margin, y, pageWidth - margin, y);
    y += 20;

    for (const section of report.sections) {
      heading(section.heading);
      table(null, section.rows);
    }

    if (report.tDisc) {
      heading(report.tDisc.heading);
      table(report.tDisc.passes.head, report.tDisc.passes.rows);
      table(report.tDisc.windows.head, report.tDisc.windows.rows);
      paragraph(report.tDisc.summary, 9);
    }

    heading(report.calculation.heading);
    table(report.calculation.head, report.calculation.rows, report.calculation.total);

    // ── Footer on every page ──
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(8);
      doc.setTextColor(...HEADER_GREY);
      doc.text(`${report.footer} · Page ${p} of ${pages}`, margin, pageHeight - 20);
    }

    doc.save(report.fileName);
  }
}
