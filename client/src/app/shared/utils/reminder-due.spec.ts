import { describe, it, expect } from 'vitest';
import { daysUntilDue, REMINDER_DUE_CLASS, reminderDueTier } from './reminder-due';

// The urgency rule the producer-pane card and the producer-list badge both read. These tests exist
// because the two drifted once: the badge turned green the day before a follow-up was due while the
// card stayed grey.

/** A due instant `days` from today at the given local hour. */
function due(days: number, hour = 9): string {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value.toISOString();
}

describe('reminder due tiers', () => {
  it('is overdue once the day has passed', () => {
    expect(reminderDueTier(due(-1))).toBe('overdue');
    expect(reminderDueTier(due(-9))).toBe('overdue');
  });

  it('is today on the day, whatever the hour', () => {
    expect(reminderDueTier(due(0, 8))).toBe('today');
    expect(reminderDueTier(due(0, 23))).toBe('today');
  });

  it('is tomorrow the day before', () => {
    expect(reminderDueTier(due(1))).toBe('tomorrow');
  });

  it('is upcoming from two days out', () => {
    expect(reminderDueTier(due(2))).toBe('upcoming');
    expect(reminderDueTier(due(30))).toBe('upcoming');
  });

  it('counts calendar days, not 24-hour blocks', () => {
    // 11pm tonight is still today; 1am tomorrow is tomorrow, though it is only hours away.
    expect(daysUntilDue(due(0, 23))).toBe(0);
    expect(daysUntilDue(due(1, 1))).toBe(1);
  });

  it('treats an unreadable date as today rather than throwing', () => {
    expect(daysUntilDue('not a date')).toBe(0);
    expect(reminderDueTier('not a date')).toBe('today');
  });
});

describe('reminder due colours', () => {
  it('is red once missed, amber today, green tomorrow and grey beyond', () => {
    expect(REMINDER_DUE_CLASS.overdue).toContain('red');
    expect(REMINDER_DUE_CLASS.today).toContain('amber');
    expect(REMINDER_DUE_CLASS.tomorrow).toContain('scoular-green');
    expect(REMINDER_DUE_CLASS.upcoming).toContain('gray');
  });

  it('gives every tier a light and a dark variant', () => {
    for (const cssClass of Object.values(REMINDER_DUE_CLASS)) {
      expect(cssClass).toMatch(/dark:/);
    }
  });
});
