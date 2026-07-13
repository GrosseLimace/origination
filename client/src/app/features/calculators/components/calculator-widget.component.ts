import { Component, input, output, signal } from '@angular/core';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';

import { CalculatorType } from '../models/calculator.model';
import { ProfitabilityCalculatorComponent } from './profitability-calculator.component';
import { CheckCalculatorComponent } from './check-calculator.component';
import { CancelRollCalculatorComponent } from './cancel-roll-calculator.component';

/**
 * Movable, non-modal calculator panel. Draggable by its title bar via CDK drag-drop
 * (same primitive the Bid Sheet uses). Renders the active calculator by type.
 */
@Component({
  selector: 'app-calculator-widget',
  standalone: true,
  imports: [CdkDrag, CdkDragHandle, ProfitabilityCalculatorComponent, CheckCalculatorComponent, CancelRollCalculatorComponent],
  templateUrl: './calculator-widget.component.html',
})
export class CalculatorWidgetComponent {
  readonly type = input.required<CalculatorType>();
  readonly title = input<string>('Calculator');
  readonly producerName = input<string>('');
  readonly close = output<void>();

  readonly minimized = signal(false);
  /** Explicit panel width when a calculator asks to grow (e.g. add-commodity); null = default width. */
  readonly panelWidth = signal<string | null>(null);

  toggleMinimize(): void {
    this.minimized.update(v => !v);
  }

  /** Auto-size the panel to fit N side-by-side columns (capped by max-w). One column → default. */
  onColumnCount(count: number): void {
    this.panelWidth.set(count > 1 ? `${count * 18 + 3}rem` : null);
  }
}
