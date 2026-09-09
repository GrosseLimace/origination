import { Component, inject, input, output, signal, computed, ChangeDetectionStrategy, HostBinding, HostListener, DestroyRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppStateService } from '@core/services/app-state.service';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';

@Component({
  selector: 'app-trade-unit-selector',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './trade-unit-selector.component.html'
})
export class TradeUnitSelectorComponent implements OnInit {
  /** stacked=true: full-width vertical layout (Customers sidebar).
   *  stacked=false (default): compact inline layout (page headers). */
  stacked = input(false);

  /**
   * deferred=true: changes are staged locally until Done is clicked.
   * Outside-click or cancel discards changes without touching app state.
   * Use this when the host component needs to control when the selection applies.
   */
  deferred = input(false);

  @HostBinding('class') get hostClass() {
    return this.stacked()
      ? 'block w-full space-y-3'
      : 'flex items-center gap-2 flex-wrap';
  }
  private readonly userTradeUnits = inject(UserTradeUnitsService);
  private readonly appState = inject(AppStateService);
  private readonly destroyRef = inject(DestroyRef);

  // Dropdown open/close state — local only
  isTradeUnitDropdownOpen = signal(false);
  isGroupDropdownOpen = signal(false);
  groupsLoading = signal(false);
  /** The groups request failed — offer Retry. */
  groupsLoadError = signal(false);
  /** The request succeeded but the user has no trade-unit assignments at all. Driven by shared
   *  app state (set by UserTradeUnitsService on every load, including the refresh after the
   *  Trade Unit Preferences popup closes) so it appears/clears no matter which path loaded. */
  readonly noTradeUnitsAssigned = computed(() =>
    this.appState.noTradeUnitAssignments() && this.appState.userGroups().length === 0);

  // Draft selection used when deferred=true — null means dropdown is closed/no pending edit
  private readonly _draftTradeUnits = signal<string[] | null>(null);

  // Effective selection shown in the dropdown: draft when deferred+open, else app state
  private readonly _effectiveTradeUnits = computed(() => {
    const draft = this._draftTradeUnits();
    return this.deferred() && draft !== null ? draft : this.appState.selectedTradeUnits();
  });

  ngOnInit(): void {
    if (!this.appState.userGroupsLoaded()) {
      this._fetchGroups();
    }
  }

  retryLoadGroups(): void {
    this.groupsLoadError.set(false);
    this._fetchGroups();
  }

  /** Hand off to the Trade Unit Preferences app (popup). The service re-loads the groups when
   *  the popup closes, which flips noTradeUnitsAssigned off once assignments exist. */
  openTradeUnitPreferences(): void {
    this.userTradeUnits.openPreferences();
  }

