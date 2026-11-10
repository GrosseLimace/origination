import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { ProducerEdit, ProducerEditing } from '@core/context/producer-editing';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { EditCustomerDialogComponent } from './edit-customer-dialog.component';

/**
 * Edit in the profile header's buttons, and the Edit Producer Details dialog it opens for the producer on screen. The
 * dialog stays in place while closed, so what it has read once (the trade-unit list, every producer for the link
 * search) is not read again on the next open. Its element takes no space, so the button sits in the header's row.
 */
@Component({
  selector: 'app-edit-producer-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditCustomerDialogComponent],
  host: { class: 'contents' },
  templateUrl: './edit-producer-button.component.html',
})
export class EditProducerButtonComponent {
  private readonly editing = inject(ProducerEditing);
  private readonly usageTracking = inject(UsageTrackingService);

  readonly customer = inject(SelectedCustomerContext).customer;
  readonly open = signal(false);

  /** Hands the edit to the page to save, and closes. */
  save(edit: ProducerEdit): void {
    this.usageTracking.trackProducerDetailsEdit(edit.customerId.toString());
    this.editing.save(edit);
    this.open.set(false);
  }
}
