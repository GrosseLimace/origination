import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [class]="wrapperClass()" [style.max-height]="maxHeight()">
      <table class="w-full min-w-max caption-bottom text-sm border-collapse">
        <ng-content></ng-content>
      </table>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      position: relative;
    }

    /* Custom scrollbar for webkit browsers */
    div::-webkit-scrollbar {
      height: 10px;
    }

    div::-webkit-scrollbar-track {
      background: rgb(243 244 246);
      border-radius: 5px;
    }

    div::-webkit-scrollbar-thumb {
      background: rgb(209 213 219);
      border-radius: 5px;
    }

    :host-context(.dark) div::-webkit-scrollbar-track {
      background: rgb(31 41 55);
    }

    :host-context(.dark) div::-webkit-scrollbar-thumb {
      background: rgb(75 85 99);
    }

    div::-webkit-scrollbar-thumb:hover {
      background: rgb(156 163 175);
    }

    :host-context(.dark) div::-webkit-scrollbar-thumb:hover {
      background: rgb(107 114 128);
    }

    /* Smooth scrolling */
    div {
      scroll-behavior: smooth;
    }
  `]
})
export class TableComponent {
  public stickyHeader = input<boolean>(false);

  /**
   * Caps the scroll area, e.g. `calc(100dvh - var(--app-chrome) - 3rem)`.
   * Set this rather than putting a max-height on an ancestor: a sticky header
   * only sticks to the element that scrolls, which is this wrapper.
   */
  public maxHeight = input<string | undefined>(undefined);

  readonly wrapperClass = computed(() => {
    // With a height cap the wrapper owns both axes. Without one, sticky-header
    // tables still rely on an ancestor for horizontal scroll (callers predate
    // maxHeight); plain tables scroll themselves.
    if (this.maxHeight()) return 'w-full overflow-auto';
    return this.stickyHeader() ? 'w-full' : 'w-full overflow-x-auto overflow-y-visible';
  });
}

@Component({
  selector: 'app-table-header',
  standalone: true,
  imports: [CommonModule],
  host: { style: 'display: contents' },
  template: `
    <thead class="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
      <ng-content></ng-content>
    </thead>
  `
})
export class TableHeaderComponent {}

@Component({
  selector: 'app-table-body',
  standalone: true,
  imports: [CommonModule],
  host: { style: 'display: contents' },
  template: `
    <tbody>
      <ng-content></ng-content>
    </tbody>
  `
})
export class TableBodyComponent {}

@Component({
  selector: 'app-table-row',
  standalone: true,
  imports: [CommonModule],
  host: { style: 'display: contents' },
  template: `
    <tr
      [attr.id]="rowId()"
      [class]="getRowClasses()"
      (click)="rowClick.emit()"
    >
      <ng-content></ng-content>
    </tr>
  `
})
export class TableRowComponent {
  public clickable = input<boolean>(false);
  public highlighted = input<boolean>(false);
  public class = input<string>('');
  public rowId = input<string | null>(null);
  public rowClick = output<void>();

  getRowClasses(): string {
    let classes = 'border-b border-gray-200 dark:border-gray-800 transition-colors even:bg-gray-100 dark:even:bg-gray-800/30';
    if (this.clickable()) {
      // More pronounced hover for clickable rows so the user can clearly see
      // which row they're about to select.
      classes += ' cursor-pointer hover:bg-scoular-green/10 dark:hover:bg-scoular-green/20';
    } else {
      classes += ' hover:bg-gray-200 dark:hover:bg-gray-800/50';
    }
    if (this.highlighted()) {
      classes += ' bg-scoular-red/5 dark:bg-red-950/20';
    }
    if (this.class()) {
      classes += ' ' + this.class();
    }
    return classes;
  }
}

@Component({
  selector: 'app-table-head',
  standalone: true,
  imports: [CommonModule],
  host: { style: 'display: contents' },
  template: `
    <th
      [class]="getHeadClasses()"
      [class.cursor-pointer]="sortable()"
      [class.select-none]="sortable()"
      [class.hover:bg-gray-50]="sortable()"
      [class.dark:hover:bg-gray-800]="sortable()"
      [style.min-width]="minWidth()"
    >
      <ng-content></ng-content>
    </th>
  `
})
export class TableHeadComponent {
  public sortable = input<boolean>(false);
  public minWidth = input<string | undefined>(undefined);
  public thClass = input<string>('');

  getHeadClasses(): string {
    return `h-12 px-4 text-left align-middle font-medium text-gray-700 dark:text-gray-400 whitespace-nowrap ${this.thClass()}`.trim();
  }
}

@Component({
  selector: 'app-table-cell',
  standalone: true,
  imports: [CommonModule],
  host: { style: 'display: contents' },
  template: `
    <td
      [class]="getCellClasses()"
      [attr.colspan]="colspan()"
      [style.min-width]="minWidth()"
    >
      <ng-content></ng-content>
    </td>
  `
})
export class TableCellComponent {
  public colspan = input<number | undefined>(undefined);
  public minWidth = input<string | undefined>(undefined);
  public tdClass = input<string>('');

  getCellClasses(): string {
    return `p-4 align-middle text-gray-900 dark:text-gray-100 whitespace-nowrap ${this.tdClass()}`.trim();
  }
}
