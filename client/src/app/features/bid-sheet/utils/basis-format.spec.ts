import { describe, expect, it } from 'vitest';
import { formatBasis } from './basis-format';

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
