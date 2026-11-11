import { ErrorHandler, Injectable, PendingTasks, Type, inject, signal } from '@angular/core';
import { CustomerPanel } from './module-manifest';

/**
 * Loads the code of the panels the customer list's rows show, once for the session, so every row shares one load. A
 * panel whose code fails to load is reported and stays out; the app counts as busy while one loads.
 */
@Injectable({ providedIn: 'root' })
export class ContributionLoader {
  private readonly errorHandler = inject(ErrorHandler);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly requested = new Set<CustomerPanel>();
  private readonly _loaded = signal<ReadonlyMap<CustomerPanel, Type<unknown>>>(new Map());

  /** Each panel's component, once its code has loaded. Keyed by the manifest's own object, which never changes. */
  readonly loaded = this._loaded.asReadonly();

  /** Starts loading a panel's code, unless it has been asked for already. */
  load(panel: CustomerPanel): void {
    if (this.requested.has(panel)) return;
    this.requested.add(panel);
    const done = this.pendingTasks.add();
    panel.component().then(
      type => { this._loaded.update(loaded => new Map(loaded).set(panel, type)); done(); },
      error => { this.errorHandler.handleError(error); done(); },
    );
  }
}
