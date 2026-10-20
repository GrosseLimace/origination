import { describe, it, expect } from 'vitest';
import { parseServerTime } from './server-time';

describe('parseServerTime', () => {
  it('reads a bare ISO string as UTC, which is how the API sends DateTime.UtcNow', () => {
    expect(parseServerTime('2026-10-13T15:30:00').toISOString()).toBe('2026-10-13T15:30:00.000Z');
  });

  it('leaves a string that already says Z alone', () => {
    expect(parseServerTime('2026-10-13T15:30:00Z').toISOString()).toBe('2026-10-13T15:30:00.000Z');
  });

  it('honours an explicit offset rather than appending Z to it', () => {
    expect(parseServerTime('2026-10-13T10:30:00-05:00').toISOString()).toBe('2026-10-13T15:30:00.000Z');
  });

  it('passes a Date through unchanged', () => {
    const d = new Date(Date.UTC(2026, 9, 13, 15, 30));
    expect(parseServerTime(d).getTime()).toBe(d.getTime());
  });

  it('returns an invalid Date for garbage, so callers can keep their isNaN checks', () => {
    expect(isNaN(parseServerTime('not a date').getTime())).toBe(true);
  });
});
