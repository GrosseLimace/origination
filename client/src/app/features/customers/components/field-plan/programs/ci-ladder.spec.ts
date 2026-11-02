import { describe, it, expect } from 'vitest';
import { atOrBelowTarget, ciLadder } from './ci-ladder';

const fields = [
  { item: 'East 80', value: 6100, bushels: 16000 },
  { item: 'South', value: 2034, bushels: 25000 },
  { item: 'North', value: 2874, bushels: 44000 },
];

describe('bushels by CI', () => {
  it('should sort fields lowest CI first with a running total of bushels at or below each', () => {
    expect(ciLadder(fields).map(r => [r.item, r.atOrBelow])).toEqual([['South', 25000], ['North', 69000], ['East 80', 85000]]);
  });

  it('should give fields with the same CI the same running total', () => {
    const tied = ciLadder([...fields, { item: 'West', value: 2874, bushels: 1000 }]);
    expect(tied.filter(r => r.value === 2874).map(r => r.atOrBelow)).toEqual([70000, 70000]);
  });

  it('should total the bushels and fields at or below a target', () => {
    expect(atOrBelowTarget(fields, 3000)).toEqual({ bushels: 69000, fields: 2 });
    expect(atOrBelowTarget(fields, 2874)).toEqual({ bushels: 69000, fields: 2 });
    expect(atOrBelowTarget(fields, 1000)).toEqual({ bushels: 0, fields: 0 });
  });

  it('should handle no fields', () => {
    expect(ciLadder([])).toEqual([]);
    expect(atOrBelowTarget([], 5000)).toEqual({ bushels: 0, fields: 0 });
  });
});
