import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { Customer } from '@models';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { ProducerProfileStore } from '../../data-access/producer-profile.store';

/** A customer list row's acres, beside the producer's name: the farm acres in their saved details, 0 without any. */
@Component({
  selector: 'app-acres-badge',
  standalone: true,
  imports: [BadgeComponent, DecimalPipe],
  templateUrl: './acres-badge.component.html',
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcresBadgeComponent {
  readonly customer = input.required<Customer>();
  private readonly profiles = inject(ProducerProfileStore);
  readonly acres = computed(() => this.profiles.profileOf(this.customer().id)?.totalAcres ?? 0);
}
