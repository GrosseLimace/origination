import { Injectable } from '@angular/core';

/**
 * Clears what the app holds for the signed-in user when their session ends: on sign-out and on the idle timeout,
 * through AppStateService.clearAll(). Core can't reach a module's stores, so each store registers its own clearing
 * when it is created; a store never created holds nothing to clear.
 *
 * For root stores only: a registration lasts as long as the app.
 */
@Injectable({ providedIn: 'root' })
export class SessionReset {
  private readonly resets = new Set<() => void>();

  /** Registers how a store clears itself. Call it from the store's constructor. */
  onReset(reset: () => void): void {
    this.resets.add(reset);
  }

  /** Clears every registered store. */
  reset(): void {
    for (const reset of this.resets) reset();
  }
}
