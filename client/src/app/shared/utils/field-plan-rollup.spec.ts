import { describe, it, expect } from 'vitest';
import { PlantingIntention } from '@models';
import { matchIntention, nextTotal, otherAcres, rotationSuggestion } from './field-plan-rollup';

function intention(overrides: Partial<PlantingIntention>): PlantingIntention {
  return {
    id: 1, customerId: 9, customerName: '', customerCode: '', tradeUnit: '2190', plantingYear: 2026,
    crop: 'YC', acres: 220, createdAt: '', createdBy: '', ...overrides,
  };
}

describe('field-plan-rollup', () => {
  describe('nextTotal', () => {
    it('should move acres out of other acres when a field is added, leaving the total unchanged', () => {
      // 220 ac of corn already planned, none in fields; North 80 is planted to corn.
      expect(nextTotal(220, 0, 80)).toBe(220);
      expect(otherAcres(220, 80)).toBe(140);
    });

    it('should raise the total only by what the other acres cannot cover', () => {
      // 140 other acres left; a 320 ac field takes them all and adds 180.
      expect(nextTotal(220, 80, 400)).toBe(400);
    });

    it('should add the full field when there are no other acres', () => {
      expect(nextTotal(0, 0, 80)).toBe(80);
    });

    it('should take removed field acres off the total', () => {
      // North 80 switched from corn to soybeans: corn loses 80.
      expect(nextTotal(220, 80, 0)).toBe(140);
    });

    it('should never go below zero', () => {
      expect(nextTotal(50, 80, 0)).toBe(0);
    });
  });

  describe('matchIntention', () => {
    const key = { crop: 'YC', type: 'Irrigated', year: 2026, tradeUnit: '2190' };

    it('should prefer an exact type match', () => {
      const exact = intention({ id: 2, type: 'Irrigated' });
      expect(matchIntention([intention({ id: 1 }), exact], key)).toBe(exact);
    });

    it('should fall back to a same-crop row with no type so acres are not counted twice', () => {
      const untyped = intention({ id: 1 });
      expect(matchIntention([untyped], key)).toBe(untyped);
    });

    it('should not match another type, year or trade unit', () => {
      expect(matchIntention([intention({ type: 'Dryland' })], key)).toBeUndefined();
      expect(matchIntention([intention({ plantingYear: 2025 })], key)).toBeUndefined();
      expect(matchIntention([intention({ tradeUnit: '2191' })], key)).toBeUndefined();
    });
  });

  it('should suggest the corn/soybean rotation and repeat anything else', () => {
    expect(rotationSuggestion('Corn')).toBe('Soybeans');
    expect(rotationSuggestion('Organic Soybeans')).toBe('Corn');
    expect(rotationSuggestion('Hard Red Winter Wheat')).toBeNull();
    expect(rotationSuggestion('Popcorn')).toBeNull();
  });
});
