import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionRequiredAuthError, InteractionStatus } from '@azure/msal-browser';
import { filter, firstValueFrom, take } from 'rxjs';
import type {
  CallClient,
  CallState,
  ConnectionState,
  ConnectionStateChangedReason,
  TeamsCall,
  TeamsCallAgent,
  TeamsIncomingCall,
} from '@azure/communication-calling';
import type { AzureCommunicationTokenCredential } from '@azure/communication-common';

import { ApiService } from '@core/services/api.service';
import { CallAudioPermissionService } from '@core/services/call-audio-permission.service';
import { CallingSdk, CallingSdkLoader } from '@core/services/calling-sdk-loader.service';
import { ToastService } from '@core/services/toast.service';
import { CallingToken, IncomingCallMatch, IncomingCallState, IncomingCallSummary } from '@models';
import { environment } from '@env/environment';

/** How long "Call ended" shows before the popup clears. */
const ENDED_LINGER_MS = 2500;

/** Web Locks name: whichever tab holds it is the one Teams endpoint for this user in this browser.
 *  Every tab with a call agent is a separate endpoint that rings and can answer, so only one may
 *  register (Infrastructure guide, "one agent, one tab"). The lock is released when the tab closes,
 *  and the next waiting tab takes over automatically. */
const LEADER_LOCK = 'origination.incomingCall.agent';

/** Re-registration back-off: the first retry waits about this long, and each consecutive failure
 *  doubles it (with +/-20 % jitter so several browsers do not retry in step), up to the cap.
 *  Re-registering every ~3 s is what got the Dev POC throttled by the Teams registrar (429 / 42901,
 *  retryAfter ~2 min), and retrying inside the throttle window only kept it from ever clearing. */
export const RECONNECT_BASE_DELAY_MS = 5_000;
export const RECONNECT_MAX_DELAY_MS = 5 * 60 * 1000;

/** A registration only counts as healthy (and resets the back-off) once it has stayed up this long.
 *  `createTeamsCallAgent` resolving is not proof: the registrar can still refuse moments later. */
export const STABLE_CONNECTION_MS = 60_000;

/** Consecutive failed registrations before this tab gives up until the next page load / sign-in. */
export const MAX_CONSECUTIVE_FAILURES = 6;

/** Wait used when a failure says "throttled" but carries no readable retryAfter. */
export const THROTTLED_FALLBACK_MS = 2 * 60 * 1000;

/** Upper bound on any honoured retryAfter, so a malformed value cannot park the tab for hours. */
const MAX_RETRY_AFTER_MS = 10 * 60 * 1000;

/** Back-off before the (attempt + 1)th retry: base * 2^attempt, capped, with +/-20 % jitter. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const raw = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt));
  return Math.round(raw * (0.8 + random() * 0.4));
}

/**
 * How long a failure asks us to wait, if it says so: an explicit `retryAfter` (seconds, or the
 * registrar's "hh:mm:ss.ff" form, also when only present inside the error's message / JSON), else
 * THROTTLED_FALLBACK_MS for anything that looks like a throttle (HTTP 429, registrar code 42901,
 * "throttled"), else null. Defensive on purpose: the SDK does not document how, or whether, it
 * surfaces the registrar's 429 to the app.
 */
export function throttleRetryAfterMs(err: unknown): number | null {
  if (err === null || err === undefined) return null;
  const e = (typeof err === 'object' ? err : {}) as Record<string, unknown>;

  const direct = parseRetryAfter(e['retryAfter']);
  if (direct !== null) return Math.min(direct, MAX_RETRY_AFTER_MS);

  let text = typeof err === 'string' ? err : String(e['message'] ?? '');
  if (typeof err === 'object') {
    try { text += ' ' + JSON.stringify(err); } catch { /* circular: the message alone will do */ }
  }
  const embedded = /"?retryAfter"?\s*[:=]\s*"?([0-9][0-9:.]*)/i.exec(text);
  const parsed = embedded ? parseRetryAfter(embedded[1]) : null;
  if (parsed !== null) return Math.min(parsed, MAX_RETRY_AFTER_MS);

  const throttled = e['code'] === 429 || e['status'] === 429 || e['statusCode'] === 429
    || e['subCode'] === 42901 || /42901|throttl/i.test(text);
  return throttled ? THROTTLED_FALLBACK_MS : null;
}

