/** A personal follow-up reminder against a producer, from GET /reminders/customer/{id}.
 *
 *  Reminders are PRIVATE: the API only ever returns the signed-in user's own, so there is no
 *  author/owner field to render. `outlookEventId` is null when the reminder is not on the user's
 *  Outlook calendar — either the calendar write was declined or it failed — which is what drives
 *  the "Add to Outlook" retry on the row. */
export interface Reminder {
  id: number;
  customerId: number;
  customerName: string;
  customerCode?: string;
  /** Due instant, UTC (ISO string over the wire). */
  dueAt: string;
  subject: string;
  notes?: string;
  outlookEventId?: string | null;
  /** False only when a reschedule could not move the existing calendar event. The reminder saved
   *  either way — the API reports this so the client never has to talk to Graph to find out. */
  outlookEventMoved?: boolean;
  isCompleted: boolean;
  completedAt?: string | null;
  createdAt: string;
  modifiedAt?: string | null;
}

/** One OPEN reminder the signed-in user owns, from GET /reminders/mine — the producer-list badge
 *  feed. Mirrors NoteLastContact: keyed on customerCode, carries no reminder text, and is bounded
 *  by how many follow-ups the user has scheduled. */
export interface ReminderDue {
  id: number;
  customerId: number;
  customerCode?: string;
  /** Due instant, UTC (ISO string over the wire). */
  dueAt: string;
}
