import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, Subject, of, throwError } from 'rxjs';
import type { Customer, Note, NoteLastContact, Reminder, ReminderDue } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { ToastService } from '@core/services/toast.service';
import { CustomerStore, CustomersApiService } from '@features/customers';
import { ProducerProfilesFake, producerProfile, producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { CustomerEngagementStore } from './customer-engagement.store';
import { EngagementApiService } from './engagement-api.service';
import { EngagementStore } from './engagement.store';
import { OutlookCalendarService } from './outlook-calendar.service';

function note(id: number, customerId: number, createdAt: string, over: Partial<Note> = {}): Note {
  return {
    id, customerId, customerName: `P${customerId}`, customerCode: `S-${customerId}`, content: `n${id}`, isPinned: false,
    createdBy: 't', createdAt: createdAt as unknown as Date, ...over,
  };
}

function reminder(id: number, over: Partial<Reminder> = {}): Reminder {
  return {
    id, customerId: 1, customerName: 'P1', customerCode: 'S-1', dueAt: '2026-10-20T15:00:00Z', subject: 'Call',
    isCompleted: false, createdAt: '2026-10-14T00:00:00Z', ...over,
  };
}

const P1 = { id: 1, scoularId: 'S-1', name: 'P1' } as Customer;
const P2 = { id: 2, scoularId: 'S-2', name: 'P2' } as Customer;
const P3 = { id: 3, scoularId: 'S-3', name: 'P3' } as Customer;

/**
 * The selected customer's notes, with their linked group's, and the user's follow-ups for them, which the Notes and My
 * follow-ups cards and the producer panels read.
 */
describe('CustomerEngagementStore', () => {
  let store: CustomerEngagementStore;
  let shared: EngagementStore;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let toast: { success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let outlook: { addToOutlook: ReturnType<typeof vi.fn> };
  let profiles: ProducerProfilesFake;

  const shown = () => store.notes().map(n => n.id);
  const readsOf = (id: number) => api['getNotesByCustomer'].mock.calls.filter(args => args[0] === id).length;
  /** Links producer 1 to producer 2 in their saved details, so 2 joins 1's group. */
  const linkOneToTwo = () => { profiles.put(producerProfile(1, { linkedProducerIds: 'S-2' })); TestBed.tick(); };

  beforeEach(() => {
    api = {
      getNotesByCustomer: vi.fn((_id: number): Observable<Note[]> => of([])),
      getNotesLastContact: vi.fn((): Observable<NoteLastContact[]> => of([])),
      createNote: vi.fn((customerId: number, content: string) => of(note(500, customerId, '2026-10-14T12:00:00', { content }))),
      toggleNotePin: vi.fn((id: number) => of(note(id, 1, '2026-09-01T00:00:00', { isPinned: true }))),
      updateNote: vi.fn((id: number, content: string) => of(note(id, 1, '2026-10-01T00:00:00', { content }))),
      deleteNote: vi.fn(() => of(undefined)),
      getRemindersByCustomer: vi.fn((): Observable<Reminder[]> => of([])),
      createReminder: vi.fn((customerId: number, dueAt: string, subject?: string) =>
        of(reminder(900, { customerId, dueAt, subject: subject ?? '' }))),
      updateReminder: vi.fn((id: number) => of(reminder(id, { outlookEventId: 'evt' }))),
      setReminderCompleted: vi.fn((id: number, done: boolean) => of(reminder(id, { isCompleted: done }))),
      deleteReminder: vi.fn(() => of(undefined)),
    };
    toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
    outlook = { addToOutlook: vi.fn((): Observable<Reminder | null> => of(null)) };
    profiles = producerProfilesFake();
    TestBed.configureTestingModule({
      providers: [
        { provide: EngagementApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: OutlookCalendarService, useValue: outlook },
        { provide: CustomersApiService, useValue: {} },
        provideProducerProfiles(profiles),
      ],
    });
    TestBed.inject(TradeUnitContext).setTradeUnits(['TU1']);
    TestBed.inject(CustomerStore).setCustomers([P1, P2, P3]);
    store = TestBed.inject(CustomerEngagementStore);
    shared = TestBed.inject(EngagementStore);
    TestBed.tick();
  });

  it('exposes its loading and saving state read-only, so only the store changes it', () => {
    for (const flag of [store.isLoadingNotes, store.isSavingNote, store.noteSaveSucceededCounter, store.isLoadingReminders,
      store.isSavingReminder, store.reminderSaveSucceededCounter, store.notes, store.reminders]) {
      expect('set' in flag).toBe(false);
    }
  });

  describe('the notes', () => {
    it("reads the customer's and their linked group's, newest first, and keeps the last-contact summary in step", () => {
      profiles.put(producerProfile(1, { linkedProducerIds: 'S-2' }));
      api['getNotesByCustomer'].mockImplementation((id: number) =>
        of(id === 1 ? [note(1, 1, '2026-10-01T00:00:00')] : [note(2, 2, '2026-10-05T00:00:00')]));

      store.select(P1);

      expect(api['getNotesByCustomer'].mock.calls.map(c => c[0])).toEqual([1, 2]);
      expect(shown()).toEqual([2, 1]);
      expect(store.isLoadingNotes()).toBe(false);
      expect(shared.noteLastContacts().map(r => r.customerId).sort()).toEqual([1, 2]);
    });

    it("reads the notes of a producer who joins the group later, as the links land", () => {
      api['getNotesByCustomer'].mockImplementation((id: number) => of([note(id * 10, id, '2026-10-01T00:00:00')]));
      store.select(P1);
      expect(shown()).toEqual([10]);

      linkOneToTwo();

      expect(readsOf(2)).toBe(1);
      expect(shown().sort()).toEqual([10, 20]);
    });

    it('keeps the spinner up while a cold read is in flight', () => {
      api['getNotesByCustomer'].mockReturnValue(NEVER);
      store.select(P1);
      expect(store.isLoadingNotes()).toBe(true);
    });

    // A selection can ask for notes more than once (details landing, the linked walk). A later ask mustn't drop the
    // spinner while an earlier read still has nothing on screen: that flashed "No notes yet" before they arrived.
    it('keeps the spinner up until the last of two overlapping cold reads answers', () => {
      const forOne = new Subject<Note[]>();
      const forTwo = new Subject<Note[]>();
      api['getNotesByCustomer'].mockImplementation((id: number) => (id === 1 ? forOne : forTwo).asObservable());
      store.select(P1);
      linkOneToTwo();

      forTwo.next([]);
      forTwo.complete();
      expect(store.isLoadingNotes()).toBe(true);

      forOne.next([note(1, 1, '2026-10-01T00:00:00')]);
      forOne.complete();
      expect(store.isLoadingNotes()).toBe(false);
    });

    it('a new selection is not held up by reads left over from the one before, which never land', () => {
      const late = new Subject<Note[]>();
      api['getNotesByCustomer'].mockReturnValueOnce(late);
      store.select(P1);
      api['getNotesByCustomer'].mockReturnValue(of([note(2, 2, '2026-10-01T00:00:00')]));

      store.select(P2);
      late.next([note(1, 1, '2026-10-01T00:00:00')]);
      late.complete();

      expect(store.isLoadingNotes()).toBe(false);
      expect(shown()).toEqual([2]);
    });

    it('a later selection shows what is kept at once with no spinner, then reads it again once', () => {
      const older = note(1, 1, '2026-09-01T00:00:00');
      const newer = note(2, 1, '2026-10-01T00:00:00');
      api['getNotesByCustomer'].mockReturnValue(of([older]));
      store.select(P1);
      store.select(P2);
      const second = new Subject<Note[]>();
      api['getNotesByCustomer'].mockReturnValue(second);

      store.select(P1);
      expect(shown()).toEqual([1]);
      expect(store.isLoadingNotes()).toBe(false);
      expect(readsOf(1)).toBe(2);

      second.next([older, newer]);
      second.complete();
      expect(shown()).toEqual([2, 1]);
    });

    it('does not keep a failed read as "no notes": the next selection shows the spinner and reads again', () => {
      api['getNotesByCustomer'].mockReturnValue(throwError(() => new Error('500')));
      store.select(P1);
      expect(store.isLoadingNotes()).toBe(false);
      expect(shown()).toEqual([]);

      api['getNotesByCustomer'].mockReturnValue(NEVER);
      store.select(P2);
      store.select(P1);

      expect(store.isLoadingNotes()).toBe(true);
      expect(readsOf(1)).toBe(2);
    });

    it('reads a failed one again when the group next grows, in the same selection', () => {
      api['getNotesByCustomer'].mockReturnValueOnce(throwError(() => new Error('500')));
      store.select(P1);
      api['getNotesByCustomer'].mockImplementation((id: number) => of([note(id * 10, id, '2026-10-01T00:00:00')]));

      linkOneToTwo();

      expect(readsOf(1)).toBe(2);
      expect(shown().sort()).toEqual([10, 20]);
    });

    it('a new selection of trade units forgets the kept notes, so the next selection reads with nothing to show', () => {
      api['getNotesByCustomer'].mockReturnValue(of([note(1, 1, '2026-10-01T00:00:00')]));
      store.select(P1);
      store.select(null);

      TestBed.inject(TradeUnitContext).setTradeUnits(['TU2']);
      TestBed.tick();
      api['getNotesByCustomer'].mockReturnValue(NEVER);
      store.select(P1);

      expect(shown()).toEqual([]);
      expect(store.isLoadingNotes()).toBe(true);
    });

    it("keeps the last-contact summary in step with what a customer's fresh notes say", () => {
      shared.setNoteLastContacts([{ customerId: 1, lastNoteAt: new Date('2026-01-01T00:00:00Z') }]);
      api['getNotesByCustomer'].mockReturnValue(of([note(2, 1, '2026-10-01T12:00:00')]));

      store.select(P1);

      expect(shared.noteLastContacts().map(r => r.customerId)).toEqual([1]);
      expect(shared.noteLastContacts()[0].lastNoteAt).toEqual(new Date('2026-10-01T12:00:00Z'));
    });

    it('the same customer again keeps what is shown and reads nothing, taking the customer as they now are', () => {
      store.select(P1);
      store.select({ ...P1, isOnboardCandidate: true });

      expect(readsOf(1)).toBe(1);
      store.addNote({ content: 'x', mentions: [] });
      expect(api['createNote']).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Assign a trade unit and save this producer before adding notes.');
    });
  });

  describe('the note actions', () => {
    beforeEach(() => store.select(P1));

    it('adding puts it in the panel and the last-contact summary, and clears the form', () => {
      store.addNote({ content: 'called', mentions: [] });

      expect(api['createNote']).toHaveBeenCalledWith(1, 'called', 'TU1', []);
      expect(shown()).toEqual([500]);
      expect(shared.noteLastContacts().map(r => r.customerId)).toEqual([1]);
      expect(store.noteSaveSucceededCounter()).toBe(1);
      expect(store.isSavingNote()).toBe(false);
      expect(toast.success).toHaveBeenCalledWith('Note added');
    });

    it('tags the note with the trade unit only when exactly one is selected', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['TU1', 'TU2']);
      store.addNote({ content: 'b', mentions: [] });
      expect(api['createNote']).toHaveBeenLastCalledWith(1, 'b', undefined, []);
    });

    it("mirrors into the trade units' notes once those have been read", () => {
      store.addNote({ content: 'a', mentions: [] });
      expect(shared.notesLoaded()).toBe(false);

      shared.setNotes([note(9, 3, '2026-01-01T00:00:00')]);
      store.addNote({ content: 'b', mentions: [] });
      expect(shared.notes().map(n => n.id)).toEqual([9, 500]);
    });

    it("a failed add keeps the typed text (no counter bump) and shows the server's reason", () => {
      api['createNote'].mockReturnValue(throwError(() => new Error('That group is no longer available.')));

      store.addNote({ content: 'x', mentions: [] });

      expect(toast.error).toHaveBeenCalledWith('That group is no longer available.');
      expect(store.noteSaveSucceededCounter()).toBe(0);
      expect(store.isSavingNote()).toBe(false);
    });

    it('ignores a second add while one is saving', () => {
      api['createNote'].mockReturnValue(NEVER);
      store.addNote({ content: 'one', mentions: [] });
      store.addNote({ content: 'two', mentions: [] });
      expect(api['createNote']).toHaveBeenCalledTimes(1);
      expect(store.isSavingNote()).toBe(true);
    });

    it('does nothing with no customer selected', () => {
      store.select(null);
      store.addNote({ content: 'a', mentions: [] });
      expect(api['createNote']).not.toHaveBeenCalled();
    });

    it('pinning moves a note to the top; editing replaces its text', () => {
      api['getNotesByCustomer'].mockReturnValue(of([note(1, 1, '2026-09-01T00:00:00'), note(2, 1, '2026-10-01T00:00:00')]));
      store.select(P2);
      store.select(P1);
      expect(shown()).toEqual([2, 1]);

      store.toggleNotePin(note(1, 1, '2026-09-01T00:00:00'));
      expect(shown()).toEqual([1, 2]);
      expect(toast.success).toHaveBeenCalledWith('Note pinned');

      store.editNote({ noteId: 2, content: 'edited', mentions: [] });
      expect(store.notes().find(n => n.id === 2)?.content).toBe('edited');
      expect(toast.success).toHaveBeenCalledWith('Note updated');
    });

    it("deleting a linked producer's note drops that producer back to never contacted, everywhere", () => {
      api['getNotesByCustomer'].mockImplementation((id: number) => of(id === 2 ? [note(7, 2, '2026-10-01T00:00:00')] : []));
      shared.setNotes([note(7, 2, '2026-10-01T00:00:00'), note(9, 3, '2026-10-01T00:00:00')]);
      linkOneToTwo();
      expect(shared.noteLastContacts().map(r => r.customerId)).toEqual([2]);

      store.deleteNote(7);

      expect(shown()).toEqual([]);
      expect(shared.noteLastContacts()).toEqual([]);
      expect(shared.notes().map(n => n.id)).toEqual([9]);
      expect(toast.success).toHaveBeenCalledWith('Note deleted');
    });

    it('reports a failed pin, edit or delete', () => {
      api['toggleNotePin'].mockReturnValue(throwError(() => new Error('x')));
      api['updateNote'].mockReturnValue(throwError(() => new Error('Group gone.')));
      api['deleteNote'].mockReturnValue(throwError(() => new Error('x')));

      store.toggleNotePin(note(1, 1, '2026-10-01T00:00:00'));
      store.editNote({ noteId: 1, content: 'c', mentions: [] });
      store.deleteNote(1);

      expect(toast.error.mock.calls.map(c => c[0])).toEqual(['Failed to update note', 'Group gone.', 'Failed to delete note']);
    });
  });

  describe("the user's follow-ups", () => {
    it('shows a spinner, then the customer’s list, and not their linked group’s', () => {
      profiles.put(producerProfile(1, { linkedProducerIds: 'S-2' }));
      const answer = new Subject<Reminder[]>();
      api['getRemindersByCustomer'].mockReturnValue(answer);

      store.select(P1);
      expect(store.isLoadingReminders()).toBe(true);
      answer.next([reminder(5)]);

      expect(store.reminders().map(r => r.id)).toEqual([5]);
      expect(store.isLoadingReminders()).toBe(false);
      expect(api['getRemindersByCustomer'].mock.calls.map(c => c[0])).toEqual([1]);
    });

    it('drops an answer for a customer the user has moved off', () => {
      const answer = new Subject<Reminder[]>();
      api['getRemindersByCustomer'].mockReturnValueOnce(answer);
      store.select(P1);

      store.select(P2);
      answer.next([reminder(5)]);

      expect(store.reminders()).toEqual([]);
    });

    it('clears the spinner on failure', () => {
      api['getRemindersByCustomer'].mockReturnValue(throwError(() => new Error('500')));
      store.select(P1);
      expect(store.isLoadingReminders()).toBe(false);
    });

    it('saves nothing with no customer selected', () => {
      store.saveReminder({ dueAt: '2026-10-20T15:00:00Z', subject: 'x', notes: '' });
      expect(api['createReminder']).not.toHaveBeenCalled();
      expect(store.isSavingReminder()).toBe(false);
    });

    describe('for a selected customer', () => {
      beforeEach(() => {
        api['getRemindersByCustomer'].mockReturnValue(of([reminder(5), reminder(6, { dueAt: '2026-10-30T00:00:00Z' })]));
        shared.setMyReminders([
          { id: 5, customerId: 1, dueAt: '2026-10-20T15:00:00Z' },
          { id: 6, customerId: 1, dueAt: '2026-10-30T00:00:00Z' },
        ] as ReminderDue[]);
        store.select(P1);
      });

      it('creating sorts it in, feeds the badge, bumps the counter, and reports an Outlook miss quietly', () => {
        store.saveReminder({ dueAt: '2026-10-19T15:00:00Z', subject: '', notes: 'n' });

        expect(api['createReminder']).toHaveBeenCalledWith(1, '2026-10-19T15:00:00Z', undefined, 'n');
        expect(store.reminders().map(r => r.id)).toEqual([900, 5, 6]);
        expect(shared.myReminders().map(r => r.id)).toEqual([5, 6, 900]);
        expect(store.reminderSaveSucceededCounter()).toBe(1);
        expect(store.isSavingReminder()).toBe(false);
        expect(toast.success).toHaveBeenCalledWith('Follow-up added');
        expect(outlook.addToOutlook).toHaveBeenCalledWith(expect.objectContaining({ id: 900 }), `${window.location.origin}/?customerId=1`);
        expect(toast.info).toHaveBeenCalledWith('Follow-up saved. It could not be added to Outlook — use "Add to Outlook" to retry.');
      });

      it('records the Outlook event id when the calendar write succeeds', () => {
        outlook.addToOutlook.mockReturnValue(of(reminder(900, { outlookEventId: 'evt-1' })));
        store.saveReminder({ dueAt: '2026-10-19T15:00:00Z', subject: 'x', notes: '' });
        expect(store.reminders().find(r => r.id === 900)?.outlookEventId).toBe('evt-1');
        expect(toast.info).not.toHaveBeenCalled();
      });

      it('editing replaces the row, and says so when the API could not move the Outlook event', () => {
        api['updateReminder'].mockReturnValue(of(reminder(5, { subject: 'New', outlookEventId: 'evt', outlookEventMoved: false })));

        store.saveReminder({ id: 5, dueAt: '2026-10-21T15:00:00Z', subject: 'New', notes: '' });

        expect(api['updateReminder']).toHaveBeenCalledWith(5, '2026-10-21T15:00:00Z', 'New', '', expect.any(String));
        expect(store.reminders().find(r => r.id === 5)?.subject).toBe('New');
        expect(toast.success).toHaveBeenCalledWith('Follow-up updated');
        expect(toast.info).toHaveBeenCalledWith('Saved, but the Outlook event could not be moved.');
        expect(outlook.addToOutlook).not.toHaveBeenCalled();
      });

      it('editing one that never reached Outlook tries the calendar again', () => {
        api['updateReminder'].mockReturnValue(of(reminder(5, { outlookEventId: null })));
        store.saveReminder({ id: 5, dueAt: '2026-10-21T15:00:00Z', subject: 'x', notes: '' });
        expect(outlook.addToOutlook).toHaveBeenCalledTimes(1);
      });

      it('keeps the form open on failure', () => {
        api['createReminder'].mockReturnValue(throwError(() => new Error('500')));
        store.saveReminder({ dueAt: '2026-10-20T15:00:00Z', subject: 'x', notes: '' });
        expect(store.isSavingReminder()).toBe(false);
        expect(store.reminderSaveSucceededCounter()).toBe(0);
      });

      it('completing moves it below the open ones and off the badge feed; reopening puts it back', () => {
        store.toggleReminderComplete(reminder(5));
        expect(api['setReminderCompleted']).toHaveBeenCalledWith(5, true);
        expect(store.reminders().map(r => r.id)).toEqual([6, 5]);
        expect(shared.myReminders().map(r => r.id)).toEqual([6]);

        store.toggleReminderComplete(reminder(5, { isCompleted: true }));
        expect(shared.myReminders().map(r => r.id).sort()).toEqual([5, 6]);
      });

      it('deleting removes it everywhere and confirms', () => {
        store.deleteReminder(reminder(5));
        expect(store.reminders().map(r => r.id)).toEqual([6]);
        expect(shared.myReminders().map(r => r.id)).toEqual([6]);
        expect(toast.success).toHaveBeenCalledWith('Follow-up deleted');
      });

      it('Add to Outlook confirms and records the event id, and says plainly when it still could not', () => {
        outlook.addToOutlook.mockReturnValueOnce(of(reminder(5, { outlookEventId: 'evt-5' })));
        store.addReminderToOutlook(reminder(5));
        expect(store.reminders().find(r => r.id === 5)?.outlookEventId).toBe('evt-5');
        expect(toast.success).toHaveBeenCalledWith('Added to your Outlook calendar');

        store.addReminderToOutlook(reminder(6));
        expect(toast.info).toHaveBeenCalledWith('Could not add this to Outlook. Your follow-up is still saved here.');
      });
    });
  });

  it('forgets the selection and every kept note at sign-out', () => {
    api['getNotesByCustomer'].mockReturnValue(of([note(1, 1, '2026-10-01T00:00:00')]));
    store.select(P1);

    TestBed.inject(SessionReset).reset();

    expect(shown()).toEqual([]);
    api['getNotesByCustomer'].mockReturnValue(NEVER);
    store.select(P1);
    expect(store.isLoadingNotes()).toBe(true);
  });
});