/** Seconds (number or numeric string) or a .NET TimeSpan string ("00:01:54.63") → ms. */
function parseRetryAfter(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.ceil(value * 1000) : null;
  if (typeof value !== 'string') return null;
  const v = value.trim();
  const hms = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(v);
  if (hms) return Math.ceil((Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])) * 1000);
  if (/^\d+(\.\d+)?$/.test(v)) return Math.ceil(Number(v) * 1000);
  return null;
}

/** One call this tab knows about: ringing, live, on hold, or just ended. */
class CallSession {
  readonly state = signal<IncomingCallState>('ringing');
  readonly matches = signal<IncomingCallMatch[]>([]);
  readonly matchesLoading = signal(false);
  /** The producer the user picked from a multi-match chooser. */
  readonly chosenId = signal<number | null>(null);
  /** Epoch ms the call first connected; drives the timer. */
  readonly connectedSince = signal<number | null>(null);
  /** The producer this call is about: the only match, or the one the user picked. */
  readonly selectedMatch = computed<IncomingCallMatch | null>(() => {
    const all = this.matches();
    if (all.length === 1) return all[0];
    return all.find(m => m.customerId === this.chosenId()) ?? null;
  });
  /** Ringing: the SDK's incoming call. Answered: the live call. */
  incoming: TeamsIncomingCall | null = null;
  active: TeamsCall | null = null;
  /** "The caller hung up" lingers briefly on the main card, then this removes it. */
  endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly seq: number,
    readonly callerNumber: string | null,
    readonly displayName: string | null,
    readonly simulated: boolean,
  ) {}

  summary(): IncomingCallSummary {
    return {
      seq: this.seq,
      state: this.state(),
      callerNumber: this.callerNumber,
      displayName: this.displayName,
      match: this.selectedMatch(),
      matchCount: this.matches().length,
      matchesLoading: this.matchesLoading(),
      connectedSince: this.connectedSince(),
    };
  }
}

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
 * in Teams, so the failure mode is "no popup", never "no call". A lost or refused registration is
 * retried with exponential back-off (honouring the Teams registrar's retryAfter when throttled) and
 * abandoned after MAX_CONSECUTIVE_FAILURES until the next page load.
 *
 * The microphone is never opened at registration. Once registered, CallAudioPermissionService
 * checks the permission without touching the device and, if the browser would still ask, offers a
 * one-time "Enable call audio" banner; answer() asks through the SDK as the fallback.
 *
 * Teams-to-Teams calls from colleagues are ignored (they still ring this endpoint silently and are
 * answered in Teams as usual). Every other caller raises the popup; phone numbers are looked up.
 *
 * Several calls at once (call waiting): the service keeps a list of calls. One is on the popup's main
 * card (the public state / caller / matches signals and answer / hold / resume / hangUp act on it);
 * the others are rows under it (otherCalls), either waiting to be answered or on hold. Only one call
 * is ever live: answering a waiting call, or resuming a held one, first puts the live call on hold.
 * When the main card's call ends, the next one moves up (a waiting call first, else a held one).
 */
@Injectable({ providedIn: 'root' })
export class IncomingCallService {
  private readonly api = inject(ApiService);
  private readonly sdkLoader = inject(CallingSdkLoader);
  private readonly toast = inject(ToastService);
  private readonly audioPermission = inject(CallAudioPermissionService);
  private readonly msal = inject(MsalService);
  private readonly msalBroadcast = inject(MsalBroadcastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Every call this tab knows about, oldest first. */
  private readonly sessions = signal<CallSession[]>([]);
  /** The call on the popup's main card. */
  private readonly focusedSeq = signal<number | null>(null);
  private readonly focused = computed(() => this.sessions().find(s => s.seq === this.focusedSeq()) ?? null);
  /** Calling is off in this environment, or the SDK could not (or can no longer) register. */
  private readonly unavailable = signal(false);

  /** The main card's call state; 'idle' (or 'unavailable') when there is no call. */
  readonly state = computed<IncomingCallState>(() =>
    this.focused()?.state() ?? (this.unavailable() ? 'unavailable' : 'idle'));
  /** Caller id as the SDK delivered it (E.164), or as typed into the simulator. Null when the caller
   *  is not a phone number (e.g. a call queue / resource account), in which case the popup shows
   *  `callerDisplayName`. */
  readonly callerNumber = computed(() => this.focused()?.callerNumber ?? null);
  /** The display name the SDK supplied for the caller, if any. */
  readonly callerDisplayName = computed(() => this.focused()?.displayName ?? null);
  readonly matches = computed<IncomingCallMatch[]>(() => this.focused()?.matches() ?? []);
  readonly matchesLoading = computed(() => this.focused()?.matchesLoading() ?? false);
  /** The producer the main card's call is about: the only match, or the one the user picked. */
  readonly selectedMatch = computed<IncomingCallMatch | null>(() => this.focused()?.selectedMatch() ?? null);
  /** Epoch ms the main card's call connected; drives the popup's timer. */
  readonly connectedSince = computed(() => this.focused()?.connectedSince() ?? null);
  /** True while the main card shows a simulated call (no SDK). */
  readonly isSimulated = computed(() => this.focused()?.simulated ?? false);
  /** The other calls, as rows under the main card: waiting to be answered, or on hold. */
  readonly otherCalls = computed<IncomingCallSummary[]>(() => {
    const main = this.focused();
    return this.sessions().filter(s => s !== main).map(s => s.summary());
  });
  /** True once the SDK is registered and listening for calls. */
  readonly isListening = signal(false);
  /** True in the tab that holds the call agent for this user; other tabs of the same browser wait. */
  readonly isLeader = signal(false);
  /** Whether the popup has anything to show. */
  readonly isVisible = computed(() => {
    const s = this.state();
    return s !== 'idle' && s !== 'unavailable';
  });

  /** Simulation is offered in local and Dev only (environment.incomingCallSimulatorEnabled). */
  readonly canSimulate = environment.incomingCallEnabled && environment.incomingCallSimulatorEnabled;

  private sdk: CallingSdk | null = null;
  /** One per tab, created on the first registration and reused by every re-registration: each
   *  CallClient owns a device manager, and only `callClient.dispose()` releases it. */
  private callClient: CallClient | null = null;
  private callAgent: TeamsCallAgent | null = null;
  /** The credential the current agent was built with. Disposed with the agent, which stops its
   *  proactive-refresh timer (otherwise every discarded credential keeps fetching tokens). */
  private credential: AzureCommunicationTokenCredential | null = null;
  /** Numbers the calls this tab sees. */
  private callSeq = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Fires once a registration has stayed up STABLE_CONNECTION_MS; only then is the back-off reset. */
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  /** Failed registrations in a row (agent creation threw, or the connection dropped before it was
   *  stable). Drives the back-off and the give-up. */
  private consecutiveFailures = 0;
  /** Set after MAX_CONSECUTIVE_FAILURES: no more retries until start() runs again (page load / sign-in). */
  private gaveUp = false;
  /** Re-registration after a disconnect while a call was on screen, run once the call is over. */
  private reconnectAfterCall = false;
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
    this.gaveUp = false;
    this.consecutiveFailures = 0;

    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks?.request) {
      // No Web Locks (very old browser / test runner): this tab is the endpoint.
      this.isLeader.set(true);
      await this.startAgent(false);
      return;
    }

    // Waits in line until no other tab holds the lock, then holds it until stop(): the promise we
    // return from the callback keeps the lock, and the browser releases it if the tab closes. A tab
    // that gave up keeps the lock too, so the next tab does not walk straight into the same failure.
    void locks.request(LEADER_LOCK, async () => {
      if (this.stopped) return;
      this.isLeader.set(true);
      await this.startAgent(false);
      await new Promise<void>(resolve => { this.releaseLeadership = resolve; });
    }).catch(err => console.warn('Incoming-call popup: leader election failed', err));
  }

  /** Unregisters this tab as a Teams endpoint (sign-out, or the tab going away) and releases the
   *  agent, its credential and the CallClient (with its device manager). */
  async stop(): Promise<void> {
    this.stopped = true;
    this.reconnectAfterCall = false;
    this.clearReconnectTimer();
    this.clearStableTimer();
    for (const session of [...this.sessions()]) this.removeSession(session); // and their timers
    const client = this.callClient;
    this.callClient = null;
    this.isListening.set(false);
    this.isLeader.set(false);
    this.audioPermission.deactivate();
    this.releaseLeadership?.();
    this.releaseLeadership = null;
    this.started = false;
    await this.teardownAgent();
    if (client) {
      try { await client.dispose(); } catch (err) { console.warn('Incoming-call popup: dispose failed', err); }
    }
  }

  /**
   * Fetches a token, loads the SDK and registers the call agent. On the first attempt a missing
   * token means calling is off here and the service goes dormant; any later failure is retried with
   * back-off (see scheduleReconnect).
   *
   * The SDK's askDevicePermission is NOT called here: it opens a real capture stream and holds it
   * for several seconds even when permission is already granted, which kept the mic-in-use light on.
   * After registering, CallAudioPermissionService only queries the permission (no device access);
   * answer() asks through the SDK as the fallback.
   */
  private async startAgent(isRetry: boolean): Promise<void> {
    try {
      const first = await this.fetchCallingToken();
      if (this.stopped) return;
      if (!first?.token) {
        if (isRetry) {
          // Worked before, so a 502 now is most likely transient: retry like any other failure.
          this.registrationFailed(null, 'calling token unavailable');
          return;
        }
        // Off in this environment (204), or not a calling token at all (a 200 with some other body,
        // as a generic test stub answers). Either way the SDK is never downloaded.
        this.unavailable.set(true);
        return;
      }

      const sdk = this.sdk ??= await this.sdkLoader.load();
      const callClient = this.callClient ??= new sdk.CallClient();

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
      this.credential = credential;

      const agent = await callClient.createTeamsCallAgent(credential);
      if (this.stopped || this.credential !== credential) {
        await agent.dispose().catch(() => undefined);
        credential.dispose();
        return;
      }
      this.callAgent = agent;
      agent.on('incomingCall', ({ incomingCall }) => this.onIncomingCall(incomingCall));
      // Only the current agent may drive reconnects: disposing an old one can still emit a late
      // Disconnected, which must not count as a failure of its replacement.
      agent.on('connectionStateChanged', ({ newValue, reason }) => {
        if (this.callAgent === agent) this.onConnectionStateChanged(newValue, reason);
      });
      this.isListening.set(true);
      this.unavailable.set(false);
      this.armStableTimer();
      // This tab is now the endpoint: check (never open) the mic and offer the enable banner if needed.
      void this.audioPermission.activate();
    } catch (err) {
      // Most likely causes: registrar throttling, consent missing in this environment, CSP missing
      // a host, licence. The popup just stays away; Teams itself is unaffected.
      console.warn('Incoming-call popup unavailable: calling SDK did not start', err);
      if (this.stopped) return;
      this.unavailable.set(true);
      this.registrationFailed(err, 'calling SDK did not start');
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

  // ── Keeping the registration alive ────────────────────────────────────────

  /**
   * The SDK's connection to Teams changed. A drop rebuilds the agent with back-off (guide,
   * "Reconnect"); a drop before the registration was stable counts as a failure.
   *
   * `invalidToken` is rebuilt the same way: the SDK offers no way to hand an existing agent a new
   * credential, and the rebuild fetches a fresh token anyway. The SDK retries the registrar itself
   * while connected, so this only acts on what it reports as lost.
   *
   * The rebuild is only scheduled, never immediate: the SDK reports a brief Disconnected
   * (connectionIssue) about half a second after nearly every registration and then recovers by
   * itself (seen on Dev 2026-10-29: a call rang and was answered on an agent already marked "lost").
   * So a Connected before the timer fires cancels the rebuild and keeps the working agent; tearing
   * it down only starts the next one, which does the same.
   */
  private onConnectionStateChanged(newState: ConnectionState, reason?: ConnectionStateChangedReason): void {
    if (this.stopped || this.gaveUp) return;
    if (newState === 'Connected') {
      this.isListening.set(true);
      this.reconnectAfterCall = false;
      if (this.reconnectTimer !== null) {
        this.clearReconnectTimer();
        console.info('[incoming-call] connection restored by the SDK; rebuild cancelled');
      }
      if (!this.stableTimer) this.armStableTimer();
      return;
    }
    if (newState !== 'Disconnected') return;
    this.isListening.set(false);
    this.clearStableTimer();
    if (this.isBusy()) {
      // Mid-call: the SDK handles media recovery itself; re-register once the call is over.
      this.reconnectAfterCall = true;
      return;
    }
    this.registrationFailed({ reason }, `connection lost (${reason ?? 'no reason given'})`);
  }

  /**
   * Records a failed registration and schedules the next attempt: exponential back-off with jitter,
   * never shorter than a throttle's retryAfter. After MAX_CONSECUTIVE_FAILURES the tab gives up
   * (state `unavailable`) until the next page load or sign-in.
   */
  private registrationFailed(err: unknown, why: string): void {
    if (this.stopped || this.gaveUp) return;
    this.isListening.set(false);
    this.clearStableTimer();
    this.consecutiveFailures += 1;

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.gaveUp = true;
      this.clearReconnectTimer();
      console.warn(`[incoming-call] giving up after ${this.consecutiveFailures} failed registrations `
        + `(last: ${why}). Calls still ring in Teams; reload the page to try again.`);
      void this.teardownAgent();
      this.audioPermission.deactivate(); // No endpoint here any more, so nothing to enable audio for.
      this.unavailable.set(true);
      return;
    }

    const backoff = reconnectDelayMs(this.consecutiveFailures - 1);
    const throttle = throttleRetryAfterMs(err);
    const delay = Math.max(backoff, throttle ?? 0);
    console.info(`[incoming-call] ${why}; re-registering in ${Math.round(delay / 1000)} s `
      + `(failure ${this.consecutiveFailures} of ${MAX_CONSECUTIVE_FAILURES}${throttle !== null ? ', throttled' : ''})`);
    this.scheduleReconnect(delay);
  }

  private scheduleReconnect(delayMs: number): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.stopped || this.gaveUp) return;
      await this.teardownAgent();
      await this.startAgent(true);
    }, delayMs);
  }

  /** Disposes the current agent and its credential. The CallClient is kept for the next agent. */
  private async teardownAgent(): Promise<void> {
    const agent = this.callAgent;
    const credential = this.credential;
    this.callAgent = null;
    this.credential = null;
    if (agent) {
      try { await agent.dispose(); } catch (err) { console.warn('Incoming-call popup: dispose failed', err); }
    }
    try { credential?.dispose(); } catch { /* already disposed */ }
  }

  private armStableTimer(): void {
    this.clearStableTimer();
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      this.consecutiveFailures = 0;
    }, STABLE_CONNECTION_MS);
  }

  private clearStableTimer(): void {
    if (this.stableTimer !== null) clearTimeout(this.stableTimer);
    this.stableTimer = null;
  }

  /** A call that was on screen when the connection dropped is over: re-register now. */
  private resumeAfterCall(): void {
    if (!this.reconnectAfterCall || this.stopped || this.gaveUp) return;
    this.reconnectAfterCall = false;
    this.registrationFailed({}, 'connection lost during a call');
  }

  // ── Ringing ───────────────────────────────────────────────────────────────

  private onIncomingCall(call: TeamsIncomingCall): void {
    const info = call.callerInfo;
    const id = info?.identifier;

    // POC evidence for Infrastructure (what a call-queue / auto-attendant call carries). Local and
    // Dev builds only, via its own flag: QA is also production: false, and real producers' calls ring
    // a QA tab too, so the caller's number (PII) must not be printed there.
    if (environment.logCallerInfo) {
      console.info('[incoming-call] callerInfo', JSON.stringify(info),
        'transferorInfo', JSON.stringify((call as { transferorInfo?: unknown }).transferorInfo ?? null));
    }

    if (id?.kind === 'microsoftTeamsUser') return; // Colleague calling over Teams: not a producer.

    // Already on a call here? Then this one waits as a row under it (Hold & answer / Decline).
    const number = id?.kind === 'phoneNumber' ? id.phoneNumber : null;
    const session = this.addSession(number, info?.displayName ?? null, false);
    session.incoming = call;
    call.on('callEnded', () => this.onRingEnded(session));
  }

  /**
   * Ringing stopped without this tab answering: that call simply goes away, whatever the reason —
   * picked up in Teams desktop / mobile (487 / 10003), caller hung up, rang out to voicemail, or
   * declined elsewhere. Like Teams on several devices: whichever endpoint answers, the others stop.
   * (There used to be an "answered in Teams" banner, but the SDK sends nothing when that Teams call
   * ends, so it could only linger after the call was over — decision 2026-10-29.)
   */
  private onRingEnded(session: CallSession): void {
    if (session.state() !== 'ringing') return;
    session.incoming = null;
    this.removeSession(session);
  }

  /** Adds a ringing call and starts its producer lookup. It takes the main card if that is free. */
  private addSession(number: string | null, displayName: string | null, simulated: boolean): CallSession {
    const session = new CallSession(++this.callSeq, number, displayName, simulated);
    this.sessions.update(all => [...all, session]);
    if (!this.focused()) this.focusedSeq.set(session.seq);

    if (number) {
      session.matchesLoading.set(true);
      this.api.getIncomingCallMatches(number).subscribe(matches => {
        session.matches.set(matches);
        session.matchesLoading.set(false);
      });
    }
    return session;
  }

  // ── User actions on the main card ─────────────────────────────────────────

  /** Remembers which producer the user picked when several share the number. */
  choose(customerId: number): void {
    this.focused()?.chosenId.set(customerId);
  }

  /** Back to the list when several producers share the number (the user picked the wrong one). */
  clearChoice(): void {
    this.focused()?.chosenId.set(null);
  }

  /** Answers the main card's call in the browser (putting any live call on hold first). */
  async answer(): Promise<void> {
    const session = this.focused();
    if (session?.state() === 'ringing') await this.answerSession(session);
  }

  async decline(): Promise<void> {
    const session = this.focused();
    if (session?.state() === 'ringing') await this.declineSession(session);
  }

  async hold(): Promise<void> {
    const session = this.focused();
    if (session?.state() === 'connected') await this.holdSession(session);
  }

  async resume(): Promise<void> {
    const session = this.focused();
    if (session?.state() === 'held') await this.resumeSession(session);
  }

  /** Ends the call and takes it off the popup straight away: the user knows they hung up, so there
   *  is nothing to acknowledge. (When the CALLER hangs up, "Call ended" shows briefly instead.) */
  async hangUp(): Promise<void> {
    const session = this.focused();
    if (session) await this.hangUpSession(session);
  }

  // ── User actions on the other calls (rows under the main card) ────────────

  /** "Hold & answer": the live call goes on hold, this one connects and takes the main card. */
  async answerCall(seq: number): Promise<void> {
    const session = this.find(seq);
    if (session?.state() === 'ringing') await this.answerSession(session);
  }

  async declineCall(seq: number): Promise<void> {
    const session = this.find(seq);
    if (session?.state() === 'ringing') await this.declineSession(session);
  }

  /** Switches to a held call: the live one goes on hold, this one resumes and takes the main card. */
  async resumeCall(seq: number): Promise<void> {
    const session = this.find(seq);
    if (session?.state() === 'held') await this.resumeSession(session);
  }

  async hangUpCall(seq: number): Promise<void> {
    const session = this.find(seq);
    if (session) await this.hangUpSession(session);
  }

  // ── Simulation (local and Dev only) ──────────────────────────────────────

  /** Runs the popup flow for a typed-in number, without the SDK or a real call. While another call is
   *  on screen it arrives as a waiting call, which exercises Hold & answer. */
  simulate(number: string): void {
    if (!this.canSimulate || !number.trim()) return;
    this.addSession(number.trim(), null, true);
  }

  /** Simulates the caller hanging up mid-call. */
  simulateCallerHungUp(): void {
    const session = this.focused();
    if (!session?.simulated) return;
    const s = session.state();
    if (s === 'connected' || s === 'held') this.markEnded(session);
  }

  /** Simulates the user picking up on the Teams desktop app instead: the call goes away. */
  simulateAnsweredElsewhere(): void {
    const session = this.focused();
    if (session?.simulated) this.onRingEnded(session);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private find(seq: number): CallSession | null {
    return this.sessions().find(s => s.seq === seq) ?? null;
  }

  /** Answers in the browser: puts any live call on hold, asks for the microphone (the only place the
   *  service touches it), then accepts. The answered call takes the main card. */
  private async answerSession(session: CallSession): Promise<void> {
    if (this.hasLiveCallOtherThan(session)) await this.holdLiveCalls(session);
    this.focusedSeq.set(session.seq);

    if (session.simulated) {
      this.markConnected(session);
      return;
    }

    const call = session.incoming;
    if (!call || !this.callClient) return;

    session.state.set('connecting');
    try {
      const devices = await this.callClient.getDeviceManager();
      await devices.askDevicePermission({ audio: true, video: false });
      const active = await call.accept();
      session.incoming = null;
      session.active = active;
      // Ignore events from a call this service has already let go of (e.g. after the user hung up).
      active.on('stateChanged', () => {
        if (session.active === active) this.onActiveCallState(session, active.state);
      });
      this.onActiveCallState(session, active.state);
    } catch (err) {
      console.warn('Could not answer the call in the browser', err);
      this.toast.error('Could not answer here — pick up in Teams instead.');
      // Still ringing in Teams; keep it on screen so the producer link stays one click away.
      if (session.state() === 'connecting') session.state.set('ringing');
    }
  }

  private async declineSession(session: CallSession): Promise<void> {
    const call = session.incoming;
    this.removeSession(session);
    await call?.reject().catch(err => console.warn('Could not decline the call', err));
  }

  private async holdSession(session: CallSession): Promise<void> {
    if (!session.simulated) {
      try {
        await session.active?.hold();
      } catch (err) {
        console.warn('Hold failed', err);
        return;
      }
    }
    // The SDK also reports LocalHold; setting it here keeps the screen right if that is late.
    if (session.state() === 'connected') session.state.set('held');
  }

  private async resumeSession(session: CallSession): Promise<void> {
    if (this.hasLiveCallOtherThan(session)) await this.holdLiveCalls(session);
    this.focusedSeq.set(session.seq);
    if (!session.simulated) {
      try {
        await session.active?.resume();
      } catch (err) {
        console.warn('Resume failed', err);
        return;
      }
    }
    if (session.state() === 'held') this.markConnected(session);
  }

  private async hangUpSession(session: CallSession): Promise<void> {
    const s = session.state();
    if (s !== 'connected' && s !== 'held') return;
    const call = session.active;
    this.removeSession(session);
    await call?.hangUp().catch(err => console.warn('Hang up failed', err));
  }

  private hasLiveCallOtherThan(session: CallSession): boolean {
    return this.sessions().some(s => s !== session && s.state() === 'connected');
  }

  /** Only one call is live at a time: hold whichever is, before another connects. */
  private async holdLiveCalls(except: CallSession): Promise<void> {
    for (const other of this.sessions()) {
      if (other !== except && other.state() === 'connected') await this.holdSession(other);
    }
  }

  private onActiveCallState(session: CallSession, state: CallState): void {
    switch (state) {
      case 'Connected':
        this.markConnected(session);
        break;
      case 'LocalHold':
        session.state.set('held');
        break;
      case 'Disconnected':
        session.active = null;
        this.markEnded(session);
        break;
      default:
        break; // Connecting / RemoteHold / Disconnecting: keep what the user sees.
    }
  }

  private markConnected(session: CallSession): void {
    if (session.connectedSince() === null) session.connectedSince.set(Date.now());
    session.state.set('connected');
  }

  /** The other side hung up. On the main card "The caller hung up" shows briefly; a call on hold
   *  or waiting just disappears from its row. */
  private markEnded(session: CallSession): void {
    if (session !== this.focused()) {
      this.removeSession(session);
      return;
    }
    session.state.set('ended');
    if (session.endTimer !== null) clearTimeout(session.endTimer);
    session.endTimer = setTimeout(() => this.removeSession(session), ENDED_LINGER_MS);
  }

  /** Takes a call off the popup. If it was on the main card, the next call moves up: a waiting one
   *  first (so it can be answered), else the oldest held one (which stays on hold until Resume). */
  private removeSession(session: CallSession): void {
    if (session.endTimer !== null) clearTimeout(session.endTimer);
    session.endTimer = null;
    session.incoming = null;
    session.active = null;
    const rest = this.sessions().filter(s => s !== session);
    this.sessions.set(rest);
    if (this.focusedSeq() === session.seq) {
      const next = rest.find(s => s.state() === 'ringing') ?? rest[0] ?? null;
      this.focusedSeq.set(next?.seq ?? null);
    }
    if (rest.length === 0) this.resumeAfterCall();
  }

  /** Anything on screen counts: a re-registration would drop the calls it holds. */
  private isBusy(): boolean {
    return this.sessions().length > 0;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

}
