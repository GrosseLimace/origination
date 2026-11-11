import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, finalize, takeUntil } from 'rxjs/operators';
import type { Customer, Note, NoteMention, Reminder, ReminderDraft, ReminderDue } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';
import { SelectedProducerEngagement } from '@core/context/selected-producer-engagement';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { alreadyShown } from '@core/http/shown-errors';
import { ToastService } from '@core/services/toast.service';
import { environment } from '@env/environment';
import { LinkedProducersStore } from '@features/customers';
import { lastContactFromNotes, sortNotes, sortReminders } from '../utils/notes-and-reminders';
import { EngagementApiService } from './engagement-api.service';
import { EngagementStore } from './engagement.store';
import { OutlookCalendarService } from './outlook-calendar.service';

/** Whether two lists of ids are the same, in the same order. */
const sameIds = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The selected customer's notes and the signed-in user's follow-ups for them: the customer screen's
 * SelectedProducerEngagement, which the composition root provides. The page tells it who is selected; it reads the
 * notes of the customer and their linked group (LinkedProducersStore), as the group becomes known, and the user's
 * follow-ups for the customer alone, and adds, edits and deletes both, keeping the last-contact summary, the user's
 * follow-up feed and the trade units' notes (EngagementStore) in step.
 *
 * Notes aren't bulk-read: each producer's are read when they or a producer linked to them is selected, and kept until
 * the trade units change. A selection shows what is kept at once and reads each producer of the group again once, so
 * notes other reps added show. A follow-up is about the one customer it was set on, so the linked group's aren't shown.
 *
 * The follow-ups' database rows are the record and the Outlook event a best-effort mirror: a calendar failure never
 * blocks or undoes a follow-up; it leaves the event id empty, which the row offers to retry.
 */
@Injectable({ providedIn: 'root' })
export class CustomerEngagementStore implements SelectedProducerEngagement {
  private readonly api = inject(EngagementApiService);
  private readonly store = inject(EngagementStore);
  private readonly toast = inject(ToastService);
  private readonly outlookCalendar = inject(OutlookCalendarService);
  private readonly tradeUnitContext = inject(TradeUnitContext);
  private readonly linked = inject(LinkedProducersStore);

  /** Cancels what is still being read for the customer selected before. */
  private readonly cancel$ = new Subject<void>();
  private readonly _selected = signal<Customer | null>(null);

  /** The selected customer and their linked group, by id, the customer first. */
  private readonly groupIds = computed(() => {
    const customer = this._selected();
    return customer ? [...new Set([customer.id, ...this.linked.groupOf(customer).map(c => c.id)])] : [];
  }, { equal: sameIds });

  // ── Notes ──────────────────────────────────────────────────────────────────

  /** Each customer's notes, from their last read and kept in step by the note actions. `has` tells "read, none" from
   *  "not read yet"; a failed read isn't kept, so the next selection reads again. Dropped on a trade-unit change. */
  private readonly notesByCustomer = new Map<number, Note[]>();
  /** Customers whose notes were read again during this selection: each is read once per selection, however often the
   *  group is asked for (details landing, the linked walk finishing). */
  private readonly readThisSelection = new Set<number>();
  /** Notes reads of this selection still out, and which selection that is: the spinner drops once nothing is left,
   *  or once there is something to show. */
  private notesInFlight = 0;
  private selection = 0;

  private readonly _notes = signal<Note[]>([]);
  private readonly _isLoadingNotes = signal(false);
  private readonly _isSavingNote = signal(false);
  private readonly _noteSaveSucceededCounter = signal(0);

  readonly notes = this._notes.asReadonly();
  readonly isLoadingNotes = this._isLoadingNotes.asReadonly();
  readonly isSavingNote = this._isSavingNote.asReadonly();
  readonly noteSaveSucceededCounter = this._noteSaveSucceededCounter.asReadonly();

  // ── Follow-ups ─────────────────────────────────────────────────────────────

  /** Off until the API registration has delegated Calendars.ReadWrite with admin consent. */
  readonly remindersEnabled = environment.remindersEnabled;
  private readonly _reminders = signal<Reminder[]>([]);
  private readonly _isLoadingReminders = signal(false);
  private readonly _isSavingReminder = signal(false);
  private readonly _reminderSaveSucceededCounter = signal(0);

