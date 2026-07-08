import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CancelRollCalculatorComponent } from './cancel-roll-calculator.component';
import { CancelRollReportService } from '../services/cancel-roll-report.service';
import { ToastService } from '@core/services/toast.service';

describe('CancelRollCalculatorComponent', () => {
  let component: CancelRollCalculatorComponent;
  let fixture: ComponentFixture<CancelRollCalculatorComponent>;
  const reportMock = { download: vi.fn().mockResolvedValue(undefined) };
  const toastMock = { error: vi.fn(), success: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [CancelRollCalculatorComponent],
      providers: [
        { provide: CancelRollReportService, useValue: reportMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CancelRollCalculatorComponent);
    component = fixture.componentInstance;
  });

  it('starts blank with a zero result', () => {
    expect(component.result().buyOut).toBe(0);
    expect(component.result().newCashPriceNextYear).toBe(0);
  });

  it('computes both options from the shared cash price (sheet example)', () => {
    component.setField('cashPriceToday', '5.95');
    component.setField('contractAvgPrice', '5.92');
    component.setField('cancelFee', '0.20');
    component.setField('bushels', '2335');
    component.setField('cashPriceNextYear', '6.24');
    component.setField('hedgeCost', '0.12');
    component.setField('contractCashPrice', '5.92');

    expect(component.result().costToCancel).toBeCloseTo(0.23, 2);
    expect(component.result().buyOut).toBeCloseTo(537.05, 2);
    expect(component.result().costToRoll).toBeCloseTo(-0.17, 2);
    expect(component.result().newCashPriceNextYear).toBeCloseTo(6.09, 2);
  });

  it('treats parentheses as negative (accounting notation)', () => {
    component.setField('cashPriceToday', '5.95');
    component.setField('cashPriceNextYear', '6.24');
    component.setField('hedgeCost', '(0.12)'); // −0.12
    expect(component.result().costToRoll).toBeCloseTo(-0.41, 2); // 5.95 − 6.24 − 0.12
  });

  it('reformats a leading-minus entry to accounting parentheses on blur', () => {
    component.setField('hedgeCost', '-0.12');
    component.normalizeField('hedgeCost');
    expect(component.view().hedgeCost).toBe('(0.12)');
  });

  it('prefills the producer and emits a 2-column request on init', () => {
    const spy = vi.fn();
    component.columnCount.subscribe(spy);
    fixture.componentRef.setInput('producerName', 'Acme Farms');
    fixture.detectChanges(); // runs ngOnInit
    expect(component.producer()).toBe('Acme Farms');
    expect(spy).toHaveBeenCalledWith(2);
  });

  it('exports a PDF with the producer, inputs, and result', async () => {
    fixture.componentRef.setInput('producerName', 'Acme Farms');
    fixture.detectChanges();
    component.setField('bushels', '2335');
    await component.downloadPdf();
    expect(reportMock.download).toHaveBeenCalledWith(
      'Acme Farms',
      expect.objectContaining({ bushels: 2335 }),
      expect.objectContaining({ buyOut: expect.any(Number) }),
    );
  });
});
