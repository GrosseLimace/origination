import { describe, it, expect, beforeEach } from 'vitest';
import { AccountingCurrencyPipe } from './accounting-currency.pipe';

describe('AccountingCurrencyPipe', () => {
  let pipe: AccountingCurrencyPipe;

  beforeEach(() => {
    pipe = new AccountingCurrencyPipe();
  });

  it('formats positives as "$ 40.00"', () => {
    expect(pipe.transform(40)).toBe('$ 40.00');
  });

  it('formats negatives with parentheses and no minus: "$ (40.00)"', () => {
    expect(pipe.transform(-40)).toBe('$ (40.00)');
  });

  it('formats zero as "$ 0.00"', () => {
    expect(pipe.transform(0)).toBe('$ 0.00');
  });

  it('adds thousands separators', () => {
    expect(pipe.transform(2338.4)).toBe('$ 2,338.40');
    expect(pipe.transform(-9740)).toBe('$ (9,740.00)');
  });

  it('honors a higher maxFractionDigits (e.g. per-bushel cash price)', () => {
    expect(pipe.transform(4.8712, 4)).toBe('$ 4.8712');
  });

  it('never drops below 2 fraction digits even when asked for fewer', () => {
    expect(pipe.transform(4.5, 0)).toBe('$ 4.50');
  });

  it('treats null/undefined/NaN as zero', () => {
    expect(pipe.transform(null)).toBe('$ 0.00');
    expect(pipe.transform(undefined)).toBe('$ 0.00');
    expect(pipe.transform(NaN)).toBe('$ 0.00');
  });
});
