import { Provider, signal } from '@angular/core';
import { vi } from 'vitest';
import { Note, Reminder } from '@models';
import { SelectedProducerEngagement } from '@core/context/selected-producer-engagement';

/**
 * A SelectedProducerEngagement for specs: writable signals a test sets directly, and a spy per action. Starts with no
 * notes or follow-ups, nothing loading or saving, and follow-ups switched on.
 */
export function selectedProducerEngagementFake() {
  return {
    notes: signal<Note[]>([]),
    isLoadingNotes: signal(false),
    isSavingNote: signal(false),
    noteSaveSucceededCounter: signal(0),
    addNote: vi.fn(),
    toggleNotePin: vi.fn(),
    editNote: vi.fn(),
    deleteNote: vi.fn(),
    remindersEnabled: true,
    reminders: signal<Reminder[]>([]),
    isLoadingReminders: signal(false),
    isSavingReminder: signal(false),
    reminderSaveSucceededCounter: signal(0),
    saveReminder: vi.fn(),
    toggleReminderComplete: vi.fn(),
    deleteReminder: vi.fn(),
    addReminderToOutlook: vi.fn(),
  } satisfies SelectedProducerEngagement;
}

export type SelectedProducerEngagementFake = ReturnType<typeof selectedProducerEngagementFake>;

/** Provides `fake` (or an empty one) as the SelectedProducerEngagement. */
export function provideSelectedProducerEngagement(fake: SelectedProducerEngagementFake = selectedProducerEngagementFake()): Provider {
  return { provide: SelectedProducerEngagement, useValue: fake };
}
