import { describe, it, expect } from 'vitest';

import { formatCallerId, formatPhoneDisplay, formatPhoneProgressive } from './phone';

describe('formatPhoneProgressive', () => {
  it('formats progressively while typing', () => {
    expect(formatPhoneProgressive('4')).toBe('(4');
    expect(formatPhoneProgressive('402')).toBe('(402');
    expect(formatPhoneProgressive('40255')).toBe('(402) 55');
    expect(formatPhoneProgressive('4025551234')).toBe('(402) 555-1234');
  });

  it('strips non-digits and caps at 10 digits', () => {
    expect(formatPhoneProgressive('(402) 555-1234 ext 9')).toBe('(402) 555-1234');
    expect(formatPhoneProgressive('')).toBe('');
  });
});

describe('formatPhoneDisplay', () => {
  it('formats exactly-10-digit numbers', () => {
    expect(formatPhoneDisplay('4025551234')).toBe('(402) 555-1234');
  });

  it('returns anything else as-is (extensions, international, empty)', () => {
    expect(formatPhoneDisplay('402555123')).toBe('402555123');
    expect(formatPhoneDisplay(null)).toBe('');
    expect(formatPhoneDisplay(undefined)).toBe('');
  });
});

describe('formatCallerId', () => {
  it('formats the E.164 caller id the Teams calling SDK delivers', () => {
    expect(formatCallerId('+14025551234')).toBe('(402) 555-1234');
    expect(formatCallerId('14025551234')).toBe('(402) 555-1234');
  });

  it('formats a plain 10-digit number like the stored-number formatter', () => {
    expect(formatCallerId('4025551234')).toBe('(402) 555-1234');
  });

  it('returns anything else unchanged (international, withheld, empty)', () => {
    expect(formatCallerId('+442079460958')).toBe('+442079460958');
    expect(formatCallerId('anonymous')).toBe('anonymous');
    expect(formatCallerId(null)).toBe('');
  });
});
