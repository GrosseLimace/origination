import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { AppInsightsService } from './app-insights.service';
import { HandledErrorReporter } from './handled-error-reporter.service';

describe('HandledErrorReporter', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  it('logs the error in dev builds and hands it to App Insights', () => {
    const track = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: AppInsightsService, useValue: { trackHandledError: track } }] });
    const err = new Error('boom');

    TestBed.inject(HandledErrorReporter).report('[BidSheet] export failed', err);

    expect(warn).toHaveBeenCalledWith('[[BidSheet] export failed]', err);
    expect(track).toHaveBeenCalledWith('[BidSheet] export failed', err);
  });

  it('sends without logging, for callers that write their own console line', () => {
    const track = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: AppInsightsService, useValue: { trackHandledError: track } }] });

    TestBed.inject(HandledErrorReporter).send('Home: failed to load notes', new Error('boom'));

    expect(warn).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(1);
  });

  // AppInsightsService needs MSAL to be built; a screen's test (or a broken telemetry setup) may not have it.
  it('never turns a report into a second error when App Insights can\'t be created', () => {
    TestBed.configureTestingModule({});

    expect(() => TestBed.inject(HandledErrorReporter).report('Failed to save print layout', new Error('boom'))).not.toThrow();
  });
});
