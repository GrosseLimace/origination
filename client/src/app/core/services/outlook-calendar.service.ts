// Angular core
import { inject, Injectable } from '@angular/core';

// RxJS
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

// Services / models
import { ApiService } from '@core/services/api.service';
import { Reminder } from '@models';

/**
 * Puts a producer follow-up on the signed-in user's own Outlook calendar.
 *
 * The write itself happens in our API, which calls Microsoft Graph on-behalf-of the user. This used
 * to run here in the browser with a delegated token acquired through MSAL. IT Security moved it
 * server-side on 2026-09-15: delegated Graph permissions live on the API registration across the
 * fleet, and anything added by hand to a SPA registration is wiped when their config reconciler next
 * runs. The boundary is unchanged — the user's identity flows through the exchange, so it is still
 * their own calendar and nobody else's.
 *
 * Two things got better in the move. There is no consent popup any more, so a half-filled reminder
 * form can no longer be interrupted by an auth dialog. And rescheduling and deleting now happen
 * inside the save and delete calls, so the browser makes one request where it used to make two.
 *
 * NOTHING here throws. A calendar write is a best-effort side effect of saving a reminder: if
 * consent is missing or Graph is down, the reminder still saves and the row shows an "Add to
 * Outlook" retry.
 */
@Injectable({ providedIn: 'root' })
export class OutlookCalendarService {
  private readonly api = inject(ApiService);

  /**
   * Adds an already-saved reminder to the calendar and resolves the updated reminder.
   *
   * The returned reminder still has a null `outlookEventId` when the calendar could not be written,
   * which is the signal the row uses to keep offering the retry.
   */
  addToOutlook(reminder: Reminder, producerLink: string): Observable<Reminder | null> {
    return this.api
      .addReminderToOutlook(reminder.id, {
        // The server has no idea where the user is sitting, and Graph wants a local literal plus a
        // zone name — so the browser's own IANA zone is the only correct source for this.
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        producerLink,
      })
      .pipe(catchError(() => of(null)));
  }

  /** The browser's IANA time zone, sent with a save so the API can move an existing event. */
  static currentTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
}
