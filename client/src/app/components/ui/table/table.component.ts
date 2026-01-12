import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full overflow-auto">
      <table class="w-full caption-bottom text-sm">
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
  template: `
    <thead class="[&_tr]:border-b border-gray-200 dark:border-gray-700">
      <ng-content></ng-content>
    </thead>
  `
})
export class TableHeaderComponent {}

@Component({
  selector: 'app-table-body',
  standalone: true,
  imports: [CommonModule],
  template: `
    <tbody class="[&_tr:last-child]:border-0">
      <ng-content></ng-content>
    </tbody>
  `
})
export class TableBodyComponent {}

@Component({
  selector: 'app-table-row',
  standalone: true,
  imports: [CommonModule],
  template: `
    <tr
      class="border-b border-gray-200 dark:border-gray-700 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
      [class.cursor-pointer]="clickable"
      [class.bg-red-50]="highlighted"
      [class.dark:bg-red-950/20]="highlighted"
      (click)="rowClick.emit()"
    >
      <ng-content></ng-content>
    </tr>
  `
})
export class TableRowComponent {
  @Input() clickable = false;
  @Input() highlighted = false;
  @Output() rowClick = new EventEmitter<void>();
}

@Component({
  selector: 'app-table-head',
  standalone: true,
  imports: [CommonModule],
  template: `
    <th class="h-12 px-4 text-left align-middle font-medium text-gray-500 dark:text-gray-400 [&:has([role=checkbox])]:pr-0">
      <ng-content></ng-content>
    </th>
  `
})
export class TableHeadComponent {}

@Component({
  selector: 'app-table-cell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <td class="p-4 align-middle text-gray-900 dark:text-gray-100 [&:has([role=checkbox])]:pr-0">
      <ng-content></ng-content>
    </td>
  `
})
export class TableCellComponent {}
