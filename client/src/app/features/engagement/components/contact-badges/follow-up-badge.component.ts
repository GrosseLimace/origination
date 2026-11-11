import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { Customer } from '@models';
import { ContactBadges } from '../../data-access/contact-badges';

/** A customer list row's follow-up line: the signed-in user's soonest open follow-up for the customer, when they have
 *  one. */
@Component({
  selector: 'app-follow-up-badge',
  standalone: true,
  templateUrl: './follow-up-badge.component.html',
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FollowUpBadgeComponent {
  readonly customer = input.required<Customer>();
  private readonly badges = inject(ContactBadges);
  readonly badge = computed(() => this.badges.followUpOf(this.customer()));
}
