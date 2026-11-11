import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { Customer } from '@models';
import { appliesToSegment, segmentOf } from '@core/context/selected-customer-context.service';
import { ContributionLoader } from './contribution-loader';
import { CustomerRowSlot } from './module-manifest';
import { ModuleRegistry } from './module-registry';

/**
 * Hosts one slot of a customer list row: renders the panels the modules contribute to it, in order, keeping those the
 * user holds the permissions for and that apply to the row's customer, and gives each the customer as its `customer`
 * input. Every row shares one load of each panel's code (ContributionLoader). With nothing to show it renders nothing,
 * and its own element takes no space.
 */
@Component({
  selector: 'app-customer-row-slot',
  standalone: true,
  imports: [NgComponentOutlet],
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (item of shown(); track item.panel) {
      <ng-container *ngComponentOutlet="item.type; inputs: { customer: customer() }" />
    }
  `,
})
export class CustomerRowSlotComponent {
  readonly slot = input.required<CustomerRowSlot>();
  readonly customer = input.required<Customer>();

  private readonly registry = inject(ModuleRegistry);
  private readonly loader = inject(ContributionLoader);

  /** The panels this slot shows for the row's customer, in order, whether or not their code has loaded. */
  readonly panels = computed(() => {
    const segment = segmentOf(this.customer());
    return this.registry.customerPanels(this.slot()).filter(panel => appliesToSegment(panel, segment));
  });

  /** Those of them whose code has loaded. */
  readonly shown = computed(() => this.panels().flatMap(panel => {
    const type = this.loader.loaded().get(panel);
    return type ? [{ panel, type }] : [];
  }));

  constructor() {
    effect(() => {
      for (const panel of this.panels()) this.loader.load(panel);
    });
  }
}
