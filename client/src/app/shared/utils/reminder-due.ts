/**
 * How close a follow-up is, and the colour that says so.
 *
 * Two places render this: the Follow-Up card on the producer pane and the badge on the producer
 * list row. They drifted once already — the badge turned green the day before a follow-up was due
 * while the card stayed grey — so the rule lives here and both read it.
 *
 * The tiers are deliberately coarse. What an originator needs at a glance is "have I missed this",
 * "is it today", "is it next", not an exact countdown.
 */
export type ReminderDueTier = 'overdue' | 'today' | 'tomorrow' | 'upcoming';

/**
 * Whole days from today to the due date, in the user's own zone. Negative means overdue.
 *
 * Both sides are flattened to local midnight first, so this counts CALENDAR days rather than
 * 24-hour blocks: a follow-up at 4pm today is "today", not "in 0.7 days", and one at 9am tomorrow
 * is "tomorrow" even when that is only fifteen hours away.
 */
export function daysUntilDue(dueAt: string | Date): number {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 0;
  due.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export function reminderDueTier(dueAt: string | Date): ReminderDueTier {
  const days = daysUntilDue(dueAt);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return 'upcoming';
}

/** Red once missed, amber on the day, green the day before, grey while it is still far off. */
export const REMINDER_DUE_CLASS: Readonly<Record<ReminderDueTier, string>> = {
  overdue: 'text-red-600 dark:text-red-400',
  today: 'text-amber-600 dark:text-amber-400',
  tomorrow: 'text-scoular-green-accessible dark:text-scoular-green',
  upcoming: 'text-gray-500 dark:text-gray-400',
};

/** Completed follow-ups drop out of the colour scheme entirely — they are no longer due. */
export const REMINDER_DONE_CLASS = 'text-gray-400 dark:text-gray-500';
