import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { OrganicPanelState, isOrganicProducer } from './organic-panel.state';

/**
 * The Organic badge beside an organic producer's name. It opens and closes the Organic panel under the name, which
 * starts closed for each producer. Its element takes no space, so the badge sits in the badge row like the others.
 */
@Component({
  selector: 'app-organic-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  templateUrl: './organic-badge.component.html',
})
export class OrganicBadgeComponent {
  readonly panel = inject(OrganicPanelState);
  private readonly customer = inject(SelectedCustomerContext).customer;

  readonly shown = computed(() => isOrganicProducer(this.customer()));
  private readonly customerId = computed(() => this.customer()?.id ?? null);

  constructor() {
    // Each producer starts with the panel closed.
    effect(() => {
      this.customerId();
      untracked(() => this.panel.open.set(false));
    });
  }
}
