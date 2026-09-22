import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { ToastContainerComponent } from './toast-container.component';
import { ToastService, Toast } from '@core/services/toast.service';

// Drives the real root ToastService rather than a stub: the container's whole job is to
// mirror that service's signal, so the test proves the two agree (automated-testing.md §7.2).
describe('ToastContainerComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup() {
    const view = await render(ToastContainerComponent);
    const toasts = TestBed.inject(ToastService);
    return { ...view, toasts };
  }

  it('should render nothing when there are no toasts', async () => {
    await setup();

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('should render each toast message from the service with its own dismiss button', async () => {
    const { fixture, toasts } = await setup();

    toasts.success('Bid saved');
    toasts.error('Save failed');
    fixture.detectChanges();

    expect(screen.getByText('Bid saved')).toBeInTheDocument();
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('should dismiss only the toast whose button was clicked', async () => {
    const { fixture, toasts } = await setup();
    toasts.success('Bid saved');
    toasts.error('Save failed');
    fixture.detectChanges();

    // Buttons render in toast order; the first belongs to "Bid saved".
    await userEvent.click(screen.getAllByRole('button')[0]);
    fixture.detectChanges();

    expect(screen.queryByText('Bid saved')).toBeNull();
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    expect(toasts.toasts().map(t => t.message)).toEqual(['Save failed']);
  });

  it('should drop a toast once its duration elapses', async () => {
    const { fixture, toasts } = await setup();
    vi.useFakeTimers();

    toasts.show('Temporary', 'info', 1000);
    fixture.detectChanges();
    expect(screen.getByText('Temporary')).toBeInTheDocument();

    vi.advanceTimersByTime(999);
    fixture.detectChanges();
    expect(screen.getByText('Temporary')).toBeInTheDocument();

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(screen.queryByText('Temporary')).toBeNull();
  });

  it('should keep showing later toasts after an earlier one expires', async () => {
    const { fixture, toasts } = await setup();
    vi.useFakeTimers();

    toasts.show('Short-lived', 'info', 1000);
    toasts.show('Long-lived', 'warning', 5000);
    fixture.detectChanges();

    vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    expect(screen.queryByText('Short-lived')).toBeNull();
    expect(screen.getByText('Long-lived')).toBeInTheDocument();
  });

  it('should still dismiss by button while fake timers are pending', async () => {
    const { fixture, toasts } = await setup();
    vi.useFakeTimers();
    toasts.info('Heads up');
    fixture.detectChanges();

    fireEvent.click(screen.getByRole('button'));
    fixture.detectChanges();

    expect(screen.queryByText('Heads up')).toBeNull();
    // The later auto-dismiss must not throw or resurrect anything.
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(toasts.toasts()).toEqual([]);
  });

  it('should give each toast type its own visual treatment', async () => {
    const { fixture } = await setup();
    const types: Toast['type'][] = ['success', 'error', 'warning', 'info'];

    const treatments = new Set(types.map(t => fixture.componentInstance.getToastClasses(t)));

    expect(treatments.size).toBe(types.length);
  });
});
