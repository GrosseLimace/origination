import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import type { Note, NoteLastContact, NoteMention } from '@models';
import { HomeBackgroundFailures } from './home-background-failures';
import { HomePageState } from './home-page.state';
import { lastContactFromNotes, sortNotes } from './home-derivations';

/**
 * Notes on the producer page: the per-producer full-notes cache, the selected producer's notes
 * panel, the customer list's "last contacted" badge feed, and the note handlers. Provided by
 * HomeComponent, which exposes these signals and delegates its note handlers here.
 *
 * Notes are not bulk-downloaded: the selected producer's linked group is fetched on selection
 * (ensureCustomerNotes) and kept here for the visit. The badge feed is a tiny per-customer
 * aggregate covering every trade unit, so the list never needs note bodies.
 */
@Injectable()
export class HomeNotesStore {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly backgroundFailures = inject(HomeBackgroundFailures);
  private readonly page = inject(HomePageState);
  private readonly destroyRef = inject(DestroyRef);

  /** Per-customer full-notes cache (Tier 2). Notes are no longer bulk-downloaded; the
   *  selected producer's linked group is fetched via getNotesByCustomer on selection and
   *  cached here for the session. Map.has distinguishes "fetched, zero notes" from "not
   *  fetched yet"; a failed fetch is NOT cached so the next selection retries. Kept in
   *  sync by the note CRUD handlers; cleared on TU change with the other caches. */
  private readonly _customerNotesCache = new Map<number, Note[]>();
  /** Producer ids whose notes have already been re-fetched during the CURRENT selection.
   *  Reset when a new producer is selected. Lets ensureCustomerNotes refresh each producer
   *  once per selection (so notes added by other reps show on re-click — stale-while-revalidate)
   *  without the several internal calls per selection (details-arrival, BFS) re-fetching. */
  private readonly _notesRefreshedThisSelection = new Set<number>();

  /** Per-customer "last contacted" aggregate — the badge feed for the customer list.
   *  Covers ALL trade units (entitlement-filtered server-side) so linked producers in
   *  unselected TUs are represented without downloading any note bodies. Full notes are
   *  fetched per-producer on selection into _customerNotesCache. */
  readonly noteLastContacts = signal<NoteLastContact[]>([]);
  /** The selected producer's notes and its linked group's, pinned first then newest. */
  readonly customerNotes = signal<Note[]>([]);
  /** True while the selected producer's (and linked group's) notes are being fetched.
   *  Drives the notes panel's loading state so a producer with notes doesn't flash
   *  "No notes yet" during the per-customer fetch. */
  readonly isLoadingNotes = signal(false);
  /** True while a createNote request is in flight. Bound to <app-customer-notes
   *  [isSavingNote]> so the textarea + button show a "Saving..." state and ignore
   *  repeat clicks during the round trip. */
  readonly isSavingNote = signal(false);
  /** Increments after each successful createNote. <app-customer-notes> watches
   *  this counter and clears its textarea only when it increments — so if the save
   *  fails, the user's typed content survives and they can retry. */
  readonly noteSaveSucceededCounter = signal(0);

  /** A new producer was selected: allow each producer's notes to be re-fetched once, so other
   *  reps' adds show. */
  startSelection(): void {
    this._notesRefreshedThisSelection.clear();
  }

  /** Trade units changed: drop every cached note so the next selection re-fetches (freshness
   *  parity with the other per-customer caches). */
  forgetAll(): void {
    this._customerNotesCache.clear();
    this._notesRefreshedThisSelection.clear();
  }

  /** Pure recompute of the notes panel from the cache for the given producers — safe to call from
   *  every data-arrival callback. */
  showNotesFor(customerIds: Iterable<number>): void {
    this.customerNotes.set(sortNotes(
      [...customerIds].flatMap(id => this._customerNotesCache.get(id) ?? [])
    ));
  }

