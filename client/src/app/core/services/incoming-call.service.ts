import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { filter, firstValueFrom, take } from 'rxjs';
import type {
  CallClient,
  CallEndReason,
  CallState,
  TeamsCall,
  TeamsCallAgent,
  TeamsIncomingCall,
} from '@azure/communication-calling';

import { ApiService } from '@core/services/api.service';
import { CallingSdkLoader } from '@core/services/calling-sdk-loader.service';
import { ToastService } from '@core/services/toast.service';
import { IncomingCallMatch, IncomingCallState } from '@models';
import { environment } from '@env/environment';

/** Call end reason when the call was picked up on another of the user's Teams endpoints. */
const ACCEPTED_ELSEWHERE = { code: 487, subCode: 10003 } as const;

/** How long the "answered in Teams" banner lingers if nobody dismisses it. The SDK sends nothing
 *  further for a call accepted elsewhere, so there is no "that call has now ended" signal. */
const ANSWERED_ELSEWHERE_TTL_MS = 15 * 60 * 1000;

/** How long "Call ended" shows before the popup clears. */
const ENDED_LINGER_MS = 2500;

/**
 * Incoming Teams phone calls, surfaced inside the Workbench.
 *
 * The browser registers as one more of the signed-in user's Teams Phone endpoints through the
 * Azure Communication Services Calling SDK ("Communication as a Microsoft 365 user"). The Teams
 * desktop and mobile apps keep ringing exactly as before; this tab rings alongside them, learns the
 * caller id at ring time, looks the number up against producers' phones on file, and drives the
 * popup. Answer / Decline / Hold act on the real call.
 *
 * Fail-soft by design: if the environment has no calling (token endpoint answers 204), or the SDK
 * cannot start, the service settles in `unavailable` and the popup never appears. Calls still ring
 * in Teams, so the failure mode is "no popup", never "no call".
 *
 * Only PSTN callers (a phone number) raise the popup. Teams-to-Teams calls from colleagues still
 * ring this endpoint silently; they are answered in Teams as usual.
 */
@Injectable({ providedIn: 'root' })
export class IncomingCallService {
  private readonly api = inject(ApiService);
  private readonly sdkLoader = inject(CallingSdkLoader);
  private readonly toast = inject(ToastService);
  private readonly msal = inject(MsalService);
  private readonly msalBroadcast = inject(MsalBroadcastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<IncomingCallState>('idle');
  /** Caller id as the SDK delivered it (E.164), or as typed into the simulator. */
  readonly callerNumber = signal<string | null>(null);
  readonly matches = signal<IncomingCallMatch[]>([]);
  readonly matchesLoading = signal(false);
  /** The producer the user picked from a multi-match chooser. */
  private readonly chosenId = signal<number | null>(null);
  /** The producer this call is about: the only match, or the one the user picked. */
  readonly selectedMatch = computed<IncomingCallMatch | null>(() => {
    const all = this.matches();
    if (all.length === 1) return all[0];
    return all.find(m => m.customerId === this.chosenId()) ?? null;
  });
  /** Epoch ms the call connected; drives the popup's timer. */
  readonly connectedSince = signal<number | null>(null);
  /** True while a simulated call (no SDK) is on screen. */
  readonly isSimulated = signal(false);
  /** True once the SDK is registered and listening for calls. */
  readonly isListening = signal(false);
  /** Whether the popup has anything to show. */
  readonly isVisible = computed(() => {
    const s = this.state();
    return s !== 'idle' && s !== 'unavailable';
  });

  /** Simulation is offered outside production only. */
  readonly canSimulate = environment.incomingCallEnabled && !environment.production;

  private callClient: CallClient | null = null;
  private callAgent: TeamsCallAgent | null = null;
  private incomingCall: TeamsIncomingCall | null = null;
  private activeCall: TeamsCall | null = null;
  /** Guards async match lookups and timers against a newer call having replaced this one. */
  private callSeq = 0;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (!environment.incomingCallEnabled) return;

    // The token endpoint is authenticated, so wait for MSAL to settle with an account.
    this.msalBroadcast.inProgress$
      .pipe(
        filter(status => status === InteractionStatus.None),
        filter(() => this.msal.instance.getAllAccounts().length > 0),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => void this.start());

    this.destroyRef.onDestroy(() => {
      this.clearResetTimer();
      void this.callAgent?.dispose();
    });
  }

