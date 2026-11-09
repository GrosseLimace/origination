import { Injectable, inject } from '@angular/core';
import { SelectedProducerEngagement } from '@core/context/selected-producer-engagement';
import type { Note, NoteMention, Reminder, ReminderDraft } from '@models';
import { HomeNotesStore } from './home-notes.store';
import { HomeRemindersStore } from './home-reminders.store';

/**
 * The page's SelectedProducerEngagement: the selected producer's notes and the user's follow-ups, as the Notes and My
 * follow-ups cards read them. Delegates to the page's notes and reminders stores, which do the loading.
 */
@Injectable()
export class HomeEngagement implements SelectedProducerEngagement {
  private readonly notesStore = inject(HomeNotesStore);
  private readonly remindersStore = inject(HomeRemindersStore);

  readonly notes = this.notesStore.customerNotes.asReadonly();
  readonly isLoadingNotes = this.notesStore.isLoadingNotes;
  readonly isSavingNote = this.notesStore.isSavingNote;
  readonly noteSaveSucceededCounter = this.notesStore.noteSaveSucceededCounter;

  addNote(note: { content: string; mentions: NoteMention[] }): void {
    this.notesStore.addNote(note);
  }

  toggleNotePin(note: Note): void {
    this.notesStore.toggleNotePin(note);
  }

  editNote(edit: { noteId: number; content: string; mentions: NoteMention[] }): void {
    this.notesStore.editNote(edit);
  }

  deleteNote(noteId: number): void {
    this.notesStore.deleteNote(noteId);
  }

  readonly remindersEnabled = this.remindersStore.remindersEnabled;
  readonly reminders = this.remindersStore.customerReminders.asReadonly();
  readonly isLoadingReminders = this.remindersStore.isLoadingReminders;
  readonly isSavingReminder = this.remindersStore.isSavingReminder;
  readonly reminderSaveSucceededCounter = this.remindersStore.reminderSaveSucceededCounter;

  saveReminder(draft: ReminderDraft): void {
    this.remindersStore.saveReminder(draft);
  }

  toggleReminderComplete(reminder: Reminder): void {
    this.remindersStore.toggleReminderComplete(reminder);
  }

  deleteReminder(reminder: Reminder): void {
    this.remindersStore.deleteReminder(reminder);
  }

  addReminderToOutlook(reminder: Reminder): void {
    this.remindersStore.addReminderToOutlook(reminder);
  }
}
