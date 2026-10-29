import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CdkDrag, CdkDragEnd, CdkDragHandle } from '@angular/cdk/drag-drop';

import { IncomingCallService } from '@core/services/incoming-call.service';
import { IncomingCallMatch, IncomingCallSummary } from '@models';
import { formatCallerId } from '@shared/utils/phone';

/**
 * The incoming-call popup, mounted once in the app shell (deferred until a call first appears).
 *
 * Ringing: who is calling (producer name + customer code, a chooser when several producers share
 * the number, or "unknown caller"), with Answer / Decline. Answering also opens the producer's page.
 * On a call: timer, Hold / Resume, Hang up, Open producer. Picked up in Teams instead: it goes away.
 *
 * Several calls at once: the main card is one call; the others are rows under it — "Also calling"
 * (Hold & answer / Decline) or "On hold" (Resume / Hang up). Answering or resuming a row puts the
 * live call on hold first, and that row's call takes the main card.
 *
 * Collapse (chevron, top right) shrinks the popup to one bar — the main call, its timer and how many
 * others there are. It is offered only while nothing rings, and any call that starts ringing opens
 * the popup again, so a call can never be missed behind the collapsed bar.
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
      <div class="fixed top-20 right-4 z-50 w-full max-w-sm flex flex-col gap-2" data-testid="incoming-call-popup" role="dialog" aria-live="assertive" aria-label="Incoming call"
           cdkDrag cdkDragBoundary="body" [cdkDragFreeDragPosition]="position()" (cdkDragEnded)="onDragEnded($event)">
        @if (collapsed()) {
          <!-- Collapsed: one bar with the main call, its timer and how many other calls there are. Any
               call that starts ringing expands it again, so nothing can be missed while it is small. -->
          <div class="rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-2 pr-1 py-1.5 flex items-center gap-2 slide-in" data-testid="incoming-call-collapsed">
            <span cdkDragHandle (dblclick)="resetPosition()" title="Drag to move · double-click to reset" class="cursor-move flex-shrink-0 h-7 w-7 rounded-full bg-scoular-green/10 text-scoular-green-accessible dark:text-scoular-green flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </span>
            <button type="button" (click)="collapsed.set(false)" class="flex-1 min-w-0 flex items-center gap-2 text-left" aria-label="Show call details" title="Show call details" data-testid="incoming-call-expand">
              <span class="min-w-0 flex-1 truncate text-sm">
                <span class="mr-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ statusLabel() }}</span>
                <span class="font-semibold text-gray-900 dark:text-gray-100" data-testid="incoming-call-collapsed-name">{{ mainName() }}</span>
              </span>
              @if (call.state() === 'connected' || call.state() === 'held') {
                <span class="flex-shrink-0 text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400">{{ elapsed() }}</span>
              }
              @if (othersBadge(); as badge) {
                <span class="flex-shrink-0 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-300" data-testid="incoming-call-collapsed-badge">{{ badge }}</span>
              }
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 text-gray-400" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
            </button>
          </div>
        } @else {
        <div class="relative rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 pb-4 pt-1 slide-in">
          @if (canCollapse()) {
            <button type="button" (click)="collapsed.set(true)" class="absolute top-1 right-1.5 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700" aria-label="Collapse" title="Collapse" data-testid="incoming-call-collapse">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          }
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
                @if (call.matches().length > 1) {
                  <!-- Several producers share this number: let the user go back if they picked the wrong one. -->
                  <button type="button" (click)="call.clearChoice()" class="mt-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" data-testid="incoming-call-back-to-list">
                    ‹ Back to all {{ call.matches().length }} producers
                  </button>
                }
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
        <!-- Every other call is its own card under the main one, laid out the same way: an incoming
             (waiting) call in green with a ringing icon, a call on hold in grey with its own timer.
             Only one call is ever live. -->
        @for (o of call.otherCalls(); track o.seq) {
          <div class="rounded-lg shadow-lg border bg-white dark:bg-gray-800 px-4 py-3 slide-in"
               [class]="o.state === 'ringing' ? 'border-scoular-green/60' : 'border-gray-200 dark:border-gray-700'"
               [attr.data-testid]="'incoming-call-other-' + o.seq">
            <div class="flex items-start gap-3">
              <span cdkDragHandle (dblclick)="resetPosition()" class="cursor-move flex-shrink-0 mt-0.5 h-9 w-9 rounded-full flex items-center justify-center"
                    [class]="o.state === 'ringing' ? 'bg-scoular-green/10 text-scoular-green-accessible dark:text-scoular-green ring-anim' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'">
                @if (o.state === 'ringing') {
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                } @else {
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                }
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline justify-between gap-2">
                  <p class="text-xs font-medium uppercase tracking-wide"
                     [class]="o.state === 'ringing' ? 'text-scoular-green-accessible dark:text-scoular-green' : 'text-gray-500 dark:text-gray-400'">
                    {{ o.state === 'ringing' ? 'Incoming call' : 'On hold' }}
                  </p>
                  @if (o.state === 'held' && o.connectedSince !== null) {
                    <span class="text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400">{{ elapsedSince(o.connectedSince) }}</span>
                  }
                </div>
                <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ otherHeading(o) }}</p>
                @if (o.match; as m) {
                  <div class="mt-2 rounded-md border px-3 py-2"
                       [class]="o.state === 'ringing' ? 'border-scoular-green/30 bg-scoular-green/5' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40'">
                    <span class="block text-sm font-medium"
                          [class]="o.state === 'ringing' ? 'text-scoular-green-accessible dark:text-scoular-green' : 'text-gray-800 dark:text-gray-200'">{{ m.contactName || m.name }}</span>
                    @if (m.contactName) {
                      <span class="block text-sm text-gray-700 dark:text-gray-300">{{ m.name }}</span>
                    }
                    <span class="block text-xs text-gray-500 dark:text-gray-400">{{ detailLine(m) }}</span>
                  </div>
                } @else if (otherDetail(o); as detail) {
                  <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ detail }}</p>
                }
                <div class="mt-3 flex gap-2">
                  @if (o.state === 'ringing') {
                    <button type="button" (click)="answerOther(o.seq)" class="flex-1 rounded-md bg-scoular-green-accessible hover:opacity-90 text-white text-sm font-medium px-3 py-1.5">
                      {{ hasLiveCall() ? 'Hold & answer' : 'Answer' }}
                    </button>
                    <button type="button" (click)="call.declineCall(o.seq)" class="flex-1 rounded-md bg-scoular-red-accessible hover:opacity-90 text-white text-sm font-medium px-3 py-1.5">Decline</button>
                  } @else {
                    <button type="button" (click)="call.resumeCall(o.seq)" class="flex-1 rounded-md bg-scoular-green-accessible hover:opacity-90 text-white text-sm font-medium px-3 py-1.5">Resume</button>
                    <button type="button" (click)="call.hangUpCall(o.seq)" class="flex-1 rounded-md bg-scoular-red-accessible hover:opacity-90 text-white text-sm font-medium px-3 py-1.5">Hang up</button>
                  }
                </div>
              </div>
            </div>
          </div>
        }
        }
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

  readonly elapsed = computed(() => this.elapsedSince(this.call.connectedSince()));

  /** m:ss since a call connected (re-read every tick while a call is live). */
  elapsedSince(since: number | null): string {
    if (since === null) return '0:00';
    const total = Math.max(0, Math.floor((this.now() - since) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

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
    // Never let a ringing call hide in the collapsed bar.
    effect(() => {
      if (this.anyRinging()) this.collapsed.set(false);
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

  /** Shrunk to one bar by the user. Any call that starts ringing expands it again (see constructor). */
  readonly collapsed = signal(false);

  /** Something is ringing — the main call or a waiting one — so the popup must be fully open. */
  private readonly anyRinging = computed(() =>
    this.call.state() === 'ringing' || this.call.otherCalls().some(o => o.state === 'ringing'));

  /** Collapsing is offered once nothing is ringing (a ringing call must stay in full view). */
  readonly canCollapse = computed(() => !this.anyRinging());

  /** The main call in the collapsed bar: contact or producer name, else the number. */
  readonly mainName = computed(() => {
    const m = this.call.selectedMatch();
    if (m) return m.contactName || m.name;
    const n = this.call.matches().length;
    return n > 1 ? `${this.formattedNumber()} · ${n} producers` : this.formattedNumber();
  });

  /** "1 on hold", "1 waiting", "1 waiting · 2 on hold" for the collapsed bar. */
  readonly othersBadge = computed(() => {
    const others = this.call.otherCalls();
    const waiting = others.filter(o => o.state === 'ringing').length;
    const held = others.filter(o => o.state === 'held').length;
    return [waiting ? `${waiting} waiting` : '', held ? `${held} on hold` : ''].filter(Boolean).join(' · ') || null;
  });

  /** True while the main card's call is live, so answering a waiting call means holding this one. */
  readonly hasLiveCall = computed(() => this.call.state() === 'connected');

  /** The other call's heading line, like the main card's: the number, else the SDK's display name. */
  otherHeading(o: IncomingCallSummary): string {
    if (o.callerNumber) return formatCallerId(o.callerNumber);
    return o.displayName ?? 'Unknown caller';
  }

  /** Under the heading when no producer is known yet: why. */
  otherDetail(o: IncomingCallSummary): string | null {
    if (o.matchesLoading) return 'Looking up producer…';
    if (o.matchCount > 1) return `${o.matchCount} producers share this number`;
    if (!o.callerNumber && o.displayName) return null;
    return 'Unknown caller — no producer has this number on file.';
  }

  /** Hold & answer a waiting call, then open its producer's page (like Answer on the main card). */
  async answerOther(seq: number): Promise<void> {
    await this.call.answerCall(seq);
    const m = this.call.selectedMatch();
    const s = this.call.state();
    if (m && (s === 'connected' || s === 'connecting')) this.navigateTo(m);
  }

  /** Answers, and opens the producer's page when we know who it is. */
  async answer(): Promise<void> {
    const m = this.call.selectedMatch();
    await this.call.answer();
    if (m && this.call.state() !== 'ringing') this.navigateTo(m);
  }

  /** Opens the producer's page and remembers the choice (the card then shows that producer, with a
   *  way back to the list when several share the number). Does not touch the call itself. */
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
