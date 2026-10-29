import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';

import {
  IncomingCallService,
  MAX_CONSECUTIVE_FAILURES,
  RECONNECT_MAX_DELAY_MS,
  STABLE_CONNECTION_MS,
  THROTTLED_FALLBACK_MS,
  reconnectDelayMs,
  throttleRetryAfterMs,
} from './incoming-call.service';
import { CallingSdkLoader } from './calling-sdk-loader.service';
import { ToastService } from './toast.service';
import { CallAudioPermissionService } from './call-audio-permission.service';
import { makeMsalBroadcastMock, makeMsalServiceMock } from '@testing/msal.mocks';
import { environment } from '@env/environment';
import type { IncomingCallMatch } from '@models';

const BASE = environment.apiBaseUrl;

const SMITH: IncomingCallMatch = {
  customerId: 158259, name: 'Smith Farms', scoularId: 'SMIFAR', tradeUnit: '3811', tradeUnits: ['3811'],
};
const JONES: IncomingCallMatch = { customerId: 7, name: 'Jones Ag', scoularId: 'JONAG', tradeUnits: [] };

/** A stand-in for the ACS SDK: just enough surface to drive the service's state machine. */
function makeFakeSdk() {
  const listeners: Record<string, (args: any) => void> = {};
  const agent = {
    on: vi.fn((event: string, cb: (args: any) => void) => { listeners[event] = cb; }),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  const deviceManager = { askDevicePermission: vi.fn().mockResolvedValue({ audio: true }) };
  const credentialArgs: any[] = [];
  const credentials: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const clients: CallClient[] = [];
  /** Shared by every CallClient, so a test can make registration fail (e.g. a registrar 429). */
  const createTeamsCallAgent = vi.fn().mockResolvedValue(agent);

  class CallClient {
    createTeamsCallAgent = createTeamsCallAgent;
    getDeviceManager = vi.fn().mockResolvedValue(deviceManager);
    dispose = vi.fn().mockResolvedValue(undefined);
    constructor() { clients.push(this); }
  }
  class AzureCommunicationTokenCredential {
    dispose = vi.fn();
    constructor(args: any) { credentialArgs.push(args); credentials.push(this); }
  }

  /** Simulates Teams ringing this endpoint. Returns handles to drive the call afterwards. */
  function ring(identifier: any = { kind: 'phoneNumber', phoneNumber: '+14025554914' }, displayName?: string) {
    let ended: ((args: any) => void) | undefined;
    let stateChanged: (() => void) | undefined;
    const active = {
      state: 'Connected' as string,
      on: vi.fn((_e: string, cb: () => void) => { stateChanged = cb; }),
      hold: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      hangUp: vi.fn().mockResolvedValue(undefined),
    };
    const incoming = {
      callerInfo: { identifier, displayName },
      on: vi.fn((_e: string, cb: (args: any) => void) => { ended = cb; }),
      accept: vi.fn().mockResolvedValue(active),
      reject: vi.fn().mockResolvedValue(undefined),
    };
    listeners['incomingCall']({ incomingCall: incoming });
    return {
      incoming,
      active,
      end: (code: number, subCode: number) => ended?.({ callEndReason: { code, subCode } }),
      setState: (s: string) => { active.state = s; stateChanged?.(); },
    };
  }

  const connection = (newValue: string, reason?: string) =>
    listeners['connectionStateChanged']?.({ oldValue: 'Connected', newValue, reason });

  return {
    sdk: { CallClient, AzureCommunicationTokenCredential } as any,
    agent, deviceManager, credentialArgs, credentials, clients, createTeamsCallAgent, ring, connection,
  };
}

describe('IncomingCallService', () => {
  let httpMock: HttpTestingController;
  let fake: ReturnType<typeof makeFakeSdk>;
  let loader: { load: ReturnType<typeof vi.fn> };
  let toast: { error: ReturnType<typeof vi.fn> };
  let audioPermission: { activate: ReturnType<typeof vi.fn>; deactivate: ReturnType<typeof vi.fn> };

  function create(account: any = { name: 'Caden', username: 'CEgr@scoular.com' }): IncomingCallService {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MsalService, useValue: makeMsalServiceMock(account) },
        { provide: MsalBroadcastService, useValue: makeMsalBroadcastMock() },
        { provide: CallingSdkLoader, useValue: loader },
        { provide: ToastService, useValue: toast },
        { provide: CallAudioPermissionService, useValue: audioPermission },
      ],
    });
    const service = TestBed.inject(IncomingCallService);
    httpMock = TestBed.inject(HttpTestingController);
    return service;
  }

  /** The exchange request arrives after an awaited MSAL call, so give the microtask queue a turn.
   *  `match` removes what it finds from the controller, so the request is captured on the attempt
   *  that sees it rather than looked up twice. */
  async function expectExchange() {
    let req: TestRequest | undefined;
    await vi.waitFor(() => {
      req ??= httpMock.match(`${BASE}/calling/token`)[0];
      expect(req).toBeDefined();
    });
    return req!;
  }

  /** Answers the exchange and waits for the SDK to register. */
  async function startListening(service: IncomingCallService) {
    (await expectExchange()).flush({ token: 'acs-token', expiresOn: '2099-01-01T00:00:00Z' });
    await vi.waitFor(() => expect(service.isListening()).toBe(true));
  }

  function flushMatches(matches: IncomingCallMatch[]) {
    httpMock.expectOne(r => r.url === `${BASE}/calling/match`).flush(matches);
  }

  beforeEach(() => {
    fake = makeFakeSdk();
    loader = { load: vi.fn().mockResolvedValue(fake.sdk) };
    toast = { error: vi.fn() };
    audioPermission = { activate: vi.fn().mockResolvedValue(undefined), deactivate: vi.fn() };
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  // ── Start-up ──────────────────────────────────────────────────────────────

  it('posts the Entra token for the ACS scopes to the exchange endpoint, in the body', async () => {
    create();

    const req = await expectExchange();

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ teamsUserAadToken: 'test-access-token' }); // from the MSAL mock
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('stays dormant and never downloads the SDK when the environment has no calling (204)', async () => {
    const service = create();

    (await expectExchange()).flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() => expect(service.state()).toBe('unavailable'));
    expect(loader.load).not.toHaveBeenCalled();
    expect(service.isVisible()).toBe(false);
  });

  it('stays dormant when the exchange fails (502)', async () => {
    const service = create();

    (await expectExchange()).flush({ error: { code: 'CALLING_TOKEN_EXCHANGE_FAILED' } }, { status: 502, statusText: 'Bad Gateway' });

    await vi.waitFor(() => expect(service.state()).toBe('unavailable'));
    expect(loader.load).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does nothing before anyone is signed in', async () => {
    create(null);

    await new Promise(r => setTimeout(r, 20));
    httpMock.expectNone(`${BASE}/calling/token`);
  });

  it('settles in unavailable, without a toast, when the SDK cannot be loaded', async () => {
    loader.load.mockRejectedValue(new Error('chunk load failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = create();

    (await expectExchange()).flush({ token: 't', expiresOn: '2099-01-01T00:00:00Z' });

    await vi.waitFor(() => expect(service.state()).toBe('unavailable'));
    expect(toast.error).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('registers as a Teams endpoint with a self-refreshing token, without touching the microphone', async () => {
    const service = create();
    await startListening(service);

    expect(service.isLeader()).toBe(true);
    expect(fake.agent.on).toHaveBeenCalledWith('incomingCall', expect.any(Function));
    expect(fake.agent.on).toHaveBeenCalledWith('connectionStateChanged', expect.any(Function));
    // askDevicePermission opens a real capture stream (the mic-in-use light), so it waits for Answer.
    expect(fake.deviceManager.askDevicePermission).not.toHaveBeenCalled();
    // Only now (registered, leader tab) is the permission checked for the enable-audio banner.
    expect(audioPermission.activate).toHaveBeenCalledTimes(1);
    expect(fake.credentialArgs[0].token).toBe('acs-token');
    expect(fake.credentialArgs[0].refreshProactively).toBe(true);

    // The refresher re-runs both hops: MSAL silent, then the exchange.
    const refreshed = fake.credentialArgs[0].tokenRefresher();
    (await expectExchange()).flush({ token: 'acs-token-2', expiresOn: '2099-01-01T00:00:00Z' });
    await expect(refreshed).resolves.toBe('acs-token-2');
  });

  it('stop() disposes the agent, its credential and the CallClient, and stops listening (sign-out)', async () => {
    const service = create();
    await startListening(service);

    await service.stop();

    expect(fake.agent.dispose).toHaveBeenCalled();
    expect(fake.credentials[0].dispose).toHaveBeenCalled();
    expect(fake.clients).toHaveLength(1);
    expect(fake.clients[0].dispose).toHaveBeenCalled();
    expect(audioPermission.deactivate).toHaveBeenCalled();
    expect(service.isListening()).toBe(false);
    expect(service.isLeader()).toBe(false);
  });

  it('never checks the microphone permission when the environment has no calling (204)', async () => {
    const service = create();

    (await expectExchange()).flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() => expect(service.state()).toBe('unavailable'));
    expect(audioPermission.activate).not.toHaveBeenCalled();
  });

  // ── Re-registration, back-off and throttling ──────────────────────────────

  describe('re-registration', () => {
    const tokenUrl = `${BASE}/calling/token`;

    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor exactly 1.0
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    /** Lets pending promises settle WITHOUT moving the fake clock. (vi.waitFor cannot be used
     *  between a failure and expectRetryAfter: under fake timers it advances the clock itself.) */
    async function settle() {
      for (let i = 0; i < 25; i++) await vi.advanceTimersByTimeAsync(0);
    }

    /** Advances to just before `delayMs` (no exchange yet), then to it, and answers the exchange. */
    async function expectRetryAfter(delayMs: number) {
      await vi.advanceTimersByTimeAsync(delayMs - 1);
      httpMock.expectNone(tokenUrl);
      await vi.advanceTimersByTimeAsync(1);
      (await expectExchange()).flush({ token: 'acs-token-n', expiresOn: '2099-01-01T00:00:00Z' });
    }

    it('re-registers after the SDK reports its connection lost, letting the old agent and credential go', async () => {
      const service = create();
      await startListening(service);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      fake.connection('Disconnected', 'connectionIssue');
      expect(service.isListening()).toBe(false);

      await expectRetryAfter(reconnectDelayMs(0));
      await vi.waitFor(() => expect(service.isListening()).toBe(true));
      expect(fake.agent.dispose).toHaveBeenCalled();
      expect(fake.credentials[0].dispose).toHaveBeenCalled();
    });

    it('backs off exponentially when registrations keep dropping before they are stable', async () => {
      const service = create();
      await startListening(service);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      for (const delay of [5_000, 10_000, 20_000]) {
        fake.connection('Disconnected', 'connectionIssue');
        await expectRetryAfter(delay);
        await vi.waitFor(() => expect(service.isListening()).toBe(true));
      }
    });

    it('resets the back-off only once a registration has stayed up for a while', async () => {
      const service = create();
      await startListening(service);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      fake.connection('Disconnected', 'connectionIssue');
      await expectRetryAfter(5_000);
      await vi.waitFor(() => expect(service.isListening()).toBe(true));

      await vi.advanceTimersByTimeAsync(STABLE_CONNECTION_MS); // stable: failures forgiven
      fake.connection('Disconnected', 'connectionIssue');
      await expectRetryAfter(5_000);                           // back to the first step, not 10 s
      await vi.waitFor(() => expect(service.isListening()).toBe(true));
    });

    it('keeps the agent when the SDK recovers by itself before the rebuild is due', async () => {
      const service = create();
      await startListening(service);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      // What Dev showed after every registration: a blip ~0.5 s in, then the SDK reconnects itself.
      fake.connection('Disconnected', 'connectionIssue');
      expect(service.isListening()).toBe(false);
      fake.connection('Connected');
      expect(service.isListening()).toBe(true);

      await vi.advanceTimersByTimeAsync(RECONNECT_MAX_DELAY_MS);
      httpMock.expectNone(tokenUrl);                       // no new token, so no rebuild
      expect(fake.agent.dispose).not.toHaveBeenCalled();
      expect(fake.credentials[0].dispose).not.toHaveBeenCalled();
      expect(fake.createTeamsCallAgent).toHaveBeenCalledTimes(1);
    });

    it('still rebuilds when the connection stays down', async () => {
      const service = create();
      await startListening(service);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      fake.connection('Disconnected', 'connectionIssue');
      fake.connection('Connecting');                       // not a recovery
      await expectRetryAfter(reconnectDelayMs(0));
      await vi.waitFor(() => expect(service.isListening()).toBe(true));
      expect(fake.agent.dispose).toHaveBeenCalled();
    });

    it('treats invalidToken the same way: rebuilds with a fresh token after the back-off', async () => {
      const service = create();
      await startListening(service);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      fake.connection('Disconnected', 'invalidToken');

      await expectRetryAfter(5_000);
      await vi.waitFor(() => expect(service.isListening()).toBe(true));
    });

    it('waits at least the registrar retryAfter when registration is throttled (429 / 42901)', async () => {
      fake.createTeamsCallAgent.mockRejectedValueOnce(Object.assign(
        new Error('Registration failed: {"code":42901,"retryAfter":"00:01:54.63","message":"Request was throttled"}'),
        { code: 429 }));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const service = create();

      (await expectExchange()).flush({ token: 'acs-token', expiresOn: '2099-01-01T00:00:00Z' });
      await settle();
      expect(service.state()).toBe('unavailable');

      await vi.advanceTimersByTimeAsync(reconnectDelayMs(0)); // the plain back-off is not enough
      httpMock.expectNone(tokenUrl);
      await expectRetryAfter(114_630 - reconnectDelayMs(0));
      await vi.waitFor(() => expect(service.isListening()).toBe(true));
      expect(service.state()).toBe('idle');
    });

    it('reuses one CallClient across re-registrations', async () => {
      const service = create();
      await startListening(service);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      fake.connection('Disconnected', 'connectionIssue');
      await expectRetryAfter(5_000);
      await vi.waitFor(() => expect(service.isListening()).toBe(true));
      fake.connection('Disconnected', 'connectionIssue');
      await expectRetryAfter(10_000);
      await vi.waitFor(() => expect(service.isListening()).toBe(true));

      expect(fake.clients).toHaveLength(1);
      expect(fake.createTeamsCallAgent).toHaveBeenCalledTimes(3);
      expect(fake.credentials).toHaveLength(3);
      expect(fake.credentials[0].dispose).toHaveBeenCalled();
      expect(fake.credentials[1].dispose).toHaveBeenCalled();
      expect(fake.credentials[2].dispose).not.toHaveBeenCalled(); // the live one
    });

    it(`gives up after ${MAX_CONSECUTIVE_FAILURES} consecutive failures and stays unavailable`, async () => {
      fake.createTeamsCallAgent.mockRejectedValue(new Error('registration refused'));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const service = create();

      (await expectExchange()).flush({ token: 'acs-token', expiresOn: '2099-01-01T00:00:00Z' }); // failure 1
      for (let failure = 1; failure < MAX_CONSECUTIVE_FAILURES; failure++) {
        await settle();
        expect(fake.createTeamsCallAgent).toHaveBeenCalledTimes(failure);
        await expectRetryAfter(reconnectDelayMs(failure - 1));                                  // failure + 1
      }
      await settle();
      expect(fake.createTeamsCallAgent).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES);

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      httpMock.expectNone(tokenUrl);
      expect(fake.createTeamsCallAgent).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES);
      expect(service.state()).toBe('unavailable');
      expect(service.isListening()).toBe(false);
      expect(audioPermission.activate).not.toHaveBeenCalled(); // never registered, so no banner
      expect(audioPermission.deactivate).toHaveBeenCalled();
    });

    it('does not rebuild mid-call; re-registers once the call is over', async () => {
      const service = create();
      await startListening(service);
      const call = fake.ring();
      flushMatches([SMITH]);
      await service.answer();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      fake.connection('Disconnected', 'connectionIssue');
      await vi.advanceTimersByTimeAsync(RECONNECT_MAX_DELAY_MS);
      httpMock.expectNone(tokenUrl);
      expect(service.state()).toBe('connected');

      await service.hangUp();
      expect(call.active.hangUp).toHaveBeenCalled();
      await expectRetryAfter(5_000);
      await vi.waitFor(() => expect(service.isListening()).toBe(true));
    });

    it('ignores a late Disconnected from an agent it has already replaced', async () => {
      const service = create();
      await startListening(service);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const oldAgentListener = fake.agent.on.mock.calls.filter(c => c[0] === 'connectionStateChanged')[0][1];
      const replacement = { on: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined) };
      fake.createTeamsCallAgent.mockResolvedValueOnce(replacement);

      fake.connection('Disconnected', 'connectionIssue');
      await expectRetryAfter(5_000);
      await vi.waitFor(() => expect(service.isListening()).toBe(true));
      expect(replacement.on).toHaveBeenCalledWith('connectionStateChanged', expect.any(Function));

      // Disposing the old agent can emit one more Disconnected; it must not touch the new registration.
      oldAgentListener({ oldValue: 'Connected', newValue: 'Disconnected', reason: 'connectionIssue' });
      expect(service.isListening()).toBe(true);
      await vi.advanceTimersByTimeAsync(RECONNECT_MAX_DELAY_MS);
      httpMock.expectNone(tokenUrl);
    });
  });

  describe('reconnectDelayMs / throttleRetryAfterMs', () => {
    it('doubles per attempt with +/-20 % jitter, capped', () => {
      expect(reconnectDelayMs(0, () => 0.5)).toBe(5_000);
      expect(reconnectDelayMs(1, () => 0.5)).toBe(10_000);
      expect(reconnectDelayMs(3, () => 0.5)).toBe(40_000);
      expect(reconnectDelayMs(0, () => 0)).toBe(4_000);
      expect(reconnectDelayMs(0, () => 1)).toBe(6_000);
      expect(reconnectDelayMs(30, () => 0.5)).toBe(RECONNECT_MAX_DELAY_MS);
    });

    it('reads retryAfter as a TimeSpan, as seconds, or from inside a message', () => {
      expect(throttleRetryAfterMs({ retryAfter: '00:01:54.63' })).toBe(114_630);
      expect(throttleRetryAfterMs({ retryAfter: 30 })).toBe(30_000);
      expect(throttleRetryAfterMs(new Error('{"code":42901,"retryAfter":"00:00:10","message":"Request was throttled"}'))).toBe(10_000);
    });

    it('falls back to a fixed wait for a throttle without a readable retryAfter', () => {
      expect(throttleRetryAfterMs({ code: 429 })).toBe(THROTTLED_FALLBACK_MS);
      expect(throttleRetryAfterMs({ subCode: 42901 })).toBe(THROTTLED_FALLBACK_MS);
      expect(throttleRetryAfterMs(new Error('Request was throttled'))).toBe(THROTTLED_FALLBACK_MS);
    });

    it('returns null for ordinary failures and caps absurd values', () => {
      expect(throttleRetryAfterMs(undefined)).toBeNull();
      expect(throttleRetryAfterMs({ reason: 'connectionIssue' })).toBeNull();
      expect(throttleRetryAfterMs(new Error('network down'))).toBeNull();
      expect(throttleRetryAfterMs({ retryAfter: '99:00:00' })).toBe(10 * 60 * 1000);
    });
  });

  // ── A real (faked) call ───────────────────────────────────────────────────

  it('rings with the matched producer when a phone number calls', async () => {
    const service = create();
    await startListening(service);

    fake.ring();
    expect(service.state()).toBe('ringing');
    expect(service.callerNumber()).toBe('+14025554914');
    const req = httpMock.expectOne(r => r.url === `${BASE}/calling/match`);
    expect(req.request.params.get('number')).toBe('+14025554914');
    req.flush([SMITH]);

    expect(service.selectedMatch()).toEqual(SMITH); // single match is auto-selected
    expect(service.matchesLoading()).toBe(false);
  });

  it('ignores Teams-to-Teams calls from colleagues', async () => {
    const service = create();
    await startListening(service);

    fake.ring({ kind: 'microsoftTeamsUser', microsoftTeamsUserId: 'abc' });

    expect(service.state()).toBe('idle');
    httpMock.expectNone(r => r.url === `${BASE}/calling/match`);
  });

  it('still pops for a caller that is not a phone number (e.g. a call queue), showing its name', async () => {
    // POC scenario 2: Infrastructure needs to see what a queue / auto-attendant call carries.
    const service = create();
    await startListening(service);

    fake.ring({ kind: 'microsoftTeamsApp', teamsAppId: 'queue-1' }, 'Omaha Main');

    expect(service.state()).toBe('ringing');
    expect(service.callerNumber()).toBeNull();
    expect(service.callerDisplayName()).toBe('Omaha Main');
    expect(service.matchesLoading()).toBe(false);
    httpMock.expectNone(r => r.url === `${BASE}/calling/match`); // nothing to look up
  });

  it('collapses to the "answered in Teams" banner when picked up on another endpoint (487/10003)', async () => {
    const service = create();
    await startListening(service);
    const call = fake.ring();
    flushMatches([SMITH]);

    call.end(487, 10003);

    expect(service.state()).toBe('answeredElsewhere');
    expect(service.selectedMatch()).toEqual(SMITH); // the banner still knows who it is
    service.dismiss();
    expect(service.state()).toBe('idle');
  });

  it.each([
    [487, 0],      // caller hung up
    [487, 10004],  // rang out
    [487, 10024],  // declined on every endpoint
  ])('clears when ringing ends with %i/%i', async (code, subCode) => {
    const service = create();
    await startListening(service);
    const call = fake.ring();
    flushMatches([]);

    call.end(code, subCode);

    expect(service.state()).toBe('idle');
  });

  it('answers in the browser: mic permission, accept, then connected with a timer start', async () => {
    const service = create();
    await startListening(service);
    const call = fake.ring();
    flushMatches([SMITH]);
    expect(fake.deviceManager.askDevicePermission).not.toHaveBeenCalled(); // ringing alone does not open the mic

    await service.answer();

    expect(fake.deviceManager.askDevicePermission).toHaveBeenLastCalledWith({ audio: true, video: false });
    expect(call.incoming.accept).toHaveBeenCalled();
    expect(service.state()).toBe('connected');
    expect(service.connectedSince()).not.toBeNull();
  });

  it('holds, resumes and hangs up the real call', async () => {
    const service = create();
    await startListening(service);
    const call = fake.ring();
    flushMatches([SMITH]);
    await service.answer();

    await service.hold();
    expect(call.active.hold).toHaveBeenCalled();
    call.setState('LocalHold');
    expect(service.state()).toBe('held');

    await service.resume();
    expect(call.active.resume).toHaveBeenCalled();
    call.setState('Connected');
    expect(service.state()).toBe('connected');

    await service.hangUp();
    expect(call.active.hangUp).toHaveBeenCalled();
    expect(service.state()).toBe('idle');      // closes at once; nothing to click
    call.setState('Disconnected');
    expect(service.state()).toBe('idle');      // the late Disconnected event does not reopen it
  });

  it('when the caller hangs up, shows "call ended" briefly and then closes by itself', async () => {
    const service = create();
    await startListening(service);
    const call = fake.ring();
    flushMatches([SMITH]);
    await service.answer();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    call.setState('Disconnected');
    expect(service.state()).toBe('ended');

    vi.advanceTimersByTime(3000);
    expect(service.state()).toBe('idle');
  });

  it('declines: rejects the call and clears the popup', async () => {
    const service = create();
    await startListening(service);
    const call = fake.ring();
    flushMatches([]);

    await service.decline();

    expect(call.incoming.reject).toHaveBeenCalled();
    expect(service.state()).toBe('idle');
  });

  it('keeps ringing and tells the user when answering in the browser fails (e.g. mic blocked)', async () => {
    const service = create();
    await startListening(service);
    fake.ring();
    flushMatches([SMITH]);
    fake.deviceManager.askDevicePermission.mockRejectedValue(new Error('NotAllowedError'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await service.answer();

    expect(service.state()).toBe('ringing');
    expect(toast.error).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not let a second call replace one already in progress', async () => {
    const service = create();
    await startListening(service);
    fake.ring();
    flushMatches([SMITH]);
    await service.answer();

    fake.ring({ kind: 'phoneNumber', phoneNumber: '+15155550000' });

    expect(service.callerNumber()).toBe('+14025554914');
    httpMock.expectNone(r => r.url === `${BASE}/calling/match`);
  });

  // ── Simulation ────────────────────────────────────────────────────────────

  it('simulate runs the popup flow without the SDK', async () => {
    const service = create(null); // no sign-in needed to simulate

    service.simulate('(402) 555-4914');
    flushMatches([SMITH, JONES]);

    expect(service.state()).toBe('ringing');
    expect(service.isSimulated()).toBe(true);
    expect(service.selectedMatch()).toBeNull(); // two matches: the user must choose
    service.choose(JONES.customerId);
    expect(service.selectedMatch()).toEqual(JONES);

    await service.answer();
    expect(service.state()).toBe('connected');
    await service.hold();
    expect(service.state()).toBe('held');
    await service.resume();
    await service.hangUp();
    expect(service.state()).toBe('idle');
  });

  it('simulate can play the caller hanging up', () => {
    const service = create(null);
    service.simulate('4025554914');
    flushMatches([SMITH]);
    void service.answer();

    service.simulateCallerHungUp();

    expect(service.state()).toBe('ended');
  });

  it('a stale match response from an earlier call never overwrites the current one', async () => {
    const service = create(null);
    service.simulate('4025554914');
    const first = httpMock.expectOne(r => r.url === `${BASE}/calling/match`);
    await service.decline();
    service.simulate('5155550000');
    const second = httpMock.expectOne(r => r.url === `${BASE}/calling/match`);

    first.flush([SMITH]);
    second.flush([JONES]);

    expect(service.matches()).toEqual([JONES]);
  });
});
