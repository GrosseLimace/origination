import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { Customer } from '@models';
import { ContactBadges } from '../../data-access/contact-badges';
import { EngagementStore } from '../../data-access/engagement.store';

/** A customer list row's last-contacted line: when the customer or their linked group was last contacted. */
@Component({
  selector: 'app-last-contacted-badge',
  standalone: true,
  templateUrl: './last-contacted-badge.component.html',
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LastContactedBadgeComponent {
  readonly customer = input.required<Customer>();
  private readonly badges = inject(ContactBadges);
  readonly badge = computed(() => this.badges.lastContactOf(this.customer()));

  constructor() {
    // With no trade unit selected Engagement's preload doesn't run, so the badges ask for the summary themselves.
    inject(EngagementStore).ensureLastContacts();
  }
}
