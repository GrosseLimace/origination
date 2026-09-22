import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import {
  TableComponent,
  TableHeaderComponent,
  TableBodyComponent,
  TableRowComponent,
  TableHeadComponent,
  TableCellComponent,
} from './table.component';

const TABLE_PARTS = [
  TableComponent,
  TableHeaderComponent,
  TableBodyComponent,
  TableRowComponent,
  TableHeadComponent,
  TableCellComponent,
];

// Behavior-focused (style-guides/automated-testing.md §7.2/§7.4): the table primitives are
// thin wrappers whose contract is (a) real <table> semantics for the projected content and
// (b) a handful of inputs that change scroll ownership, row affordance, and cell layout.
// We query by ARIA role and assert the input-driven attributes/styles, not the Tailwind
// palette — except where a class IS the behavior (pointer affordance on clickable rows).
describe('TableComponent', () => {
  it('should render projected header and body rows as a real accessible table', async () => {
    await render(
      `<app-table>
        <app-table-header>
          <app-table-row>
            <app-table-head>Producer</app-table-head>
            <app-table-head>Bushels</app-table-head>
          </app-table-row>
        </app-table-header>
        <app-table-body>
          <app-table-row>
            <app-table-cell>Acme Farms</app-table-cell>
            <app-table-cell>2,335</app-table-cell>
          </app-table-row>
          <app-table-row>
            <app-table-cell>Smith Farms</app-table-cell>
            <app-table-cell>900</app-table-cell>
          </app-table-row>
        </app-table-body>
      </app-table>`,
      { imports: TABLE_PARTS },
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map(h => h.textContent?.trim())).toEqual(['Producer', 'Bushels']);
    // One header row plus two body rows.
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('cell', { name: 'Acme Farms' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '900' })).toBeInTheDocument();
  });

  it('should render only the header when the caller has no rows, with a spanning empty-state cell', async () => {
    await render(
      `<app-table>
        <app-table-header>
          <app-table-row>
            <app-table-head>Producer</app-table-head>
            <app-table-head>Bushels</app-table-head>
          </app-table-row>
        </app-table-header>
        <app-table-body>
          @for (row of rows; track row) {
            <app-table-row><app-table-cell>{{ row }}</app-table-cell></app-table-row>
          } @empty {
            <app-table-row><app-table-cell [colspan]="2">No producers found</app-table-cell></app-table-row>
          }
        </app-table-body>
      </app-table>`,
      { imports: TABLE_PARTS, componentProperties: { rows: [] as string[] } },
    );

    const empty = screen.getByRole('cell', { name: 'No producers found' });
    expect(empty).toHaveAttribute('colspan', '2');
    // Header row + the single empty-state row; no data rows.
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('should scroll horizontally itself by default and defer to an ancestor when the header is sticky', () => {
    const fixture = TestBed.createComponent(TableComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.wrapperClass()).toBe('w-full overflow-x-auto overflow-y-visible');

    fixture.componentRef.setInput('stickyHeader', true);
    fixture.detectChanges();

    expect(fixture.componentInstance.wrapperClass()).toBe('w-full');
  });

  it('should own both scroll axes and cap its height when maxHeight is set', () => {
    const fixture = TestBed.createComponent(TableComponent);
    fixture.componentRef.setInput('stickyHeader', true);
    fixture.componentRef.setInput('maxHeight', '40rem');
    fixture.detectChanges();

    const wrapper = fixture.nativeElement.querySelector('div') as HTMLElement;
    expect(fixture.componentInstance.wrapperClass()).toBe('w-full overflow-auto');
    expect(wrapper.style.maxHeight).toBe('40rem');
  });

  it('should not cap the height when maxHeight is left unset', () => {
    const fixture = TestBed.createComponent(TableComponent);
    fixture.detectChanges();

    const wrapper = fixture.nativeElement.querySelector('div') as HTMLElement;
    expect(wrapper.style.maxHeight).toBe('');
  });
});

describe('TableRowComponent', () => {
  it('should emit rowClick when the row is clicked', async () => {
    const rowClick = vi.fn();
    await render(
      `<table><tbody>
        <app-table-row [clickable]="true" (rowClick)="rowClick()">
          <app-table-cell>Acme Farms</app-table-cell>
        </app-table-row>
      </tbody></table>`,
      { imports: [TableRowComponent, TableCellComponent], componentProperties: { rowClick } },
    );

    await userEvent.click(screen.getByRole('row'));

    expect(rowClick).toHaveBeenCalledTimes(1);
  });

  it('should stamp rowId onto the tr so callers can scroll to or highlight it', () => {
    const fixture = TestBed.createComponent(TableRowComponent);
    fixture.detectChanges();
    const tr = fixture.nativeElement.querySelector('tr') as HTMLTableRowElement;
    expect(tr.hasAttribute('id')).toBe(false);

    fixture.componentRef.setInput('rowId', 'row-42');
    fixture.detectChanges();

    expect(tr.id).toBe('row-42');
  });

  it('should show a pointer affordance only for clickable rows and append caller classes', () => {
    const fixture = TestBed.createComponent(TableRowComponent);
    fixture.detectChanges();
    const tr = fixture.nativeElement.querySelector('tr') as HTMLTableRowElement;
    const plainClasses = fixture.componentInstance.getRowClasses();
    expect(tr.classList.contains('cursor-pointer')).toBe(false);

    fixture.componentRef.setInput('clickable', true);
    fixture.componentRef.setInput('highlighted', true);
    fixture.componentRef.setInput('class', 'producer-row');
    fixture.detectChanges();

    expect(tr.classList.contains('cursor-pointer')).toBe(true);
    expect(tr.classList.contains('producer-row')).toBe(true);
    // Highlighted + clickable is a different visual state from a plain row.
    expect(fixture.componentInstance.getRowClasses()).not.toBe(plainClasses);
  });
});

describe('TableHeadComponent', () => {
  it('should only show the pointer affordance when the column is sortable', () => {
    const fixture = TestBed.createComponent(TableHeadComponent);
    fixture.detectChanges();
    const th = fixture.nativeElement.querySelector('th') as HTMLTableCellElement;
    expect(th.classList.contains('cursor-pointer')).toBe(false);

    fixture.componentRef.setInput('sortable', true);
    fixture.detectChanges();

    expect(th.classList.contains('cursor-pointer')).toBe(true);
  });

  it('should apply minWidth and extra th classes from the caller', () => {
    const fixture = TestBed.createComponent(TableHeadComponent);
    fixture.componentRef.setInput('minWidth', '12rem');
    fixture.componentRef.setInput('thClass', 'bushels-column');
    fixture.detectChanges();

    const th = fixture.nativeElement.querySelector('th') as HTMLTableCellElement;
    expect(th.style.minWidth).toBe('12rem');
    expect(th.classList.contains('bushels-column')).toBe(true);
  });
});

describe('TableCellComponent', () => {
  it('should omit colspan by default and span columns when asked', () => {
    const fixture = TestBed.createComponent(TableCellComponent);
    fixture.detectChanges();
    const td = fixture.nativeElement.querySelector('td') as HTMLTableCellElement;
    expect(td.hasAttribute('colspan')).toBe(false);

    fixture.componentRef.setInput('colspan', 3);
    fixture.detectChanges();

    expect(td.getAttribute('colspan')).toBe('3');
  });

  it('should apply minWidth and extra td classes from the caller', () => {
    const fixture = TestBed.createComponent(TableCellComponent);
    fixture.componentRef.setInput('minWidth', '8rem');
    fixture.componentRef.setInput('tdClass', 'numeric-cell');
    fixture.detectChanges();

    const td = fixture.nativeElement.querySelector('td') as HTMLTableCellElement;
    expect(td.style.minWidth).toBe('8rem');
    expect(td.classList.contains('numeric-cell')).toBe(true);
  });
});
