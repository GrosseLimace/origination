import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, ComponentRef, input, output } from '@angular/core';
import { By } from '@angular/platform-browser';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { CalculatorWidgetComponent } from './calculator-widget.component';
import { CalculatorType } from '../models/calculator.model';

/**
 * The widget is the movable shell around one calculator. This pins (through the REAL template):
 *  - the @switch that picks the calculator body by type and forwards the producer name,
 *  - minimize HIDES the body rather than destroying it (entered values must survive a minimize),
 *  - the close button emits `close`,
 *  - a calculator asking for N side-by-side columns widens the panel (N × 18 + 3 rem); one column resets it.
 *
 * The three calculators are replaced with selector-compatible stubs — they have their own specs and
 * pull in report/API services this shell doesn't care about. CdkDrag stays real.
 */

@Component({ selector: 'app-profitability-calculator', standalone: true, template: 'profitability' })
class StubProfitabilityCalculator {
  readonly producerName = input<string>('');
}

@Component({ selector: 'app-check-calculator', standalone: true, template: 'check' })
class StubCheckCalculator {
  readonly producerName = input<string>('');
  readonly columnCount = output<number>();
}

@Component({ selector: 'app-cancel-roll-calculator', standalone: true, template: 'cancel-roll' })
class StubCancelRollCalculator {
  readonly producerName = input<string>('');
  readonly columnCount = output<number>();
}

describe('CalculatorWidgetComponent', () => {
  let fixture: ComponentFixture<CalculatorWidgetComponent>;
  let ref: ComponentRef<CalculatorWidgetComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const panel = (): HTMLElement => host().querySelector('[cdkDrag]') as HTMLElement;
  const body = (): HTMLElement => panel().querySelector('.overflow-auto') as HTMLElement;
  const button = (label: string): HTMLButtonElement =>
    host().querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

  function create(type: CalculatorType, inputs: { title?: string; producerName?: string } = {}): void {
    fixture = TestBed.createComponent(CalculatorWidgetComponent);
    ref = fixture.componentRef;
    ref.setInput('type', type);
    for (const [k, v] of Object.entries(inputs)) ref.setInput(k, v);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.overrideComponent(CalculatorWidgetComponent, {
      set: { imports: [CdkDrag, CdkDragHandle, StubProfitabilityCalculator, StubCheckCalculator, StubCancelRollCalculator] },
    });
    await TestBed.configureTestingModule({ imports: [CalculatorWidgetComponent] }).compileComponents();
  });

  it('renders the calculator matching the type, and only that one', () => {
    create('check');
    expect(host().querySelector('app-check-calculator')).not.toBeNull();
    expect(host().querySelector('app-profitability-calculator')).toBeNull();
    expect(host().querySelector('app-cancel-roll-calculator')).toBeNull();

    ref.setInput('type', 'cancelRoll');
    fixture.detectChanges();
    expect(host().querySelector('app-cancel-roll-calculator')).not.toBeNull();
    expect(host().querySelector('app-check-calculator')).toBeNull();
  });

  it('shows the title in the drag-handle bar and forwards the producer name to the calculator', () => {
    create('profitability', { title: 'Profitability Calculator', producerName: 'Sample Farms' });

    expect(host().querySelector('[cdkDragHandle]')?.textContent).toContain('Profitability Calculator');
    const calc = fixture.debugElement.query(By.directive(StubProfitabilityCalculator)).componentInstance as StubProfitabilityCalculator;
    expect(calc.producerName()).toBe('Sample Farms');
  });

  it('defaults the title to "Calculator"', () => {
    create('profitability');
    expect(host().querySelector('[cdkDragHandle] span')?.textContent?.trim()).toBe('Calculator');
  });

  it('minimize hides the body without destroying the calculator, and expand restores it', () => {
    create('check');
    const calcBefore = fixture.debugElement.query(By.directive(StubCheckCalculator)).componentInstance;

    button('Minimize').click();
    fixture.detectChanges();

    expect(body().classList).toContain('hidden');
    expect(panel().style.height).toBe('auto');
    expect(button('Expand')).not.toBeNull();
    // Same instance → whatever the user typed is still there.
    expect(fixture.debugElement.query(By.directive(StubCheckCalculator)).componentInstance).toBe(calcBefore);

    button('Expand').click();
    fixture.detectChanges();
    expect(body().classList).not.toContain('hidden');
    expect(panel().style.height).toBe('');
  });

  it('emits close when the close button is clicked', () => {
    create('check');
    let closed = 0;
    fixture.componentInstance.close.subscribe(() => closed++);

    button('Close calculator').click();

    expect(closed).toBe(1);
  });

  it('widens the panel when the calculator reports more than one column, and resets at one', () => {
    create('check');
    const calc = fixture.debugElement.query(By.directive(StubCheckCalculator)).componentInstance as StubCheckCalculator;

    calc.columnCount.emit(3);
    fixture.detectChanges();
    expect(panel().style.width).toBe('57rem'); // 3 × 18 + 3

    calc.columnCount.emit(1);
    fixture.detectChanges();
    expect(panel().style.width).toBe('');
  });

  it('takes column-count requests from the cancel-roll calculator too', () => {
    create('cancelRoll');
    const calc = fixture.debugElement.query(By.directive(StubCancelRollCalculator)).componentInstance as StubCancelRollCalculator;

    calc.columnCount.emit(2);
    fixture.detectChanges();

    expect(panel().style.width).toBe('39rem');
  });
});
