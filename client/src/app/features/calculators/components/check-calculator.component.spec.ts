import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CheckCalculatorComponent } from './check-calculator.component';
import { CheckReportService } from '../services/check-report.service';
import { ToastService } from '@core/services/toast.service';

describe('CheckCalculatorComponent', () => {
  let component: CheckCalculatorComponent;
  let fixture: ComponentFixture<CheckCalculatorComponent>;
  const reportMock = { download: vi.fn().mockResolvedValue(undefined) };
  const toastMock = { error: vi.fn(), success: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [CheckCalculatorComponent],
      providers: [
        { provide: CheckReportService, useValue: reportMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckCalculatorComponent);
    component = fixture.componentInstance;
  });

  it('starts with one blank commodity defaulting today + DP rate', () => {
    expect(component.views().length).toBe(1);
    expect(component.views()[0].form.settlementDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(component.views()[0].form.dailyDpFee).toBe('0.002');
  });

  it('computes once bushels + future price are entered', () => {
    component.setField(0, 'bushels', '2000');
    component.setField(0, 'basis', '-0.70');
    component.setField(0, 'futurePrice', '5.57');
    expect(component.views()[0].result.cashPrice).toBeCloseTo(4.87, 2);
    expect(component.views()[0].result.totalBeforeFees).toBeCloseTo(9740, 2);
  });

  it('reformats a leading-minus entry to accounting parentheses on blur', () => {
    component.setField(0, 'basis', '-0.70');
    component.normalizeField(0, 'basis');
    expect(component.views()[0].form.basis).toBe('(0.70)');
    // positives and blanks are left as-is
    component.setField(0, 'futurePrice', '5.57');
    component.normalizeField(0, 'futurePrice');
    expect(component.views()[0].form.futurePrice).toBe('5.57');
  });

  it('does not turn a lone "-" into empty parentheses on blur', () => {
    component.setField(0, 'basis', '-');
    component.normalizeField(0, 'basis');
    expect(component.views()[0].form.basis).toBe('-');
  });

  it('converts a percent-mode check-off entry (e.g. "2") to 2% of value', () => {
    component.setField(0, 'bushels', '2000');
    component.setField(0, 'futurePrice', '5.57');
    component.setField(0, 'basis', '-0.70');
    component.setField(0, 'checkOffMode', 'percent');
    component.setField(0, 'checkOffValue', '2');
    expect(component.views()[0].result.totalCheckOff).toBeCloseTo(-194.8, 2); // −(9740 × 0.02)
  });

  it('applies a $-mode check-off decimal directly to gross value', () => {
    component.setField(0, 'bushels', '2000');
    component.setField(0, 'futurePrice', '5.57');
    component.setField(0, 'basis', '-0.70');
    component.setField(0, 'checkOffMode', 'perBushel');
    component.setField(0, 'checkOffValue', '0.01');
    // $ mode uses the decimal as-is: −(9740 × 0.01), NOT × bushels
    expect(component.views()[0].result.totalCheckOff).toBeCloseTo(-97.4, 2);
  });

  it('computes Total Freight as freight per bushel × bushels (negative)', () => {
    component.setField(0, 'bushels', '2000');
    component.setField(0, 'freightPerBushel', '0.10');
    expect(component.views()[0].result.totalFreight).toBeCloseTo(-200, 2);
  });

  it('treats parentheses as negative (accounting notation): (0.70) === -0.70', () => {
    component.setField(0, 'bushels', '2000');
    component.setField(0, 'futurePrice', '5.57');
    component.setField(0, 'basis', '(0.70)');
    expect(component.views()[0].result.cashPrice).toBeCloseTo(4.87, 2); // 5.57 − 0.70
  });

  it('add/remove commodity columns', () => {
    component.addCommodity();
    expect(component.views().length).toBe(2);
    component.removeCommodity(1);
    expect(component.views().length).toBe(1);
  });

  it('prefills the producer from the producerName input', () => {
    fixture.componentRef.setInput('producerName', 'Acme Farms');
    fixture.detectChanges(); // runs ngOnInit
    expect(component.producer()).toBe('Acme Farms');
  });

  it('exports a PDF with the producer and current commodities', async () => {
    fixture.componentRef.setInput('producerName', 'Acme Farms');
    fixture.detectChanges();
    component.setField(0, 'bushels', '2000');
    await component.downloadPdf();
    expect(reportMock.download).toHaveBeenCalledWith(
      'Acme Farms',
      expect.arrayContaining([expect.objectContaining({ input: expect.anything(), result: expect.anything() })]),
    );
  });

  it('exports a PDF even with empty inputs (no required fields)', async () => {
    await component.downloadPdf();
    expect(reportMock.download).toHaveBeenCalled();
  });
});