  readonly reminders = this._reminders.asReadonly();
  readonly isLoadingReminders = this._isLoadingReminders.asReadonly();
  readonly isSavingReminder = this._isSavingReminder.asReadonly();
  readonly reminderSaveSucceededCounter = this._reminderSaveSucceededCounter.asReadonly();

  constructor() {
    inject(SessionReset).onReset(() => {
      this.select(null);
      this.forgetAll();
    });

    // A new selection of trade units: each customer's notes are read again for it, picking up other reps' adds.
    let first = true;
    effect(() => {
      this.tradeUnitContext.selectedTradeUnits();
      untracked(() => {
        if (first) { first = false; return; }
        this.forgetAll();
      });
    });

    // The group grows as the customer's details, their links and the linked producers from other trade units land:
    // the new members' notes are read and shown.
    effect(() => {
      const ids = this.groupIds();
      untracked(() => { if (ids.length > 0) this.readGroupNotes(ids); });
    });
  }

  /**
   * The customer the screen now shows, or null for none. A new customer cancels what was still being read for the one
   * before, shows the notes kept for them and their group, reads each again once, and reads the user's follow-ups for
   * them. The same customer again (after an edit, or on the way back to the page) keeps what is shown and takes the
   * customer as they now are.
   */
  select(customer: Customer | null): void {
    if (customer && this._selected()?.id === customer.id) {
      this._selected.set(customer);
      return;
    }
    this.cancel$.next();
    this.readThisSelection.clear();
    this.selection++;
    this.notesInFlight = 0;
    this._selected.set(customer);
    this._isLoadingNotes.set(false);
    this._reminders.set([]);
    this._isLoadingReminders.set(false);
    if (!customer) {
      this._notes.set([]);
      return;
    }
    this.showNotes();
    this.readGroupNotes(this.groupIds());
    this.loadReminders(customer.id);
  }

  /** Drops every customer's kept notes. */
  private forgetAll(): void {
    this.notesByCustomer.clear();
    this.readThisSelection.clear();
    this.selection++;
    this.notesInFlight = 0;
  }

  /** The notes of the customer and their group, as kept, pinned first then newest. */
  private showNotes(): void {
    this._notes.set(sortNotes(this.groupIds().flatMap(id => this.notesByCustomer.get(id) ?? [])));
  }

  /**
   * Reads the notes of those of the group not read this selection. The spinner shows only when nothing is kept to show
   * meanwhile. Each read lands in what is kept and in the last-contact summary; a failed one isn't kept and is read again
   * on the next ask. The next selection cancels them.
   */
  private readGroupNotes(groupIds: number[]): void {
    const haveAny = groupIds.some(id => this.notesByCustomer.has(id));
    if (haveAny) {
      this._isLoadingNotes.set(false);
      this.showNotes();
    }
    const toRead = groupIds.filter(id => !this.readThisSelection.has(id));
    if (toRead.length === 0) {
      if (this.notesInFlight === 0) this._isLoadingNotes.set(false);
      return;
    }
    toRead.forEach(id => this.readThisSelection.add(id));
    if (!haveAny) this._isLoadingNotes.set(true);

    const selection = this.selection;
    this.notesInFlight++;
    let settled = false;
    // Once per read, on its answer or its cancelling: the spinner drops once this selection has notes to show or
    // nothing left to read. A read from an earlier selection never touches this one's count.
    const settle = () => {
      if (settled) return;
      settled = true;
      if (selection !== this.selection) return;
      this.notesInFlight = Math.max(0, this.notesInFlight - 1);
      const showing = groupIds.some(id => (this.notesByCustomer.get(id)?.length ?? 0) > 0);
      if (this.notesInFlight === 0 || showing) this._isLoadingNotes.set(false);
    };

    forkJoin(toRead.map(id => this.api.getNotesByCustomer(id).pipe(catchError(() => of(null as Note[] | null))))).pipe(
      finalize(settle),
      takeUntil(this.cancel$),
    ).subscribe(lists => {
      lists.forEach((list, i) => {
        if (!list) {
          this.readThisSelection.delete(toRead[i]);
          return;
        }
        this.notesByCustomer.set(toRead[i], list);
        // The list's badge follows the notes just read: other reps' adds and deletes.
        this.recomputeLastContactFor(toRead[i]);
      });
      settle();
      this.showNotes();
    });
  }

