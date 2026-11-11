import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { environment } from '@env/environment';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { CalculatorLauncherComponent } from './calculator-launcher.component';

/**
 * The Calculators module's panel on the customer home page: the floating calculator launcher, while a producer is
 * selected, with their name to prefill. Going back to the list takes the launcher away, and any calculator open with
 * it. Switched on per environment.
 */
@Component({
  selector: 'app-calculator-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CalculatorLauncherComponent],
  host: { class: 'contents' },
  templateUrl: './calculator-panel.component.html',
})
export class CalculatorPanelComponent {
  readonly enabled = environment.calculatorEnabled;
  readonly customer = inject(SelectedCustomerContext).customer;
}
