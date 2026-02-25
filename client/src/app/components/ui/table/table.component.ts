import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full overflow-x-auto overflow-y-visible">
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
export class TableComponent {}

@Component({
  selector: 'app-table-header',
  standalone: true,
  imports: [CommonModule],
  host: { style: 'display: contents' },
  template: `
    <thead class="border-b border-gray-200 dark:border-gray-700">
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
      [class]="getRowClasses()"
      (click)="rowClick.emit()"
    >
      <ng-content></ng-content>
    </tr>
  `
})
export class TableRowComponent {
  @Input() clickable = false;
  @Input() highlighted = false;
  @Input() class = '';
  @Output() rowClick = new EventEmitter<void>();

  getRowClasses(): string {
    let classes = 'border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50';
    if (this.clickable) {
      classes += ' cursor-pointer';
    }
    if (this.highlighted) {
      classes += ' bg-red-50 dark:bg-red-950/20';
    }
    if (this.class) {
      classes += ' ' + this.class;
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
      class="h-12 px-4 text-left align-middle font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap"
      [class.cursor-pointer]="sortable"
      [class.select-none]="sortable"
      [class.hover:bg-gray-50]="sortable"
      [class.dark:hover:bg-gray-800]="sortable"
      [style.min-width]="minWidth"
    >
      <ng-content></ng-content>
    </th>
  `
})
export class TableHeadComponent {
  @Input() sortable = false;
  @Input() minWidth?: string;
}

@Component({
  selector: 'app-table-cell',
  standalone: true,
  imports: [CommonModule],
  host: { style: 'display: contents' },
  template: `
    <td
      class="p-4 align-middle text-gray-900 dark:text-gray-100 whitespace-nowrap"
      [attr.colspan]="colspan"
      [style.min-width]="minWidth"
    >
      <ng-content></ng-content>
    </td>
  `
})
export class TableCellComponent {
  @Input() colspan?: number;
  @Input() minWidth?: string;
}
