import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, output } from '@angular/core';
import { By } from '@angular/platform-browser';
import { CalculatorLauncherComponent } from './calculator-launcher.component';
import { CalculatorWidgetComponent } from './calculator-widget.component';
import { CALCULATOR_TYPES, CalculatorType } from '../models/calculator.model';

/**
 * The launcher is the FAB → type picker → widget flow on the customer home page. This pins
 * (through the REAL template):
 *  - the FAB toggles the picker and reflects it in aria-expanded,
 *  - the picker lists every registered calculator type,
 *  - choosing one closes the picker and opens the widget with "<Label> Calculator" and the producer name,
 *  - the widget's close output tears it down,
 *  - an outside click or Escape dismisses the picker; a click inside the launcher does not.
 *
 * The widget is swapped for a selector-compatible stub — it has its own spec.
 */

@Component({ selector: 'app-calculator-widget', standalone: true, template: '' })
class StubCalculatorWidget {
  readonly type = input.required<CalculatorType>();
  readonly title = input<string>('Calculator');
  readonly producerName = input<string>('');
  readonly close = output<void>();
}

describe('CalculatorLauncherComponent', () => {
  let fixture: ComponentFixture<CalculatorLauncherComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const fab = (): HTMLButtonElement => host().querySelector('button[aria-label="Open calculators"]') as HTMLButtonElement;
  const menuItems = (): HTMLButtonElement[] => Array.from(host().querySelectorAll('[role="menuitem"]'));
  const widget = (): StubCalculatorWidget | null =>
    fixture.debugElement.query(By.directive(StubCalculatorWidget))?.componentInstance ?? null;

  beforeEach(async () => {
    TestBed.overrideComponent(CalculatorLauncherComponent, {
      remove: { imports: [CalculatorWidgetComponent] },
      add: { imports: [StubCalculatorWidget] },
    });
    await TestBed.configureTestingModule({ imports: [CalculatorLauncherComponent] }).compileComponents();
    fixture = TestBed.createComponent(CalculatorLauncherComponent);
    fixture.componentRef.setInput('producerName', 'Sample Farms');
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  it('starts with the picker closed and no widget', () => {
    expect(host().querySelector('[role="menu"]')).toBeNull();
    expect(fab().getAttribute('aria-expanded')).toBe('false');
    expect(widget()).toBeNull();
  });

  it('the FAB toggles the picker open and closed', () => {
    fab().click();
    fixture.detectChanges();
    expect(host().querySelector('[role="menu"]')).not.toBeNull();
    expect(fab().getAttribute('aria-expanded')).toBe('true');

    fab().click();
    fixture.detectChanges();
    expect(host().querySelector('[role="menu"]')).toBeNull();
  });

  it('lists every registered calculator type in the picker', () => {
    fab().click();
    fixture.detectChanges();

    const labels = menuItems().map(b => b.querySelector('span')?.textContent?.trim());
    expect(labels).toEqual(CALCULATOR_TYPES.map(t => t.label));
  });

  it('choosing a type closes the picker and opens the widget titled for that type, with the producer name', () => {
    fab().click();
    fixture.detectChanges();
    menuItems().find(b => b.textContent?.includes('Cancel vs. Roll'))!.click();
    fixture.detectChanges();

    expect(host().querySelector('[role="menu"]')).toBeNull();
    const w = widget();
    expect(w).not.toBeNull();
    expect(w!.type()).toBe('cancelRoll');
    expect(w!.title()).toBe('Cancel vs. Roll Calculator');
    expect(w!.producerName()).toBe('Sample Farms');
  });

  it('removes the widget when it emits close', () => {
    fab().click();
    fixture.detectChanges();
    menuItems()[0].click();
    fixture.detectChanges();

    widget()!.close.emit();
    fixture.detectChanges();

    expect(widget()).toBeNull();
  });

  it('a click outside the launcher dismisses the picker; a click inside does not', () => {
    document.body.appendChild(fixture.nativeElement);
    fab().click();
    fixture.detectChanges();

    host().querySelector('[role="menu"] p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(host().querySelector('[role="menu"]')).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(host().querySelector('[role="menu"]')).toBeNull();
  });

  it('Escape dismisses the picker', () => {
    fab().click();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(host().querySelector('[role="menu"]')).toBeNull();
  });
});

