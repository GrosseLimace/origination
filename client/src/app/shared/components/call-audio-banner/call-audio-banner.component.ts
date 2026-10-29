import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CallAudioPermissionService } from '@core/services/call-audio-permission.service';

/**
 * One-line notice under the header about microphone access for answering Teams calls here.
 *
 * - The browser would still ask: "Enable call audio" with Enable / Not now. Enable gets the grant
 *   and releases the microphone at once; Not now hides it for the browser session.
 * - The microphone is blocked for this site: a dismissible hint on how to allow it, so the user
 *   finds out before a call rings rather than when Answer fails.
 *
 * Mounted (deferred) by the app shell only while CallAudioPermissionService has a notice, which in
 * turn only happens in the tab that is the registered call endpoint.
 */
@Component({
  selector: 'app-call-audio-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (audio.showEnableBanner()) {
      <div class="max-w-[2000px] w-full mx-auto px-4 sm:px-6 pt-3" data-testid="call-audio-enable-banner">
        <div class="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-scoular-green/10 border border-scoular-green/30" role="region" aria-label="Call audio">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-scoular-green-accessible dark:text-scoular-green flex-shrink-0" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          <p class="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-200">
            Enable call audio so you can answer Teams calls here.
          </p>
          <button type="button" (click)="audio.enable()" [disabled]="audio.enabling()"
            class="flex-shrink-0 rounded-md bg-scoular-green-accessible hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium px-3 py-1.5">
            Enable
          </button>
          <button type="button" (click)="audio.dismissEnableBanner()"
            class="flex-shrink-0 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 bg-transparent border-0 px-2 py-1">
            Not now
          </button>
        </div>
      </div>
    } @else if (audio.showBlockedHint()) {
      <div class="max-w-[2000px] w-full mx-auto px-4 sm:px-6 pt-3" data-testid="call-audio-blocked-hint">
        <div class="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800" role="status">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-600 dark:text-amber-400 flex-shrink-0" aria-hidden="true"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          <p class="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-200">
            The microphone is blocked for this site, so Teams calls can only be answered in Teams. To answer here,
            click the site icon left of the address, set <span class="font-semibold">Microphone</span> to Allow, and reload.
          </p>
          <button type="button" (click)="audio.dismissBlockedHint()" aria-label="Dismiss"
            class="flex-shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>
    }
  `,
})
export class CallAudioBannerComponent {
  readonly audio = inject(CallAudioPermissionService);
}
