import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { CustomerPrintReportComponent } from './customer-print-report.component';

/**
 * Print in the profile header's buttons, and the Producer Summary Report it opens for the producer on screen. The report
 * stays in place while closed, so the originator details typed into it last until the profile goes. Its element takes
 * no space, so the button sits in the header's row.
 */
@Component({
  selector: 'app-print-report-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CustomerPrintReportComponent],
  host: { class: 'contents' },
  templateUrl: './print-report-button.component.html',
})
export class PrintReportButtonComponent {
  readonly customer = inject(SelectedCustomerContext).customer;
  readonly open = signal(false);
}
