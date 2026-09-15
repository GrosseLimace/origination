// Angular core
import { inject, Injectable } from '@angular/core';

// Angular HTTP
import { HttpClient } from '@angular/common/http';

// MSAL
import { MsalService } from '@azure/msal-angular';
import { InteractionRequiredAuthError } from '@azure/msal-browser';

// RxJS
import { from, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

// Models
import { Reminder } from '@models';

/** Graph v1.0 events collection for the SIGNED-IN user. Never /users/{id}/events — this feature
 *  only ever writes the caller's own calendar, which is why a delegated scope is enough. */
const GRAPH_EVENTS_URL = 'https://graph.microsoft.com/v1.0/me/events';

/** Delegated permission. Needs admin consent on the SPA app registration per environment. */
const CALENDAR_SCOPE = 'Calendars.ReadWrite';

/** How long the calendar block runs. A follow-up is a prompt to make a call, not a meeting. */
const EVENT_MINUTES = 30;

/** Outlook pops its reminder this many minutes before the block. */
const REMINDER_MINUTES_BEFORE = 15;

/**
 * Writes producer follow-up reminders to the signed-in user's own Outlook calendar.
 *
 * Why the browser and not the API: the event belongs to the user, so a DELEGATED token acquired in
 * the SPA is the least-privilege way to write it. The alternative — the API's managed identity
 * holding application-wide Calendars.ReadWrite — would grant the service write access to every
 * mailbox in the tenant to accomplish the same thing. The app already calls Graph this way for the
 * profile photo in the header, so the pattern and the CSP allowance are established.
 *
 * NOTHING here ever throws or rejects. A calendar write is a best-effort side effect of saving a
 * reminder: if consent is missing, the popup is blocked, or Graph is down, the reminder must still
 * save. Failures surface as `null` / `false` and the caller shows an "Add to Outlook" retry.
 */
@Injectable({ providedIn: 'root' })
export class OutlookCalendarService {
  private readonly http = inject(HttpClient);
  private readonly msal = inject(MsalService);

  /** Creates the event and resolves the Graph event id, or null when it could not be written. */
  createEvent(reminder: Reminder, producerLink: string): Observable<string | null> {
    return this.withToken<string | null>(token => {
      const start = new Date(reminder.dueAt);
      const body = {
        subject: reminder.subject,
        body: { contentType: 'HTML', content: this.buildBody(reminder, producerLink) },
        start: this.toGraphTime(start),
        end: this.toGraphTime(new Date(start.getTime() + EVENT_MINUTES * 60_000)),
        isReminderOn: true,
        reminderMinutesBeforeStart: REMINDER_MINUTES_BEFORE,
      };

      return this.http.post<{ id?: string }>(GRAPH_EVENTS_URL, body, { headers: this.authHeader(token) }).pipe(
        map(created => created?.id ?? null),
        catchError(() => of(null))
      );
    }, null);
  }

  /**
   * Moves an existing event to a new due date. PATCHes ONLY start and end: replacing the event, or
   * deleting and recreating it, makes Outlook render the original slot as "Canceled". Subject, body
   * and reminder settings are left alone so a user's own tweaks in Outlook survive a reschedule.
   */
  updateEventWindow(eventId: string, dueAt: string): Observable<boolean> {
    return this.withToken<boolean>(token => {
      const start = new Date(dueAt);
      const patch = {
        start: this.toGraphTime(start),
        end: this.toGraphTime(new Date(start.getTime() + EVENT_MINUTES * 60_000)),
      };

      return this.http.patch(GRAPH_EVENTS_URL + `/${eventId}`, patch, { headers: this.authHeader(token) }).pipe(
        map(() => true),
        catchError(() => of(false))
      );
    }, false);
  }

  /** Removes the event. An event already gone (404) counts as success — the end state is the same. */
  deleteEvent(eventId: string): Observable<boolean> {
    return this.withToken<boolean>(token =>
      this.http.delete(GRAPH_EVENTS_URL + `/${eventId}`, { headers: this.authHeader(token) }).pipe(
        map(() => true),
        catchError(err => of(err?.status === 404))
      ), false);
  }

  // --------------------------------------------------------------------------
  /**
   * Runs `work` with a delegated Graph token, or resolves `fallback` if one cannot be obtained.
   *
   * Silent acquisition first; on InteractionRequiredAuthError (the first use, before the user has
   * consented) it escalates to a POPUP rather than a redirect. A redirect would navigate away from
   * the page and lose the reminder the user just filled in.
   */
  private withToken<T>(work: (token: string) => Observable<T>, fallback: T): Observable<T> {
    const account = this.msal.instance.getActiveAccount() ?? this.msal.instance.getAllAccounts()[0];
    if (!account) {
      return of(fallback);
    }

    const request = { scopes: [CALENDAR_SCOPE], account };

    return from(this.msal.instance.acquireTokenSilent(request)).pipe(
      catchError(err => {
        if (err instanceof InteractionRequiredAuthError) {
          return from(this.msal.instance.acquireTokenPopup(request));
        }
        throw err;
      }),
      switchMap(result => (result?.accessToken ? work(result.accessToken) : of(fallback))),
      catchError(() => of(fallback))
    );
  }

  private authHeader(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Graph wants an UNZONED local literal plus a separate time-zone name — handing it an ISO string
   * with an offset makes it interpret the zone differently from what the user picked. The browser's
   * IANA zone is the right one here: the event is being written for the person sitting in front of
   * this browser, on their own calendar.
   */
  private toGraphTime(value: Date): { dateTime: string; timeZone: string } {
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateTime =
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
      `T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
    return { dateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
  }

  /** Event body: the producer, the user's own note, and a link straight back to their page. */
  private buildBody(reminder: Reminder, producerLink: string): string {
    const parts = [`<p>Follow-up with <strong>${this.escape(reminder.customerName)}</strong>.</p>`];
    if (reminder.notes) {
      parts.push(`<p>${this.escape(reminder.notes).replace(/\n/g, '<br>')}</p>`);
    }
    parts.push(`<p><a href="${this.escape(producerLink)}">Open in Origination Workbench</a></p>`);
    return parts.join('');
  }

  /** The subject and notes are user-authored free text landing in an HTML body — escape them. */
  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
