import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApiError } from '@core/errors/api-error';
import { ToastService } from '@core/services/toast.service';
import { FieldPlanDocument } from '@models';
import { FieldPlanDocumentsService } from '../../store/field-plan-documents.service';
import { FdCicDocumentsDialogComponent } from './fd-cic-documents-dialog.component';

describe('FdCicDocumentsDialogComponent', () => {
  const doc = (over: Partial<FieldPlanDocument>): FieldPlanDocument => ({
    id: 'd', fileName: 'f.pdf', contentType: 'application/pdf', size: 2048, uploadedAt: '2026-11-04T15:00:00Z',
    uploadedBy: 'Tess Tester', documentType: 'Other', cropYear: 2026, ...over,
  });
  const reports = [
    doc({ id: 'r1', fileName: 'report-43.pdf', documentType: 'FeedstockReport', splitId: 'TATOB43', commodity: 'YC' }),
    doc({ id: 'r2', fileName: 'report-44.pdf', documentType: 'FeedstockReport', splitId: 'TATOB44', commodity: 'YC' }),
  ];
  const attestation = doc({ id: 'a1', fileName: 'attestation.pdf', documentType: 'ProducerAttestation' });

  let service: { enabled: boolean; list: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn>; content: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<FdCicDocumentsDialogComponent>;
  let dialog: FdCicDocumentsDialogComponent;

  beforeEach(async () => {
    service = { enabled: true, list: vi.fn().mockResolvedValue([attestation, ...reports]), upload: vi.fn(), content: vi.fn() };
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
    await vi.waitFor(() => expect(dialog.loading()).toBe(false));
  });

  const section = (type: string) => dialog.visibleSections().find(s => s.type === type)!;

  it('should list the producer\'s documents for the year, the attestation first and then each field\'s report', () => {
    expect(service.list).toHaveBeenCalledWith(260843, 2026);
    expect(dialog.visibleSections().map(s => s.type)).toEqual(['ProducerAttestation', 'FeedstockReport', 'Other']);
    expect(section('ProducerAttestation').docs.map(d => d.id)).toEqual(['a1']);
    expect(section('FeedstockReport').docs.map(d => d.id)).toEqual(['r1', 'r2']);
  });

  it('should filter by type, and the reports by field', () => {
    dialog.splitFilter.set('TATOB44');
    expect(section('FeedstockReport').docs.map(d => d.id)).toEqual(['r2']);
    expect(section('ProducerAttestation').docs.map(d => d.id)).toEqual(['a1']);

    dialog.typeFilter.set('FeedstockReport');
    expect(dialog.visibleSections().map(s => s.type)).toEqual(['FeedstockReport']);
  });

  it('should upload a signed attestation for the producer and year and show it', async () => {
    const file = new File(['%PDF-1.7'], 'signed.pdf', { type: 'application/pdf' });
    const saved = doc({ id: 'a2', fileName: 'signed.pdf', documentType: 'ProducerAttestation' });
    service.upload.mockResolvedValue(saved);
    dialog.chosen.set(file);

    await dialog.upload();

    expect(service.upload).toHaveBeenCalledWith(260843, 2026, 'ProducerAttestation', file);
    expect(section('ProducerAttestation').docs.map(d => d.id)).toEqual(['a2', 'a1']);
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

  it('should only offer View for a PDF or an image', () => {
    expect(dialog.viewable(doc({ contentType: 'application/pdf' }))).toBe(true);
    expect(dialog.viewable(doc({ contentType: 'image/jpeg' }))).toBe(true);
    expect(dialog.viewable(doc({ contentType: 'text/html' }))).toBe(false);
  });

  describe('View', () => {
    const el = () => fixture.nativeElement as HTMLElement;
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
