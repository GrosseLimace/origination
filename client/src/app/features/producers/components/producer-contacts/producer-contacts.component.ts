import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, ProducerContactItem } from '@models';

/**
 * The producer's contacts, primary first then in saved order. A producer saved before contacts were a list has the
 * legacy primary contact and phone instead, shown as one starred row.
 */
export function sortedProducerContacts(customer: Customer | null): ProducerContactItem[] {
  if (!customer) return [];
  if (customer.contacts && customer.contacts.length > 0) {
    return [...customer.contacts].sort((a, b) =>
      (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }
  if (customer.primaryContact || customer.primaryPhone) {
    return [{ name: customer.primaryContact || 'Primary Contact', phone: customer.primaryPhone, isPrimary: true }];
  }
  return [];
}

/**
 * The user-entered contacts at the top of the profile's Contact and Locations column, one row each: name, phone and
 * email, the primary one starred. Its element takes no space, so each row is one of the column's own.
 */
@Component({
  selector: 'app-producer-contacts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  templateUrl: './producer-contacts.component.html',
})
export class ProducerContactsComponent {
  private readonly customer = inject(SelectedCustomerContext).customer;
  private readonly usageTracking = inject(UsageTrackingService);

  /** Sorted once per producer, not on every change-detection pass. */
  readonly contacts = computed(() => sortedProducerContacts(this.customer()));

  trackCall(): void {
    const id = this.customer()?.id;
    if (id != null) this.usageTracking.trackCallClick(id.toString());
  }

  trackEmail(): void {
    const id = this.customer()?.id;
    if (id != null) this.usageTracking.trackEmailClick(id.toString());
  }
}
