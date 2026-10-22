import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MsalService } from '@azure/msal-angular';
import { IdleTimeoutService } from './idle-timeout.service';
import { AppStateService } from './app-state.service';

/**
 * Automatic sign-out after 8 hours of inactivity. Pins that the timer starts on start() (not only on
 * first activity), that ANY of the tracked inputs restarts the full window, that the logout clears
 * cached app data BEFORE redirecting, and that nothing happens before start() is called.
 */
const EIGHT_HOURS = 480 * 60 * 1000;

describe('IdleTimeoutService', () => {
  let service: IdleTimeoutService;
  let logoutRedirect: ReturnType<typeof vi.fn>;
  let clearAll: ReturnType<typeof vi.fn>;
  let calls: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    logoutRedirect = vi.fn(() => calls.push('logout'));
    clearAll = vi.fn(() => calls.push('clearAll'));
    TestBed.configureTestingModule({
      providers: [
        { provide: MsalService, useValue: { logoutRedirect } },
        { provide: AppStateService, useValue: { clearAll } },
      ],
    });
    service = TestBed.inject(IdleTimeoutService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing until start() is called', () => {
    vi.advanceTimersByTime(EIGHT_HOURS * 2);
    expect(logoutRedirect).not.toHaveBeenCalled();
  });

  it('signs out after 8 idle hours even if the user never touches the page', () => {
    service.start();

    vi.advanceTimersByTime(EIGHT_HOURS - 1);
    expect(logoutRedirect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(logoutRedirect).toHaveBeenCalledTimes(1);
  });

  it('clears cached app data before redirecting to logout', () => {
    service.start();
    vi.advanceTimersByTime(EIGHT_HOURS);

    expect(calls).toEqual(['clearAll', 'logout']);
  });

  it.each([
    ['mousemove', () => document.dispatchEvent(new MouseEvent('mousemove'))],
    ['keydown', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))],
    ['mousedown', () => document.dispatchEvent(new MouseEvent('mousedown'))],
    ['touchstart', () => document.dispatchEvent(new Event('touchstart'))],
    ['scroll (captured from any element)', () => document.body.dispatchEvent(new Event('scroll'))],
  ])('%s restarts the full 8-hour window', (_name, act) => {
    service.start();

    vi.advanceTimersByTime(EIGHT_HOURS - 1000);
    act();
    vi.advanceTimersByTime(EIGHT_HOURS - 1);
    expect(logoutRedirect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(logoutRedirect).toHaveBeenCalledTimes(1);
  });

  it('logs out only once per idle period, not repeatedly', () => {
    service.start();
    vi.advanceTimersByTime(EIGHT_HOURS * 3);

    expect(logoutRedirect).toHaveBeenCalledTimes(1);
  });
});
