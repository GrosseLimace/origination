import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MsalBroadcastService } from '@azure/msal-angular';
import { EventType, type EventMessage } from '@azure/msal-browser';
import { Subject, of } from 'rxjs';

import { AppInsightsService } from './app-insights.service';
import { ApiService } from './api.service';

// The SDK is replaced wholesale: these tests are about when we send and what, not about the SDK.
const sdk = vi.hoisted(() => {
  const instance = {
    loadAppInsights: vi.fn(),
    addTelemetryInitializer: vi.fn(),
    setAuthenticatedUserContext: vi.fn(),
    trackException: vi.fn(),
    trackEvent: vi.fn(),
  };
  return { instance, ctor: vi.fn(() => instance) };
});
vi.mock('@microsoft/applicationinsights-web', () => ({
  ApplicationInsights: function (this: unknown, ...args: unknown[]) { return sdk.ctor(...args); },
}));

const CONNECTION_STRING = 'InstrumentationKey=x;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/';

describe('AppInsightsService', () => {
  let msal$: Subject<EventMessage>;
  let api: { getClientTelemetryConfig: ReturnType<typeof vi.fn> };

  function create(connectionString: string | null) {
    api.getClientTelemetryConfig.mockReturnValue(of({ connectionString }));
    return TestBed.inject(AppInsightsService);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    msal$ = new Subject<EventMessage>();
    api = { getClientTelemetryConfig: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: MsalBroadcastService, useValue: { msalSubject$: msal$ } },
      ],
    });
  });

  it('stays off, and never loads the SDK, when the server has no connection string', async () => {
    const svc = create(null);
    svc.trackException(new Error('before start'));

    await svc.start('CEgr');
    svc.trackException(new Error('after start'));

    expect(sdk.ctor).not.toHaveBeenCalled();
    expect(sdk.instance.trackException).not.toHaveBeenCalled();
  });

  it('turns on with the server connection string and tags the user by short name', async () => {
    const svc = create(CONNECTION_STRING);

    await svc.start('CEgr');

    expect(sdk.ctor).toHaveBeenCalledTimes(1);
    const config = (sdk.ctor.mock.calls[0] as unknown as [{ config: Record<string, unknown> }])[0].config;
    expect(config['connectionString']).toBe(CONNECTION_STRING);
    // API calls are the server's to record; tracking them here would double the volume.
    expect(config['disableAjaxTracking']).toBe(true);
    expect(config['disableFetchTracking']).toBe(true);
    // No config fetch from js.monitor.azure.com: the CSP would block it and log a violation.
    expect(config['extensionConfig']).toEqual({ AppInsightsCfgSyncPlugin: { blkCdnCfg: true } });
    expect(sdk.instance.loadAppInsights).toHaveBeenCalled();
    expect(sdk.instance.setAuthenticatedUserContext).toHaveBeenCalledWith('CEgr', undefined, true);
  });

  it('sends what was reported before start, then reports directly', async () => {
    const svc = create(CONNECTION_STRING);
    const early = new Error('during bootstrap');
    svc.trackException(early);
    expect(sdk.instance.trackException).not.toHaveBeenCalled();

    await svc.start('CEgr');
    svc.trackException('a thrown string');

    expect(sdk.instance.trackException).toHaveBeenCalledTimes(2);
    const [first, second] = sdk.instance.trackException.mock.calls.map(c => (c[0] as { exception: Error }).exception);
    expect(first).toBe(early);
    // A non-Error throw still arrives as an Error, so App Insights can group it.
    expect(second).toBeInstanceOf(Error);
    expect(second.message).toBe('a thrown string');
  });

  it('holds at most 20 items before start', async () => {
    const svc = create(CONNECTION_STRING);
    for (let i = 0; i < 25; i++) svc.trackException(new Error(`e${i}`));

    await svc.start('CEgr');

    expect(sdk.instance.trackException).toHaveBeenCalledTimes(20);
  });

  it('starts only once however often it is called', async () => {
    const svc = create(CONNECTION_STRING);

    await Promise.all([svc.start('CEgr'), svc.start('CEgr')]);
    await svc.start('CEgr');

    expect(api.getClientTelemetryConfig).toHaveBeenCalledTimes(1);
    expect(sdk.ctor).toHaveBeenCalledTimes(1);
  });

  it('forwards MSAL failures by code only, and ignores successes', async () => {
    const svc = create(CONNECTION_STRING);
    await svc.start('CEgr');

    msal$.next({ eventType: EventType.ACQUIRE_TOKEN_SUCCESS, error: null } as EventMessage);
    msal$.next({
      eventType: EventType.ACQUIRE_TOKEN_FAILURE,
      interactionType: 'silent',
      error: Object.assign(new Error('AADSTS50058: details naming someone@scoular.com'), {
        name: 'InteractionRequiredAuthError', errorCode: 'interaction_required', subError: 'login_required',
      }),
    } as unknown as EventMessage);

    expect(sdk.instance.trackEvent).toHaveBeenCalledTimes(1);
    const sent = sdk.instance.trackEvent.mock.calls[0][0] as { name: string; properties: Record<string, string> };
    expect(sent.name).toBe('MSAL.failure');
    expect(sent.properties).toEqual({
      eventType: EventType.ACQUIRE_TOKEN_FAILURE,
      interactionType: 'silent',
      errorName: 'InteractionRequiredAuthError',
      errorCode: 'interaction_required',
      subError: 'login_required',
    });
    // The message can echo account details, so it is never sent.
    expect(JSON.stringify(sent)).not.toContain('scoular.com');
  });
});
