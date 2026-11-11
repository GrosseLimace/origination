import { Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * Which of its customers the customer list keeps: every one; none decided yet, while the filter works them out (the
 * list keeps what it shows and says `message`); or those with the ids given.
 */
export type KeptCustomers =
  | { readonly kind: 'all' }
  | { readonly kind: 'pending'; readonly message: string }
  | { readonly kind: 'some'; readonly ids: ReadonlySet<number> };

const ALL: KeptCustomers = { kind: 'all' };

/**
 * The customer list's filter, which the panel in the list's `list-filter` slot sets: the Lists module's saved-list
 * picker. The customer list provides it, so a module can narrow the list without the list knowing which module it is.
 * The list applies it to its trade units' customers and to a search's results.
 */
@Injectable()
export class CustomerListFilter {
  private readonly _kept = signal<KeptCustomers>(ALL);
  private readonly _picked = new Subject<void>();
  private readonly _reset = new Subject<void>();

  /** Which customers the list keeps. */
  readonly kept = this._kept.asReadonly();
  /** Emits when the user picks a filter. The list leaves its search, so the filter applies to its customers. */
  readonly picked: Observable<void> = this._picked.asObservable();
  /** Emits when the list is cleared: the filter goes back to keeping every customer. */
  readonly reset: Observable<void> = this._reset.asObservable();

  /** The panel's say on which customers the list keeps. */
  keep(kept: KeptCustomers): void {
    this._kept.set(kept);
  }

  /** The panel tells the list the user picked a filter. */
  pick(): void {
    this._picked.next();
  }

  /** The list asks the panel to keep every customer again. */
  clear(): void {
    this._reset.next();
  }
}
