import { Component, input, output, signal } from '@angular/core';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';

import { CalculatorType } from '../models/calculator.model';
import { ProfitabilityCalculatorComponent } from './profitability-calculator.component';

/**
 * Movable, non-modal calculator panel. Draggable by its title bar via CDK drag-drop
 * (same primitive the Bid Sheet uses). Renders the active calculator by type.
 */
@Component({
  selector: 'app-calculator-widget',
  standalone: true,
  imports: [CdkDrag, CdkDragHandle, ProfitabilityCalculatorComponent],
  templateUrl: './calculator-widget.component.html',
})
export class CalculatorWidgetComponent {
  readonly type = input.required<CalculatorType>();
  readonly title = input<string>('Calculator');
  readonly producerName = input<string>('');
  readonly close = output<void>();

  readonly minimized = signal(false);

  toggleMinimize(): void {
    this.minimized.update(v => !v);
  }
}