  // ── Start-up ──────────────────────────────────────────────────────────────

  /** Fetches a token and registers the SDK. Never throws; any failure lands in `unavailable`. */
  async start(): Promise<void> {
    try {
      const first = await firstValueFrom(this.api.getCallingToken());
      if (!first) {
        this.state.set('unavailable'); // Off in this environment. The SDK is never downloaded.
        return;
      }

      const sdk = await this.sdkLoader.load();
      const credential = new sdk.AzureCommunicationTokenCredential({
        token: first.token,
        refreshProactively: true,
        tokenRefresher: async () => {
          const next = await firstValueFrom(this.api.getCallingToken());
          if (!next) throw new Error('Calling token is no longer available');
          return next.token;
        },
      });

      this.callClient = new sdk.CallClient();
      this.callAgent = await this.callClient.createTeamsCallAgent(credential);
      this.callAgent.on('incomingCall', ({ incomingCall }) => this.onIncomingCall(incomingCall));
      this.isListening.set(true);
    } catch (err) {
      // Most likely causes: mic/media blocked by policy, CSP missing a host, licence. The popup
      // just stays away; Teams itself is unaffected.
      console.warn('Incoming-call popup unavailable: calling SDK did not start', err);
      if (!this.isVisible()) this.state.set('unavailable');
    }
  }

  // ── Ringing ───────────────────────────────────────────────────────────────

  private onIncomingCall(call: TeamsIncomingCall): void {
    const id = call.callerInfo.identifier;
    if (id?.kind !== 'phoneNumber') return; // Colleague calling over Teams: not a producer.
    if (this.isBusy()) return;               // Already on a call here; Teams handles the second one.

    this.incomingCall = call;
    this.isSimulated.set(false);
    const seq = this.ring(id.phoneNumber);

    call.on('callEnded', ({ callEndReason }) => this.onRingEnded(seq, callEndReason));
  }

  /** Ringing stopped without this tab answering. */
  private onRingEnded(seq: number, reason: CallEndReason | undefined): void {
    if (seq !== this.callSeq || this.state() !== 'ringing') return;
    this.incomingCall = null;

    if (reason?.code === ACCEPTED_ELSEWHERE.code && reason.subCode === ACCEPTED_ELSEWHERE.subCode) {
      this.state.set('answeredElsewhere');
      this.scheduleReset(seq, ANSWERED_ELSEWHERE_TTL_MS);
    } else {
      // Caller hung up, it rang out to voicemail, or it was declined on another endpoint.
      this.reset();
    }
  }

  /** Puts a call on screen and starts the producer lookup. Returns the call's sequence number. */
  private ring(number: string): number {
    this.clearResetTimer();
    const seq = ++this.callSeq;
    this.callerNumber.set(number);
    this.matches.set([]);
    this.chosenId.set(null);
    this.connectedSince.set(null);
    this.matchesLoading.set(true);
    this.state.set('ringing');

    this.api.getIncomingCallMatches(number).subscribe(matches => {
      if (seq !== this.callSeq) return;
      this.matches.set(matches);
      this.matchesLoading.set(false);
    });
    return seq;
  }

  // ── User actions ──────────────────────────────────────────────────────────

  /** Remembers which producer the user picked when several share the number. */
  choose(customerId: number): void {
    this.chosenId.set(customerId);
  }

  /** Answers in the browser: asks for the microphone, then accepts the call. */
  async answer(): Promise<void> {
    if (this.state() !== 'ringing') return;

    if (this.isSimulated()) {
      this.markConnected();
      return;
    }

    const call = this.incomingCall;
    if (!call || !this.callClient) return;

    this.state.set('connecting');
    try {
      const devices = await this.callClient.getDeviceManager();
      await devices.askDevicePermission({ audio: true, video: false });
      const active = await call.accept();
      this.incomingCall = null;
      this.activeCall = active;
      // Ignore events from a call this service has already let go of (e.g. after the user hung up).
      active.on('stateChanged', () => {
        if (this.activeCall === active) this.onActiveCallState(active.state);
      });
      this.onActiveCallState(active.state);
    } catch (err) {
      console.warn('Could not answer the call in the browser', err);
      this.toast.error('Could not answer here — pick up in Teams instead.');
      // Still ringing in Teams; keep the popup so the producer link stays one click away.
      if (this.state() === 'connecting') this.state.set('ringing');
    }
  }

