import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { GraphTeamsChannel, MentionCatalog, Note, NoteLastContact, NoteMention, Reminder, ReminderDue } from '@models';
import { environment } from '@env/environment';
import { injectApiErrorHandler } from '@core/http/api-error-handler';
import { dedupeRequests } from '@core/http/dedupe-requests';

/**
 * The Engagement module's calls: notes and the last-contact summary, the user's follow-ups and their Outlook events,
 * the Teams channels and the mention catalog the note composer offers. Exported from the module's index for Lists,
 * whose prompts read the notes, and the Planting Dashboard.
 */
@Injectable({ providedIn: 'root' })
export class EngagementApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;
  /** In-flight request deduplication: concurrent callers of the same slow endpoint share one request. */
  private readonly dedupe = dedupeRequests();
  private readonly handleError = injectApiErrorHandler();

  // ==========================================================================
  // Note Operations (Customer contact notes)
  // ==========================================================================

  /** Fetches notes. With no options this is the full set; the options narrow the read SERVER-SIDE
   *  so note-scoped prompts don't pull all ~28.8k notes:
   *   - `sinceDays`   — only notes created within the last N days (date-recency prompts).
   *   - `contentAny`  — only notes whose text contains ANY of these keywords (content search).
   *   - `authorAny`   — only notes whose author (CreatedBy/ModifiedBy) contains ANY of these.
   *   - `pinnedOnly`  — only pinned notes.
   *  Each is a SUPERSET the caller then matches exactly, so results are unchanged — just fewer
   *  rows over the wire. Every distinct option set gets its own dedupe key so a partial slice never
   *  collides with (or masquerades as) the full-set cache. */
  getNotes(tradeUnits?: string[], opts?: { sinceDays?: number; contentAny?: string[]; authorAny?: string[]; pinnedOnly?: boolean; customerIds?: number[] }): Observable<Note[]> {
    const params: string[] = [];
    if (tradeUnits?.length) params.push(`tradeUnits=${encodeURIComponent(tradeUnits.join(','))}`);
    if (opts?.sinceDays != null && opts.sinceDays > 0) params.push(`sinceDays=${opts.sinceDays}`);
    if (opts?.contentAny?.length) params.push(`contentAny=${encodeURIComponent(opts.contentAny.join(','))}`);
    if (opts?.authorAny?.length) params.push(`authorAny=${encodeURIComponent(opts.authorAny.join(','))}`);
    if (opts?.pinnedOnly) params.push('pinnedOnly=true');
    if (opts?.customerIds?.length) params.push(`customerIds=${encodeURIComponent(opts.customerIds.join(','))}`);
    const url = params.length ? `${this.baseUrl}/notes?${params.join('&')}` : `${this.baseUrl}/notes`;
    const scopeParams = params.filter(p => !p.startsWith('tradeUnits=')).sort().join('&');
    const key = `notes:${[...(tradeUnits ?? [])].sort().join(',')}:${scopeParams}`;
    return this.dedupe(key,
      this.http.get<Note[]>(url).pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Per-customer "last contacted" aggregate — tiny rows (no note bodies), all trade units.
   *  Feeds the list badges; payload is bounded by customer count, not note count. */
  getNotesLastContact(): Observable<NoteLastContact[]> {
    return this.dedupe('notes-last-contact',
      this.http.get<NoteLastContact[]>(`${this.baseUrl}/notes/last-contact`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Fetches all notes for a specific customer */
  getNotesByCustomer(customerId: number): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.baseUrl}/notes/customer/${customerId}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Creates a new note for a customer (optionally with "@" mentions) */
  createNote(customerId: number, content: string, tradeUnit?: string, mentions?: NoteMention[]): Observable<Note> {
    return this.http.post<Note>(`${this.baseUrl}/notes`, { customerId, content, tradeUnit, mentions })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Lookup data (people / trade units / groups) for the note "@" mention picker */
  /** The Teams channels the signed-in user belongs to. The API reads these from Graph
   *  on-behalf-of the caller, so the browser never talks to Graph and never holds a Graph token.
   *  An empty list means consent has not been granted in this environment. */
  getMyTeamsChannels(): Observable<GraphTeamsChannel[]> {
    return this.http
      .get<GraphTeamsChannel[]>(`${this.baseUrl}/teamschannels/mine`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Registers a Teams channel the composer read from Graph, or returns the row that already
   *  exists for it. Idempotent, so the composer calls it on every pick without checking first.
   *  Returns the registry id the note mention must carry. */
  registerTeamsChannel(body: {
    teamId: string; teamName: string; channelId: string; displayName: string; channelEmail: string;
  }): Observable<{ id: number; displayName: string; teamName: string; channelId: string }> {
    return this.http
      .post<{ id: number; displayName: string; teamName: string; channelId: string }>(
        `${this.baseUrl}/teamschannels`, body)
      .pipe(catchError(e => this.handleError(e)));
  }

  getMentionCatalog(): Observable<MentionCatalog> {
    return this.dedupe('mention-catalog',
      this.http.get<MentionCatalog>(`${this.baseUrl}/notes/mention-catalog`)
        .pipe(catchError(() => of<MentionCatalog>({ people: [], tradeUnits: [], tradeUnitGroups: [], appGroups: [], teamsChannels: [] })))
    );
  }

  /** Toggles the pinned status of a note */
  toggleNotePin(id: number): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}/toggle-pin`, {})
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Updates the content of a note. `mentions` MUST be supplied whenever the caller knows them:
   *  omitting it leaves the note's existing mentions untouched, while passing [] clears them.
   *  (Sending nothing used to wipe them outright — every edit silently destroyed a note's
   *  mentions and their highlighting.) */
  updateNote(id: number, content: string, mentions?: NoteMention[]): Observable<Note> {
    return this.http.put<Note>(`${this.baseUrl}/notes/${id}`, { content, mentions })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes a note */
  deleteNote(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/notes/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  // ==========================================================================
  // Reminder Operations (personal producer follow-ups)
  // ==========================================================================
  // Every route below is scoped server-side to the signed-in user: reminders are private, so
  // these never return or touch another originator's follow-ups.

  /** The signed-in user's reminders for one producer, soonest due first. */
  getRemindersByCustomer(customerId: number, includeCompleted = false): Observable<Reminder[]> {
    const query = includeCompleted ? '?includeCompleted=true' : '';
    return this.http.get<Reminder[]>(`${this.baseUrl}/reminders/customer/${customerId}${query}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Every OPEN reminder the signed-in user owns — tiny rows feeding the producer-list badge.
   *  Payload is bounded by the user's own follow-ups, not by the team's. */
  getMyReminders(): Observable<ReminderDue[]> {
    return this.dedupe('reminders-mine',
      this.http.get<ReminderDue[]>(`${this.baseUrl}/reminders/mine`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Creates a follow-up reminder. `dueAt` must be a UTC ISO string. */
  createReminder(customerId: number, dueAt: string, subject?: string, notes?: string): Observable<Reminder> {
    return this.http.post<Reminder>(`${this.baseUrl}/reminders`, { customerId, dueAt, subject, notes })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Edits the due date, subject or notes of one of the user's own reminders. */
  /** Saves an edit. `timeZone` rides along because the API moves the Outlook event in the same call
   *  when the due date changed, and Graph needs a local time plus a zone name. */
  updateReminder(id: number, dueAt: string, subject?: string, notes?: string, timeZone?: string): Observable<Reminder> {
    return this.http.put<Reminder>(`${this.baseUrl}/reminders/${id}`, { dueAt, subject, notes, timeZone })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Marks a reminder complete, or reopens it. */
  setReminderCompleted(id: number, isCompleted: boolean): Observable<Reminder> {
    return this.http.put<Reminder>(`${this.baseUrl}/reminders/${id}/complete`, { isCompleted })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Puts an existing reminder on the caller's own Outlook calendar. The API writes the event via
   *  Graph on-behalf-of the user and records the id, so the browser never touches Graph. A reminder
   *  that comes back with a null `outlookEventId` means the calendar could not be written, and the
   *  row keeps offering the retry. */
  addReminderToOutlook(id: number, body: { timeZone: string; producerLink: string }): Observable<Reminder> {
    return this.http.post<Reminder>(`${this.baseUrl}/reminders/${id}/outlook`, body)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes one of the user's own reminders. */
  deleteReminder(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/reminders/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }
}
