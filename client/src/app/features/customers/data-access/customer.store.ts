import { Injectable, inject, signal } from '@angular/core';
import { Customer } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';

/**
 * The customers of the selected trade units, kept for the session so every screen shares one load: the home page's
 * producer list, Build a List, Actionable Insights and the Planting Dashboard. Customers' preload fills it on each
 * trade-unit change; the home page and Build a List write back customers they onboard or edit.
 */
@Injectable({ providedIn: 'root' })
export class CustomerStore {
  private readonly _customers = signal<Customer[]>([]);
  private readonly _customersLoading = signal(false);
  private readonly _customersLoadFailed = signal(false);

  readonly customers = this._customers.asReadonly();

  /** True while the trade units' customers are loading, so a screen waits rather than showing "no producers". */
  readonly customersLoading = this._customersLoading.asReadonly();

  /**
   * Set when the trade-unit-wide producer read failed, as opposed to returning nothing: an empty producer list
   * otherwise reads as "no producers in these trade units". Clear it from a tap BEFORE the catchError, never from
   * setCustomers: the failure path resolves to an empty array that flows through setCustomers one operator later, so
   * clearing there would undo the flag in the same tick.
   */
  readonly customersLoadFailed = this._customersLoadFailed.asReadonly();

  constructor() {
    // Signing out or timing out drops the customers with the rest of the user's data.
    inject(SessionReset).onReset(() => {
      this._customers.set([]);
      this._customersLoading.set(false);
    });
  }

  setCustomers(customers: Customer[]): void {
    this._customers.set(customers);
  }

  setCustomersLoading(loading: boolean): void {
    this._customersLoading.set(loading);
  }

  setCustomersLoadFailed(failed: boolean): void {
    this._customersLoadFailed.set(failed);
  }
}
