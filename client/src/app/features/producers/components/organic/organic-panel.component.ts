import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { OrganicPanelState, isOrganicProducer } from './organic-panel.state';

/**
 * What the Organic badge opens, under the producer's name: their NOP ID. Open, it carries header-panel, which the
 * profile spaces the line below by.
 */
@Component({
  selector: 'app-organic-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  templateUrl: './organic-panel.component.html',
})
export class OrganicPanelComponent {
  readonly panel = inject(OrganicPanelState);
  readonly customer = inject(SelectedCustomerContext).customer;

  readonly shown = computed(() => isOrganicProducer(this.customer()));
}
