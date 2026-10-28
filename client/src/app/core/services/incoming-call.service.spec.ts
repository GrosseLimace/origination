import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';

import { IncomingCallService } from './incoming-call.service';
import { CallingSdkLoader } from './calling-sdk-loader.service';
import { ToastService } from './toast.service';
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

  class CallClient {
    createTeamsCallAgent = vi.fn().mockResolvedValue(agent);
    getDeviceManager = vi.fn().mockResolvedValue(deviceManager);
  }
  class AzureCommunicationTokenCredential {
    constructor(args: any) { credentialArgs.push(args); }
  }

  /** Simulates Teams ringing this endpoint. Returns handles to drive the call afterwards. */
  function ring(identifier: any = { kind: 'phoneNumber', phoneNumber: '+14025554914' }) {
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
      callerInfo: { identifier },
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

  return { sdk: { CallClient, AzureCommunicationTokenCredential } as any, agent, deviceManager, credentialArgs, ring };
}

describe('IncomingCallService', () => {
  let httpMock: HttpTestingController;
  let fake: ReturnType<typeof makeFakeSdk>;
  let loader: { load: ReturnType<typeof vi.fn> };
  let toast: { error: ReturnType<typeof vi.fn> };

  function create(account: any = { name: 'Caden', username: 'CEgr@scoular.com' }): IncomingCallService {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MsalService, useValue: makeMsalServiceMock(account) },
        { provide: MsalBroadcastService, useValue: makeMsalBroadcastMock() },
        { provide: CallingSdkLoader, useValue: loader },
        { provide: ToastService, useValue: toast },
      ],
    });
    const service = TestBed.inject(IncomingCallService);
    httpMock = TestBed.inject(HttpTestingController);
    return service;
  }

  /** Answers the token request and waits for the SDK to register. */
  async function startListening(service: IncomingCallService) {
    httpMock.expectOne(`${BASE}/calling/token`).flush({ token: 'acs-token', expiresOn: '2099-01-01T00:00:00Z' });
    await vi.waitFor(() => expect(service.isListening()).toBe(true));
  }

  function flushMatches(matches: IncomingCallMatch[]) {
    httpMock.expectOne(r => r.url === `${BASE}/calling/match`).flush(matches);
  }

  beforeEach(() => {
    fake = makeFakeSdk();
    loader = { load: vi.fn().mockResolvedValue(fake.sdk) };
    toast = { error: vi.fn() };
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  // ── Start-up ──────────────────────────────────────────────────────────────

  it('stays dormant and never downloads the SDK when the environment has no calling (204)', async () => {
    const service = create();

    httpMock.expectOne(`${BASE}/calling/token`).flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() => expect(service.state()).toBe('unavailable'));
    expect(loader.load).not.toHaveBeenCalled();
    expect(service.isVisible()).toBe(false);
  });

  it('does nothing before anyone is signed in', () => {
    create(null);

    httpMock.expectNone(`${BASE}/calling/token`);
  });

  it('settles in unavailable, without a toast, when the SDK cannot be loaded', async () => {
    loader.load.mockRejectedValue(new Error('chunk load failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = create();

    httpMock.expectOne(`${BASE}/calling/token`).flush({ token: 't', expiresOn: '2099-01-01T00:00:00Z' });

    await vi.waitFor(() => expect(service.state()).toBe('unavailable'));
    expect(toast.error).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('registers as a Teams endpoint with a self-refreshing token', async () => {
    const service = create();
    await startListening(service);

    expect(fake.agent.on).toHaveBeenCalledWith('incomingCall', expect.any(Function));
    expect(fake.credentialArgs[0].token).toBe('acs-token');
    expect(fake.credentialArgs[0].refreshProactively).toBe(true);

    // The refresher goes back to the same endpoint for a new token.
    const refreshed = fake.credentialArgs[0].tokenRefresher();
    httpMock.expectOne(`${BASE}/calling/token`).flush({ token: 'acs-token-2', expiresOn: '2099-01-01T00:00:00Z' });
    await expect(refreshed).resolves.toBe('acs-token-2');
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

    await service.answer();

    expect(fake.deviceManager.askDevicePermission).toHaveBeenCalledWith({ audio: true, video: false });
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const service = create();
    await startListening(service);
    const call = fake.ring();
    flushMatches([SMITH]);
    await service.answer();

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
