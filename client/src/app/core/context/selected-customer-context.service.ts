import { Injectable, Signal, computed, inject } from '@angular/core';
import { Customer, CustomerSegment } from '@models';
import { AppStateService } from '@core/services/app-state.service';

/**
 * The customer the customer screen is showing, for what the modules contribute to that screen: a contribution reads
 * the customer here rather than through inputs. The home page provides one for its whole view, so the slots outside
 * the profile (the sidebar and the floating launcher) see the same customer as the profile's tabs and panels.
 */
@Injectable()
export class SelectedCustomerContext {
  /** The selected customer, or null before one is picked. */
  readonly customer: Signal<Customer | null> = inject(AppStateService).selectedCustomer;

  /**
   * The selected customer's segment, or null with no customer. Every customer is a producer until customers carry a
   * segment of their own.
   */
  readonly segment = computed<CustomerSegment | null>(() => (this.customer() ? 'Producer' : null));

  /**
   * Whether a contribution applies to the selected customer: it lists no segments, or the customer's segment is among
   * them. With no customer selected, only contributions for every customer apply.
   */
  appliesTo(contribution: { readonly segments?: readonly CustomerSegment[] }): boolean {
    const segments = contribution.segments ?? [];
    if (segments.length === 0) return true;
    const segment = this.segment();
    return segment !== null && segments.includes(segment);
  }
}
