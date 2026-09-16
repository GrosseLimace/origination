import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { BidSheet } from '@models';

/**
 * The control that says which bid sheets are on screen.
 *
 * It is a checkbox list rather than a `<select>` because the answer is now a SET: originators compare
 * a Kansas sheet against a Nebraska one without switching back and forth. A native multi-select was
 * the obvious alternative and was rejected -- it needs ctrl-click to add a second option, which is
 * undiscoverable, and one stray plain click silently throws the rest of the selection away.
 *
 * Two surfaces use it, the map toolbar and the Edit Bids header, and they differ in exactly one way:
 * the map can also be shown UNSCOPED, browsing every location anyone has added. That is not a sheet,
 * so it is not a row in the list -- it is its own entry that clears the selection's hold on the map.
 * The grid has no such mode (it is always editing sheets) and leaves `showAllOption` off.
 *
 * The component owns no selection state. It reports intent -- tick this, show only this, show all --
 * and the page decides, because the page is what has to flush pending edits and re-save the choice.
 */
@Component({
  selector: 'app-sheet-multi-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sheet-multi-select.component.html',
})
export class SheetMultiSelectComponent {
  readonly sheets = input.required<BidSheet[]>();
  /** Ticked ids, in tick order. */
  readonly selectedIds = input.required<number[]>();
  /** Whether to offer "All locations" -- the map does, the grid does not. */
  readonly showAllOption = input<boolean>(false);
  /** True when the map is unscoped, in which case no sheet reads as ticked on this control. */
  readonly showingAll = input<boolean>(false);
  /** Compact styling for the map toolbar, which sits in a crowded single row. */
  readonly compact = input<boolean>(false);

  /** Tick or untick one sheet, leaving the rest alone. */
  readonly toggled = output<number>();
  /** Show this sheet and nothing else -- the row label, as distinct from its checkbox. */
  readonly pickedOnly = output<number>();
  /** Browse every location instead of any sheet. */
  readonly pickedAll = output<void>();

  readonly open = signal<boolean>(false);

  private readonly selectedSet = computed<ReadonlySet<number>>(() => new Set(this.selectedIds()));

  isSelected(id: number): boolean {
    return !this.showingAll() && this.selectedSet().has(id);
  }

  /**
   * What the closed control says. Naming every sheet stops being readable past a couple, and a bare
   * count stops being informative below that, so it switches: up to two by name, then "N bid sheets".
   */
  readonly label = computed<string>(() => {
    if (this.showingAll()) return 'All locations';
    const byId = new Map(this.sheets().map(s => [s.id, s]));
    const names = this.selectedIds().map(id => byId.get(id)?.name).filter((n): n is string => !!n);
    if (names.length === 0) return this.sheets().length === 0 ? 'No bid sheets yet' : 'Choose a bid sheet';
    if (names.length <= 2) return names.join(' + ');
    return `${names.length} bid sheets`;
  });

  toggleOpen(): void { this.open.update(v => !v); }
  close(): void { this.open.set(false); }

  onToggle(id: number): void { this.toggled.emit(id); }

  onPickOnly(id: number): void {
    this.pickedOnly.emit(id);
    this.close();
  }

  onPickAll(): void {
    this.pickedAll.emit();
    this.close();
  }
}
