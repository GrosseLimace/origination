import { describe, it, expect } from 'vitest';
import { QueryLibraryItem, SavedList } from '@models';
import {
  filterLibrary, groupLibrary, libraryCategories, libraryCategoryForQuery, matchedPatternLabels, searchSavedLists, searchTeamLists,
} from './query-library';

const item = (id: number, category: string, name: string, over: Partial<QueryLibraryItem> = {}): QueryLibraryItem =>
  ({ id, category, name, queryText: name, sortOrder: id, ...over });
const LIB = [
  item(1, 'Contracts', 'Unpriced contracts', { description: 'Open U/D contracts' }),
  item(2, 'Contacts', 'Follow-ups due', { tags: 'Reminders follow-up' }),
  item(3, 'Tickets', 'Delivered this month', { tags: 'scale' }),
  item(4, 'Contracts', 'All contract holders', { queryText: 'All producers with contracts' }),
];
const list = (id: number, name: string, query: string, createdBy?: string): SavedList =>
  ({ id, name, query, createdBy, createdAt: '2026-10-01' });

describe('matchedPatternLabels', () => {
  it('labels known patterns, drops unknown ones and duplicates, keeps order', () => {
    expect(matchedPatternLabels(['top_n', 'nope', 'unsigned_contract', 'contract_unconfirmed', 'state_filter'])).toEqual(
      ['Top N ranking', 'Unconfirmed contracts', 'State']);
    expect(matchedPatternLabels([])).toEqual([]);
  });
});

describe('filterLibrary', () => {
  const ids = (items: QueryLibraryItem[]) => items.map(q => q.id);

  it('narrows by category and by search on name, description, tags, category and prompt', () => {
    expect(ids(filterLibrary(LIB, '', null, true))).toEqual([1, 2, 3, 4]);
    expect(ids(filterLibrary(LIB, '', 'Contracts', true))).toEqual([1, 4]);
    expect(ids(filterLibrary(LIB, 'u/d', null, true))).toEqual([1]);
    expect(ids(filterLibrary(LIB, 'scale', null, true))).toEqual([3]);
    expect(ids(filterLibrary(LIB, 'tickets', null, true))).toEqual([3]);
    expect(ids(filterLibrary(LIB, 'all producers', null, true))).toEqual([4]);
    expect(ids(filterLibrary(LIB, 'contract', 'Tickets', true))).toEqual([]);
  });

  it('hides reminder cards while the reminders feature is off', () => {
    expect(ids(filterLibrary(LIB, '', null, false))).toEqual([1, 3, 4]);
  });
});

describe('libraryCategories', () => {
  it('puts Saved Lists (and Team Lists for managers) before the sorted prompt categories', () => {
    expect(libraryCategories(LIB, false)).toEqual(['Saved Lists', 'Contacts', 'Contracts', 'Tickets']);
    expect(libraryCategories(LIB, true)).toEqual(['Saved Lists', 'Team Lists', 'Contacts', 'Contracts', 'Tickets']);
    expect(libraryCategories([], false)).toEqual(['Saved Lists']);
  });
});

describe('saved and team list search', () => {
  const lists = [list(1, 'Corn growers', 'All producers', 'Lee Smith'), list(2, 'Beans', 'Producers with active contracts')];

  it('team lists match name, prompt or owner', () => {
    expect(searchTeamLists(lists, '')).toBe(lists);
    expect(searchTeamLists(lists, 'smith').map(l => l.id)).toEqual([1]);
    expect(searchTeamLists(lists, 'active').map(l => l.id)).toEqual([2]);
  });

  it('saved lists match name or prompt, not owner', () => {
    expect(searchSavedLists(lists, 'corn').map(l => l.id)).toEqual([1]);
    expect(searchSavedLists(lists, 'smith')).toEqual([]);
  });
});

describe('libraryCategoryForQuery', () => {
  it('finds the card with the same prompt text, ignoring case and outer spaces', () => {
    expect(libraryCategoryForQuery(LIB, '  ALL PRODUCERS WITH CONTRACTS ')).toBe('Contracts');
    expect(libraryCategoryForQuery(LIB, 'something else')).toBeNull();
  });
});

describe('groupLibrary', () => {
  it('groups cards by category in first-seen order', () => {
    expect(groupLibrary(LIB).map(g => [g.category, g.queries.map(q => q.id)])).toEqual([
      ['Contracts', [1, 4]], ['Contacts', [2]], ['Tickets', [3]],
    ]);
  });
});
