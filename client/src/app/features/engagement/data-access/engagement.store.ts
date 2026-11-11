import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import type { Note, NoteLastContact, ReminderDue } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';
import { HandledErrorReporter } from '@core/services/handled-error-reporter.service';
import { EngagementApiService } from './engagement-api.service';

/**
 * The notes and follow-ups every screen shares for the session: the last-contact summary (one row per customer with
 * notes, every trade unit), the signed-in user's own open follow-ups, and the trade units' full notes, which only a
 * screen whose prompt reads note bodies loads. Engagement's preload reads the first two on each trade-unit change; the
 * selected producer's notes and follow-ups (CustomerEngagementStore) keep them in step as they change. The customer
 * list's badges, Build a List, the saved lists and the Planting Dashboard read them.
 */
@Injectable({ providedIn: 'root' })
export class EngagementStore {
  private readonly api = inject(EngagementApiService);
  private readonly handledErrors = inject(HandledErrorReporter);

  private readonly _notes = signal<Note[]>([]);
  private readonly _notesLoaded = signal(false);
  private readonly _noteLastContacts = signal<NoteLastContact[]>([]);
  private readonly _noteLastContactsLoadFailed = signal(false);
  private readonly _myReminders = signal<ReminderDue[]>([]);
  private readonly _myRemindersLoadFailed = signal(false);
  /** Whether the last-contact summary has been asked for since sign-in. */
  private lastContactsRequested = false;

  /** The trade units' full notes: a lazy cache for the prompts that read note bodies, authors, pins or counts. */
  readonly notes = this._notes.asReadonly();
  /** True once the full notes have been read for the trade units, whether or not there are any. Check this rather
   *  than `notes().length`: trade units with no notes read the same as "not read yet" by length. */
  readonly notesLoaded = this._notesLoaded.asReadonly();
  /** The last time each customer was contacted, from the newest note created on them, across every trade unit: the
   *  customer list's last-contacted badge and the recency prompts read it, without any note bodies. */
  readonly noteLastContacts = this._noteLastContacts.asReadonly();
  /** Set when the last-contact summary's read failed, as opposed to returning nothing: otherwise every customer reads
   *  "Never contacted" and the recency prompts ("not contacted in 30 days") match everyone. */
  readonly noteLastContactsLoadFailed = this._noteLastContactsLoadFailed.asReadonly();
  /** The signed-in user's own open follow-ups, across every customer: the list's follow-up badge. Private per user:
   *  the API returns nobody else's. */
  readonly myReminders = this._myReminders.asReadonly();
  /** Same, for the follow-ups: their badges vanish and the follow-up prompts match no one. */
  readonly myRemindersLoadFailed = this._myRemindersLoadFailed.asReadonly();

  constructor() {
    inject(SessionReset).onReset(() => {
      this.clearNotesCache();
      this._noteLastContacts.set([]);
      this._myReminders.set([]);
      this.clearLoadFailures();
      this.lastContactsRequested = false;
    });
  }

  /** The trade units' full notes, read for the selection now. */
  setNotes(notes: Note[]): void {
    this._notes.set(notes);
    this._notesLoaded.set(true);
  }

  /** Drops the full notes: a new trade-unit selection reads its own when a prompt needs them. */
  clearNotesCache(): void {
    this._notes.set([]);
    this._notesLoaded.set(false);
  }

  setNoteLastContacts(rows: NoteLastContact[]): void { this._noteLastContacts.set(rows); }
  setMyReminders(rows: ReminderDue[]): void { this._myReminders.set(rows); }
  setNoteLastContactsLoadFailed(failed: boolean): void { this._noteLastContactsLoadFailed.set(failed); }
  setMyRemindersLoadFailed(failed: boolean): void { this._myRemindersLoadFailed.set(failed); }

  /** A new trade-unit load is starting: the previous load's failures no longer describe anything. */
  clearLoadFailures(): void {
    this._noteLastContactsLoadFailed.set(false);
    this._myRemindersLoadFailed.set(false);
  }

  /**
   * Reads the last-contact summary into the store. A failure is recorded, and the summary emptied, so the badges say
   * the contact history is unavailable rather than "Never contacted"; App Insights is told.
   */
  readLastContacts(): Observable<NoteLastContact[]> {
    this.lastContactsRequested = true;
    return this.api.getNotesLastContact().pipe(
      tap(() => this._noteLastContactsLoadFailed.set(false)),
      catchError(err => {
        this._noteLastContactsLoadFailed.set(true);
        this.handledErrors.send('Engagement: failed to load last-contacted dates', err);
        return of([] as NoteLastContact[]);
      }),
      tap(rows => this._noteLastContacts.set(rows ?? [])),
    );
  }

  /**
   * Reads the last-contact summary unless it was asked for since sign-in. The customer list's badges ask, so they show
   * with no trade unit selected too, when Engagement's preload doesn't run.
   */
  ensureLastContacts(): void {
    if (this.lastContactsRequested) return;
    this.readLastContacts().subscribe();
  }
}
