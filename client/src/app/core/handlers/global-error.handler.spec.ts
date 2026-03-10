import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GlobalErrorHandler } from './global-error.handler';
import { ToastService } from '@core/services/toast.service';

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
});
