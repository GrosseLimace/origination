import { Signal } from '@angular/core';
import { Customer, Note, NoteMention, Reminder, ReminderDraft } from '@models';

/**
 * The selected producer's notes and the signed-in user's follow-ups for them, with what the user can do to each,
 * as the customer screen's pieces read them: the Notes and My follow-ups cards. Declared in core so those pieces can
 * use it without importing the module that loads the data. The Engagement module's CustomerEngagementStore is the
 * implementation, which the composition root provides; the page that hosts the customer screen tells it who is selected.
 */
export abstract class SelectedProducerEngagement {
  /**
   * The customer the screen now shows, or null for none: reads the notes of the customer and their linked group, and the
   * user's follow-ups for them, and cancels what was still being read for the one before. The same customer again keeps
   * what is shown, taking the customer as they now are.
   */
  abstract select(customer: Customer | null): void;

  /** The producer's notes, with their linked producers', newest first. */
  abstract readonly notes: Signal<Note[]>;
  /** True while the notes are loading. */
  abstract readonly isLoadingNotes: Signal<boolean>;
  /** True while a note is being added. */
  abstract readonly isSavingNote: Signal<boolean>;
  /** Goes up by one each time a note is added, so the form can clear itself. */
  abstract readonly noteSaveSucceededCounter: Signal<number>;

  abstract addNote(note: { content: string; mentions: NoteMention[] }): void;
  abstract toggleNotePin(note: Note): void;
  abstract editNote(edit: { noteId: number; content: string; mentions: NoteMention[] }): void;
  abstract deleteNote(noteId: number): void;

  /** Whether follow-ups are switched on in this environment. */
  abstract readonly remindersEnabled: boolean;
  /** The signed-in user's own follow-ups for the producer. */
  abstract readonly reminders: Signal<Reminder[]>;
  /** True while the follow-ups are loading. */
  abstract readonly isLoadingReminders: Signal<boolean>;
  /** True while a follow-up is being saved. */
  abstract readonly isSavingReminder: Signal<boolean>;
  /** Goes up by one each time a follow-up is saved, so the form can close. */
  abstract readonly reminderSaveSucceededCounter: Signal<number>;

  /** Adds a follow-up, or edits one when the draft carries an id. */
  abstract saveReminder(draft: ReminderDraft): void;
  abstract toggleReminderComplete(reminder: Reminder): void;
  abstract deleteReminder(reminder: Reminder): void;
  /** Puts a follow-up on the user's Outlook calendar, after it was saved while that failed or was declined. */
  abstract addReminderToOutlook(reminder: Reminder): void;
}
