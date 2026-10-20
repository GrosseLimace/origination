import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { OutlookCalendarService } from '@core/services/outlook-calendar.service';
import { environment } from '@env/environment';
import type { Reminder, ReminderDue } from '@models';
import type { ReminderDraft } from '../../components/customer-reminders/customer-reminders.component';
import { HomePageState } from './home-page.state';
import { sortReminders } from './home-derivations';

/**
 * Personal follow-up reminders on the producer page: the selected producer's list, the signed-in
 * user's badge feed across producers, and the create / edit / complete / delete / Outlook handlers.
 * Provided by HomeComponent, which exposes these signals and delegates its handlers here.
 *
 * Every reminder here belongs to the signed-in user — the API returns nobody else's. The
 * running theme in these handlers: the DATABASE is the source of truth and the Outlook event
 * is a best-effort mirror. A calendar failure never blocks or rolls back the reminder; it just
 * leaves outlookEventId null, which surfaces as an "Add to Outlook" retry on the row.
 */
@Injectable()
export class HomeRemindersStore {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly outlookCalendar = inject(OutlookCalendarService);
  private readonly page = inject(HomePageState);
  private readonly destroyRef = inject(DestroyRef);

  /** Gates the personal follow-up reminders card and the producer-list reminder badge. Off until
   *  the API app registration has delegated Calendars.ReadWrite with admin consent — the API calls
   *  Graph on-behalf-of the user, so the permission lives there rather than on the SPA. */
  readonly remindersEnabled = environment.remindersEnabled;

  /** The signed-in user's own OPEN follow-ups across all producers — feeds the list badge.
   *  Private per user: the API only ever returns the caller's own. */
  readonly myReminders = signal<ReminderDue[]>([]);
  /** The signed-in user's open follow-ups for the SELECTED producer only. Unlike notes this is
   *  not walked across the linked-producer group: a follow-up is about the one producer it was
   *  set on, and showing a linked producer's reminders here would make "complete" ambiguous. */
  readonly customerReminders = signal<Reminder[]>([]);
  readonly isLoadingReminders = signal(false);
  readonly isSavingReminder = signal(false);
  /** Incremented on each successful reminder save so the card closes and resets its form. */
  readonly reminderSaveSucceededCounter = signal(0);

