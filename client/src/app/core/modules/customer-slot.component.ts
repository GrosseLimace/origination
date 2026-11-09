import { ChangeDetectionStrategy, Component, ErrorHandler, Type, computed, effect, inject, input, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { CustomerPanel, CustomerSlot } from './module-manifest';
import { ModuleRegistry } from './module-registry';

/**
 * Hosts one slot of the customer screen: renders the panels the modules contribute to it, in order, keeping those the
 * user holds the permissions for and that apply to the selected customer. Each panel's code loads the first time it is
 * shown, and the slot shows panels as they arrive, still in order. With nothing to show it renders nothing, and its
 * own element takes no space, so the host's layout sees only the panels.
 */
@Component({
  selector: 'app-customer-slot',
  standalone: true,
  imports: [NgComponentOutlet],
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (item of shown(); track item.panel) {
      <ng-container *ngComponentOutlet="item.type" />
    }
  `,
})
export class CustomerSlotComponent {
  readonly slot = input.required<CustomerSlot>();

  private readonly registry = inject(ModuleRegistry);
  private readonly context = inject(SelectedCustomerContext);
  private readonly errorHandler = inject(ErrorHandler);

  /** Each panel's component, once its code has loaded. Keyed by the manifest's own object, which never changes. */
  private readonly loaded = signal<ReadonlyMap<CustomerPanel, Type<unknown>>>(new Map());
  private readonly requested = new Set<CustomerPanel>();

  /** The panels this slot shows, in order, whether or not their code has loaded. */
  readonly panels = computed(() => this.registry.customerPanels(this.slot()).filter(panel => this.context.appliesTo(panel)));

  /** Those of them whose code has loaded. */
  readonly shown = computed(() => this.panels().flatMap(panel => {
    const type = this.loaded().get(panel);
    return type ? [{ panel, type }] : [];
  }));

  constructor() {
    effect(() => {
      for (const panel of this.panels()) this.load(panel);
    });
  }

  /**
   * Loads a panel's code once. If it fails (a deploy replaced the chunk, the network dropped), the error is reported
   * and the panel stays out; the slot's other panels are unaffected.
   */
  private load(panel: CustomerPanel): void {
    if (this.requested.has(panel)) return;
    this.requested.add(panel);
    panel.component().then(
      type => this.loaded.update(loaded => new Map(loaded).set(panel, type)),
      error => this.errorHandler.handleError(error),
    );
  }
}
