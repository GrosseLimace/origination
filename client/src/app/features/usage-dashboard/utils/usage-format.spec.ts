import { describe, it, expect } from 'vitest';

import {
  FEATURE_LABELS, formatDayLabel, formatLastActive, formatSessionDuration, formatTimeSpent,
  formatUsageTimestamp, formatFeatureLabel, getInitials, getStatusClasses,
  localIsoDateDaysAgo, titleCaseCode, toLocalIsoDate, windowDays
} from './usage-format';

describe('toLocalIsoDate', () => {
  it('reports the local calendar date even late in the evening', () => {
    // The old implementation used toISOString(), which converts to UTC first — so any time after
    // ~18:00 US Central reported *tomorrow*, and the dashboard requested a window a day ahead of
    // what the user picked. Constructed with local-time components on purpose.
    expect(toLocalIsoDate(new Date(2026, 7, 4, 19, 30))).toBe('2026-08-04');
    expect(toLocalIsoDate(new Date(2026, 7, 4, 23, 59))).toBe('2026-08-04');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('handles the last day of a year', () => {
    expect(toLocalIsoDate(new Date(2026, 11, 31, 22, 0))).toBe('2026-12-31');
  });
});

describe('localIsoDateDaysAgo', () => {
  it('is consistent with toLocalIsoDate for zero days', () => {
    expect(localIsoDateDaysAgo(0)).toBe(toLocalIsoDate(new Date()));
  });

  it('walks back across a month boundary', () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    expect(localIsoDateDaysAgo(7)).toBe(toLocalIsoDate(sevenDaysAgo));
  });
});

describe('windowDays', () => {
  it('counts an inclusive range', () => {
    expect(windowDays('2026-08-01', '2026-08-30')).toBe(30);
  });

  it('treats a single day as one day', () => {
    expect(windowDays('2026-08-04', '2026-08-04')).toBe(1);
  });

  it('never returns zero or negative for an inverted range', () => {
    expect(windowDays('2026-08-10', '2026-08-01')).toBe(1);
  });
});

describe('formatTimeSpent', () => {
  it('drops units that are zero', () => {
    expect(formatTimeSpent(90)).toBe('1h 30m');
    expect(formatTimeSpent(1440)).toBe('1d');
    expect(formatTimeSpent(1500)).toBe('1d 1h');
  });

  it('shows minutes for short spans and 0m for nothing', () => {
    expect(formatTimeSpent(5)).toBe('5m');
    expect(formatTimeSpent(0)).toBe('0m');
    expect(formatTimeSpent(-3)).toBe('0m');
  });
});

describe('formatSessionDuration', () => {
  it('uses hours only past the hour mark', () => {
    expect(formatSessionDuration(45)).toBe('45m');
    expect(formatSessionDuration(60)).toBe('1h');
    expect(formatSessionDuration(95)).toBe('1h 35m');
  });
});

describe('formatUsageTimestamp', () => {
  it('treats an offset-less timestamp as UTC', () => {
    // The API serializes DateTime.UtcNow with no offset; parsing that as local time shifted every
    // event by the viewer's offset. Both spellings must describe the same instant.
    expect(formatUsageTimestamp('2026-08-04T15:30:00'))
      .toBe(formatUsageTimestamp('2026-08-04T15:30:00Z'));
  });

  it('leaves an explicit offset alone', () => {
    const withOffset = formatUsageTimestamp('2026-08-04T15:30:00+00:00');
    expect(withOffset).toBe(formatUsageTimestamp('2026-08-04T15:30:00Z'));
  });
});

describe('formatLastActive', () => {
  it('names the recent days rather than printing a date', () => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    expect(formatLastActive(today.toISOString())).toBe('Today');
    expect(formatLastActive(yesterday.toISOString())).toBe('Yesterday');
  });

  it('counts days for the rest of the week', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    expect(formatLastActive(threeDaysAgo.toISOString())).toBe('3 days ago');
  });

  it('reports never for a user with no activity', () => {
    expect(formatLastActive(null)).toBe('Never');
  });
});

describe('formatDayLabel', () => {
  it('renders a short month and day without shifting the date', () => {
    expect(formatDayLabel('2026-08-04')).toBe('Aug 4');
  });
});

describe('getStatusClasses', () => {
  it('gives each status its own colour', () => {
    expect(getStatusClasses('Active')).toContain('green');
    expect(getStatusClasses('Light Usage')).toContain('amber');
    expect(getStatusClasses('Dormant')).toContain('orange');
    expect(getStatusClasses('Never')).toContain('red');
    expect(getStatusClasses('Something Else')).toContain('gray');
  });
});

describe('getInitials', () => {
  it('uses first and last name when both are present', () => {
    expect(getInitials('Caden Egr')).toBe('CE');
    expect(getInitials('Mary Jane Watson')).toBe('MW');
  });

  it('falls back to the first two characters', () => {
    expect(getInitials('admin')).toBe('AD');
  });
});

describe('formatFeatureLabel', () => {
  it('maps known feature codes', () => {
    expect(formatFeatureLabel('customers')).toBe('Producer Page');
  });

  it('title-cases an unrecognized code instead of showing it raw', () => {
    expect(formatFeatureLabel('brand-new-feature')).toBe('Brand New Feature');
  });

  it('no longer carries a label for the retired position report', () => {
    // The feature was removed from the app; the lingering label made it render forever as a zero.
    expect(FEATURE_LABELS['position-report']).toBeUndefined();
  });
});

describe('titleCaseCode', () => {
  it('turns a kebab-case code into words', () => {
    expect(titleCaseCode('notes-edit')).toBe('Notes Edit');
    expect(titleCaseCode('single')).toBe('Single');
    expect(titleCaseCode('')).toBe('');
  });
});