  addNote(payload: { content: string; mentions: NoteMention[] }): void {
    const customer = this._selected();
    if (!customer) return;
    // A customer not added yet has no row for a note to attach to.
    if (customer.isOnboardCandidate) {
      this.toast.error('Assign a trade unit and save this producer before adding notes.');
      return;
    }
    if (this._isSavingNote()) return;
    const units = this.tradeUnitContext.selectedTradeUnits();
    const tradeUnit = units.length === 1 ? units[0] : undefined;
    this._isSavingNote.set(true);
    this.api.createNote(customer.id, payload.content, tradeUnit, payload.mentions).subscribe({
      next: note => {
        this.applyNote(note);
        this._notes.update(notes => sortNotes([...notes, note]));
        this.recomputeLastContactFor(note.customerId);
        this.toast.success('Note added');
        // The counter first, so the form clears, then the flag.
        this._noteSaveSucceededCounter.update(n => n + 1);
        this._isSavingNote.set(false);
      },
      error: (err: Error) => {
        // The server's reason (a mentioned group no longer available) is what the user can act on. The form keeps
        // the text for a retry.
        if (!alreadyShown(err)) this.toast.error(err?.message || 'Failed to add note');
        this._isSavingNote.set(false);
      },
    });
  }

  toggleNotePin(note: Note): void {
    this.api.toggleNotePin(note.id).subscribe({
      next: updated => {
        // A pin isn't a contact: the last-contact summary stays.
        this.applyNote(updated);
        this._notes.update(notes => sortNotes(notes.map(n => n.id === updated.id ? updated : n)));
        this.toast.success(updated.isPinned ? 'Note pinned' : 'Note unpinned');
      },
      error: err => { if (!alreadyShown(err)) this.toast.error('Failed to update note'); },
    });
  }

  editNote(edit: { noteId: number; content: string; mentions: NoteMention[] }): void {
    this.api.updateNote(edit.noteId, edit.content, edit.mentions).subscribe({
      next: updated => {
        this.applyNote(updated);
        this._notes.update(notes => sortNotes(notes.map(n => n.id === updated.id ? updated : n)));
        this.toast.success('Note updated');
      },
      error: (err: Error) => { if (!alreadyShown(err)) this.toast.error(err?.message || 'Failed to update note'); },
    });
  }

  deleteNote(noteId: number): void {
    // The note's customer, which may be a linked producer, before it goes.
    const target = this._notes().find(n => n.id === noteId);
    this.api.deleteNote(noteId).subscribe({
      next: () => {
        if (target) {
          this.removeNote(noteId, target.customerId);
          this.recomputeLastContactFor(target.customerId);
        }
        this._notes.update(notes => notes.filter(n => n.id !== noteId));
        this.toast.success('Note deleted');
      },
      error: err => { if (!alreadyShown(err)) this.toast.error('Failed to delete note'); },
    });
  }

  /** Puts a note in what is kept for its customer and, once the trade units' full notes are read, there too. */
  private applyNote(note: Note): void {
    const kept = this.notesByCustomer.get(note.customerId);
    this.notesByCustomer.set(note.customerId, kept
      ? (kept.some(n => n.id === note.id) ? kept.map(n => n.id === note.id ? note : n) : [...kept, note])
      : [note]);
    if (this.store.notesLoaded()) {
      const all = this.store.notes();
      this.store.setNotes(all.some(n => n.id === note.id) ? all.map(n => n.id === note.id ? note : n) : [...all, note]);
    }
  }

  private removeNote(noteId: number, customerId: number): void {
    const kept = this.notesByCustomer.get(customerId);
    if (kept) this.notesByCustomer.set(customerId, kept.filter(n => n.id !== noteId));
    if (this.store.notesLoaded()) this.store.setNotes(this.store.notes().filter(n => n.id !== noteId));
  }

  /** The customer's row in the last-contact summary, from their kept notes: a new note raises it, and a customer whose
   *  last note was deleted drops back to "Never contacted". */
  private recomputeLastContactFor(customerId: number): void {
    const rest = this.store.noteLastContacts().filter(r => r.customerId !== customerId);
    const row = lastContactFromNotes(customerId, this.notesByCustomer.get(customerId) ?? []);
    this.store.setNoteLastContacts(row ? [...rest, row] : rest);
  }

  // ── Follow-ups ─────────────────────────────────────────────────────────────

