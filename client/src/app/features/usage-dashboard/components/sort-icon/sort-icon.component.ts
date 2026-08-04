import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { SortDirection } from '../../utils/table-sort';

/**
 * Three-state sort indicator for a sortable table header: up when sorted ascending on this column,
 * down when descending, and a neutral both-ways glyph otherwise.
 *
 * The dashboard's two tables have 15 sortable headers between them, each of which previously
 * inlined this same conditional SVG block.
 */
@Component({
  selector: 'app-sort-icon',
  standalone: true,
  template: `
    <span [class]="colorClass()">
      @if (isActive() && direction() === 'asc') {
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
      } @else if (isActive() && direction() === 'desc') {
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
      } @else {
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>
      }
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SortIconComponent {
  /** The column this header sorts by. */
  readonly column = input.required<string>();
  /** The column the table is currently sorted by, if any. */
  readonly activeColumn = input<string | null>(null);
  readonly direction = input<SortDirection>('none');

  protected readonly isActive = computed(() => this.activeColumn() === this.column());

  protected readonly colorClass = computed(() =>
    this.isActive()
      ? 'text-gray-600 dark:text-gray-300'
      : 'text-gray-400 dark:text-gray-600');
}
