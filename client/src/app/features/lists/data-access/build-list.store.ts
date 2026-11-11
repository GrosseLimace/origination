import { Injectable, inject, signal } from '@angular/core';
import { RefinementFilters } from '../models/refine-filters.model';
import { QueryLibraryItem } from '../models/query-library.model';
import { SavedList } from '../models/saved-list.model';
import { SessionReset } from '@core/auth/session-reset.service';

export interface BuildListState {
  queryText: string;
  filteredCustomerIds: number[];
  hasGenerated: boolean;
  showMap: boolean;
  detectedState: string | null;
  tradeUnits: string[];
  appliedRefinements?: RefinementFilters;
  notContactedDaysInput?: string;
  showRefinePanel?: boolean;
  manuallyIncludedCustomerIds?: number[];
  manuallyExcludedCustomerIds?: number[];
  showManageMembersPanel?: boolean;
  selectedLibraryQuery?: QueryLibraryItem | null;
  /** When a saved list is the active context, persist it so navigating away and back
   *  restores the "Active List" indicator and keeps Save/Update wired to the same list
   *  (rather than dropping back to a no-context state that creates a new list on save). */
  activeSavedList?: SavedList | null;
}

/** Build a List's screen state, kept for the session so navigating away and back restores the query and results. */
@Injectable({ providedIn: 'root' })
export class BuildListStore {
  private readonly _buildListState = signal<BuildListState | null>(null);

  readonly buildListState = this._buildListState.asReadonly();

  constructor() {
    // Signing out or timing out drops it with the rest of the user's data.
    inject(SessionReset).onReset(() => this.clearBuildListState());
  }

  setBuildListState(state: BuildListState): void {
    this._buildListState.set(state);
  }

  clearBuildListState(): void {
    this._buildListState.set(null);
  }
}
