import { describe, expect, it } from 'vitest';
import { formatBasis, normalizeBasis } from './basis-format';

/**
 * The sign carries the meaning of a basis quote, so the only interesting cases are the ones where it
 * is absent, already present, or where the value is not a number at all.
 */
describe('formatBasis', () => {
  it('signs a positive so it cannot be misread as a cash price', () => {
    expect(formatBasis('20')).toBe('+20');
    expect(formatBasis('0.45')).toBe('+0.45');
  });

  it('leaves a negative alone rather than double-signing it', () => {
    expect(formatBasis('-30')).toBe('-30');
    expect(formatBasis('-0.4500')).toBe('-0.4500');
  });

  it('leaves an explicitly signed positive alone', () => {
    expect(formatBasis('+20')).toBe('+20');
  });

  it('leaves zero bare, because a zero basis is "even" and "+0" says otherwise', () => {
    expect(formatBasis('0')).toBe('0');
    expect(formatBasis('0.00')).toBe('0.00');
  });

  it('keeps the typed precision instead of reformatting the number', () => {
    // Prefixing the parsed number would turn this into "+0.45" and quietly drop two places an
    // originator chose to write.
    expect(formatBasis('0.4500')).toBe('+0.4500');
    expect(formatBasis('20.0')).toBe('+20.0');
  });

  it('passes through anything that is not a number', () => {
    expect(formatBasis('even')).toBe('even');
    expect(formatBasis('n/a')).toBe('n/a');
  });

  it('treats empty and absent as empty', () => {
    expect(formatBasis('')).toBe('');
    expect(formatBasis('   ')).toBe('');
    expect(formatBasis(null)).toBe('');
    expect(formatBasis(undefined)).toBe('');
  });
});

describe('normalizeBasis', () => {
  it('takes the display plus back off', () => {
    expect(normalizeBasis('+5')).toBe('5');
    expect(normalizeBasis('+0.4500')).toBe('0.4500');
  });

  it('leaves everything else as it is', () => {
    expect(normalizeBasis('5')).toBe('5');
    expect(normalizeBasis('-30')).toBe('-30');
    expect(normalizeBasis('even')).toBe('even');
    expect(normalizeBasis('')).toBe('');
    expect(normalizeBasis(null)).toBe('');
  });

  it('round-trips with formatBasis, which is what keeps the sign out of the database', () => {
    for (const stored of ['5', '-30', '0', '0.4500', 'even', '']) {
      expect(normalizeBasis(formatBasis(stored))).toBe(stored);
    }
  });
});
