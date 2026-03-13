import { Component, inject, input, signal, computed, ChangeDetectionStrategy, HostBinding, HostListener, DestroyRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';

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

  @HostBinding('class') get hostClass() {
    return this.stacked()
      ? 'block w-full space-y-3'
      : 'flex items-center gap-2 flex-wrap';
  }
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly destroyRef = inject(DestroyRef);

  // Dropdown open/close state — local only
  isTradeUnitDropdownOpen = signal(false);
  isGroupDropdownOpen = signal(false);
  groupsLoading = signal(false);

  ngOnInit(): void {
    if (!this.appState.userGroupsLoaded()) {
      this.groupsLoading.set(true);
      this.apiService.getUserTradeUnits().pipe(
        takeUntilDestroyed(this.destroyRef)
      ).subscribe({
        next: (groups) => {
          const mapped = groups.map(g => ({
            groupName: g.groupName,
            tradeUnitCodes: g.tradeUnitCodes
          }));
          this.appState.setUserGroups(mapped);
          this.groupsLoading.set(false);

          // Restore group selection, filtering out groups that no longer exist
          const prevGroups = this.appState.selectedGroupNames();
          if (prevGroups.length > 0) {
            const validGroups = prevGroups.filter(g => mapped.some(m => m.groupName === g));
            this.appState.setSelectedGroupNames(validGroups);
          }
          // Restore trade unit selection, keeping only units still available
          const prevUnits = this.appState.selectedTradeUnits();
          if (prevUnits.length > 0) {
            const allAvailable = this._computeAvailableTradeUnits(mapped, this.appState.selectedGroupNames());
            this.appState.setTradeUnits(prevUnits.filter(u => allAvailable.includes(u)));
          }
        },
        error: () => { this.groupsLoading.set(false); }
      });
    }
  }

  // ---- Computed accessors that delegate to AppStateService ----

  get userGroups() {
    return this.appState.userGroups();
  }

  get selectedTradeUnits() {
    return this.appState.selectedTradeUnits();
  }

  get selectedGroupNames() {
    return this.appState.selectedGroupNames();
  }

  // ---- Group helpers ----

  getAvailableTradeUnits(): string[] {
    return this._computeAvailableTradeUnits(this.appState.userGroups(), this.appState.selectedGroupNames());
  }

  private _computeAvailableTradeUnits(
    groups: { groupName: string; tradeUnitCodes: string[] }[],
    selectedGroups: string[]
  ): string[] {
    if (groups.length <= 1) return groups[0]?.tradeUnitCodes ?? [];
    const filterGroups = selectedGroups.length === 0 ? groups : groups.filter(g => selectedGroups.includes(g.groupName));
    const units = new Set<string>();
    for (const g of filterGroups) {
      g.tradeUnitCodes.forEach(u => units.add(u));
    }
    return [...units].sort();
  }

  getGroupButtonText(): string {
    const sel = this.appState.selectedGroupNames();
    if (sel.length === 0) return 'Select a Group';
    if (sel.length === 1) return sel[0];
    return `${sel.length} groups selected`;
  }

  isGroupSelected(groupName: string): boolean {
    return this.appState.selectedGroupNames().includes(groupName);
  }

  toggleGroupDropdown(): void {
    this.isGroupDropdownOpen.update(v => !v);
    if (this.isGroupDropdownOpen()) {
      this.isTradeUnitDropdownOpen.set(false);
    }
  }

  toggleGroupSelection(groupName: string): void {
    const current = this.appState.selectedGroupNames();
    const idx = current.indexOf(groupName);
    const updated = idx > -1 ? current.filter((_, i) => i !== idx) : [...current, groupName];
    this.appState.setSelectedGroupNames(updated);
    // Remove selected trade units no longer in any selected group
    const available = this.getAvailableTradeUnits();
    const filteredUnits = this.appState.selectedTradeUnits().filter(u => available.includes(u));
    this.appState.setTradeUnits(filteredUnits);
  }

  // ---- Trade unit helpers ----

  toggleTradeUnitDropdown(): void {
    this.isTradeUnitDropdownOpen.update(v => !v);
    if (this.isTradeUnitDropdownOpen()) {
      this.isGroupDropdownOpen.set(false);
    }
  }

  closeDropdown(): void {
    this.isTradeUnitDropdownOpen.set(false);
  }

  toggleTradeUnit(unit: string): void {
    const current = this.appState.selectedTradeUnits();
    const index = current.indexOf(unit);
    const updated = index > -1 ? current.filter((_, i) => i !== index) : [...current, unit];
    this.appState.setTradeUnits(updated);
  }

  clearAllTradeUnits(): void {
    this.appState.setTradeUnits([]);
    // Keep dropdown open so user can make new selections
  }

  isTradeUnitSelected(unit: string): boolean {
    return this.appState.selectedTradeUnits().includes(unit);
  }

  getTradeUnitButtonText(): string {
    const units = this.appState.selectedTradeUnits();
    if (units.length === 0) {
      return 'Select Trade Units';
    } else if (units.length === 1) {
      return units[0];
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
