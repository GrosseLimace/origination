import { Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MsalService, MsalBroadcastService, MsalGuard } from '@azure/msal-angular';
import { makeMsalServiceMock, makeMsalBroadcastMock, FakeAccount } from './msal.mocks';

export interface TestEnvOptions {
  /** Signed-in account to simulate; defaults to none. */
  account?: FakeAccount | null;
  /** Extra providers (e.g. component-specific service stubs) appended last so they can override. */
  extraProviders?: Provider[];
}

/**
 * Cross-cutting providers a smart component needs to render in isolation without real
 * auth, routing, or network: a no-route router, the HTTP testing backend, and mocked
 * MSAL services. Compose with `render(Component, { providers: provideTestEnvironment() })`.
 *
 * Change detection is intentionally left to TestBed's default (Testing Library calls
 * detectChanges for us); we avoid Zone-specific patterns per automated-testing.md §7.1.
 */
export function provideTestEnvironment(options: TestEnvOptions = {}): Provider[] {
  return [
    provideRouter([]),
    provideHttpClient(),
    provideHttpClientTesting(),
    { provide: MsalService, useValue: makeMsalServiceMock(options.account ?? null) },
    { provide: MsalBroadcastService, useValue: makeMsalBroadcastMock() },
    { provide: MsalGuard, useValue: { canActivate: () => true } },
    ...(options.extraProviders ?? []),
  ];
}
