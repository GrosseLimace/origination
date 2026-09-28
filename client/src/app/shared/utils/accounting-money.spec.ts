import { describe, it, expect } from 'vitest';
import { formatAccountingMoney } from './accounting-money';

// The single formatter behind every signed dollar figure in the app. It exists because
// AccountingCurrencyPipe (on-screen) and reportMoneyAccounting (calculator report builder) held
// byte-for-byte identical copies and drifted. These tests pin the exact output strings — including
// the `$` + space prefix — so a change to one surface can't quietly change only that surface.

describe('formatAccountingMoney', () => {
  it('renders a positive value as "$ " then the amount, always to two decimals', () => {
    expect(formatAccountingMoney(40)).toBe('$ 40.00');
    expect(formatAccountingMoney(40.5)).toBe('$ 40.50');
  });

  it('renders a negative value in parentheses with no minus sign', () => {
    // Accounting style: the parentheses ARE the sign. A stray "-" here means someone swapped in
    // a plain currency formatter.
    expect(formatAccountingMoney(-40)).toBe('$ (40.00)');
    expect(formatAccountingMoney(-40)).not.toContain('-');
  });

  it('groups thousands with commas', () => {
    expect(formatAccountingMoney(1_234_567.5)).toBe('$ 1,234,567.50');
    expect(formatAccountingMoney(-1234.5)).toBe('$ (1,234.50)');
  });

  it('treats null and undefined as zero rather than printing NaN', () => {
    expect(formatAccountingMoney(null)).toBe('$ 0.00');
    expect(formatAccountingMoney(undefined)).toBe('$ 0.00');
  });

  it('treats zero as non-negative, so it never renders as "$ (0.00)"', () => {
    expect(formatAccountingMoney(0)).toBe('$ 0.00');
    // -0 is falsy, so the `|| 0` normalises it to +0 and the parentheses branch is skipped.
    expect(formatAccountingMoney(-0)).toBe('$ 0.00');
  });

  it('floors maxFractionDigits at 2 so money never shows LESS precision than cents', () => {
    // Callers asking for 0 decimals still get cents — the floor is the whole point of the arg.
    expect(formatAccountingMoney(1.239, 0)).toBe('$ 1.24');
    expect(formatAccountingMoney(1.239, 1)).toBe('$ 1.24');
  });

  it('honours maxFractionDigits above 2 for finer values like per-bushel prices', () => {
    expect(formatAccountingMoney(4.1275, 4)).toBe('$ 4.1275');
    expect(formatAccountingMoney(-4.1275, 4)).toBe('$ (4.1275)');
  });

  it('still pads to two decimals when a higher max is allowed but not needed', () => {
    // minimumFractionDigits stays at 2 regardless of the max, so $5 never renders as "$ 5".
    expect(formatAccountingMoney(5, 4)).toBe('$ 5.00');
  });

  it('keeps the parentheses for a negative that rounds away to zero', () => {
    // The sign is decided on the raw value, not the rounded string, so a tiny debit still reads
    // as a debit rather than flipping to "$ 0.00".
    expect(formatAccountingMoney(-0.004)).toBe('$ (0.00)');
  });
});
