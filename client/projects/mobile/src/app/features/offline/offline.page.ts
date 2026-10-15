import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { ConnectivityService } from '../../core/offline/connectivity.service';

/** Shown when the app opens offline with no signed-in account: nothing can be loaded and nothing can be signed in. */
@Component({
  selector: 'mob-offline-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-16 text-center space-y-3">
      <div class="text-5xl" aria-hidden="true">📵</div>
      <h1 class="text-xl font-bold">You're offline</h1>
      <p class="text-gray-600">Sign-in needs a connection. Move to where you have signal and this page will continue automatically.</p>
      <button type="button" class="mob-tap px-4 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100" (click)="retry()">Try again</button>
    </div>
  `,
})
export class OfflinePage {
  private readonly connectivity = inject(ConnectivityService);
  private readonly router = inject(Router);
  readonly returnUrl = input<string>('/');

  constructor() {
    effect(() => {
      if (this.connectivity.online()) this.retry();
    });
  }

  protected retry(): void {
    const target = this.returnUrl().startsWith('/') ? this.returnUrl() : '/';
    void this.router.navigateByUrl(target === '/offline' ? '/' : target);
  }
}
