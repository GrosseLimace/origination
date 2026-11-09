import { Injectable, signal } from '@angular/core';

/** The last producer the customer list scrolled to, kept for the session so coming back to the list doesn't re-scroll. */
@Injectable({ providedIn: 'root' })
export class CustomerListScrollStore {
  private readonly _lastScrolledCustomerId = signal<number | null>(null);

  readonly lastScrolledCustomerId = this._lastScrolledCustomerId.asReadonly();

  setLastScrolledCustomerId(id: number | null): void {
    this._lastScrolledCustomerId.set(id);
  }
}
