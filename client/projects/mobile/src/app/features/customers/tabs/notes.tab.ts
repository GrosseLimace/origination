import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, resource, signal } from '@angular/core';

import { MobileApiService, Note, NoteCreate, RecentNotes, newClientRequestId } from '../../../core/api/mobile-api.service';
import { NoticeService } from '../../../core/errors/notice.service';
import { ConnectivityService } from '../../../core/offline/connectivity.service';
import { QueuedOperation } from '../../../core/offline/indexed-db';
import { SyncQueueService } from '../../../core/offline/sync-queue.service';
import { ClampOverflowDirective } from '../../../core/ui/clamp-overflow.directive';
import { SpinnerComponent } from '../../../core/ui/spinner.component';
import { formatNoteTimestamp, noteInitials } from '../../../core/util/note-format';

/**
 * Card #644 — a prominent Add note, the pinned note on top, and at most ten recent notes.
 * Looks like the desktop's customer-notes (user 2026-10-14): each note a card with the author's initials,
 * name and "Today at 3:15 PM"-style time over a divider, the text clamped to four lines with "Show more"
 * when it is actually cut off; pinned notes amber; the desktop's dark-mode colours.
 * Creating a note offline (or when the request cannot reach the server) queues it with its
 * clientRequestId; the queue replays it when signal returns and the server de-duplicates.
 */
