import { describe, it, expect } from 'vitest';
import { RefinementFilters } from '@models';
import { buildSavedListPayload, SavedListPayloadInput } from './saved-list-payload';

const input = (over: Partial<SavedListPayloadInput> = {}): SavedListPayloadInput => ({
  query: 'All producers', tradeUnits: [], refinements: null, category: null, includedIds: [], excludedIds: [], ...over,
});

describe('buildSavedListPayload', () => {
  it('sends empty parts as undefined', () => {
    expect(buildSavedListPayload(input())).toEqual({
      query: 'All producers', tradeUnits: undefined, filters: undefined, includedCustomerIds: undefined, excludedCustomerIds: undefined,
    });
  });

  it('joins trade units and passes the member overrides through', () => {
    const p = buildSavedListPayload(input({ tradeUnits: ['1000', '2000'], includedIds: [4], excludedIds: [3, 5] }));
    expect(p.tradeUnits).toBe('1000,2000');
    expect(p.includedCustomerIds).toEqual([4]);
    expect(p.excludedCustomerIds).toEqual([3, 5]);
  });

  it('adds the prompt category to a copy of the refinements, or sends it alone', () => {
    const refinements: RefinementFilters = { states: ['KS'] };
    const withBoth = buildSavedListPayload(input({ refinements, category: 'Contracts' }));
    expect(withBoth.filters).toEqual({ states: ['KS'], _promptCategory: 'Contracts' });
    expect(refinements).toEqual({ states: ['KS'] });
    expect(buildSavedListPayload(input({ refinements })).filters).toEqual({ states: ['KS'] });
    expect(buildSavedListPayload(input({ refinements })).filters).not.toBe(refinements);
    expect(buildSavedListPayload(input({ category: 'Tickets' })).filters).toEqual({ _promptCategory: 'Tickets' });
  });
});
