import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    service = new ToastService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with an empty toast list', () => {
    expect(service.toasts()).toEqual([]);
  });

  it('show() adds a toast with correct type and message', () => {
    service.show('Hello', 'success');
    const toasts = service.toasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Hello');
    expect(toasts[0].type).toBe('success');
  });

  it('success() adds a success toast', () => {
    service.success('Saved!');
    expect(service.toasts()[0].type).toBe('success');
    expect(service.toasts()[0].message).toBe('Saved!');
  });

  it('error() adds an error toast', () => {
    service.error('Something went wrong');
    expect(service.toasts()[0].type).toBe('error');
  });

  it('info() adds an info toast', () => {
    service.info('FYI');
    expect(service.toasts()[0].type).toBe('info');
  });

  it('warning() adds a warning toast', () => {
    service.warning('Heads up');
    expect(service.toasts()[0].type).toBe('warning');
  });

  it('dismiss() removes the toast with matching id', () => {
    service.show('First', 'info');
    service.show('Second', 'info');
    const id = service.toasts()[0].id;
    service.dismiss(id);
    expect(service.toasts()).toHaveLength(1);
    expect(service.toasts()[0].message).toBe('Second');
  });

  it('auto-dismisses toast after the specified duration', () => {
    service.show('Temp', 'info', 2000);
    expect(service.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(service.toasts()).toHaveLength(0);
  });

  it('each toast gets a unique id', () => {
    service.show('A', 'info');
    service.show('B', 'info');
    const ids = service.toasts().map(t => t.id);
    expect(new Set(ids).size).toBe(2);
  });
});
