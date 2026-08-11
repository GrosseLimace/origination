import { Signal, signal } from '@angular/core';

export type SortDirection = 'none' | 'asc' | 'desc';

/** Per-column comparators; a column absent from the map sorts as equal. */
export type Comparators<T> = Record<string, (a: T, b: T) => number>;

export interface TableSort<T> {
  readonly column: Signal<string | null>;
  readonly direction: Signal<SortDirection>;
  /** Advances the given column through none → asc → desc → none. */
  handle(column: string): void;
  /** Returns a sorted copy, or the original array when no sort is active. */
  apply(rows: T[], comparators: Comparators<T>): T[];
}

/**
 * Three-state column sorting for the dashboard's tables. Both tables previously carried their own
 * copy of this state machine plus a matching icon-class helper.
 */
export function createTableSort<T>(): TableSort<T> {
  const column = signal<string | null>(null);
  const direction = signal<SortDirection>('none');

  return {
    column,
    direction,

    handle(next: string): void {
      if (column() !== next) {
        column.set(next);
        direction.set('asc');
        return;
      }
      switch (direction()) {
        case 'none':
          direction.set('asc');
          break;
        case 'asc':
          direction.set('desc');
          break;
        default:
          // Third click clears the sort entirely rather than cycling back to ascending.
          direction.set('none');
          column.set(null);
      }
    },

    apply(rows: T[], comparators: Comparators<T>): T[] {
      const col = column();
      const dir = direction();
      if (!col || dir === 'none') return rows;

      const compare = comparators[col];
      if (!compare) return rows;

      const sorted = [...rows].sort(compare);
      return dir === 'desc' ? sorted.reverse() : sorted;
    },
  };
}
