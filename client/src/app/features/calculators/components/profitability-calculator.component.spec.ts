import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ProfitabilityCalculatorComponent } from './profitability-calculator.component';
import { ProfitabilityReportService } from '../services/profitability-report.service';
import { ToastService } from '@core/services/toast.service';

describe('ProfitabilityCalculatorComponent', () => {
  let component: ProfitabilityCalculatorComponent;
  const reportMock = { download: vi.fn().mockResolvedValue(undefined) };
  const toastMock = { error: vi.fn(), success: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [ProfitabilityCalculatorComponent],
      providers: [
        { provide: ProfitabilityReportService, useValue: reportMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    component = TestBed.createComponent(ProfitabilityCalculatorComponent).componentInstance;
  });

  it('starts with one blank, invalid crop', () => {
    expect(component.views().length).toBe(1);
    expect(component.isValid()).toBe(false);
    expect(component.views()[0].missing).toContain('totalAcres');
  });

  it('becomes valid and computes profit once required fields are entered', () => {
    component.setField(0, 'totalAcres', '120');
    component.setField(0, 'yieldPerAcre', '180');
    component.setField(0, 'pricePerBushel', '5.50');
    expect(component.isValid()).toBe(true);
    // revenue 118,800 − fixed 0 (no costs entered) = 118,800 profit
    expect(component.views()[0].result.totalRevenue).toBeCloseTo(118_800, 2);
    expect(component.views()[0].result.profit).toBeCloseTo(118_800, 2);
  });

  it('add-crop appends additional crops (no fixed limit), and remove drops one', () => {
    component.addCrop();
    component.addCrop();
    expect(component.views().length).toBe(3);
    component.removeCrop(1);
    expect(component.views().length).toBe(2);
  });

  it('prefills the first crop Farm Name from the producer', () => {
    const fixture = TestBed.createComponent(ProfitabilityCalculatorComponent);
    fixture.componentRef.setInput('producerName', 'Smith Farms');
    fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.views()[0].form.farmName).toBe('Smith Farms');
  });

  it('blocks PDF export and toasts when required fields are missing', async () => {
    await component.downloadPdf();
    expect(reportMock.download).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalled();
  });
});
