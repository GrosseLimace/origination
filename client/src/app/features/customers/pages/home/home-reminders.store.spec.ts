import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { OutlookCalendarService } from '@core/services/outlook-calendar.service';
import type { Customer, Reminder, ReminderDue } from '@models';
import { HomePageState } from './home-page.state';
import { HomeRemindersStore } from './home-reminders.store';

function reminder(id: number, over: Partial<Reminder> = {}): Reminder {
  return {
    id, customerId: 1, customerName: 'P1', customerCode: 'S-1', dueAt: '2026-10-20T15:00:00Z', subject: 'Call',
    isCompleted: false, createdAt: '2026-10-14T00:00:00Z', ...over,
  };
}

const P1 = { id: 1, scoularId: 'S-1', name: 'P1' } as Customer;
const P2 = { id: 2, scoularId: 'S-2', name: 'P2' } as Customer;

describe('HomeRemindersStore', () => {
  let store: HomeRemindersStore;
  let page: HomePageState;
  let api: {
    getRemindersByCustomer: ReturnType<typeof vi.fn>;
    createReminder: ReturnType<typeof vi.fn>;
    updateReminder: ReturnType<typeof vi.fn>;
    setReminderCompleted: ReturnType<typeof vi.fn>;
    deleteReminder: ReturnType<typeof vi.fn>;
  };
  let appState: { setMyReminders: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let outlook: { addToOutlook: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = {
      getRemindersByCustomer: vi.fn((): Observable<Reminder[]> => of([])),
      createReminder: vi.fn((customerId: number, dueAt: string, subject?: string) =>
        of(reminder(900, { customerId, dueAt, subject: subject ?? '' }))),
      updateReminder: vi.fn((id: number) => of(reminder(id, { outlookEventId: 'evt' }))),
      setReminderCompleted: vi.fn((id: number, done: boolean) => of(reminder(id, { isCompleted: done }))),
      deleteReminder: vi.fn(() => of(undefined)),
    };
    appState = { setMyReminders: vi.fn() };
    toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
    outlook = { addToOutlook: vi.fn((): Observable<Reminder | null> => of(null)) };
    TestBed.configureTestingModule({
      providers: [
        HomePageState, HomeRemindersStore,
        { provide: ApiService, useValue: api },
        { provide: AppStateService, useValue: appState },
        { provide: ToastService, useValue: toast },
        { provide: OutlookCalendarService, useValue: outlook },
      ],
    });
    store = TestBed.inject(HomeRemindersStore);
    page = TestBed.inject(HomePageState);
    page.selectedCustomer.set(P1);
  });

  it('exposes its loading and saving flags read-only, so only the store can change them', () => {
    // Same rule as AppStateService: the page and the panels read these; only the store writes them.
    for (const flag of [store.isLoadingReminders, store.isSavingReminder, store.reminderSaveSucceededCounter]) {
      expect('set' in flag).toBe(false);
      expect('update' in flag).toBe(false);
    }
  });

  describe('loading a producer\'s follow-ups', () => {
    it('shows a spinner, then the producer\'s list', () => {
      const answer = new Subject<Reminder[]>();
      api.getRemindersByCustomer.mockReturnValue(answer);
      store.customerReminders.set([reminder(1)]);

      store.loadCustomerReminders(1);
      expect(store.customerReminders()).toEqual([]);
      expect(store.isLoadingReminders()).toBe(true);

      answer.next([reminder(5)]);
      expect(store.customerReminders().map(r => r.id)).toEqual([5]);
      expect(store.isLoadingReminders()).toBe(false);
    });

    it('drops an answer for a producer the user has moved off', () => {
      const answer = new Subject<Reminder[]>();
      api.getRemindersByCustomer.mockReturnValue(answer);
      store.loadCustomerReminders(1);

      page.selectedCustomer.set(P2);
      answer.next([reminder(5)]);

      expect(store.customerReminders()).toEqual([]);
    });

    it('is cancelled by a new selection', () => {
      const answer = new Subject<Reminder[]>();
      api.getRemindersByCustomer.mockReturnValue(answer);
      store.loadCustomerReminders(1);

      page.cancelSelection$.next();
      answer.next([reminder(5)]);

      expect(store.customerReminders()).toEqual([]);
    });

    it('clears the spinner on failure', () => {
      api.getRemindersByCustomer.mockReturnValue(throwError(() => new Error('500')));
      store.loadCustomerReminders(1);
      expect(store.isLoadingReminders()).toBe(false);
    });
  });

  describe('saving', () => {
    it('does nothing with no producer selected', () => {
      page.selectedCustomer.set(null);
      store.saveReminder({ dueAt: '2026-10-20T15:00:00Z', subject: 'x', notes: '' });
      expect(api.createReminder).not.toHaveBeenCalled();
      expect(store.isSavingReminder()).toBe(false);
    });

    it('creates: sorts it in, feeds the badge, bumps the counter, and reports an Outlook miss quietly', () => {
      store.customerReminders.set([reminder(1, { dueAt: '2026-10-25T00:00:00Z' })]);

      store.saveReminder({ dueAt: '2026-10-20T15:00:00Z', subject: '', notes: 'n' });

      expect(api.createReminder).toHaveBeenCalledWith(1, '2026-10-20T15:00:00Z', undefined, 'n');
      expect(store.customerReminders().map(r => r.id)).toEqual([900, 1]);
      expect(store.myReminders()).toEqual([{ id: 900, customerId: 1, customerCode: 'S-1', dueAt: '2026-10-20T15:00:00Z' }]);
      expect(appState.setMyReminders).toHaveBeenLastCalledWith(store.myReminders());
      expect(store.reminderSaveSucceededCounter()).toBe(1);
      expect(store.isSavingReminder()).toBe(false);
      expect(toast.success).toHaveBeenCalledWith('Follow-up added');
      expect(outlook.addToOutlook).toHaveBeenCalledWith(expect.objectContaining({ id: 900 }), `${window.location.origin}/?customerId=1`);
      expect(toast.info).toHaveBeenCalledWith('Follow-up saved. It could not be added to Outlook — use "Add to Outlook" to retry.');
    });

    it('records the Outlook event id when the calendar write succeeds', () => {
      outlook.addToOutlook.mockReturnValue(of(reminder(900, { outlookEventId: 'evt-1' })));
      store.saveReminder({ dueAt: '2026-10-20T15:00:00Z', subject: 'x', notes: '' });
      expect(store.customerReminders()[0].outlookEventId).toBe('evt-1');
      expect(toast.info).not.toHaveBeenCalled();
    });

    it('edits: replaces the row, and says so when the API could not move the Outlook event', () => {
      store.customerReminders.set([reminder(7)]);
      api.updateReminder.mockReturnValue(of(reminder(7, { subject: 'New', outlookEventId: 'evt', outlookEventMoved: false })));

      store.saveReminder({ id: 7, dueAt: '2026-10-21T15:00:00Z', subject: 'New', notes: '' });

      expect(api.updateReminder).toHaveBeenCalledWith(7, '2026-10-21T15:00:00Z', 'New', '', expect.any(String));
      expect(store.customerReminders()[0].subject).toBe('New');
      expect(toast.success).toHaveBeenCalledWith('Follow-up updated');
      expect(toast.info).toHaveBeenCalledWith('Saved, but the Outlook event could not be moved.');
      expect(outlook.addToOutlook).not.toHaveBeenCalled();
    });

    it('edits a reminder that never reached Outlook: tries the calendar again', () => {
      api.updateReminder.mockReturnValue(of(reminder(7, { outlookEventId: null })));
      store.saveReminder({ id: 7, dueAt: '2026-10-21T15:00:00Z', subject: 'x', notes: '' });
      expect(outlook.addToOutlook).toHaveBeenCalledTimes(1);
    });

    it('keeps the form open on failure', () => {
      api.createReminder.mockReturnValue(throwError(() => new Error('500')));
      store.saveReminder({ dueAt: '2026-10-20T15:00:00Z', subject: 'x', notes: '' });
      expect(store.isSavingReminder()).toBe(false);
      expect(store.reminderSaveSucceededCounter()).toBe(0);
    });
  });

  describe('completing, reopening and deleting', () => {
    beforeEach(() => {
      store.customerReminders.set([reminder(5), reminder(6, { dueAt: '2026-10-30T00:00:00Z' })]);
      store.myReminders.set([
        { id: 5, customerId: 1, dueAt: '2026-10-20T15:00:00Z' },
        { id: 6, customerId: 1, dueAt: '2026-10-30T00:00:00Z' },
      ] as ReminderDue[]);
    });

    it('completing moves it below the open ones and off the badge feed', () => {
      store.toggleReminderComplete(reminder(5));
      expect(api.setReminderCompleted).toHaveBeenCalledWith(5, true);
      expect(store.customerReminders().map(r => r.id)).toEqual([6, 5]);
      expect(store.myReminders().map(r => r.id)).toEqual([6]);
    });

    it('reopening puts it back on the badge feed', () => {
      store.myReminders.set([]);
      store.toggleReminderComplete(reminder(5, { isCompleted: true }));
      expect(api.setReminderCompleted).toHaveBeenCalledWith(5, false);
      expect(store.myReminders().map(r => r.id)).toEqual([5]);
    });

    it('deleting removes it everywhere and confirms', () => {
      store.deleteReminder(reminder(5));
      expect(store.customerReminders().map(r => r.id)).toEqual([6]);
      expect(store.myReminders().map(r => r.id)).toEqual([6]);
      expect(toast.success).toHaveBeenCalledWith('Follow-up deleted');
    });
  });

  describe('Add to Outlook (retry)', () => {
    it('confirms success and records the event id', () => {
      store.customerReminders.set([reminder(5)]);
      outlook.addToOutlook.mockReturnValue(of(reminder(5, { outlookEventId: 'evt-5' })));
      store.addReminderToOutlook(reminder(5));
      expect(store.customerReminders()[0].outlookEventId).toBe('evt-5');
      expect(toast.success).toHaveBeenCalledWith('Added to your Outlook calendar');
    });

    it('says plainly when it still could not be added', () => {
      store.addReminderToOutlook(reminder(5));
      expect(toast.info).toHaveBeenCalledWith('Could not add this to Outlook. Your follow-up is still saved here.');
    });
  });
});
