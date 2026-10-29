import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CdkDrag, CdkDragEnd, CdkDragHandle } from '@angular/cdk/drag-drop';

import { IncomingCallService } from '@core/services/incoming-call.service';
import { IncomingCallMatch } from '@models';
import { formatCallerId } from '@shared/utils/phone';

/**
 * The incoming-call popup, mounted once in the app shell (deferred until a call first appears).
 *
 * Ringing: who is calling (producer name + customer code, a chooser when several producers share
 * the number, or "unknown caller"), with Answer / Decline. Answering also opens the producer's page.
 * On a call: timer, Hold / Resume, Hang up, Open producer. Picked up in Teams instead: a one-line
 * banner that keeps the producer link.
 *
 * Starts top-right, so it never collides with the bottom-right toasts. The user can drag it by its
 * grab bar (CDK drag, same pattern as the calculator widget) for the rest of that call. Every NEW call
 * starts back in the top-right corner; double-clicking the grab bar also puts it back.
 */
@Component({
  selector: 'app-incoming-call-popup',
  standalone: true,
  imports: [CdkDrag, CdkDragHandle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (call.isVisible()) {
      <div class="fixed top-20 right-4 z-50 w-full max-w-sm" data-testid="incoming-call-popup" role="dialog" aria-live="assertive" aria-label="Incoming call"
           cdkDrag cdkDragBoundary="body" [cdkDragFreeDragPosition]="position()" (cdkDragEnded)="onDragEnded($event)">
        <div class="rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 pb-4 pt-1 slide-in">
          <div cdkDragHandle (dblclick)="resetPosition()" title="Drag to move · double-click to reset" class="-mx-4 mb-1 flex justify-center py-1 cursor-move select-none text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400" data-testid="incoming-call-drag-handle">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="8" viewBox="0 0 20 8" fill="currentColor" aria-hidden="true"><circle cx="4" cy="2" r="1.3"/><circle cx="10" cy="2" r="1.3"/><circle cx="16" cy="2" r="1.3"/><circle cx="4" cy="6" r="1.3"/><circle cx="10" cy="6" r="1.3"/><circle cx="16" cy="6" r="1.3"/></svg>
          </div>
          <div class="flex items-start gap-3">
            <span cdkDragHandle (dblclick)="resetPosition()" class="cursor-move flex-shrink-0 mt-0.5 h-9 w-9 rounded-full bg-scoular-green/10 text-scoular-green-accessible dark:text-scoular-green flex items-center justify-center" [class.ring-anim]="call.state() === 'ringing'">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </span>
            <div class="flex-1 min-w-0">
              <div cdkDragHandle (dblclick)="resetPosition()" class="flex items-baseline justify-between gap-2 cursor-move select-none">
                <p class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400" data-testid="incoming-call-status">{{ statusLabel() }}</p>
                @if (call.state() === 'connected' || call.state() === 'held') {
                  <span class="text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400" data-testid="incoming-call-timer">{{ elapsed() }}</span>
                }
              </div>
              <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ formattedNumber() }}</p>

              @if (call.matchesLoading()) {
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Looking up producer…</p>
              } @else if (call.matches().length === 0) {
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400" data-testid="incoming-call-unknown">Unknown caller — no producer has this number on file.</p>
              } @else if (call.selectedMatch(); as m) {
                <button type="button" (click)="open(m)" class="mt-2 w-full text-left rounded-md border border-scoular-green/30 bg-scoular-green/5 hover:bg-scoular-green/15 transition-colors px-3 py-2" [attr.data-testid]="'incoming-call-match-' + m.customerId">
                  <span class="block text-sm font-medium text-scoular-green-accessible dark:text-scoular-green" data-testid="incoming-call-caller-name">{{ m.contactName || m.name }}</span>
                  @if (m.contactName) {
                    <span class="block text-sm text-gray-700 dark:text-gray-300">{{ m.name }}</span>
                  }
                  <span class="block text-xs text-gray-500 dark:text-gray-400">{{ detailLine(m) }}</span>
                </button>
              } @else {
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Several producers share this number — choose one:</p>
                <div class="mt-1.5 flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                  @for (m of call.matches(); track m.customerId) {
                    <button type="button" (click)="open(m)" class="w-full text-left rounded-md border border-gray-200 dark:border-gray-700 hover:border-scoular-green/40 hover:bg-scoular-green/10 transition-colors px-3 py-1.5" [attr.data-testid]="'incoming-call-match-' + m.customerId">
                      <span class="block text-sm font-medium text-gray-800 dark:text-gray-200">{{ m.contactName || m.name }}</span>
                      @if (m.contactName) {
                        <span class="block text-xs text-gray-700 dark:text-gray-300">{{ m.name }}</span>
                      }
                      <span class="block text-xs text-gray-500 dark:text-gray-400">{{ detailLine(m) }}</span>
                    </button>
                  }
                </div>
              }

              <div class="mt-3 flex flex-wrap gap-2">
                @switch (call.state()) {
                  @case ('ringing') {
                    <button type="button" (click)="answer()" class="flex-1 rounded-md bg-scoular-green-accessible hover:opacity-90 text-white text-sm font-medium px-3 py-1.5">Answer</button>
                    <button type="button" (click)="call.decline()" class="flex-1 rounded-md bg-scoular-red-accessible hover:opacity-90 text-white text-sm font-medium px-3 py-1.5">Decline</button>
                  }
                  @case ('connected') {
                    <button type="button" (click)="call.hold()" class="flex-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-medium px-3 py-1.5">Hold</button>
                    <button type="button" (click)="call.hangUp()" class="flex-1 rounded-md bg-scoular-red-accessible hover:opacity-90 text-white text-sm font-medium px-3 py-1.5">Hang up</button>
                  }
                  @case ('held') {
                    <button type="button" (click)="call.resume()" class="flex-1 rounded-md bg-scoular-green-accessible hover:opacity-90 text-white text-sm font-medium px-3 py-1.5">Resume</button>
                    <button type="button" (click)="call.hangUp()" class="flex-1 rounded-md bg-scoular-red-accessible hover:opacity-90 text-white text-sm font-medium px-3 py-1.5">Hang up</button>
                  }
                  @case ('ended') {
                    <!-- The caller hung up. Closes by itself after a moment; nothing to click. -->
                    <p class="text-xs text-gray-500 dark:text-gray-400" data-testid="incoming-call-ended">The caller hung up.</p>
                  }
                }
              </div>

              @if (call.isSimulated() && call.state() === 'ringing') {
                <button type="button" (click)="call.simulateAnsweredElsewhere()" class="mt-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline">Simulate: answered in Teams</button>
              }
              @if (call.isSimulated() && (call.state() === 'connected' || call.state() === 'held')) {
                <button type="button" (click)="call.simulateCallerHungUp()" class="mt-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline">Simulate: caller hangs up</button>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: none; opacity: 1; } }
    .slide-in { animation: slideIn 0.3s ease-out; }
    @keyframes ring { 0%, 50%, 100% { transform: none; } 10% { transform: rotate(12deg); } 20% { transform: rotate(-10deg); } 30% { transform: rotate(8deg); } 40% { transform: rotate(-6deg); } }
    .ring-anim { animation: ring 1.6s ease-in-out infinite; }
  `],
})
export class IncomingCallPopupComponent {
  readonly call = inject(IncomingCallService);
  private readonly router = inject(Router);

  /** Where the user dragged the popup to, as an offset from its top-right home. */
  readonly position = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  /** Ticks once a second while a call is connected, driving the timer. */
  private readonly now = signal(Date.now());

  /** The caller line: the formatted number, or the SDK's display name when the caller is not a phone
   *  number (a call queue / resource account), or "Unknown caller". */
  readonly formattedNumber = computed(() => {
    const number = this.call.callerNumber();
    if (number) return formatCallerId(number);
    return this.call.callerDisplayName() ?? 'Unknown caller';
  });

  readonly callerLabel = computed(() => {
    const m = this.call.selectedMatch();
    if (m) {
      const producer = m.scoularId ? `${m.name} (${m.scoularId})` : m.name;
      // A contact added on the producer details card: say who it is, then whose contact they are.
      return m.contactName ? `${m.contactName}, ${producer}` : producer;
    }
    return this.formattedNumber();
  });

  readonly statusLabel = computed(() => {
    switch (this.call.state()) {
      case 'ringing': return this.call.isSimulated() ? 'Incoming call (simulated)' : 'Incoming call';
      case 'connecting': return 'Connecting…';
      case 'connected': return 'On call';
      case 'held': return 'On hold';
      case 'ended': return 'Call ended';
      default: return '';
    }
  });

  readonly elapsed = computed(() => {
    const since = this.call.connectedSince();
    if (since === null) return '0:00';
    const total = Math.max(0, Math.floor((this.now() - since) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  });

  constructor() {
    let handle: ReturnType<typeof setInterval> | null = null;
    effect(() => {
      const live = this.call.state() === 'connected' || this.call.state() === 'held';
      if (live && handle === null) {
        this.now.set(Date.now());
        handle = setInterval(() => this.now.set(Date.now()), 1000);
      } else if (!live && handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    });
    // Each new call starts in the top-right corner, wherever the last one was dragged to.
    let lastState: string | null = null;
    effect(() => {
      const s = this.call.state();
      if (s === 'ringing' && lastState !== 'ringing') this.position.set({ x: 0, y: 0 });
      lastState = s;
    });

    inject(DestroyRef).onDestroy(() => {
      if (handle !== null) clearInterval(handle);
    });
  }

  /** Answers, and opens the producer's page when we know who it is. */
  async answer(): Promise<void> {
    const m = this.call.selectedMatch();
    await this.call.answer();
    if (m && this.call.state() !== 'ringing') this.navigateTo(m);
  }

  /** Opens the producer's page and remembers the choice (it labels the banner if the call is
   *  then picked up in Teams). Does not touch the call itself. */
  open(m: IncomingCallMatch): void {
    this.call.choose(m.customerId);
    this.navigateTo(m);
  }

  /** Keeps the popup where the user dropped it for the rest of this call. */
  onDragEnded(event: CdkDragEnd): void {
    this.position.set(event.source.getFreeDragPosition());
  }

  /** Puts the popup back in its top-right corner. */
  resetPosition(): void {
    this.position.set({ x: 0, y: 0 });
  }

  detailLine(m: IncomingCallMatch): string {
    const place = [m.location, m.stateProvince].filter(Boolean).join(', ');
    // Customer code and location only. The trade unit is deliberately left off the call card.
    return [m.scoularId, place].filter(Boolean).join(' · ');
  }

  private navigateTo(m: IncomingCallMatch): void {
    this.router.navigate(['/'], { queryParams: { customerId: m.customerId } });
  }
}
