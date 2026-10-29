import { describe, it, expect } from 'vitest';
import { yieldFromTickets } from './fd-cic-review.component';

describe('yieldFromTickets (the review\'s suggested actual yield)', () => {
  it('should be the included bushels over the field\'s acres, to one decimal', () => {
    expect(yieldFromTickets(24_000, 120)).toBe(200);
    expect(yieldFromTickets(20_000, 120)).toBe(166.7);
  });

  it('should suggest nothing without acres or bushels', () => {
    expect(yieldFromTickets(24_000, null)).toBeNull();
    expect(yieldFromTickets(24_000, 0)).toBeNull();
    expect(yieldFromTickets(0, 120)).toBeNull();
  });
});
