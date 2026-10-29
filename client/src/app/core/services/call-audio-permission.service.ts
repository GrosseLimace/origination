import { Injectable, computed, inject, signal } from '@angular/core';

import { ToastService } from '@core/services/toast.service';

/** What the browser says about microphone access for this site. 'unknown' = not checked yet. */
export type CallAudioPermission = 'unknown' | 'granted' | 'prompt' | 'denied';

/** sessionStorage keys: "Not now" on the enable banner, and the dismissed "blocked" hint. */
export const CALL_AUDIO_NOT_NOW_KEY = 'origination.callAudio.notNow';
export const CALL_AUDIO_BLOCKED_HINT_KEY = 'origination.callAudio.blockedHintDismissed';

/**
 * Microphone pre-approval for the incoming-call popup: "ask once, release immediately".
 *
 * Answering a Teams call in the browser needs the microphone. Asking at Answer time works, but a
 * first-time user then meets a browser prompt while the phone is ringing. So once this tab is the
 * registered call endpoint, the permission is CHECKED (navigator.permissions.query, which never
 * opens the device) and, only if the browser would still ask, a small banner offers to enable call
 * audio ahead of time.
 *
 * Enable runs getUserMedia from the click (a user gesture) and stops every track straight away:
 * the grant is what is wanted, not the stream. The SDK's deviceManager.askDevicePermission is NOT
 * used for this, because it keeps its capture stream open for about 5 s (the mic-in-use light).
 * IncomingCallService.answer() still asks through the SDK as the fallback.
 *
 * Only the elected agent tab activates this (IncomingCallService calls activate() after a
 * successful registration), so other tabs never show the banner.
 */
@Injectable({ providedIn: 'root' })
export class CallAudioPermissionService {
  private readonly toast = inject(ToastService);

  /** The browser's current answer; follows site-settings changes while active. */
  readonly permission = signal<CallAudioPermission>('unknown');
  /** True while this tab is the registered call endpoint. */
  readonly active = signal(false);
  /** True while the Enable click is waiting on the browser prompt. */
  readonly enabling = signal(false);

  private readonly notNow = signal(readFlag(CALL_AUDIO_NOT_NOW_KEY));
  private readonly blockedHintDismissed = signal(readFlag(CALL_AUDIO_BLOCKED_HINT_KEY));

  /** "Enable call audio" banner: the browser would still prompt, and the user has not said Not now. */
  readonly showEnableBanner = computed(() => this.active() && this.permission() === 'prompt' && !this.notNow());
  /** "Microphone is blocked" hint: found out now rather than when a call rings. */
  readonly showBlockedHint = computed(() => this.active() && this.permission() === 'denied' && !this.blockedHintDismissed());
  /** Whether either notice has anything to show (the app shell defers the component on this). */
  readonly hasNotice = computed(() => this.showEnableBanner() || this.showBlockedHint());

  private status: PermissionStatus | null = null;
  private readonly onStatusChange = () => {
    if (this.status) this.permission.set(toPermission(this.status.state));
  };

  /** This tab became the call endpoint: check the permission (never opens the device). Idempotent. */
  async activate(): Promise<void> {
    if (this.active()) return;
    this.active.set(true);
    await this.check();
  }

  /** Sign-out, or the endpoint was given up: hide the notices and stop following changes. */
  deactivate(): void {
    this.active.set(false);
    this.detachStatus();
  }

  /** Enable button: get the grant from the user gesture, then release the device at once. */
  async enable(): Promise<void> {
    if (this.enabling()) return;
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      this.toast.error('This browser cannot use a microphone here. Answer calls in Teams instead.');
      return;
    }

    this.enabling.set(true);
    try {
      const stream = await media.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      // The change event normally says so too, but not where the query is unsupported.
      this.permission.set('granted');
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.permission.set('denied');
      } else {
        console.warn('Call audio: could not open the microphone', err);
        this.toast.error('No microphone could be used. Check that one is connected, or answer calls in Teams.');
      }
    } finally {
      this.enabling.set(false);
    }
  }

  /** Not now: no more enable banner this browser session. */
  dismissEnableBanner(): void {
    this.notNow.set(true);
    writeFlag(CALL_AUDIO_NOT_NOW_KEY);
  }

  /** Close the "blocked" hint for this browser session. */
  dismissBlockedHint(): void {
    this.blockedHintDismissed.set(true);
    writeFlag(CALL_AUDIO_BLOCKED_HINT_KEY);
  }

  private async check(): Promise<void> {
    this.detachStatus();
    let status: PermissionStatus | null = null;
    try {
      // 'microphone' is not a PermissionName in every browser (Firefox throws), hence the cast.
      status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    } catch {
      status = null; // Unsupported here: assume the browser would ask.
    }
    if (!this.active()) return;
    if (!status) {
      this.permission.set('prompt');
      return;
    }
    this.status = status;
    this.permission.set(toPermission(status.state));
    status.addEventListener('change', this.onStatusChange);
  }

  private detachStatus(): void {
    this.status?.removeEventListener('change', this.onStatusChange);
    this.status = null;
  }
}

function toPermission(state: PermissionState | string): CallAudioPermission {
  return state === 'granted' || state === 'denied' ? state : 'prompt';
}

function readFlag(key: string): boolean {
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}

function writeFlag(key: string): void {
  try { sessionStorage.setItem(key, '1'); } catch { /* storage unavailable: dismissed for this page only */ }
}
