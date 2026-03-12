import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent, merge, Subject, timer } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';

import { MsalService } from '@azure/msal-angular';
import { AppStateService } from './app-state.service';

/** Minutes of inactivity before automatic logout. */
const IDLE_TIMEOUT_MINUTES = 30;

@Injectable({ providedIn: 'root' })
export class IdleTimeoutService {
  private readonly msalService = inject(MsalService);
  private readonly appState = inject(AppStateService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly reset$ = new Subject<void>();

  /**
   * Call once from AppComponent to start monitoring.
   * Listens for mouse, keyboard, touch, and scroll events.
   * Resets the idle timer on any activity; logs out after timeout.
   */
  start(): void {
    const activity$ = merge(
      fromEvent(document, 'mousemove'),
      fromEvent(document, 'keydown'),
      fromEvent(document, 'mousedown'),
      fromEvent(document, 'touchstart'),
      fromEvent(document, 'scroll', { capture: true }),
      this.reset$
    );

    activity$.pipe(
      switchMap(() => timer(IDLE_TIMEOUT_MINUTES * 60 * 1000)),
      tap(() => {
        this.appState.clearAll();
        this.msalService.logoutRedirect();
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();

    // Kick off the initial timer
    this.reset$.next();
  }
}
