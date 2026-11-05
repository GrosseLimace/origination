import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApiError } from '@core/errors/api-error';
import { ToastService } from '@core/services/toast.service';
import { FieldPlanDocument } from '@models';
import { FieldPlanDocumentsService } from '../../store/field-plan-documents.service';
import { FdCicDocumentsDialogComponent } from './fd-cic-documents-dialog.component';
import { parseCsv } from './csv-table';

describe('FdCicDocumentsDialogComponent', () => {
  const doc = (over: Partial<FieldPlanDocument>): FieldPlanDocument => ({
    id: 'd', fileName: 'f.pdf', contentType: 'application/pdf', size: 2048, uploadedAt: '2026-11-04T15:00:00Z',
    uploadedBy: 'Tess Tester', documentType: 'Other', cropYear: 2026, status: 'Current', ...over,
  });
  const south = { splitId: 'TATOB43', fieldName: 'South Field', commodity: 'Sorghum' };
  const north = { splitId: 'TATOB44', fieldName: 'North Field', commodity: 'Sorghum' };
  const reports = [
    doc({ id: 'r1', fileName: 'report-43.pdf', documentType: 'FeedstockReport', ...south }),
    doc({ id: 'r2', fileName: 'report-44.pdf', documentType: 'FeedstockReport', ...north }),
  ];
  const ledgers = [
    doc({ id: 'l1', fileName: 'ledger-43.csv', contentType: 'text/csv', documentType: 'MassBalanceLedger', ...south }),
    doc({ id: 'l2', fileName: 'ledger-44.csv', contentType: 'text/csv', documentType: 'MassBalanceLedger', ...north }),
  ];
  const attestation = doc({ id: 'a1', fileName: 'attestation.pdf', documentType: 'ProducerAttestation' });
  /** The version history: a report overwritten by r1, and last year's archived attestation. */
  const overwritten = doc({ id: 'r0', fileName: 'report-43-old.pdf', documentType: 'FeedstockReport', ...south, status: 'Overwritten',
    statusChangedAt: '2026-11-04T15:00:00Z', statusChangedBy: 'Hope Collins', replacedById: 'r1' });
  const archived2025 = doc({ id: 'a0', fileName: 'attestation-2025.pdf', documentType: 'ProducerAttestation', cropYear: 2025, status: 'Archived',
    statusChangedAt: '2026-01-10T15:00:00Z', statusChangedBy: 'Tess Tester', statusNote: 'Superseded by the 2026 attestation' });
  const lastYearReport = doc({ id: 'r9', fileName: 'report-2025.pdf', documentType: 'FeedstockReport', cropYear: 2025, ...north });

  let service: Record<'list' | 'upload' | 'content' | 'archive' | 'restore', ReturnType<typeof vi.fn>> & { enabled: boolean };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<FdCicDocumentsDialogComponent>;
  let dialog: FdCicDocumentsDialogComponent;

  beforeEach(async () => {
    service = {
      enabled: true, upload: vi.fn(), content: vi.fn(), archive: vi.fn(), restore: vi.fn(),
      list: vi.fn().mockResolvedValue([attestation, ...reports, ...ledgers, overwritten, archived2025, lastYearReport]),
    };
    toast = { success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({ providers: [
      { provide: FieldPlanDocumentsService, useValue: service },
      { provide: ToastService, useValue: toast },
    ] });
    fixture = TestBed.createComponent(FdCicDocumentsDialogComponent);
    fixture.componentRef.setInput('customerId', 260843);
    fixture.componentRef.setInput('year', 2026);
    fixture.componentRef.setInput('producerName', 'T-A Tobin Farms');
    fixture.detectChanges();
    dialog = fixture.componentInstance;
    // Room for a busy parallel run: the load is one resolved promise, but the default 1 s has timed out under load.
    await vi.waitFor(() => expect(dialog.documents().length).toBeGreaterThan(0), { timeout: 5000 });
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const section = (type: string) => dialog.visibleSections().find(s => s.type === type)!;
  const ids = (docs: FieldPlanDocument[]) => docs.map(d => d.id);

  it('should list the year\'s current documents: the attestation, then each field\'s report and ledger, then other', () => {
    expect(service.list).toHaveBeenCalledWith(260843);
    expect(dialog.visibleSections().map(s => s.type)).toEqual(['ProducerAttestation', 'FeedstockReport', 'MassBalanceLedger', 'Other']);
    expect(ids(section('ProducerAttestation').docs)).toEqual(['a1']);
    expect(ids(section('FeedstockReport').docs)).toEqual(['r1', 'r2']);
    expect(ids(section('MassBalanceLedger').docs)).toEqual(['l1', 'l2']);
  });

  it('should name each report and ledger by its field and year', () => {
    fixture.detectChanges();
    const ledgersText = el().querySelector('[data-testid="section-MassBalanceLedger"]')!.textContent!;
    expect(ledgersText).toContain('South Field (TATOB43) · 2026 · Sorghum');
    expect(ledgersText).toContain('North Field (TATOB44) · 2026');
    expect(dialog.describe(ledgers[0])).toBe('45Z Mass Balance Ledger · South Field (TATOB43) · 2026');
    expect(dialog.describe(attestation)).toBe('Producer attestation · 2026');
  });

  it('should filter by type, and the reports and ledgers by field', () => {
    expect(dialog.fields().map(f => f.label)).toEqual(['North Field (TATOB44)', 'South Field (TATOB43)']);
    dialog.splitFilter.set('TATOB44');
    expect(ids(section('FeedstockReport').docs)).toEqual(['r2']);
    expect(ids(section('MassBalanceLedger').docs)).toEqual(['l2']);
    expect(ids(section('ProducerAttestation').docs)).toEqual(['a1']);

    dialog.typeFilter.set('MassBalanceLedger');
    expect(dialog.visibleSections().map(s => s.type)).toEqual(['MassBalanceLedger']);
  });

  it('should upload a signed attestation for the producer and year and show it', async () => {
    const file = new File(['%PDF-1.7'], 'signed.pdf', { type: 'application/pdf' });
    const saved = doc({ id: 'a2', fileName: 'signed.pdf', documentType: 'ProducerAttestation' });
    service.upload.mockResolvedValue(saved);
    dialog.chosen.set(file);

    await dialog.upload();

    expect(service.upload).toHaveBeenCalledWith(260843, 2026, 'ProducerAttestation', file);
    expect(ids(section('ProducerAttestation').docs)).toEqual(['a2', 'a1']);
    expect(dialog.chosen()).toBeNull();
    expect(toast.success).toHaveBeenCalled();
  });

  it('should show the server\'s reason when an upload is refused, and keep the file chosen', async () => {
    const file = new File(['<html>'], 'not-a.pdf');
    service.upload.mockRejectedValue(new ApiError({ status: 400, message: 'Upload a PDF, PNG or JPEG.' }));
    dialog.chosen.set(file);

    await dialog.upload();

    expect(toast.error).toHaveBeenCalledWith('Upload a PDF, PNG or JPEG.');
    expect(dialog.chosen()).toBe(file);
  });

  it('should say when the documents can\'t be loaded, and try again', async () => {
    service.list.mockRejectedValueOnce(new ApiError({ status: 503, message: 'Doc Store isn\'t set up in this environment yet.' }));
    await dialog.load();
    expect(dialog.loadError()).toBe('Doc Store isn\'t set up in this environment yet.');

    await dialog.load();
    expect(dialog.loadError()).toBeNull();
  });

  it('should only offer View for a PDF, an image or a ledger', () => {
    expect(dialog.viewable(doc({ contentType: 'application/pdf' }))).toBe(true);
    expect(dialog.viewable(doc({ contentType: 'image/jpeg' }))).toBe(true);
    expect(dialog.viewable(doc({ contentType: 'text/csv' }))).toBe(true);
    expect(dialog.viewable(doc({ contentType: 'text/html' }))).toBe(false);
  });

  describe('Archive', () => {
    it('should archive a document with the reason given, moving it to the version history', async () => {
      service.archive.mockResolvedValue({ ...attestation, status: 'Archived', statusNote: 'Signed for the wrong year', statusChangedAt: '2026-11-05T15:00:00Z' });
      dialog.startArchive(attestation);
      dialog.archiveNote.set('  Signed for the wrong year ');

      await dialog.archive(attestation);

      expect(service.archive).toHaveBeenCalledWith(260843, 'a1', 'Signed for the wrong year');
      expect(ids(section('ProducerAttestation').docs)).toEqual([]);
      expect(ids(dialog.visibleHistory())).toContain('a1');
      expect(dialog.archiving()).toBeNull();
    });

    it('should send no reason when none is given, and keep the document current when the archive fails', async () => {
      service.archive.mockRejectedValue(new ApiError({ status: 409, message: 'Only a current document can be archived.' }));
      dialog.startArchive(ledgers[0]);

      await dialog.archive(ledgers[0]);

      expect(service.archive).toHaveBeenCalledWith(260843, 'l1', null);
      expect(toast.error).toHaveBeenCalledWith('Only a current document can be archived.');
      expect(ids(section('MassBalanceLedger').docs)).toEqual(['l1', 'l2']);
    });
  });

  describe('Version history', () => {
    beforeEach(() => {
      dialog.tab.set('history');
      fixture.detectChanges();
    });

    it('should start on the dialog\'s year, and tell overwritten from archived', () => {
      expect(dialog.historyYear()).toBe(2026);
      expect(ids(dialog.visibleHistory())).toEqual(['r0']);
      expect(dialog.statusLine(overwritten)).toMatch(/^Overwritten 11\/04\/26 when the field's CI was confirmed again by Hope Collins$/);
      expect(dialog.statusLine(archived2025)).toBe('Archived 01/10/26 by Tess Tester: Superseded by the 2026 attestation');
      expect(el().querySelector('[data-testid="history-list"]')!.textContent).toContain('Overwritten');
    });

    it('should filter by year, type, field and status', () => {
      dialog.historyYear.set(0);
      expect(ids(dialog.visibleHistory())).toEqual(['r0', 'a0']);
      expect(dialog.historyYears()).toEqual([2026, 2025]);

      dialog.historyStatus.set('Archived');
      expect(ids(dialog.visibleHistory())).toEqual(['a0']);
      dialog.historyStatus.set('');

      dialog.historyType.set('FeedstockReport');
      expect(dialog.historyFields().map(f => f.splitId)).toEqual(['TATOB43']);
      dialog.historySplit.set('TATOB43');
      expect(ids(dialog.visibleHistory())).toEqual(['r0']);

      // A field filter doesn't apply to attestations, so it's offered only for reports and ledgers.
      dialog.historyType.set('ProducerAttestation');
      expect(dialog.historyFields()).toEqual([]);
      expect(ids(dialog.visibleHistory())).toEqual(['a0']);
    });

    it('should restore an archived document to current', async () => {
      dialog.historyYear.set(2025);
      service.restore.mockResolvedValue({ ...archived2025, status: 'Current', statusNote: null });

      await dialog.restore(archived2025);

      expect(service.restore).toHaveBeenCalledWith(260843, 'a0');
      expect(ids(dialog.visibleHistory())).toEqual([]);
      expect(dialog.documents().find(d => d.id === 'a0')!.status).toBe('Current');
    });

    it('should say why a restore is refused', async () => {
      service.restore.mockRejectedValue(new ApiError({ status: 409, message: 'This field has a newer Biofuel Feedstock Report.' }));

      await dialog.restore(archived2025);

      expect(toast.error).toHaveBeenCalledWith('This field has a newer Biofuel Feedstock Report.');
      expect(dialog.documents().find(d => d.id === 'a0')!.status).toBe('Archived');
    });
  });

  describe('View', () => {
    let created: Blob[];

    beforeEach(() => {
      created = [];
      URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return `blob:doc-${created.length}`; });
      URL.revokeObjectURL = vi.fn();
      service.content.mockResolvedValue(new Blob(['%PDF-1.7']));
    });

    it('should show the document inside the dialog, typed from the allow-list, and go back to the list', async () => {
      await dialog.view(attestation);
      fixture.detectChanges();

      expect(service.content).toHaveBeenCalledWith(260843, 'a1');
      expect(created[0].type).toBe('application/pdf');
      expect(el().querySelector('[data-testid="document-viewer"]')).not.toBeNull();
      expect(el().querySelector('iframe')!.src).toBe('blob:doc-1');

      dialog.closeViewer();
      fixture.detectChanges();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:doc-1');
      expect(el().querySelector('iframe')).toBeNull();
      expect(el().textContent).toContain('Producer attestation');
    });

    it('should show a ledger as a table', async () => {
      service.content.mockResolvedValue(new Blob([String.fromCharCode(0xfeff) +
        'Producer code,Field,CI (g CO2e/bu)\r\nTATOBIN,"South Field, east",1435.88\r\n']));

      await dialog.view(ledgers[0]);
      fixture.detectChanges();

      const table = el().querySelector('[data-testid="ledger-table"]')!;
      expect([...table.querySelectorAll('th')].map(th => th.textContent!.trim())).toEqual(['Producer code', 'Field', 'CI (g CO2e/bu)']);
      expect([...table.querySelectorAll('td')].map(td => td.textContent!.trim())).toEqual(['TATOBIN', 'South Field, east', '1435.88']);
      expect(el().querySelector('iframe')).toBeNull();
      expect(created[0].type).toBe('text/csv');
    });

    it('should open an overwritten document from the version history', async () => {
      dialog.tab.set('history');
      await dialog.view(overwritten);
      fixture.detectChanges();

      expect(service.content).toHaveBeenCalledWith(260843, 'r0');
      expect(el().textContent).toContain('Back to version history');
    });

    it('should say so, and offer Download, when the browser is set to download PDFs rather than show them', async () => {
      Object.defineProperty(navigator, 'pdfViewerEnabled', { value: false, configurable: true });
      try {
        await dialog.view(attestation);
        fixture.detectChanges();

        expect(el().querySelector('iframe')).toBeNull();
        expect(el().textContent).toContain('set to download PDFs');
        expect([...el().querySelectorAll('button')].some(b => b.textContent?.trim() === 'Download')).toBe(true);
      } finally {
        Object.defineProperty(navigator, 'pdfViewerEnabled', { value: true, configurable: true });
      }
    });

    it('should stay on the list and say why when the document can\'t be fetched', async () => {
      service.content.mockRejectedValue(new ApiError({ status: 404, message: 'Document not found.' }));

      await dialog.view(attestation);

      expect(dialog.viewing()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Document not found.');
    });
  });
});

describe('parseCsv', () => {
  it('should read quoted cells with commas, quotes and line breaks, and drop the byte-order mark', () => {
    expect(parseCsv(String.fromCharCode(0xfeff) + 'a,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
    expect(parseCsv('a,b\n1,')).toEqual([['a', 'b'], ['1', '']]);
  });
});
