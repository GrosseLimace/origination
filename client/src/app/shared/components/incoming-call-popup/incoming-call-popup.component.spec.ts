import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';

import { IncomingCallPopupComponent } from './incoming-call-popup.component';
import { IncomingCallService } from '@core/services/incoming-call.service';
import { provideTestEnvironment } from '@testing/test-providers';
import type { IncomingCallMatch, IncomingCallState, IncomingCallSummary } from '@models';

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
    clearChoice: vi.fn(() => chosen.set(null)),
    otherCalls: signal<IncomingCallSummary[]>([]),
    answerCall: vi.fn(async () => undefined),
    declineCall: vi.fn(async () => undefined),
    resumeCall: vi.fn(async () => undefined),
    hangUpCall: vi.fn(async () => undefined),
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

  it('lets the user go back to the list after picking the wrong producer, and pick another', async () => {
    call.matches.set([SMITH, JONES]);
    const { navigate } = await setup();

    await userEvent.click(screen.getByTestId('incoming-call-match-7'));        // Jones Ag (wrong one)
    expect(screen.queryByText(/Several producers share this number/)).toBeNull();
    const back = screen.getByTestId('incoming-call-back-to-list');
    expect(back.textContent).toContain('Back to all 2 producers');

    await userEvent.click(back);
    expect(call.clearChoice).toHaveBeenCalled();
    expect(screen.getByText(/Several producers share this number/)).toBeTruthy();

    await userEvent.click(screen.getByTestId('incoming-call-match-158259'));   // Smith Farms
    expect(navigate).toHaveBeenLastCalledWith(['/'], { queryParams: { customerId: 158259 } });
  });

  // ── Several calls at once ────────────────────────────────────────────────
  const waiting = (over: Partial<IncomingCallSummary> = {}): IncomingCallSummary => ({
    seq: 2, state: 'ringing', callerNumber: '+15155550000', displayName: null,
    match: JONES, matchCount: 1, matchesLoading: false, connectedSince: null, ...over,
  });

  it('shows a second call as its own "Incoming call" card with Hold & answer while on a live call', async () => {
    call.state.set('connected');
    call.otherCalls.set([waiting()]);
    const { navigate } = await setup();

    const row = screen.getByTestId('incoming-call-other-2');
    expect(row.textContent).toContain('Incoming call');
    expect(row.textContent).toContain('Jones Ag');
    expect(screen.getByTestId('incoming-call-popup').querySelectorAll('[data-testid^="incoming-call-other-"]').length).toBe(1);
    expect(row.textContent).toContain('JONAG');
    expect(row.textContent).toContain('(515) 555-0000');

    // Answering the waiting call: the service holds the live one; its producer page opens.
    call.answerCall.mockImplementation(async () => {
      call.matches.set([JONES]);
      call.state.set('connected');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Hold & answer' }));
    expect(call.answerCall).toHaveBeenCalledWith(2);
    expect(navigate).toHaveBeenCalledWith(['/'], { queryParams: { customerId: 7 } });
  });

  it('a held call keeps its own timer on its card', async () => {
    call.state.set('connected');
    call.connectedSince.set(Date.now());
    call.otherCalls.set([waiting({ state: 'held', match: SMITH, connectedSince: Date.now() - 125_000 })]);
    await setup();

    expect(screen.getByTestId('incoming-call-other-2').textContent).toMatch(/2:0[0-9]/);
  });

  it('a waiting call can be declined from its card', async () => {
    call.state.set('connected');
    call.otherCalls.set([waiting()]);
    await setup();

    const row = screen.getByTestId('incoming-call-other-2');
    await userEvent.click(row.querySelector('button:last-of-type') as HTMLElement);
    expect(call.declineCall).toHaveBeenCalledWith(2);
    expect(call.hangUp).not.toHaveBeenCalled();
  });

  it('says "Answer" (not Hold & answer) when the main call is not live', async () => {
    call.state.set('held');
    call.otherCalls.set([waiting()]);
    await setup();

    expect(screen.queryByRole('button', { name: 'Hold & answer' })).toBeNull();
    expect(screen.getByTestId('incoming-call-other-2').textContent).toContain('Answer');
  });

  it('shows a held call as "On hold" with Resume and Hang up', async () => {
    call.state.set('connected');
    call.otherCalls.set([waiting({ state: 'held', match: SMITH })]);
    await setup();

    const row = screen.getByTestId('incoming-call-other-2');
    expect(row.textContent).toContain('On hold');
    expect(row.textContent).toContain('Smith Farms');
    expect(row.textContent).toContain('SMIFAR · Minden, NE');
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(call.resumeCall).toHaveBeenCalledWith(2);
    const hangUps = screen.getAllByRole('button', { name: 'Hang up' });
    await userEvent.click(hangUps[hangUps.length - 1]);              // the row's, not the main card's
    expect(call.hangUpCall).toHaveBeenCalledWith(2);
    expect(call.hangUp).not.toHaveBeenCalled();
  });

  it('labels a waiting call by number while it is looked up, or when several producers share it', async () => {
    call.state.set('connected');
    call.otherCalls.set([
      waiting({ seq: 2, match: null, matchCount: 0, matchesLoading: true }),
      waiting({ seq: 3, match: null, matchCount: 3 }),
      waiting({ seq: 4, match: null, matchCount: 0, callerNumber: null, displayName: 'Minden Main' }),
    ]);
    await setup();

    expect(screen.getByTestId('incoming-call-other-2').textContent).toContain('Looking up producer');
    expect(screen.getByTestId('incoming-call-other-3').textContent).toContain('3 producers share this number');
    expect(screen.getByTestId('incoming-call-other-4').textContent).toContain('Minden Main');
  });

  // ── Collapse ─────────────────────────────────────────────────────────────
  it('collapses to one bar with the call, its timer and the other calls, and expands again', async () => {
    call.state.set('connected');
    call.connectedSince.set(Date.now() - 44_000);
    call.otherCalls.set([waiting({ state: 'held', match: SMITH })]);
    await setup();

    await userEvent.click(screen.getByTestId('incoming-call-collapse'));

    expect(screen.queryByTestId('incoming-call-status')).toBeNull();          // full card hidden
    expect(screen.getByTestId('incoming-call-collapsed-name').textContent).toContain('Smith Farms');
    expect(screen.getByTestId('incoming-call-collapsed').textContent).toMatch(/0:4\d/);
    expect(screen.getByTestId('incoming-call-collapsed-badge').textContent).toContain('1 on hold');

    await userEvent.click(screen.getByTestId('incoming-call-expand'));
    expect(screen.queryByTestId('incoming-call-collapsed')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Hang up' }).length).toBeGreaterThan(0);
  });

  it('keeps Hold and Hang up on the collapsed bar, and Resume once on hold', async () => {
    call.state.set('connected');
    const { fixture } = await setup();
    await userEvent.click(screen.getByTestId('incoming-call-collapse'));

    await userEvent.click(screen.getByTestId('incoming-call-collapsed-hold'));
    expect(call.hold).toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('incoming-call-collapsed-hangup'));
    expect(call.hangUp).toHaveBeenCalled();

    call.state.set('held');
    fixture.detectChanges();
    expect(screen.queryByTestId('incoming-call-collapsed-hold')).toBeNull();
    await userEvent.click(screen.getByTestId('incoming-call-collapsed-resume'));
    expect(call.resume).toHaveBeenCalled();
    expect(screen.getByTestId('incoming-call-collapsed')).toBeTruthy();       // still collapsed
  });

  it('cannot be collapsed while a call is ringing', async () => {
    await setup();                                                            // main call ringing
    expect(screen.queryByTestId('incoming-call-collapse')).toBeNull();
  });

  it('opens up again by itself when another call starts ringing', async () => {
    call.state.set('connected');
    const { fixture } = await setup();
    await userEvent.click(screen.getByTestId('incoming-call-collapse'));
    expect(screen.getByTestId('incoming-call-collapsed')).toBeTruthy();

    call.otherCalls.set([waiting()]);                                         // a second call rings
    fixture.detectChanges();
    await fixture.whenStable();

    expect(screen.queryByTestId('incoming-call-collapsed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hold & answer' })).toBeTruthy();
  });

  it('shows no rows when there is only one call', async () => {
    await setup();
    expect(screen.queryByTestId('incoming-call-others')).toBeNull();
  });

  it('has no "back to list" link when only one producer has the number', async () => {
    call.matches.set([SMITH]);
    await setup();

    expect(screen.queryByTestId('incoming-call-back-to-list')).toBeNull();
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
