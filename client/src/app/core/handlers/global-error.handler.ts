import { ErrorHandler, inject, Injectable, isDevMode, NgZone } from '@angular/core';

import { ToastService } from '@core/services/toast.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly toastService = inject(ToastService);
  private readonly ngZone = inject(NgZone);

  // ---------------------------------------------------------
  handleError(error: unknown): void {
    const message = this.extractMessage(error);

    // Log full error for debugging (dev only — CWE-532)
    if (isDevMode()) {
      console.error('[GlobalErrorHandler]', error);
    }

    // Skip chunk-load errors (lazy route not yet downloaded) — Angular retries automatically
    if (message.includes('ChunkLoadError') || message.includes('Loading chunk')) {
      return;
    }

    // Show user-facing toast outside Angular's zone to avoid change-detection loops
    this.ngZone.run(() => {
      this.toastService.error('An unexpected error occurred. Please try again.');
    });
  }

  // ---------------------------------------------------------
  private extractMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
  }
}
