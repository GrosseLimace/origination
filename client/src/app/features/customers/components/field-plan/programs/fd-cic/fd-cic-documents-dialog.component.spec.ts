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
});