  async decline(): Promise<void> {
    if (this.state() !== 'ringing') return;
    const call = this.incomingCall;
    this.reset();
    if (call) {
      try {
        await call.reject();
      } catch (err) {
        console.warn('Could not decline the call', err);
      }
    }
  }

  async hold(): Promise<void> {
    if (this.state() !== 'connected') return;
    if (this.isSimulated()) {
      this.state.set('held');
      return;
    }
    await this.activeCall?.hold().catch(err => console.warn('Hold failed', err));
  }

  async resume(): Promise<void> {
    if (this.state() !== 'held') return;
    if (this.isSimulated()) {
      this.state.set('connected');
      return;
    }
    await this.activeCall?.resume().catch(err => console.warn('Resume failed', err));
  }

  /** Ends the call and closes the popup straight away: the user knows they hung up, so there is
   *  nothing to acknowledge. (When the CALLER hangs up, "Call ended" shows briefly instead.) */
  async hangUp(): Promise<void> {
    if (this.state() !== 'connected' && this.state() !== 'held') return;
    const call = this.activeCall;
    this.reset();
    await call?.hangUp().catch(err => console.warn('Hang up failed', err));
  }

  /** Closes the "answered in Teams" banner or the "call ended" card. */
  dismiss(): void {
    const s = this.state();
    if (s === 'answeredElsewhere' || s === 'ended') this.reset();
  }

  // ── Simulation (non-production only) ──────────────────────────────────────

  /** Runs the whole popup flow for a typed-in number, without the SDK or a real call. */
  simulate(number: string): void {
    if (!this.canSimulate || !number.trim() || this.isBusy()) return;
    this.isSimulated.set(true);
    this.ring(number.trim());
  }

  /** Simulates the caller hanging up mid-call. */
  simulateCallerHungUp(): void {
    if (!this.isSimulated()) return;
    const s = this.state();
    if (s === 'connected' || s === 'held') this.markEnded();
  }

  /** Simulates the user picking up on the Teams desktop app instead. */
  simulateAnsweredElsewhere(): void {
    if (!this.isSimulated()) return;
    this.onRingEnded(this.callSeq, { code: ACCEPTED_ELSEWHERE.code, subCode: ACCEPTED_ELSEWHERE.subCode });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private onActiveCallState(state: CallState): void {
    switch (state) {
      case 'Connected':
        this.markConnected();
        break;
      case 'LocalHold':
        this.state.set('held');
        break;
      case 'Disconnected':
        this.activeCall = null;
        this.markEnded();
        break;
      default:
        break; // Connecting / RemoteHold / Disconnecting: keep what the user sees.
    }
  }

  private markConnected(): void {
    if (this.connectedSince() === null) this.connectedSince.set(Date.now());
    this.state.set('connected');
  }

  private markEnded(): void {
    this.state.set('ended');
    this.scheduleReset(this.callSeq, ENDED_LINGER_MS);
  }

  private isBusy(): boolean {
    const s = this.state();
    return s === 'ringing' || s === 'connecting' || s === 'connected' || s === 'held';
  }

  private scheduleReset(seq: number, delayMs: number): void {
    this.clearResetTimer();
    this.resetTimer = setTimeout(() => {
      if (seq === this.callSeq) this.reset();
    }, delayMs);
  }

  private clearResetTimer(): void {
    if (this.resetTimer !== null) clearTimeout(this.resetTimer);
    this.resetTimer = null;
  }

  private reset(): void {
    this.clearResetTimer();
    this.incomingCall = null;
    this.activeCall = null;
    this.callerNumber.set(null);
    this.matches.set([]);
    this.matchesLoading.set(false);
    this.chosenId.set(null);
    this.connectedSince.set(null);
    this.isSimulated.set(false);
    this.state.set('idle');
  }
}
