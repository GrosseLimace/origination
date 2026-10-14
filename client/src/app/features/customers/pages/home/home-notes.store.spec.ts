import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, Subject, of, throwError } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import type { Customer, Note, NoteLastContact } from '@models';
import { HomeBackgroundFailures } from './home-background-failures';
import { HomePageState } from './home-page.state';
import { HomeNotesStore } from './home-notes.store';

function note(id: number, customerId: number, createdAt: string, over: Partial<Note> = {}): Note {
  return {
    id, customerId, customerName: `P${customerId}`, customerCode: `S-${customerId}`, content: `n${id}`, isPinned: false,
    createdBy: 't', createdAt: createdAt as unknown as Date, ...over,
  };
}

describe('HomeNotesStore', () => {
  let store: HomeNotesStore;
  let page: HomePageState;
  let api: {
    getNotesByCustomer: ReturnType<typeof vi.fn>;
    getNotesLastContact: ReturnType<typeof vi.fn>;
    createNote: ReturnType<typeof vi.fn>;
    toggleNotePin: ReturnType<typeof vi.fn>;
    updateNote: ReturnType<typeof vi.fn>;
    deleteNote: ReturnType<typeof vi.fn>;
  };
  let appState: {
    notes: ReturnType<typeof signal<Note[]>>;
    notesLoaded: ReturnType<typeof signal<boolean>>;
    setNotes: ReturnType<typeof vi.fn>;
    setNoteLastContacts: ReturnType<typeof vi.fn>;
    setNoteLastContactsLoadFailed: ReturnType<typeof vi.fn>;
  };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let failures: { report: ReturnType<typeof vi.fn> };
  let refreshPanel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    api = {
      getNotesByCustomer: vi.fn((): Observable<Note[]> => of([])),
      getNotesLastContact: vi.fn((): Observable<NoteLastContact[]> => of([])),
      createNote: vi.fn((customerId: number, content: string) =>
        of(note(500, customerId, '2026-10-14T12:00:00', { content }))),
      toggleNotePin: vi.fn((id: number) => of(note(id, 1, '2026-09-01T00:00:00', { isPinned: true }))),
      updateNote: vi.fn((id: number, content: string) => of(note(id, 1, '2026-10-01T00:00:00', { content }))),
      deleteNote: vi.fn(() => of(undefined)),
    };
    const notes = signal<Note[]>([]);
    const notesLoaded = signal(false);
    appState = {
      notes, notesLoaded,
      setNotes: vi.fn((v: Note[]) => { notes.set(v); notesLoaded.set(true); }),
      setNoteLastContacts: vi.fn(),
      setNoteLastContactsLoadFailed: vi.fn(),
    };
    toast = { success: vi.fn(), error: vi.fn() };
    failures = { report: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        HomePageState, HomeNotesStore,
        { provide: ApiService, useValue: api },
        { provide: AppStateService, useValue: appState },
        { provide: ToastService, useValue: toast },
        { provide: HomeBackgroundFailures, useValue: failures },
      ],
    });
    store = TestBed.inject(HomeNotesStore);
    page = TestBed.inject(HomePageState);
    page.selectedCustomer.set({ id: 1, scoularId: 'S-1', name: 'P1' } as Customer);
    page.selectedTradeUnits.set(['TU1']);
    refreshPanel = vi.fn();
  });

  describe('ensureCustomerNotes', () => {
    it('cold: shows the spinner, reads every group member, caches them, refreshes the panel and the badge feed', () => {
      api.getNotesByCustomer.mockImplementation((id: number) =>
        of(id === 1 ? [note(1, 1, '2026-10-01T00:00:00')] : [note(2, 2, '2026-10-05T00:00:00')]));
      const answers: boolean[] = [];
      refreshPanel.mockImplementation(() => answers.push(store.isLoadingNotes()));

      store.ensureCustomerNotes([1, 2], refreshPanel);
      store.showNotesFor([1, 2]);

      expect(api.getNotesByCustomer.mock.calls.map(c => c[0])).toEqual([1, 2]);
      expect(answers).toEqual([false]); // called once, after the spinner dropped
      expect(store.customerNotes().map(n => n.id)).toEqual([2, 1]);
      expect(store.noteLastContacts().map(r => r.customerId).sort()).toEqual([1, 2]);
      expect(appState.setNoteLastContacts).toHaveBeenCalled();
    });

    it('keeps the spinner up while a cold read is in flight', () => {
      api.getNotesByCustomer.mockReturnValue(NEVER);
      store.ensureCustomerNotes([1], refreshPanel);
      expect(store.isLoadingNotes()).toBe(true);
      expect(refreshPanel).not.toHaveBeenCalled();
    });

    it('warm: refreshes the panel at once with no spinner, re-reads once per selection', () => {
      store.ensureCustomerNotes([1], refreshPanel);
      api.getNotesByCustomer.mockClear();
      refreshPanel.mockClear();

      api.getNotesByCustomer.mockReturnValue(NEVER);
      store.ensureCustomerNotes([1], refreshPanel);
      expect(refreshPanel).toHaveBeenCalledTimes(1);
      expect(store.isLoadingNotes()).toBe(false);
      expect(api.getNotesByCustomer).not.toHaveBeenCalled(); // already read this selection

      store.startSelection();
      store.ensureCustomerNotes([1], refreshPanel);
      expect(api.getNotesByCustomer).toHaveBeenCalledTimes(1);
      expect(store.isLoadingNotes()).toBe(false);
    });

    it('does not cache a failed read, so the next call in the same selection retries it', () => {
      api.getNotesByCustomer.mockReturnValue(throwError(() => new Error('500')));
      store.ensureCustomerNotes([1], refreshPanel);
      expect(store.isLoadingNotes()).toBe(false);

      api.getNotesByCustomer.mockReturnValue(of([note(1, 1, '2026-10-01T00:00:00')]));
      store.ensureCustomerNotes([1], refreshPanel);
      store.showNotesFor([1]);
      expect(store.customerNotes().map(n => n.id)).toEqual([1]);
    });

    it('drops a read the user has clicked away from', () => {
      const answer = new Subject<Note[]>();
      api.getNotesByCustomer.mockReturnValue(answer);
      store.ensureCustomerNotes([1], refreshPanel);

      page.cancelSelection$.next();
      answer.next([note(1, 1, '2026-10-01T00:00:00')]);
      answer.complete();

      expect(refreshPanel).not.toHaveBeenCalled();
      store.showNotesFor([1]);
      expect(store.customerNotes()).toEqual([]);
    });

    it('forgetAll drops the cache and the once-per-selection marks', () => {
      api.getNotesByCustomer.mockReturnValue(of([note(1, 1, '2026-10-01T00:00:00')]));
      store.ensureCustomerNotes([1], refreshPanel);

      store.forgetAll();
      store.showNotesFor([1]);
      expect(store.customerNotes()).toEqual([]);

      api.getNotesByCustomer.mockReturnValue(NEVER);
      store.ensureCustomerNotes([1], refreshPanel);
      expect(store.isLoadingNotes()).toBe(true);
    });
  });

  describe('refreshLastContacts', () => {
    it('stores the aggregate and clears the failure flag', () => {
      const rows = [{ customerId: 3, lastNoteAt: new Date() }];
      api.getNotesLastContact.mockReturnValue(of(rows));
      store.refreshLastContacts();
      expect(store.noteLastContacts()).toEqual(rows);
      expect(appState.setNoteLastContacts).toHaveBeenCalledWith(rows);
      expect(appState.setNoteLastContactsLoadFailed).toHaveBeenCalledWith(false);
    });

    it('flags and reports a failure', () => {
      const err = new Error('500');
      api.getNotesLastContact.mockReturnValue(throwError(() => err));
      store.refreshLastContacts();
      expect(appState.setNoteLastContactsLoadFailed).toHaveBeenCalledWith(true);
      expect(failures.report).toHaveBeenCalledWith('load last-contacted dates', err);
    });
  });

  describe('note handlers', () => {
    it('adding tags the note with the trade unit only when exactly one is selected', () => {
      store.addNote({ content: 'a', mentions: [] });
      expect(api.createNote).toHaveBeenLastCalledWith(1, 'a', 'TU1', []);

      page.selectedTradeUnits.set(['TU1', 'TU2']);
      store.addNote({ content: 'b', mentions: [] });
      expect(api.createNote).toHaveBeenLastCalledWith(1, 'b', undefined, []);
    });

    it('adding mirrors into the NLQ note cache once that has been loaded', () => {
      store.addNote({ content: 'a', mentions: [] });
      expect(appState.setNotes).not.toHaveBeenCalled();

      appState.setNotes([note(9, 3, '2026-01-01T00:00:00')]);
      store.addNote({ content: 'b', mentions: [] });
      expect(appState.notes().map(n => n.id)).toEqual([9, 500]);
    });

    it('does nothing with no producer selected', () => {
      page.selectedCustomer.set(null);
      store.addNote({ content: 'a', mentions: [] });
      expect(api.createNote).not.toHaveBeenCalled();
    });

    it('deleting a linked producer\'s note recomputes that producer\'s badge, not the selected one\'s', () => {
      api.getNotesByCustomer.mockImplementation((id: number) => of(id === 2 ? [note(7, 2, '2026-10-01T00:00:00')] : []));
      store.ensureCustomerNotes([1, 2], refreshPanel);
      store.showNotesFor([1, 2]);
      expect(store.noteLastContacts().map(r => r.customerId)).toEqual([2]);

      store.deleteNote(7);

      expect(store.customerNotes()).toEqual([]);
      expect(store.noteLastContacts()).toEqual([]);
    });

    it('reports a failed pin, edit or delete', () => {
      api.toggleNotePin.mockReturnValue(throwError(() => new Error('x')));
      api.updateNote.mockReturnValue(throwError(() => new Error('Group gone.')));
      api.deleteNote.mockReturnValue(throwError(() => new Error('x')));

      store.toggleNotePin(note(1, 1, '2026-10-01T00:00:00'));
      store.editNote({ noteId: 1, content: 'c', mentions: [] });
      store.deleteNote(1);

      expect(toast.error.mock.calls.map(c => c[0])).toEqual(['Failed to update note', 'Group gone.', 'Failed to delete note']);
    });
  });
});
