import { Component, input, output, effect, inject, ChangeDetectionStrategy, HostListener, ViewChild, ElementRef, DestroyRef, afterNextRender, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { Customer, SavedList, Note, ProducerDetails } from '@models';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { NlqFilterService, NlqFilterContext } from '@core/services/nlq-filter.service';
import { CardComponent, CardContentComponent } from '@shared/components/card/card.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';

interface LastContactInfo {
  text: string;
  daysAgo: number;
  cssClass: string;
}

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, CardContentComponent, BadgeComponent],
  host: { class: 'block w-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-list.component.html'
})
export class CustomerListComponent {
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLElement>;

  public customers = input<Customer[]>([]);
  public selectedCustomer = input<Customer | null>(null);
  public savedLists = input<SavedList[]>([]);
  public notes = input<Note[]>([]);
  public loading = input(false);
  public producerDetailsMap = input(new Map<number, ProducerDetails>());
  public selectCustomer = output<Customer>();
  public tradeUnitChange = output<string[]>();

  private readonly apiService = inject(ApiService);
  private readonly appStateService = inject(AppStateService);
  private readonly nlqFilterService = inject(NlqFilterService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _searchSubject$ = new Subject<string>();

  searchQuery = signal('');
  selectedListId = signal('all');
  selectedTradeUnits = signal<string[]>([]);
  userGroups = signal<{ groupName: string; tradeUnitCodes: string[] }[]>([]);
  selectedGroupNames = signal<string[]>([]);
  filteredCustomers = signal<Customer[]>([]);
  isTradeUnitDropdownOpen = signal(false);
  isGroupDropdownOpen = signal(false);
  groupsLoading = signal(true);

  // Performance optimization: Cache last contact info to avoid repeated filtering/sorting
  lastContactCache = new Map<number, LastContactInfo>();

  constructor() {
    this._rebuildLastContactCache();

    // Restore state from service
    this.searchQuery.set(this.appStateService.searchQuery());
    this.selectedTradeUnits.set(this.appStateService.selectedTradeUnits());
    this.selectedGroupNames.set(this.appStateService.selectedGroupNames());
    this.selectedListId.set(this.appStateService.selectedSavedListId() || 'all');

    // Re-run NLQ to populate customerIds for the restored list selection
    if (this.selectedListId() !== 'all') {
      this.onSavedListChange();
    } else {
      this.applyFilters();
    }

    // Load trade unit groups from Entitlements DB — filtered to current user via vw_UserTradeUnitAccess
    this.apiService.getUserTradeUnits().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (groups) => {
        const mapped = groups.map(g => ({
          groupName: g.groupName,
          tradeUnitCodes: g.tradeUnitCodes
        }));
        this.userGroups.set(mapped);
        this.groupsLoading.set(false);
        // Restore group selection, filtering out groups that no longer exist
        const prevGroups = this.appStateService.selectedGroupNames();
        if (prevGroups.length > 0) {
          this.selectedGroupNames.set(prevGroups.filter(g => mapped.some(m => m.groupName === g)));
        }
        // Restore trade unit selection, keeping only units still available
        const prevUnits = this.appStateService.selectedTradeUnits();
        if (prevUnits.length > 0) {
          const allAvailable = this._computeAvailableTradeUnits(mapped, this.selectedGroupNames());
          this.selectedTradeUnits.set(prevUnits.filter(u => allAvailable.includes(u)));
        }
      },
      error: () => { this.groupsLoading.set(false); }
    });

    // Set up search debouncing
    this._searchSubject$.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(searchTerm => {
      this._performSearch(searchTerm);
    });

    // Scroll to last selected customer after first render
    afterNextRender(() => {
      const lastId = this.appStateService.lastScrolledCustomerId();
      if (lastId !== null) {
        const el = this.scrollContainer?.nativeElement
          ?.querySelector<HTMLElement>(`#customer-item-${lastId}`);
        if (el) {
          this._scrollItemIntoView(el, 'auto');
        }
      }
    });

    // React to customers/notes/filteredCustomers changes — filteredCustomers covers the
    // search-with-no-TU case where customers() input is empty but filteredCustomers has results.
    effect(() => {
      this.customers();
      this.filteredCustomers();
      this.notes();
      this._rebuildLastContactCache();
    });

