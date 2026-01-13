import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full overflow-auto">
      <table class="w-full caption-bottom text-sm border-collapse">
        <ng-content></ng-content>
      </table>
    </div>
  `
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
    let classes = 'border-b border-gray-200 dark:border-gray-700 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50';
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
      class="h-12 px-4 text-left align-middle font-medium text-gray-500 dark:text-gray-400"
      [class.cursor-pointer]="sortable"
      [class.select-none]="sortable"
      [class.hover:bg-gray-50]="sortable"
      [class.dark:hover:bg-gray-800]="sortable"
    >
      <ng-content></ng-content>
    </th>
  `
})
export class TableHeadComponent {
  @Input() sortable = false;
}

@Component({
  selector: 'app-table-cell',
  standalone: true,
  imports: [CommonModule],
  host: { style: 'display: contents' },
  template: `
    <td
      class="p-4 align-middle text-gray-900 dark:text-gray-100"
      [attr.colspan]="colspan"
    >
      <ng-content></ng-content>
    </td>
  `
})
export class TableCellComponent {
  @Input() colspan?: number;
}
