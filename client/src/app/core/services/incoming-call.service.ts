import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionRequiredAuthError, InteractionStatus } from '@azure/msal-browser';
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
import { CallingToken, IncomingCallMatch, IncomingCallState } from '@models';
import { environment } from '@env/environment';

/** Call end reason when the call was picked up on another of the user's Teams endpoints. */
const ACCEPTED_ELSEWHERE = { code: 487, subCode: 10003 } as const;

/** How long the "answered in Teams" banner lingers if nobody dismisses it. The SDK sends nothing
 *  further for a call accepted elsewhere, so there is no "that call has now ended" signal. */
const ANSWERED_ELSEWHERE_TTL_MS = 15 * 60 * 1000;

/** How long "Call ended" shows before the popup clears. */
const ENDED_LINGER_MS = 2500;

/** Web Locks name: whichever tab holds it is the one Teams endpoint for this user in this browser.
 *  Every tab with a call agent is a separate endpoint that rings and can answer, so only one may
 *  register (Infrastructure guide, "one agent, one tab"). The lock is released when the tab closes,
 *  and the next waiting tab takes over automatically. */
const LEADER_LOCK = 'origination.incomingCall.agent';

/** Reconnect back-off after the SDK reports its connection lost. */
const RECONNECT_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/**
 * Incoming Teams phone calls, surfaced inside the Workbench.
 *
 * The browser registers as one more of the signed-in user's Teams Phone endpoints through the
 * Azure Communication Services Calling SDK ("Communication as a Microsoft 365 user"). The Teams
 * desktop and mobile apps keep ringing exactly as before; this tab rings alongside them, learns the
 * caller id at ring time, looks the number up against producers' phones on file, and drives the
 * popup. Answer / Decline / Hold act on the real call.
 *
 * Token path (per docs/application-context/TEAMS-CALLING-GUIDE.md): the browser acquires an Entra
 * token for the ACS scopes with its own MSAL session (admin consent is on the SPA registration),
 * POSTs it to our API, and the API exchanges it for an ACS calling token bound to this user. The
 * SDK's credential re-runs both steps before the token expires.
 *
 * Fail-soft by design: if the environment has no calling (token endpoint answers 204), or the SDK
 * cannot start, the service settles in `unavailable` and the popup never appears. Calls still ring
 * in Teams, so the failure mode is "no popup", never "no call".
 *
 * Teams-to-Teams calls from colleagues are ignored (they still ring this endpoint silently and are
 * answered in Teams as usual). Every other caller raises the popup; phone numbers are looked up.
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
  /** Caller id as the SDK delivered it (E.164), or as typed into the simulator. Null when the caller
   *  is not a phone number (e.g. a call queue / resource account), in which case the popup shows
   *  `callerDisplayName`. */
  readonly callerNumber = signal<string | null>(null);
  /** The display name the SDK supplied for the caller, if any. */
  readonly callerDisplayName = signal<string | null>(null);
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
  /** True in the tab that holds the call agent for this user; other tabs of the same browser wait. */
  readonly isLeader = signal(false);
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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private started = false;
  private stopped = false;
  /** Resolving this releases the leader lock (ends the lock callback). */
  private releaseLeadership: (() => void) | null = null;

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

    this.destroyRef.onDestroy(() => void this.stop());
  }

  // ── Start-up ──────────────────────────────────────────────────────────────

  /**
   * Becomes (or waits to become) this browser's one calling endpoint for the user, then registers
   * the SDK. Never throws; any failure lands in `unavailable`.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;

    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks?.request) {
      // No Web Locks (very old browser / test runner): this tab is the endpoint.
      this.isLeader.set(true);
      await this.startAgent();
      return;
    }

    // Waits in line until no other tab holds the lock, then holds it until stop(): the promise we
    // return from the callback keeps the lock, and the browser releases it if the tab closes.
    void locks.request(LEADER_LOCK, async () => {
      if (this.stopped) return;
      this.isLeader.set(true);
      await this.startAgent();
      await new Promise<void>(resolve => { this.releaseLeadership = resolve; });
    }).catch(err => console.warn('Incoming-call popup: leader election failed', err));
  }

  /** Unregisters this tab as a Teams endpoint (sign-out, or the tab going away). */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearReconnectTimer();
    this.clearResetTimer();
    const agent = this.callAgent;
    this.callAgent = null;
    this.callClient = null;
    this.isListening.set(false);
    this.isLeader.set(false);
    this.releaseLeadership?.();
    this.releaseLeadership = null;
    this.started = false;
    if (agent) {
      try { await agent.dispose(); } catch (err) { console.warn('Incoming-call popup: dispose failed', err); }
    }
  }

  /** Fetches a token, loads the SDK and registers the call agent. */
  private async startAgent(): Promise<void> {
    try {
      const first = await this.fetchCallingToken();
      if (!first?.token) {
        // Off in this environment (204), or not a calling token at all (a 200 with some other body,
        // as a generic test stub answers). Either way the SDK is never downloaded.
        this.state.set('unavailable');
        return;
      }

      const sdk = await this.sdkLoader.load();
      const callClient = new sdk.CallClient();
      this.callClient = callClient;

      // Ask for the microphone up front so answering is one click (guide). A refusal is not fatal:
      // the popup still shows who is calling, and answer() asks again.
      try {
        const devices = await callClient.getDeviceManager();
        await devices.askDevicePermission({ audio: true, video: false });
      } catch (err) {
        console.warn('Incoming-call popup: microphone permission not granted yet', err);
      }

      const credential = new sdk.AzureCommunicationTokenCredential({
        token: first.token,
        refreshProactively: true,
        // Re-runs both hops (MSAL silent → exchange) before the current token expires.
        tokenRefresher: async () => {
          const next = await this.fetchCallingToken();
          if (!next) throw new Error('Calling token is no longer available');
          return next.token;
        },
      });

      const agent = await callClient.createTeamsCallAgent(credential);
      if (this.stopped) { void agent.dispose(); return; }
      this.callAgent = agent;
      agent.on('incomingCall', ({ incomingCall }) => this.onIncomingCall(incomingCall));
      agent.on('connectionStateChanged', ({ newValue }) => this.onConnectionStateChanged(newValue));
      this.reconnectAttempt = 0;
      this.isListening.set(true);
      if (this.state() === 'unavailable') this.state.set('idle');
    } catch (err) {
      // Most likely causes: consent missing in this environment, CSP missing a host, licence. The
      // popup just stays away; Teams itself is unaffected.
      console.warn('Incoming-call popup unavailable: calling SDK did not start', err);
      if (!this.isVisible()) this.state.set('unavailable');
    }
  }

  /**
   * Both hops of the token path: an Entra token for the ACS scopes from the browser's own MSAL
   * session, exchanged by our API for the calling token. Null when calling is off here (204) or the
   * exchange failed (502).
   */
  private async fetchCallingToken(): Promise<CallingToken | null> {
    const account = this.msal.instance.getActiveAccount() ?? this.msal.instance.getAllAccounts()[0];
    if (!account) return null;
    const request = { scopes: [...environment.acs.teamsScopes], account };

    let teamsUserAadToken: string;
    try {
      teamsUserAadToken = (await this.msal.instance.acquireTokenSilent(request)).accessToken;
    } catch (err) {
      // Admin consent is granted tenant-wide, so this only fires for a session problem (e.g. an
      // expired refresh token), never for consent.
      if (!(err instanceof InteractionRequiredAuthError)) throw err;
      teamsUserAadToken = (await this.msal.instance.acquireTokenPopup(request)).accessToken;
    }

    return firstValueFrom(this.api.exchangeCallingToken(teamsUserAadToken));
  }

  /** The SDK lost its connection to Teams: rebuild the agent with a back-off (guide, "Reconnect"). */
  private onConnectionStateChanged(newState: string): void {
    if (newState !== 'Disconnected' || this.stopped) return;
    this.isListening.set(false);
    if (this.isBusy()) return; // Mid-call: the SDK handles media recovery itself; re-register afterwards.
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(async () => {
      if (this.stopped) return;
      const old = this.callAgent;
      this.callAgent = null;
      if (old) { try { await old.dispose(); } catch { /* already gone */ } }
      await this.startAgent();
    }, delay);
  }

  // ── Ringing ───────────────────────────────────────────────────────────────

  private onIncomingCall(call: TeamsIncomingCall): void {
    const info = call.callerInfo;
    const id = info?.identifier;

    // POC evidence for Infrastructure (what a call-queue / auto-attendant call carries). Dev builds
    // only: the caller's number is PII and must not reach production telemetry.
    if (!environment.production) {
      console.info('[incoming-call] callerInfo', JSON.stringify(info),
        'transferorInfo', JSON.stringify((call as { transferorInfo?: unknown }).transferorInfo ?? null));
    }

    if (id?.kind === 'microsoftTeamsUser') return; // Colleague calling over Teams: not a producer.
    if (this.isBusy()) return;                      // Already on a call here; Teams handles the second one.

    this.incomingCall = call;
    this.isSimulated.set(false);
    const number = id?.kind === 'phoneNumber' ? id.phoneNumber : null;
    const seq = this.ring(number, info?.displayName ?? null);

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
  private ring(number: string | null, displayName: string | null = null): number {
    this.clearResetTimer();
    const seq = ++this.callSeq;
    this.callerNumber.set(number);
    this.callerDisplayName.set(displayName);
    this.matches.set([]);
    this.chosenId.set(null);
    this.connectedSince.set(null);
    this.state.set('ringing');

    if (!number) {
      this.matchesLoading.set(false); // Nothing to look up; the popup shows the display name.
      return seq;
    }

    this.matchesLoading.set(true);
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

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private reset(): void {
    this.clearResetTimer();
    this.incomingCall = null;
    this.activeCall = null;
    this.callerNumber.set(null);
    this.callerDisplayName.set(null);
    this.matches.set([]);
    this.matchesLoading.set(false);
    this.chosenId.set(null);
    this.connectedSince.set(null);
    this.isSimulated.set(false);
    this.state.set('idle');
  }
}