  /** The user's follow-ups for one customer. Not kept: the list is small, and a stale due date is worse than a read. The
   *  next selection cancels the read. */
  private loadReminders(customerId: number): void {
    if (!this.remindersEnabled) return;
    this._isLoadingReminders.set(true);
    this.api.getRemindersByCustomer(customerId).pipe(takeUntil(this.cancel$)).subscribe({
      next: reminders => {
        this._reminders.set(reminders);
        this._isLoadingReminders.set(false);
      },
      error: () => this._isLoadingReminders.set(false),
    });
  }

  saveReminder(draft: ReminderDraft): void {
    const customer = this._selected();
    if (!customer) return;
    this._isSavingReminder.set(true);

    if (draft.id === undefined) {
      this.api.createReminder(customer.id, draft.dueAt, draft.subject || undefined, draft.notes).subscribe({
        next: created => {
          this._reminders.update(list => sortReminders([...list, created]));
          this.putMyReminder(created);
          this._isSavingReminder.set(false);
          this._reminderSaveSucceededCounter.update(n => n + 1);
          this.toast.success('Follow-up added');
          this.syncToOutlook(created);
        },
        error: () => this._isSavingReminder.set(false),
      });
      return;
    }

    const id = draft.id;
    this.api.updateReminder(id, draft.dueAt, draft.subject || undefined, draft.notes, OutlookCalendarService.currentTimeZone())
      .subscribe({
        next: updated => {
          this._reminders.update(list => sortReminders(list.map(r => r.id === id ? updated : r)));
          this.putMyReminder(updated);
          this._isSavingReminder.set(false);
          this._reminderSaveSucceededCounter.update(n => n + 1);
          this.toast.success('Follow-up updated');
          // The API moved the event in the same call, patching it rather than recreating it, since a deleted and
          // recreated event shows the old slot as "Canceled". Only a move that didn't take is left to say.
          if (updated.outlookEventId) {
            if (updated.outlookEventMoved === false) this.toast.info('Saved, but the Outlook event could not be moved.');
          } else {
            this.syncToOutlook(updated);
          }
        },
        error: () => this._isSavingReminder.set(false),
      });
  }

  toggleReminderComplete(reminder: Reminder): void {
    const completing = !reminder.isCompleted;
    this.api.setReminderCompleted(reminder.id, completing).subscribe(updated => {
      // A completed follow-up stays on the calendar: deleting the event shows it as "Canceled", which reads as "never
      // happened" rather than "done".
      this._reminders.update(list => sortReminders(list.map(r => r.id === reminder.id ? updated : r)));
      if (completing) this.dropMyReminder(reminder.id);
      else this.putMyReminder(updated);
    });
  }

  deleteReminder(reminder: Reminder): void {
    // The API removes the calendar event in the same call.
    this.api.deleteReminder(reminder.id).subscribe(() => {
      this._reminders.update(list => list.filter(r => r.id !== reminder.id));
      this.dropMyReminder(reminder.id);
      this.toast.success('Follow-up deleted');
    });
  }

  addReminderToOutlook(reminder: Reminder): void {
    this.syncToOutlook(reminder, true);
  }

  /**
   * Puts the follow-up on the user's own calendar; the API writes the event and records its id in one call. Quiet
   * about a failure during a save, since the row offers the retry; explicit when the user pressed "Add to Outlook".
   */
  private syncToOutlook(reminder: Reminder, userAsked = false): void {
    const link = `${window.location.origin}/?customerId=${reminder.customerId}`;
    this.outlookCalendar.addToOutlook(reminder, link).subscribe(updated => {
      if (!updated?.outlookEventId) {
        this.toast.info(userAsked
          ? 'Could not add this to Outlook. Your follow-up is still saved here.'
          : 'Follow-up saved. It could not be added to Outlook — use "Add to Outlook" to retry.');
        return;
      }
      this._reminders.update(list => list.map(r => r.id === updated.id ? updated : r));
      if (userAsked) this.toast.success('Added to your Outlook calendar');
    });
  }

  /** Keeps the user's follow-up feed in step, so the list's badge follows without a read. */
  private putMyReminder(reminder: Reminder): void {
    const row: ReminderDue = { id: reminder.id, customerId: reminder.customerId, customerCode: reminder.customerCode, dueAt: reminder.dueAt };
    this.store.setMyReminders([
      ...this.store.myReminders().filter(r => r.id !== reminder.id),
      ...(reminder.isCompleted ? [] : [row]),
    ]);
  }

  private dropMyReminder(reminderId: number): void {
    this.store.setMyReminders(this.store.myReminders().filter(r => r.id !== reminderId));
  }
}