  /** Refreshes the per-customer last-contact aggregate (deduped in ApiService, so a
   *  concurrent data-preload request shares one HTTP call). Tiny payload — one row per
   *  customer with notes, no note bodies. */
  refreshLastContacts(): void {
    this.apiService.getNotesLastContact().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (rows) => {
        const list = rows ?? [];
        this.noteLastContacts.set(list);
        this.appState.setNoteLastContacts(list);
        this.appState.setNoteLastContactsLoadFailed(false);
      },
      error: (err) => {
        // The list then shows "Last contact unavailable" rather than "Never contacted" on every row.
        this.appState.setNoteLastContactsLoadFailed(true);
        this.backgroundFailures.report('load last-contacted dates', err);
      }
    });
  }

  /**
   * Ensures the full notes for a producer's group (`groupIds`: the producer AND its currently-known
   * linked group) are loaded and fresh, calling `refreshPanel` whenever there is something new to
   * show, so the page can recompute the notes panel + last-contact badges.
   *
   * Stale-while-revalidate: any cached notes render immediately (re-clicking a producer is
   * instant — no spinner flash), and every group member is re-fetched once per selection via
   * the per-customer endpoint so notes added by OTHER reps appear on re-click. The
   * _notesRefreshedThisSelection guard means the several internal calls per selection
   * (producer-details arrival, BFS completion) don't each re-fetch. The endpoint has no TU
   * filter, so linked producers in unselected trade units are fully covered. Failed fetches
   * aren't cached (and aren't marked refreshed), so they retry on the next trigger.
   */
  ensureCustomerNotes(groupIds: number[], refreshPanel: () => void): void {
    // Show whatever's already cached right away — instant re-click, no spinner if we have data.
    const haveAnyCached = groupIds.some(id => this._customerNotesCache.has(id));
    if (haveAnyCached) {
      this.isLoadingNotes.set(false);
      refreshPanel();
    }

    // Refresh each group member at most once per selection.
    const toFetch = groupIds.filter(id => !this._notesRefreshedThisSelection.has(id));
    if (toFetch.length === 0) {
      this.isLoadingNotes.set(false);
      return;
    }
    toFetch.forEach(id => this._notesRefreshedThisSelection.add(id));

    // Only show the spinner on a cold selection (nothing cached to display meanwhile).
    if (!haveAnyCached) this.isLoadingNotes.set(true);

    forkJoin(toFetch.map(id =>
      this.apiService.getNotesByCustomer(id).pipe(catchError(() => of(null as Note[] | null)))
    )).pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (lists) => {
        lists.forEach((list, i) => {
          if (!list) {
            // Fetch failed — allow a later retry rather than caching a wrong empty.
            this._notesRefreshedThisSelection.delete(toFetch[i]);
            return;
          }
          this._customerNotesCache.set(toFetch[i], list);
          // Keep the list badge in step with the freshly-fetched notes (picks up other reps'
          // adds/deletes for this producer, consistent with the panel).
          this._recomputeLastContactFor(toFetch[i]);
        });
        this.isLoadingNotes.set(false);
        refreshPanel();
      },
      error: () => this.isLoadingNotes.set(false)
    });
  }

  addNote(payload: { content: string; mentions: NoteMention[] }): void {
    const { content, mentions } = payload;
    const sel = this.page.selectedCustomer();
    if (!sel) return;
    // Not-yet-onboarded producer: there's no dbo.Customer row for a note to attach to
    // (it FKs to Customer). Make them assign a trade unit + Save Changes first.
    if (sel.isOnboardCandidate) {
      this.toastService.error('Assign a trade unit and save this producer before adding notes.');
      return;
    }
    // Guard against overlapping submits at the parent layer too — covers any caller
    // that didn't honor the child's own isSavingNote disable.
    if (this.isSavingNote()) return;
    const tradeUnit = this.page.selectedTradeUnits().length === 1 ? this.page.selectedTradeUnits()[0] : undefined;
    this.isSavingNote.set(true);
    this.apiService.createNote(sel.id, content, tradeUnit, mentions).subscribe({
      next: (note) => {
        this._applyNoteToCache(note);
        this.customerNotes.update(arr => sortNotes([...arr, note]));
        this._recomputeLastContactFor(note.customerId);
        this.toastService.success('Note added');
        // Increment FIRST so the child clears its textarea, then drop the flag.
        this.noteSaveSucceededCounter.update(n => n + 1);
        this.isSavingNote.set(false);
      },
      error: (err: Error) => {
        // Surface the server's reason (e.g. a mentioned group that's no longer available) —
        // the generic message gives the user nothing to act on.
        this.toastService.error(err?.message || 'Failed to add note');
        // Leave the success counter alone — the child keeps the text so the user
        // can retry. Just clear the in-flight flag so the button re-enables.
        this.isSavingNote.set(false);
      }
    });
  }

  /** Inserts or replaces `note` in the per-customer notes cache and, when the full
   *  TU-wide NLQ cache has been lazily loaded, mirrors the change there so saved-list /
   *  build-list queries keep seeing fresh data. */
  private _applyNoteToCache(note: Note): void {
    const cached = this._customerNotesCache.get(note.customerId);
    if (cached) {
      const idx = cached.findIndex(n => n.id === note.id);
      this._customerNotesCache.set(note.customerId,
        idx >= 0 ? cached.map(n => n.id === note.id ? note : n) : [...cached, note]);
    } else {
      this._customerNotesCache.set(note.customerId, [note]);
    }
    if (this.appState.notesLoaded()) {
      const all = this.appState.notes();
      const idx = all.findIndex(n => n.id === note.id);
      this.appState.setNotes(idx >= 0 ? all.map(n => n.id === note.id ? note : n) : [...all, note]);
    }
  }

  /** Removes a note from the per-customer cache and (if loaded) the NLQ cache. */
  private _removeNoteFromCache(noteId: number, customerId: number): void {
    const cached = this._customerNotesCache.get(customerId);
    if (cached) this._customerNotesCache.set(customerId, cached.filter(n => n.id !== noteId));
    if (this.appState.notesLoaded()) {
      this.appState.setNotes(this.appState.notes().filter(n => n.id !== noteId));
    }
  }

  /** Recomputes the last-contact aggregate entry for one customer from the per-customer
   *  notes cache (which the CRUD handlers keep current). A customer whose last note was
   *  deleted drops back to "Never contacted"; a new note raises the badge date. */
  private _recomputeLastContactFor(customerId: number): void {
    const cached = this._customerNotesCache.get(customerId) ?? [];
    this.noteLastContacts.update(rows => {
      const rest = rows.filter(r => r.customerId !== customerId);
      const row = lastContactFromNotes(customerId, cached);
      return row ? [...rest, row] : rest;
    });
    this.appState.setNoteLastContacts(this.noteLastContacts());
  }

  toggleNotePin(note: Note): void {
    this.apiService.toggleNotePin(note.id).subscribe({
      next: (updated) => {
        // Pin/unpin doesn't change createdAt, so the last-contact aggregate is untouched.
        this._applyNoteToCache(updated);
        this.customerNotes.update(arr =>
          sortNotes(arr.map(n => n.id === updated.id ? updated : n))
        );
        this.toastService.success(updated.isPinned ? 'Note pinned' : 'Note unpinned');
      },
      error: () => this.toastService.error('Failed to update note')
    });
  }

  editNote(data: { noteId: number; content: string; mentions: NoteMention[] }): void {
    this.apiService.updateNote(data.noteId, data.content, data.mentions).subscribe({
      next: (updated) => {
        // Content edits don't change createdAt, so the last-contact aggregate is untouched.
        this._applyNoteToCache(updated);
        this.customerNotes.update(arr =>
          sortNotes(arr.map(n => n.id === updated.id ? updated : n))
        );
        this.toastService.success('Note updated');
      },
      // Surface the server's reason (e.g. a group that's no longer available) instead of a
      // generic failure — the message is actionable and the generic one isn't.
      error: (err: Error) => this.toastService.error(err?.message || 'Failed to update note')
    });
  }

  deleteNote(noteId: number): void {
    // Resolve the note's owning customer BEFORE the delete — deletes come from the panel,
    // so the note is in customerNotes (possibly belonging to a linked producer).
    const target = this.customerNotes().find(n => n.id === noteId);
    this.apiService.deleteNote(noteId).subscribe({
      next: () => {
        if (target) {
          this._removeNoteFromCache(noteId, target.customerId);
          this._recomputeLastContactFor(target.customerId);
        }
        this.customerNotes.update(arr => arr.filter(n => n.id !== noteId));
        this.toastService.success('Note deleted');
      },
      error: () => this.toastService.error('Failed to delete note')
    });
  }
}
