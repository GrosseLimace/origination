import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { ProducerContactItem, ProducerDetails } from '@models';
import { ProducerProfiles } from '@core/context/producer-profiles';

/**
 * The producer's contacts, primary first then in saved order. A producer saved before contacts were a list has the
 * legacy primary contact and phone instead, shown as one starred row.
 */
export function sortedProducerContacts(profile: ProducerDetails | undefined): ProducerContactItem[] {
  if (!profile) return [];
  if (profile.contacts && profile.contacts.length > 0) {
    return [...profile.contacts].sort((a, b) =>
      (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }
  if (profile.primaryContact || profile.primaryPhone) {
    return [{ name: profile.primaryContact || 'Primary Contact', phone: profile.primaryPhone, isPrimary: true }];
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
  private readonly profiles = inject(ProducerProfiles);

  /** Sorted once per producer and change to their details, not on every change-detection pass. */
  readonly contacts = computed(() => {
    const customer = this.customer();
    return sortedProducerContacts(customer ? this.profiles.profileOf(customer.id) : undefined);
  });

  trackCall(): void {
    const id = this.customer()?.id;
    if (id != null) this.usageTracking.trackCallClick(id.toString());
  }

  trackEmail(): void {
    const id = this.customer()?.id;
    if (id != null) this.usageTracking.trackEmailClick(id.toString());
  }
}
