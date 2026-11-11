import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { CustomerListFilter } from '@core/context/customer-list-filter';
import { SavedListFilterStore } from '../../data-access/saved-list-filter.store';
import { SavedListsStore } from '../../data-access/saved-lists.store';

/**
 * The customer list's saved-list picker, in its `list-filter` slot: "All Producers" or one of the user's own lists that
 * share a trade unit with the selection. Picking a list narrows the customer list to who it holds, through the list's
 * CustomerListFilter; the picked list, and who it holds, are SavedListFilterStore's, so they outlast the page. Hidden
 * while the user has no list to offer.
 */
@Component({
  selector: 'app-saved-list-filter',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './saved-list-filter.component.html',
})
export class SavedListFilterComponent {
  private readonly filter = inject(CustomerListFilter);
  private readonly store = inject(SavedListFilterStore);

  readonly options = this.store.options;
  readonly selectedId = this.store.selectedId;
  readonly count = this.store.count;

  constructor() {
    // Read the user's lists again each time the page opens, so one saved or assigned elsewhere shows.
    inject(SavedListsStore).load().pipe(takeUntilDestroyed()).subscribe();

    effect(() => this.filter.keep(this.store.kept()));
    this.filter.reset.pipe(takeUntilDestroyed()).subscribe(() => this.store.select('all'));
  }

  /** A list picked, or "All Producers". */
  pick(id: string): void {
    if (id !== 'all') this.filter.pick();
    this.store.select(id);
  }
}