    // React to savedLists changes — validate selectedListId and reapply filters
    effect(() => {
      const savedLists = this.savedLists();
      if (this.selectedListId() !== 'all') {
        const stillExists = savedLists.some(l => String(l.id) === this.selectedListId());
        if (!stillExists) {
          this.selectedListId.set('all');
          this.appStateService.setSelectedSavedListId('all');
        }
      }
      this.applyFilters();
    });

    // React to customers changing — reapply filters
    effect(() => {
      this.customers();
      this.applyFilters();
    });

    // React to selectedCustomer changes — scroll into view
    effect(() => {
      const selectedCustomer = this.selectedCustomer();
      if (selectedCustomer) {
        const newId = selectedCustomer.id;
        if (newId !== this.appStateService.lastScrolledCustomerId()) {
          this.appStateService.setLastScrolledCustomerId(newId);
          setTimeout(() => {
            const el = this.scrollContainer?.nativeElement
              ?.querySelector<HTMLElement>(`#customer-item-${newId}`);
            if (el) {
              this._scrollItemIntoView(el, 'smooth');
            }
          }, 50);
        }
      }
    });
  }

  // ---- Group helpers ----

  getAvailableTradeUnits(): string[] {
    return this._computeAvailableTradeUnits(this.userGroups(), this.selectedGroupNames());
  }

  private _computeAvailableTradeUnits(
    groups: { groupName: string; tradeUnitCodes: string[] }[],
    selectedGroups: string[]
  ): string[] {
    if (groups.length <= 1) return groups[0]?.tradeUnitCodes ?? [];
    if (selectedGroups.length === 0) return [];
    const units = new Set<string>();
    for (const g of groups) {
      if (selectedGroups.includes(g.groupName)) {
        g.tradeUnitCodes.forEach(u => units.add(u));
      }
    }
    return [...units].sort();
  }

  getGroupButtonText(): string {
    const sel = this.selectedGroupNames();
    if (sel.length === 0) return 'Select a Group';
    if (sel.length === 1) return sel[0];
    return `${sel.length} groups selected`;
  }

  isGroupSelected(groupName: string): boolean {
    return this.selectedGroupNames().includes(groupName);
  }

  toggleGroupDropdown(): void {
    this.isGroupDropdownOpen.update(v => !v);
    if (this.isGroupDropdownOpen()) {
      this.isTradeUnitDropdownOpen.set(false);
    }
  }

  toggleGroupSelection(groupName: string): void {
    this.selectedGroupNames.update(names => {
      const idx = names.indexOf(groupName);
      return idx > -1 ? names.filter((_, i) => i !== idx) : [...names, groupName];
    });
    // Remove selected trade units no longer in any selected group
    const available = this.getAvailableTradeUnits();
    this.selectedTradeUnits.update(units => units.filter(u => available.includes(u)));
    this.appStateService.setSelectedGroupNames(this.selectedGroupNames());
    this.onTradeUnitsChange();
  }

  getListMaxHeight(): string {
    const hasSavedLists = !this.loading() && this.getVisibleSavedLists().length > 0;
    const hasGroupDropdown = !this.groupsLoading() && this.userGroups().length > 1;
    let offset = hasSavedLists ? 21 : 16;
    if (hasGroupDropdown) offset += 3;
    return `calc(100vh - ${offset}rem)`;
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
    this.selectedTradeUnits.update(units => {
      const index = units.indexOf(unit);
      if (index > -1) {
        return units.filter((_, i) => i !== index);
      } else {
        return [...units, unit];
      }
    });
    this.onTradeUnitsChange();
  }

  clearAllTradeUnits(): void {
    this.selectedTradeUnits.set([]);
    this.onTradeUnitsChange();
    // Keep dropdown open so user can make new selections
  }

  isTradeUnitSelected(unit: string): boolean {
    return this.selectedTradeUnits().includes(unit);
  }

  getTradeUnitButtonText(): string {
    if (this.selectedTradeUnits().length === 0) {
      return 'Select Trade Units';
    } else if (this.selectedTradeUnits().length === 1) {
      return this.selectedTradeUnits()[0];
    } else {
      return `${this.selectedTradeUnits().length} trade units selected`;
    }
  }

  onTradeUnitsChange(): void {
    const units = this.selectedTradeUnits();
    // If no individual trade units are explicitly selected, use all available units for the
    // selected group(s). This allows a group selection alone to trigger a data load.
    const emitUnits = units.length > 0 ? units : this.getAvailableTradeUnits();
    this.tradeUnitChange.emit(emitUnits);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    this.isGroupDropdownOpen.set(false);
    // Close dropdown when clicking outside
    if (this.isTradeUnitDropdownOpen()) {
      this.closeDropdown();
    }
  }


  /** Scroll a customer item into view within the list container only — never scrolls the document. */
  private _scrollItemIntoView(el: HTMLElement, behavior: ScrollBehavior): void {
    const container = this.scrollContainer?.nativeElement;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const elTop = el.getBoundingClientRect().top;
    const offset = elTop - containerTop;
    const target = container.scrollTop + offset - (container.clientHeight / 2) + (el.clientHeight / 2);
    container.scrollTo({ top: target, behavior });
  }

  applyFilters(): void {
    const searchTerm = this.searchQuery().trim().toLowerCase();

    // Save search query to state service
    this.appStateService.setSearchQuery(this.searchQuery());

    // If there's a search term but no trade units selected, use API search to search all trade units
    if (searchTerm && this.selectedTradeUnits().length === 0) {
      this._searchSubject$.next(searchTerm);
      return;
    }

    // Client-side filtering (instant) when we have customers loaded
    let result = [...this.customers()];

    // Apply search filter (client-side - much faster!)
    if (searchTerm) {
      result = result.filter(c => {
        const searchableText = [
          c.name,
          c.farm,
          c.location,
          c.stateProvince,
          c.phone,
          c.email,
          c.sourceCustomerId
        ].filter(Boolean).join(' ').toLowerCase();

        return searchableText.includes(searchTerm);
      });
    }

    // Apply saved list filter (skip for "all" which means show all customers)
    if (this.selectedListId() && this.selectedListId() !== 'all') {
      const savedList = this.savedLists().find(l => String(l.id) === this.selectedListId());
      if (savedList && savedList.customerIds?.length) {
        result = result.filter(c => savedList.customerIds!.includes(c.id));
      }
    }

    this.filteredCustomers.set(result);
  }

  /** Returns saved lists whose trade units overlap with the currently selected trade units. */
  getVisibleSavedLists(): SavedList[] {
    if (this.selectedTradeUnits().length === 0) return this.savedLists();
    return this.savedLists().filter(list => {
      if (!list.tradeUnits) return true; // Legacy lists without trade units show everywhere
      const listUnits = list.tradeUnits.split(',').map(u => u.trim());
      return listUnits.some(u => this.selectedTradeUnits().includes(u));
    });
  }

  /** Called when the user selects a saved list from the dropdown. Runs the NLQ query dynamically. */
  onSavedListChange(): void {
    this.appStateService.setSelectedSavedListId(this.selectedListId());

    if (!this.selectedListId() || this.selectedListId() === 'all') {
      this.applyFilters();
      return;
    }

    const savedList = this.savedLists().find(l => String(l.id) === this.selectedListId());
    if (!savedList) {
      this.applyFilters();
      return;
    }

    // Build NLQ context from AppStateService cache
    const context: NlqFilterContext = {
      customers: this.customers(),
      contracts: this.appStateService.contracts(),
      tickets: this.appStateService.tickets(),
      notes: this.appStateService.notes(),
      plantingIntentions: this.appStateService.plantingIntentions(),
      storedGrain: this.appStateService.storedGrain()
    };

    // Run the NLQ query, then apply refinement filters, and populate customerIds
    const nlqCustomers = this.nlqFilterService.parseAndFilter(savedList.query, context).customers;
    const refined = savedList.filters
      ? this.nlqFilterService.applyRefinementFilters(nlqCustomers, savedList.filters, this.appStateService.contracts(), this.appStateService.notes())
      : nlqCustomers;
    savedList.customerIds = refined.map(c => c.id);

    this.applyFilters();
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.appStateService.setSearchQuery('');
    this.applyFilters();
  }

  private _performSearch(searchTerm: string): void {
    // Scope to explicitly selected units, then to the selected group's units, then to all user-accessible units
    const explicitUnits = this.selectedTradeUnits();
    const availableUnits = this.getAvailableTradeUnits();
    const tradeUnits = explicitUnits.length > 0 ? explicitUnits
      : availableUnits.length > 0 ? availableUnits
      : undefined;
    this.apiService.searchCustomers(searchTerm, tradeUnits).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (customers) => {
        // Merge producer details into search results (ODS doesn't return these fields)
        let result = customers.map(c => {
          const pd = this.producerDetailsMap().get(c.id);
          if (pd) {
            return {
              ...c,
              totalAcres: pd.totalAcres ?? c.totalAcres,
              binCapacity: pd.binCapacity ?? c.binCapacity,
              primaryContact: pd.primaryContact ?? c.primaryContact,
              commodities: pd.commodities ? pd.commodities.split(',').map(s => s.trim()) : c.commodities
            };
          }
          return c;
        });

        // Apply saved list filter to search results if needed
        if (this.selectedListId()) {
          const savedList = this.savedLists().find(l => String(l.id) === this.selectedListId());
          if (savedList) {
            result = result.filter(c => (savedList.customerIds || []).includes(c.id));
          }
        }
        this.filteredCustomers.set(result);

      },
      error: () => {
        // Fall back to showing initial customers on error
        this.filteredCustomers.set([...this.customers()]);

      }
    });
  }

  /**
   * Performance optimization: Pre-calculate all last contact info once
   * instead of filtering/sorting on every render for every customer.
   *
   * Complexity: O(m + n) where m = notes count, n = customers count
   * Previously: O(n * m) on EVERY change detection cycle
   */
  private _rebuildLastContactCache(): void {
    this.lastContactCache.clear();

    // Group notes by customer ID - single pass through notes O(m)
    const notesByCustomer = new Map<number, Note[]>();
    for (const note of this.notes()) {
      if (!notesByCustomer.has(note.customerId)) {
        notesByCustomer.set(note.customerId, []);
      }
      notesByCustomer.get(note.customerId)!.push(note);
    }

    // Calculate last contact for each customer - single pass O(n)
    // Use filteredCustomers when available (covers API search results when no TU is selected
    // and customers() input is empty). Fall back to customers() for TU-filtered loads.
    const customersToCache = this.filteredCustomers().length > 0 ? this.filteredCustomers() : this.customers();
    for (const customer of customersToCache) {
      const customerNotes = notesByCustomer.get(customer.id) || [];

      if (customerNotes.length === 0) {
        this.lastContactCache.set(customer.id, {
          text: 'Never contacted',
          daysAgo: -1,
          cssClass: 'text-red-500'
        });
        continue;
      }

      // Find most recent note
      const lastNote = customerNotes.reduce((latest, note) => {
        return new Date(note.createdAt).getTime() > new Date(latest.createdAt).getTime() ? note : latest;
      }, customerNotes[0]);

      const daysAgo = Math.max(0, Math.floor((Date.now() - new Date(lastNote.createdAt).getTime()) / (1000 * 60 * 60 * 24)));

      let text: string;
      if (daysAgo === 0) text = 'Today';
      else if (daysAgo === 1) text = '1 day ago';
      else if (daysAgo < 30) text = `${daysAgo} days ago`;
      else if (daysAgo < 365) {
        const months = Math.floor(daysAgo / 30);
        text = months === 1 ? '1 month ago' : `${months} months ago`;
      }
      else {
        const years = Math.floor(daysAgo / 365);
        text = years === 1 ? '1 year ago' : `${years} years ago`;
      }

      const cssClass = this._getLastContactClass(daysAgo);

      this.lastContactCache.set(customer.id, { text, daysAgo, cssClass });
    }
  }

  getCustomerItemClass(customer: Customer): string {
    const isSelected = this.selectedCustomer()?.id === customer.id;
    const baseClass = 'p-4 cursor-pointer transition-colors';
    const stateClass = isSelected
      ? 'bg-green-50 dark:bg-green-900/30'
      : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700';
    return `${baseClass} ${stateClass}`;
  }

  private _getLastContactClass(daysAgo: number): string {
    if (daysAgo < 0) return 'text-red-500';
    if (daysAgo <= 7) return 'text-green-500';
    if (daysAgo <= 30) return 'text-yellow-500';
    return 'text-red-500';
  }

  getFormattedLocation(customer: Customer): string {
    if (!customer.location && !customer.stateProvince) {
      return '';
    }
    if (customer.location && customer.stateProvince) {
      return `${customer.location}, ${customer.stateProvince}`;
    }
    return customer.location || customer.stateProvince || '';
  }

  getFormattedPhone(phone: string): string {
    if (!phone) return '';
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    // Format as (XXX) XXX-XXXX
    if (cleaned.length === 10) {
      return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
    }
    // Return original if not 10 digits
    return phone;
  }
}
