import { Component, input, signal } from '@angular/core';

import { CALCULATOR_TYPES, CalculatorType } from '../models/calculator.model';
import { CalculatorWidgetComponent } from './calculator-widget.component';

/**
 * Floating launcher for the originator calculators. Renders a fixed FAB on the customer
 * home page; clicking it opens a type picker, and selecting a type opens the movable
 * calculator widget for it. Included once on the home page, gated by the feature flag.
 */
@Component({
  selector: 'app-calculator-launcher',
  standalone: true,
  imports: [CalculatorWidgetComponent],
  templateUrl: './calculator-launcher.component.html',
})
export class CalculatorLauncherComponent {
  /** Selected producer's name — prefilled into the calculator's Farm Name field. */
  readonly producerName = input<string>('');

  readonly types = CALCULATOR_TYPES;
  readonly pickerOpen = signal(false);
  readonly activeType = signal<CalculatorType | null>(null);

  togglePicker(): void {
    this.pickerOpen.update(v => !v);
  }

  select(type: CalculatorType): void {
    this.activeType.set(type);
    this.pickerOpen.set(false);
  }

  closeWidget(): void {
    this.activeType.set(null);
  }

  titleFor(type: CalculatorType): string {
    const label = this.types.find(t => t.type === type)?.label ?? 'Calculator';
    return `${label} Calculator`;
  }
}
