import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GlobalErrorHandler } from './global-error.handler';
import { ToastService } from '@core/services/toast.service';
import { AppInsightsService } from '@core/services/app-insights.service';

describe('GlobalErrorHandler', () => {
  let handler: GlobalErrorHandler;
  let toastService: ToastService;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GlobalErrorHandler, ToastService],
    });
    handler = TestBed.inject(GlobalErrorHandler);
    toastService = TestBed.inject(ToastService);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('logs the error to console', () => {
    const err = new Error('test error');
    handler.handleError(err);
    expect(errorSpy).toHaveBeenCalledWith('[GlobalErrorHandler]', err);
  });

  it('shows an error toast for generic errors', () => {
    const showSpy = vi.spyOn(toastService, 'error');
    handler.handleError(new Error('something went wrong'));
    expect(showSpy).toHaveBeenCalledWith('An unexpected error occurred. Please try again.');
  });

  it('does NOT show a toast for ChunkLoadError', () => {
    const showSpy = vi.spyOn(toastService, 'error');
    handler.handleError(new Error('ChunkLoadError: failed to load chunk'));
    expect(showSpy).not.toHaveBeenCalled();
  });

  it('does NOT show a toast for Loading chunk errors', () => {
    const showSpy = vi.spyOn(toastService, 'error');
    handler.handleError(new Error('Loading chunk 5 failed'));
    expect(showSpy).not.toHaveBeenCalled();
  });

  it('handles string errors', () => {
    const showSpy = vi.spyOn(toastService, 'error');
    handler.handleError('plain string error');
    expect(showSpy).toHaveBeenCalled();
  });

  it('handles unknown (non-Error, non-string) values', () => {
    const showSpy = vi.spyOn(toastService, 'error');
    handler.handleError({ code: 500 });
    expect(showSpy).toHaveBeenCalled();
  });

  describe('reporting to App Insights', () => {
    function withTelemetry(trackException: (e: unknown) => void) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [GlobalErrorHandler, ToastService, { provide: AppInsightsService, useValue: { trackException } }],
      });
      return { handler: TestBed.inject(GlobalErrorHandler), toast: TestBed.inject(ToastService) };
    }

    it('reports every error, the chunk-load ones the user is spared included', () => {
      const trackException = vi.fn();
      const { handler } = withTelemetry(trackException);
      const generic = new Error('something went wrong');
      const chunk = new Error('ChunkLoadError: failed to load chunk');

      handler.handleError(generic);
      handler.handleError(chunk);

      expect(trackException.mock.calls.map(c => c[0])).toEqual([generic, chunk]);
    });

    it('still shows the toast when reporting itself throws', () => {
      const { handler, toast } = withTelemetry(() => { throw new Error('telemetry down'); });
      const showSpy = vi.spyOn(toast, 'error');

      handler.handleError(new Error('something went wrong'));

      expect(showSpy).toHaveBeenCalledWith('An unexpected error occurred. Please try again.');
    });
  });
});
