import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';

import { IncomingCallPopupComponent } from './incoming-call-popup.component';
import { IncomingCallService } from '@core/services/incoming-call.service';
import { provideTestEnvironment } from '@testing/test-providers';
import type { IncomingCallMatch, IncomingCallState } from '@models';

const SMITH: IncomingCallMatch = {
  customerId: 158259, name: 'Smith Farms', scoularId: 'SMIFAR', location: 'Minden', stateProvince: 'NE',
  tradeUnit: '3811', tradeUnits: ['3811'],
};
const JONES: IncomingCallMatch = { customerId: 7, name: 'Jones Ag', scoularId: 'JONAG', tradeUnits: [] };

/** A hand-driven stand-in for the service: the popup only reads signals and calls methods. */
function makeCallStub() {
  const state = signal<IncomingCallState>('ringing');
  const matches = signal<IncomingCallMatch[]>([SMITH]);
  const chosen = signal<number | null>(null);
  return {
    state,
    matches,
    callerNumber: signal<string | null>('+14025554914'),
    callerDisplayName: signal<string | null>(null),
    matchesLoading: signal(false),
    connectedSince: signal<number | null>(null),
    isSimulated: signal(false),
    isVisible: computed(() => state() !== 'idle' && state() !== 'unavailable'),
    selectedMatch: computed(() =>
      matches().length === 1 ? matches()[0] : matches().find(m => m.customerId === chosen()) ?? null),
    choose: vi.fn((id: number) => chosen.set(id)),
    answer: vi.fn(async () => state.set('connected')),
    decline: vi.fn(async () => state.set('idle')),
    hold: vi.fn(), resume: vi.fn(), hangUp: vi.fn(), simulateAnsweredElsewhere: vi.fn(),
  };
}

describe('IncomingCallPopupComponent', () => {
  let call: ReturnType<typeof makeCallStub>;

  async function setup() {
    const view = await render(IncomingCallPopupComponent, {
      providers: provideTestEnvironment({ extraProviders: [{ provide: IncomingCallService, useValue: call }] }),
    });
    const router = view.fixture.debugElement.injector.get(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    return { ...view, navigate };
  }

  beforeEach(() => {
    call = makeCallStub();
  });

  it('shows the caller as a producer name and customer code with a formatted number', async () => {
    await setup();

    expect(screen.getByText('Incoming call')).toBeTruthy();
    expect(screen.getByText('(402) 555-4914')).toBeTruthy();
    expect(screen.getByText('Smith Farms')).toBeTruthy();
    expect(screen.getByText(/SMIFAR/)).toBeTruthy();
  });

  it('names the person when the number belongs to a contact added on producer details', async () => {
    call.matches.set([{ ...SMITH, contactName: 'Jane Smith', contactNames: ['Jane Smith'] }]);
    await setup();

    expect(screen.getByTestId('incoming-call-caller-name').textContent).toContain('Jane Smith');
    expect(screen.getByText('Smith Farms')).toBeTruthy(); // and whose contact she is
  });

  it('shows the customer code and location under the name, but not the trade unit', async () => {
    await setup();

    const card = screen.getByTestId('incoming-call-match-158259');
    expect(card.textContent).toContain('SMIFAR · Minden, NE');
    expect(card.textContent).not.toContain('3811');
  });

  it('Answer answers the call and opens the producer page', async () => {
    const { navigate } = await setup();

    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));

    expect(call.answer).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/'], { queryParams: { customerId: 158259 } });
  });

  it('Decline declines without navigating', async () => {
    const { navigate } = await setup();

    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(call.decline).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('clicking the producer card opens their page without touching the call', async () => {
    const { navigate } = await setup();

    await userEvent.click(screen.getByTestId('incoming-call-match-158259'));

    expect(navigate).toHaveBeenCalledWith(['/'], { queryParams: { customerId: 158259 } });
    expect(call.answer).not.toHaveBeenCalled();
  });

  it('offers a chooser when several producers share the number', async () => {
    call.matches.set([SMITH, JONES]);
    const { navigate } = await setup();

    expect(screen.getByText(/Several producers share this number/)).toBeTruthy();
    await userEvent.click(screen.getByTestId('incoming-call-match-7'));

    expect(call.choose).toHaveBeenCalledWith(7);
    expect(navigate).toHaveBeenCalledWith(['/'], { queryParams: { customerId: 7 } });
  });

  it('says "unknown caller" when nobody has the number on file', async () => {
    call.matches.set([]);
    await setup();

    expect(screen.getByTestId('incoming-call-unknown')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Answer' })).toBeTruthy(); // still answerable
  });

  it('on a call: offers Hold and Hang up, and Resume while held', async () => {
    call.state.set('connected');
    call.connectedSince.set(Date.now());
    const { fixture } = await setup();

    expect(screen.getByTestId('incoming-call-timer')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Hold' }));
    expect(call.hold).toHaveBeenCalled();

    call.state.set('held');
    fixture.detectChanges();
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(call.resume).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Hang up' }));
    expect(call.hangUp).toHaveBeenCalled();
  });

  it('after the caller hangs up there is no Close button to click (it closes itself)', async () => {
    call.state.set('ended');
    await setup();

    expect(screen.getByTestId('incoming-call-ended')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('shows the display name when the caller is not a phone number (e.g. a call queue)', async () => {
    call.callerNumber.set(null);
    call.callerDisplayName.set('Omaha Main');
    call.matches.set([]);
    await setup();

    expect(screen.getByText('Omaha Main')).toBeTruthy();
  });

  it('renders nothing when idle', async () => {
    call.state.set('idle');
    await setup();

    expect(screen.queryByTestId('incoming-call-popup')).toBeNull();
  });

  // ── Dragging ──────────────────────────────────────────────────────────────

  it('has a grab bar to drag it by', async () => {
    await setup();

    expect(screen.getAllByTestId('incoming-call-drag-handle').length).toBeGreaterThan(0);
  });

  /** Stands in for a CDK drag ending at the given offset from the top-right corner. */
  const dropAt = (x: number, y: number) =>
    ({ source: { getFreeDragPosition: () => ({ x, y }) } }) as any;

  it('starts in the top-right corner', async () => {
    const { fixture } = await setup();

    expect(fixture.componentInstance.position()).toEqual({ x: 0, y: 0 });
  });

  it('stays where it was dropped for the rest of the call', async () => {
    const { fixture } = await setup();
    const popup = fixture.componentInstance;

    popup.onDragEnded(dropAt(-300, 120));
    call.state.set('connected');
    fixture.detectChanges();

    expect(popup.position()).toEqual({ x: -300, y: 120 });
  });

  it('the next call starts back in the top-right corner', async () => {
    const { fixture } = await setup();
    const popup = fixture.componentInstance;
    popup.onDragEnded(dropAt(-300, 120));

    call.state.set('idle');
    fixture.detectChanges();
    call.state.set('ringing');
    fixture.detectChanges();

    expect(popup.position()).toEqual({ x: 0, y: 0 });
  });

  it('double-clicking the grab bar puts it back in the corner', async () => {
    const { fixture } = await setup();
    fixture.componentInstance.onDragEnded(dropAt(-250, 40));

    await userEvent.dblClick(screen.getAllByTestId('incoming-call-drag-handle')[0]);

    expect(fixture.componentInstance.position()).toEqual({ x: 0, y: 0 });
  });
});
