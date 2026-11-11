import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SelectedProducerEngagement } from '@core/context/selected-producer-engagement';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent } from '@shared/components/card/card.component';
import { describeLastContacted } from '@shared/utils/last-contacted';
import { CustomerNotesComponent } from '../customer-notes/customer-notes.component';

/** The customer screen's Notes card, in the home page's right column: the producer's notes, and when they were last contacted. */
@Component({
  selector: 'app-notes-panel',
  standalone: true,
  imports: [CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CustomerNotesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (customer(); as customer) {
      <app-card>
        <app-card-header>
          <div class="flex items-center justify-between">
            <app-card-title>Notes</app-card-title>
            <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                <line x1="16" x2="16" y1="2" y2="6"/>
                <line x1="8" x2="8" y1="2" y2="6"/>
                <line x1="3" x2="21" y1="10" y2="10"/>
              </svg>
              <span class="hidden sm:inline">Last contacted: {{ lastContacted() }}</span>
            </div>
          </div>
        </app-card-header>
        <app-card-content>
          <app-customer-notes [customer]="customer" />
        </app-card-content>
      </app-card>
    }
  `,
})
export class NotesPanelComponent {
  private readonly engagement = inject(SelectedProducerEngagement);
  readonly customer = inject(SelectedCustomerContext).customer;

  /** Never / Today / Yesterday / N days ago / a date, from the producer's most recently created note. */
  readonly lastContacted = computed(() => describeLastContacted(this.engagement.notes()));
}