@Component({
  selector: 'mob-notes-tab',
  imports: [SpinnerComponent, ClampOverflowDirective, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-2" (submit)="save($event)">
      <textarea
        class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 min-h-24 focus:outline-none focus:ring-2 focus:ring-scoular-green"
        [value]="draft()" (input)="draft.set($any($event.target).value)"
        maxlength="4000" placeholder="Add a note about this producer..." aria-label="Note text"></textarea>
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-gray-500 dark:text-gray-400">{{ draft().trim().length }}/4000@if (!online()) { · will send when back online }</span>
        <button type="submit" class="mob-tap px-4 bg-scoular-green-accessible text-white font-semibold disabled:opacity-50"
                [disabled]="draft().trim().length === 0 || saving()">
          {{ saving() ? 'Saving…' : 'Add note' }}
        </button>
      </div>
    </form>

    <!-- Notes kept on this phone until signal returns (Burdi-style queue); refused ones show in the sync issues box. -->
    @for (q of queuedNotes(); track q.id) {
      <div class="mt-3 rounded-lg border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
        <p class="text-xs font-medium text-amber-800 dark:text-amber-300">Waiting to sync</p>
        <p class="mt-1 whitespace-pre-wrap break-words text-sm text-gray-900 dark:text-gray-100">{{ queuedText(q) }}</p>
      </div>
    }

    @if (notes.isLoading() && !notes.hasValue()) {
      <mob-spinner label="Loading notes…" />
    } @else if (notes.hasValue()) {
      <div class="mt-4 space-y-3">
        @if (notes.value().pinned; as pinned) {
          <ng-container [ngTemplateOutlet]="noteCard" [ngTemplateOutletContext]="{ $implicit: pinned, pinned: true }" />
        }
        @for (n of notes.value().notes; track n.id) {
          <ng-container [ngTemplateOutlet]="noteCard" [ngTemplateOutletContext]="{ $implicit: n, pinned: false }" />
        }
      </div>
      @if (notes.value().hasMore) {
        <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">Showing the {{ notes.value().notes.length }} most recent. Older notes are on the desktop.</p>
      }
      @if (notes.value().notes.length === 0 && !notes.value().pinned) {
        <p class="mt-6 text-center text-sm text-gray-400 dark:text-gray-500">No notes yet.</p>
      }
    } @else if (notes.error()) {
      <p class="mt-3 text-sm text-red-700 dark:text-red-400" role="alert">Couldn't load notes. Your new notes will still be kept and sent later.</p>
    }

    <!-- One note, the desktop's card (customer-notes getNoteClass): amber when pinned, else white / gray-800. -->
    <ng-template #noteCard let-n let-pinned="pinned">
      <article class="rounded-lg border p-3"
               [class]="pinned ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'">
        <div class="flex items-center gap-3 pb-2 border-b border-gray-200 dark:border-gray-700">
          <div class="h-8 w-8 shrink-0 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium text-gray-600 dark:text-gray-300" aria-hidden="true">
            {{ initials(n.createdBy) }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ n.createdBy || 'User' }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ timestamp(n.createdAt) }}</div>
          </div>
          @if (pinned) {
            <span class="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400" title="Pinned">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
              Pinned
            </span>
          }
        </div>
        @if (n.subject) { <div class="pt-2 text-sm font-semibold text-gray-900 dark:text-white">{{ n.subject }}</div> }
        <p class="pt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words"
           [class.line-clamp-4]="!expanded().has(n.id)"
           mobClampOverflow (clampOverflow)="setOverflow(n.id, $event)">{{ n.content }}</p>
        @if (overflowing().has(n.id) || expanded().has(n.id)) {
          <button type="button" class="mt-1 min-h-9 text-sm font-medium text-scoular-blue dark:text-scoular-blue" (click)="toggle(n.id)"
                  [attr.aria-expanded]="expanded().has(n.id)">
            {{ expanded().has(n.id) ? 'Show less' : 'Show more' }}
          </button>
        }
      </article>
    </ng-template>
  `,
})
export class NotesTab {
  private readonly api = inject(MobileApiService);
  private readonly queue = inject(SyncQueueService);

  /** This producer's notes still on the phone (not the refused ones — those are in the sync issues box). */
  protected readonly queuedNotes = computed(() =>
    this.queue.items().filter((i) => i.kind === 'note-create' && i.customerId === this.customerId() && i.status !== 'error'),
  );

  protected queuedText(item: QueuedOperation): string {
    return (item.body as NoteCreate).content;
  }
  private readonly connectivity = inject(ConnectivityService);
  private readonly notices = inject(NoticeService);

  readonly customerId = input.required<number>();
  protected readonly draft = signal('');
  protected readonly saving = signal(false);
  protected readonly online = this.connectivity.online;

  /** Note ids opened with "Show more", and ids whose clamped text is really cut off. */
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly overflowing = signal<ReadonlySet<number>>(new Set());

  protected readonly notes = resource<RecentNotes, number>({
    params: () => this.customerId(),
    loader: ({ params }) => this.api.getRecentNotes(params),
  });

  constructor() {
    // When the queue delivers a note for THIS producer, refresh the list.
    effect(() => {
      const synced = this.queue.synced();
      if (synced && synced.customerId === this.customerId()) this.notes.reload();
    });
  }

  protected toggle(id: number): void {
    this.expanded.update((s) => toggled(s, id, !s.has(id)));
  }

  protected setOverflow(id: number, overflowing: boolean): void {
    this.overflowing.update((s) => toggled(s, id, overflowing));
  }

  protected initials(name: string | null | undefined): string {
    return noteInitials(name || 'User');
  }

  protected timestamp(value: Note['createdAt']): string {
    return formatNoteTimestamp(value);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const content = this.draft().trim();
    if (!content) return;

    const body = { clientRequestId: newClientRequestId(), content, capturedAt: new Date().toISOString() };
    this.saving.set(true);
    try {
      // Sent now with signal; kept on the phone without (or when the send drops), and sent when it returns.
      const result = await this.queue.submit({ kind: 'note-create', customerId: this.customerId(), body });
      if (result === 'sent') this.notes.reload();
      else this.notices.info('Saved on this phone. It will be sent when you are back online.');
      this.draft.set('');
    } finally {
      this.saving.set(false);
    }
  }
}

function toggled(set: ReadonlySet<number>, id: number, on: boolean): ReadonlySet<number> {
  if (set.has(id) === on) return set;
  const next = new Set(set);
  if (on) next.add(id); else next.delete(id);
  return next;
}