  /** Loads the caller's reminders for one producer. No cache: the list is small, and a stale
   *  due date is worse than a re-fetch. */
  loadCustomerReminders(customerId: number): void {
    if (!this.remindersEnabled) return;

    this.customerReminders.set([]);
    this.isLoadingReminders.set(true);
    this.apiService.getRemindersByCustomer(customerId)
      .pipe(takeUntil(this.page.cancelSelection$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reminders) => {
          if (this.page.selectedCustomer()?.id !== customerId) return;
          this.customerReminders.set(reminders);
          this.isLoadingReminders.set(false);
        },
        error: () => this.isLoadingReminders.set(false)
      });
  }

  /** Create or edit, depending on whether the draft carries an id. */
  saveReminder(draft: ReminderDraft): void {
    const customer = this.page.selectedCustomer();
    if (!customer) return;

    this.isSavingReminder.set(true);

    if (draft.id === undefined) {
      this.apiService.createReminder(customer.id, draft.dueAt, draft.subject || undefined, draft.notes)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (created) => {
            this.customerReminders.update(list => sortReminders([...list, created]));
            this._addMyReminder(created);
            this.isSavingReminder.set(false);
            this.reminderSaveSucceededCounter.update(n => n + 1);
            this.toastService.success('Follow-up added');
            this._syncReminderToOutlook(created);
          },
          error: () => this.isSavingReminder.set(false)
        });
      return;
    }

    const id = draft.id;
    this.apiService.updateReminder(id, draft.dueAt, draft.subject || undefined, draft.notes,
      OutlookCalendarService.currentTimeZone())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.customerReminders.update(list => sortReminders(list.map(r => r.id === id ? updated : r)));
          this._addMyReminder(updated);
          this.isSavingReminder.set(false);
          this.reminderSaveSucceededCounter.update(n => n + 1);
          this.toastService.success('Follow-up updated');

          // The API moved the calendar event in the same call — it patches the window rather than
          // recreating the event, because a delete-and-recreate shows the original slot as
          // "Canceled". All that is left here is to report a move that did not take.
          if (updated.outlookEventId) {
            if (updated.outlookEventMoved === false) {
              this.toastService.info('Saved, but the Outlook event could not be moved.');
            }
          } else {
            this._syncReminderToOutlook(updated);
          }
        },
        error: () => this.isSavingReminder.set(false)
      });
  }

  toggleReminderComplete(reminder: Reminder): void {
    const next = !reminder.isCompleted;
    this.apiService.setReminderCompleted(reminder.id, next)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(updated => {
        // A completed reminder stays on the calendar on purpose: deleting the event makes Outlook
        // render it as "Canceled", which reads as "this never happened" rather than "done".
        this.customerReminders.update(list => sortReminders(list.map(r => r.id === reminder.id ? updated : r)));
        if (next) {
          this._removeMyReminder(reminder.id);
        } else {
          this._addMyReminder(updated);
        }
      });
  }

  deleteReminder(reminder: Reminder): void {
    this.apiService.deleteReminder(reminder.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.customerReminders.update(list => list.filter(r => r.id !== reminder.id));
        this._removeMyReminder(reminder.id);
        this.toastService.success('Follow-up deleted');
        // The API removes the calendar event in the same call. Deleting is the only path that does
        // so: completing a reminder deliberately leaves the event, because removing it makes Outlook
        // render the slot as "Canceled", which reads as "this never happened" rather than "done".
      });
  }

  /** Retry path for a reminder saved while Outlook was unavailable or consent was declined. */
  addReminderToOutlook(reminder: Reminder): void {
    this._syncReminderToOutlook(reminder, true);
  }

  /**
   * Writes the reminder to the user's own calendar and records the event id. Silent on failure
   * during an automatic save (the row already offers a retry); explicit about it when the user
   * pressed "Add to Outlook" and is waiting for an answer.
   */
  private _syncReminderToOutlook(reminder: Reminder, userInitiated = false): void {
    const link = `${window.location.origin}/?customerId=${reminder.customerId}`;

    // One call now: the API writes the event on-behalf-of the user AND records the id, so there is
    // no window where the event exists but the row does not know about it.
    this.outlookCalendar.addToOutlook(reminder, link)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(updated => {
        // A null event id means the calendar could not be written; the row keeps its retry button.
        if (!updated?.outlookEventId) {
          this.toastService.info(
            userInitiated
              ? 'Could not add this to Outlook. Your follow-up is still saved here.'
              : 'Follow-up saved. It could not be added to Outlook — use "Add to Outlook" to retry.'
          );
          return;
        }

        this.customerReminders.update(list => list.map(r => r.id === updated.id ? updated : r));
        if (userInitiated) this.toastService.success('Added to your Outlook calendar');
      });
  }

  /** Keeps the badge feed in step locally so the list updates without a round trip. */
  private _addMyReminder(reminder: Reminder): void {
    const row: ReminderDue = {
      id: reminder.id,
      customerId: reminder.customerId,
      customerCode: reminder.customerCode,
      dueAt: reminder.dueAt,
    };
    const next = [...this.myReminders().filter(r => r.id !== reminder.id), ...(reminder.isCompleted ? [] : [row])];
    this.myReminders.set(next);
    this.appState.setMyReminders(next);
  }

  private _removeMyReminder(reminderId: number): void {
    const next = this.myReminders().filter(r => r.id !== reminderId);
    this.myReminders.set(next);
    this.appState.setMyReminders(next);
  }
}
