import { describe, it, expect, beforeEach } from 'vitest';

import { createTableSort, TableSort } from './table-sort';

interface Row { name: string; count: number }

const rows: Row[] = [
  { name: 'Charlie', count: 2 },
  { name: 'Alice', count: 3 },
  { name: 'Bob', count: 1 },
];

const comparators = {
  name: (a: Row, b: Row) => a.name.localeCompare(b.name),
  count: (a: Row, b: Row) => a.count - b.count,
};

describe('createTableSort', () => {
  let sort: TableSort<Row>;

  beforeEach(() => {
    sort = createTableSort<Row>();
  });

  it('starts unsorted and returns rows untouched', () => {
    expect(sort.column()).toBeNull();
    expect(sort.direction()).toBe('none');
    expect(sort.apply(rows, comparators)).toBe(rows);
  });

  it('cycles a column through ascending, descending, then off', () => {
    sort.handle('name');
    expect(sort.direction()).toBe('asc');
    expect(sort.apply(rows, comparators).map(r => r.name)).toEqual(['Alice', 'Bob', 'Charlie']);

    sort.handle('name');
    expect(sort.direction()).toBe('desc');
    expect(sort.apply(rows, comparators).map(r => r.name)).toEqual(['Charlie', 'Bob', 'Alice']);

    // A third click clears the sort rather than cycling back to ascending.
    sort.handle('name');
    expect(sort.direction()).toBe('none');
    expect(sort.column()).toBeNull();
    expect(sort.apply(rows, comparators)).toBe(rows);
  });

  it('restarts at ascending when switching columns mid-sort', () => {
    sort.handle('name');
    sort.handle('name');
    expect(sort.direction()).toBe('desc');

    sort.handle('count');
    expect(sort.column()).toBe('count');
    expect(sort.direction()).toBe('asc');
    expect(sort.apply(rows, comparators).map(r => r.count)).toEqual([1, 2, 3]);
  });

  it('does not mutate the source array', () => {
    sort.handle('name');
    const original = [...rows];
    sort.apply(rows, comparators);
    expect(rows).toEqual(original);
  });

  it('passes rows through unchanged for a column with no comparator', () => {
    sort.handle('unknownColumn');
    expect(sort.apply(rows, comparators)).toBe(rows);
  });
});
