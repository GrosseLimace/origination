import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ToastService } from '@core/services/toast.service';
import { HomeBackgroundFailures } from './home-background-failures';

describe('HomeBackgroundFailures', () => {
  let failures: HomeBackgroundFailures;
  let toast: { error: ReturnType<typeof vi.fn> };
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-14T12:00:00Z') });
    log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    toast = { error: vi.fn() };
    TestBed.configureTestingModule({ providers: [HomeBackgroundFailures, { provide: ToastService, useValue: toast }] });
    failures = TestBed.inject(HomeBackgroundFailures);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('toasts the first failure, naming what failed, and logs it in dev', () => {
    const err = new Error('500');
    failures.report('load contracts', err);

    expect(toast.error).toHaveBeenCalledWith('Failed to load contracts. Some data may be missing or out of date.');
    expect(log).toHaveBeenCalledWith('[Home] failed to load contracts', err);
  });

  it('logs every failure but toasts at most once a minute across sources', () => {
    failures.report('load contracts', null);
    failures.report('load stored grain', null);
    vi.advanceTimersByTime(59_000);
    failures.report('load DP contracts', null);

    expect(log).toHaveBeenCalledTimes(3);
    expect(toast.error).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    failures.report('load DP contracts', null);
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error.mock.calls[1][0]).toContain('load DP contracts');
  });

  it('keeps the same source quiet for five minutes after it has spoken', () => {
    failures.report('load contracts', null);
    vi.advanceTimersByTime(4 * 60_000);
    failures.report('load contracts', null);
    expect(toast.error).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    failures.report('load contracts', null);
    expect(toast.error).toHaveBeenCalledTimes(2);
  });
});
