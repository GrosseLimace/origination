import { ChangeDetectionStrategy, Component, ErrorHandler, PendingTasks, Type, computed, effect, inject, input, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { CustomerContribution } from './module-manifest';

/** Each contribution's component once its code has loaded, kept for the session and shared by every host. */
const loadedComponents = new WeakMap<CustomerContribution, Type<unknown>>();
/** Loads still in flight, so two hosts showing the same contribution load its code once. */
const pendingLoads = new WeakMap<CustomerContribution, Promise<Type<unknown>>>();

/**
 * Renders one contribution to the customer screen, such as the active tab's content. Its code loads the first time
 * it is shown; after that it renders at once. A contribution whose code fails to load is reported to the
 * ErrorHandler and renders nothing. Its own element takes no space. While the code loads, the app counts as busy
 * (PendingTasks), so whatever waits for the screen to settle waits for the content too.
 */
@Component({
  selector: 'app-customer-contribution',
  standalone: true,
  imports: [NgComponentOutlet],
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (component(); as type) {
      <ng-container *ngComponentOutlet="type" />
    }
  `,
})
export class CustomerContributionComponent {
  readonly contribution = input.required<CustomerContribution>();

  private readonly errorHandler = inject(ErrorHandler);
  private readonly pendingTasks = inject(PendingTasks);
  /** Bumped when a load lands, so `component` re-reads the cache. */
  private readonly loads = signal(0);

  /** The contribution's component, or null while its code is loading. */
  readonly component = computed(() => {
    this.loads();
    return loadedComponents.get(this.contribution()) ?? null;
  });

  constructor() {
    effect(() => {
      const contribution = this.contribution();
      if (loadedComponents.has(contribution)) return;
      let load = pendingLoads.get(contribution);
      if (!load) {
        load = contribution.component();
        pendingLoads.set(contribution, load);
      }
      const done = this.pendingTasks.add();
      load.then(
        type => {
          loadedComponents.set(contribution, type);
          pendingLoads.delete(contribution);
          this.loads.update(count => count + 1);
          done();
        },
        error => {
          pendingLoads.delete(contribution);
          this.errorHandler.handleError(error);
          done();
        },
      );
    });
  }
}
