import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import type { Note, NoteLastContact, ReminderDue } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';
import { HandledErrorReporter } from '@core/services/handled-error-reporter.service';
import { EngagementApiService } from './engagement-api.service';
import { EngagementStore } from './engagement.store';

/** The notes, the last-contact summary and the user's follow-ups every screen shares. */
describe('EngagementStore', () => {
  let store: EngagementStore;
  let api: { getNotesLastContact: ReturnType<typeof vi.fn<() => Observable<NoteLastContact[]>>> };
  let reporter: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = { getNotesLastContact: vi.fn(() => of([{ customerId: 1, lastNoteAt: new Date() }] as NoteLastContact[])) };
    reporter = { send: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: EngagementApiService, useValue: api }, { provide: HandledErrorReporter, useValue: reporter }],
    });
    store = TestBed.inject(EngagementStore);
  });

  it('marks the full notes read, whether or not there are any, until they are dropped', () => {
    store.setNotes([]);
    expect(store.notesLoaded()).toBe(true);

    store.clearNotesCache();
    expect(store.notesLoaded()).toBe(false);
  });

  // With no trade unit selected the preload doesn't run, so the customer list's badges ask.
  it('reads the last-contact summary once when asked, however many rows ask', () => {
    store.ensureLastContacts();
    store.ensureLastContacts();

    expect(api.getNotesLastContact).toHaveBeenCalledTimes(1);
    expect(store.noteLastContacts().map(r => r.customerId)).toEqual([1]);
  });

  it('records a failed read of the summary, empties it, and tells App Insights', () => {
    const error = new Error('500');
    store.setNoteLastContacts([{ customerId: 9, lastNoteAt: new Date() }]);
    api.getNotesLastContact.mockReturnValue(throwError(() => error));

    store.ensureLastContacts();

    expect(store.noteLastContactsLoadFailed()).toBe(true);
    expect(store.noteLastContacts()).toEqual([]);
    expect(reporter.send).toHaveBeenCalledWith('Engagement: failed to load last-contacted dates', error);
  });

  it('a new trade-unit read clears the last one’s failures', () => {
    store.setNoteLastContactsLoadFailed(true);
    store.setMyRemindersLoadFailed(true);

    store.clearLoadFailures();

    expect([store.noteLastContactsLoadFailed(), store.myRemindersLoadFailed()]).toEqual([false, false]);
  });

  it('drops everything at sign-out, and the summary is read again when next asked', () => {
    store.ensureLastContacts();
    store.setNotes([{ id: 1 } as Note]);
    store.setMyReminders([{ id: 5 } as ReminderDue]);
    store.setMyRemindersLoadFailed(true);

    TestBed.inject(SessionReset).reset();

    expect(store.notes()).toEqual([]);
    expect(store.notesLoaded()).toBe(false);
    expect(store.noteLastContacts()).toEqual([]);
    expect(store.myReminders()).toEqual([]);
    expect(store.myRemindersLoadFailed()).toBe(false);
    store.ensureLastContacts();
    expect(api.getNotesLastContact).toHaveBeenCalledTimes(2);
  });
});
