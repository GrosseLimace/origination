import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SelectedProducerEngagement } from '@core/context/selected-producer-engagement';
import { CardComponent } from '@shared/components/card/card.component';
import { CustomerRemindersComponent } from '../customer-reminders/customer-reminders.component';

/**
 * The customer screen's "My follow-ups" card, in the home page's right column: the signed-in user's own follow-ups for
 * the producer. Sits above Notes, being the short, actionable list where Notes is the long history. Shows nothing
 * where follow-ups are switched off.
 */
@Component({
  selector: 'app-follow-ups-panel',
  standalone: true,
  imports: [CardComponent, CustomerRemindersComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (remindersEnabled) {
      @if (customer(); as customer) {
        <app-card>
          <app-customer-reminders [customer]="customer" />
        </app-card>
      }
    }
  `,
})
export class FollowUpsPanelComponent {
  readonly remindersEnabled = inject(SelectedProducerEngagement).remindersEnabled;
  readonly customer = inject(SelectedCustomerContext).customer;
}
