import { Injectable, inject, signal } from '@angular/core';
import { SessionReset } from '@core/auth/session-reset.service';

/** The last producer the customer list scrolled to, kept for the session so coming back to the list doesn't re-scroll. */
@Injectable({ providedIn: 'root' })
export class CustomerListScrollStore {
  private readonly _lastScrolledCustomerId = signal<number | null>(null);

  readonly lastScrolledCustomerId = this._lastScrolledCustomerId.asReadonly();

  constructor() {
    // Signing out or timing out drops it with the rest of the user's data.
    inject(SessionReset).onReset(() => this._lastScrolledCustomerId.set(null));
  }

  setLastScrolledCustomerId(id: number | null): void {
    this._lastScrolledCustomerId.set(id);
  }
}
