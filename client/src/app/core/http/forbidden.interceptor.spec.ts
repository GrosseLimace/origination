import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { environment } from '@env/environment';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { PERMISSION_DENIED_MESSAGE, forbiddenInterceptor } from './forbidden.interceptor';
import { alreadyShown } from './shown-errors';

const API = environment.apiBaseUrl;

/**
 * The interceptor is the one place a 403 is shown, so these pin both halves of that: it shows each
 * 403 once, and a screen that checks alreadyShown(err) then stays quiet, which stops a 403 showing
 * as two toasts.
 */
describe('forbiddenInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let toast: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([forbiddenInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => backend.verify());

  /** Makes a GET to `url`, answers it with `status`, and returns the error the caller got. */
  function fail(url: string, status: number, body: unknown = null): unknown {
    let caught: unknown;
    http.get(url).subscribe({ error: e => caught = e });
    backend.expectOne(url).flush(body, { status, statusText: 'x' });
    return caught;
  }

  const messages = () => toast.toasts().map(t => t.message);

  it('shows a missing permission in plain words, not the permission id', () => {
    fail(`${API}/notes`, 403, {
      error: {
        code: 'AUTHZ_PERMISSION_DENIED',
        message: 'Insufficient permissions.',
        details: [{ field: 'permission', message: "Requires 'notes:write'.", code: 'notes:write' }],
      },
    });

    expect(messages()).toEqual([PERMISSION_DENIED_MESSAGE]);
  });

  it("shows any other 403's own reason, which is about that record", () => {
    fail(`${API}/bidsheet/locations/7`, 403, {
      error: { code: 'FORBIDDEN', message: 'Only the person who added this location, or a manager, can remove it.' },
    });

    expect(messages()).toEqual(['Only the person who added this location, or a manager, can remove it.']);
  });

  it('falls back to a generic message when the 403 has no body', () => {
    fail(`${API}/customers`, 403);

    expect(messages()).toEqual(['Access denied: you are not authorized for this resource.']);
  });

  it('passes the error on, marked as shown', () => {
    const caught = fail(`${API}/customers`, 403);

    expect(caught).toBeTruthy();
    expect(alreadyShown(caught)).toBe(true);
  });

  it("doesn't stack copies when several requests are refused together", () => {
    fail(`${API}/usagedashboard/summary`, 403, { error: { code: 'AUTHZ_PERMISSION_DENIED' } });
    fail(`${API}/usagedashboard/users`, 403, { error: { code: 'AUTHZ_PERMISSION_DENIED' } });

    expect(messages()).toEqual([PERMISSION_DENIED_MESSAGE]);
  });

  it('leaves every other failure to the screen', () => {
    const caught = fail(`${API}/customers`, 500);

    expect(messages()).toEqual([]);
    expect(alreadyShown(caught)).toBe(false);
  });

  it("ignores 403s from other hosts, such as Microsoft Graph's", () => {
    const caught = fail('https://graph.microsoft.com/v1.0/me/photo/$value', 403);

    expect(messages()).toEqual([]);
    expect(alreadyShown(caught)).toBe(false);
  });

  it('through ApiService, a screen that checks alreadyShown adds no second toast', () => {
    // ApiService wraps the response in an ApiError; the check follows its cause back to the response.
    const api = TestBed.inject(ApiService);
    api.getUserTradeUnits().subscribe({
      error: err => { if (!alreadyShown(err)) toast.error('Failed to load trade units'); },
    });
    backend.expectOne(`${API}/usertradeunits`).flush(
      { error: { code: 'AUTHZ_PERMISSION_DENIED' } }, { status: 403, statusText: 'Forbidden' });

    expect(messages()).toEqual([PERMISSION_DENIED_MESSAGE]);
  });

  it('through ApiService, a screen still shows its own message for any other failure', () => {
    const api = TestBed.inject(ApiService);
    api.getUserTradeUnits().subscribe({
      error: err => { if (!alreadyShown(err)) toast.error('Failed to load trade units'); },
    });
    backend.expectOne(`${API}/usertradeunits`).flush(null, { status: 500, statusText: 'Server Error' });

    expect(messages()).toEqual(['Failed to load trade units']);
  });
});

describe('alreadyShown', () => {
  it('is false for anything that was never marked, including non-objects', () => {
    expect(alreadyShown(new Error('x'))).toBe(false);
    expect(alreadyShown(null)).toBe(false);
    expect(alreadyShown('403')).toBe(false);
  });

  it('survives a cause chain that loops', () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = { cause: a };
    a.cause = b;

    expect(alreadyShown(a)).toBe(false);
  });
});