  /** Mapping + selection pruning live in UserTradeUnitsService (shared with the
   *  Trade Unit Preferences popup's refresh-on-close); only the loading/error UI is ours. */
  private _fetchGroups(): void {
    this.groupsLoading.set(true);
    this.userTradeUnits.load().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        // Empty is not an error: the user simply has nothing assigned yet. The service flags
        // that in app state (noTradeUnitAssignments) and leaves userGroupsLoaded false so a page
        // refresh retries naturally; the template points them at Trade Unit Preferences.
        this.groupsLoading.set(false);
      },
      error: () => {
        this.groupsLoading.set(false);
        this.groupsLoadError.set(true);
      }
    });
  }

  // ---- Computed accessors that delegate to AppStateService ----
  // Using computed() instead of getters ensures Angular's reactive system
  // tracks these as signal dependencies for OnPush change detection.

  readonly userGroups = computed(() => this.appState.userGroups());
  readonly selectedTradeUnits = computed(() => this.appState.selectedTradeUnits());
  readonly selectedGroupNames = computed(() => this.appState.selectedGroupNames());
  readonly allProducersMode = computed(() => this.appState.allProducersMode());

  // ---- Group helpers ----

  getAvailableTradeUnits(): string[] {
    return this.userTradeUnits.computeAvailableTradeUnits(this.appState.userGroups(), this.appState.selectedGroupNames());
  }

  getGroupButtonText(): string {
    if (this.appState.allProducersMode()) return 'All Producers';
    const sel = this.appState.selectedGroupNames();
    if (sel.length === 0) return 'Select a Group';
    if (sel.length === 1) return sel[0];
    return `${sel.length} groups selected`;
  }

  isGroupSelected(groupName: string): boolean {
    return this.appState.selectedGroupNames().includes(groupName);
  }

  /** Enter "All Producers" mode: a session-only override that clears scope so the customer
   *  list searches all producers (our table + ODS onboarding fallback). Set the flag BEFORE
   *  clearing the selection so the debounced preference-save in UserPreferencesService sees
   *  the mode and skips persisting the empty selection — the saved preference stays a group. */
  selectAllProducers(): void {
    this.appState.setAllProducersMode(true);
    this.appState.setSelectedGroupNames([]);
    this.appState.setTradeUnits([]);
    this.isGroupDropdownOpen.set(false);
  }

  toggleGroupDropdown(): void {
    this.isGroupDropdownOpen.update(v => !v);
    if (this.isGroupDropdownOpen()) {
      this.isTradeUnitDropdownOpen.set(false);
    }
  }

  toggleGroupSelection(groupName: string): void {
    // Picking a real group exits All Producers mode (mutually exclusive).
    this.appState.setAllProducersMode(false);
    const current = this.appState.selectedGroupNames();
    // Single-select: if already selected, deselect; otherwise select only this one
    const updated = current.includes(groupName) ? [] : [groupName];
    this.appState.setSelectedGroupNames(updated);
    // Remove selected trade units no longer in the selected group
    const available = this.getAvailableTradeUnits();
    const filteredUnits = this.appState.selectedTradeUnits().filter(u => available.includes(u));
    this.appState.setTradeUnits(filteredUnits);
    // Close the dropdown after selection
    this.isGroupDropdownOpen.set(false);
  }

  // ---- Trade unit helpers ----

  toggleTradeUnitDropdown(): void {
    this.isTradeUnitDropdownOpen.update(v => !v);
    if (this.isTradeUnitDropdownOpen()) {
      this.isGroupDropdownOpen.set(false);
      // In deferred mode, snapshot current app state as the draft
      if (this.deferred()) {
        this._draftTradeUnits.set([...this.appState.selectedTradeUnits()]);
      }
    } else if (this.deferred()) {
      // Closed without Done — discard draft
      this._draftTradeUnits.set(null);
    }
  }

  done = output<void>();

  closeDropdown(): void {
    if (this.deferred()) {
      this._draftTradeUnits.set(null); // Discard — revert to app state
    }
    this.isTradeUnitDropdownOpen.set(false);
  }

  confirmDone(): void {
    if (this.deferred()) {
      const draft = this._draftTradeUnits();
      if (draft !== null) {
        this.appState.setTradeUnits(draft);
      }
      this._draftTradeUnits.set(null);
    }
    this.isTradeUnitDropdownOpen.set(false);
    this.done.emit();
  }

  toggleTradeUnit(unit: string): void {
    if (this.deferred()) {
      const current = this._draftTradeUnits() ?? [...this.appState.selectedTradeUnits()];
      const index = current.indexOf(unit);
      this._draftTradeUnits.set(index > -1 ? current.filter((_, i) => i !== index) : [...current, unit]);
    } else {
      const current = this.appState.selectedTradeUnits();
      const index = current.indexOf(unit);
      this.appState.setTradeUnits(index > -1 ? current.filter((_, i) => i !== index) : [...current, unit]);
    }
  }

  clearAllTradeUnits(): void {
    if (this.deferred()) {
      this._draftTradeUnits.set([]);
    } else {
      this.appState.setTradeUnits([]);
    }
  }

  isTradeUnitSelected(unit: string): boolean {
    return this._effectiveTradeUnits().includes(unit);
  }

  /** Description/location for a trade unit code (e.g. "Pratt, KS"), or '' when unknown. */
  descriptionFor(code: string): string {
    return this.appState.tradeUnitDescriptions().get(code) ?? '';
  }

  getTradeUnitButtonText(): string {
    const units = this._effectiveTradeUnits();
    if (units.length === 0) {
      return 'Select Trade Units';
    } else if (units.length === 1) {
      const desc = this.descriptionFor(units[0]);
      return desc ? `${units[0]} · ${desc}` : units[0];
    } else {
      return `${units.length} trade units selected`;
    }
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.isGroupDropdownOpen.set(false);
    if (this.isTradeUnitDropdownOpen()) {
      this.closeDropdown();
    }
  }
}
