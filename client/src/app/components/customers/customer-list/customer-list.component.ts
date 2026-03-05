import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, AfterViewInit, SimpleChanges, ChangeDetectorRef, ChangeDetectionStrategy, inject, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { Customer, SavedList, Note, ProducerDetails } from '../../../models';
import { ApiService } from '../../../services/api.service';
import { AppStateService } from '../../../services/app-state.service';
import { NlqFilterService, NlqFilterContext } from '../../../services/nlq-filter.service';
import { CardComponent, CardContentComponent } from '../../ui/card/card.component';
import { BadgeComponent } from '../../ui/badge/badge.component';

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
  template: `
    <app-card>
      <app-card-content class="p-0">
        <!-- Header with Title and Filters -->
        <div class="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700 space-y-3">
          <!-- Title Row -->
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Customers</h3>

          <!-- Trade Unit Dropdown -->
          <div class="relative">
            <button
              (click)="toggleTradeUnitDropdown(); $event.stopPropagation()"
              type="button"
              class="w-full h-9 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500 flex items-center gap-2 justify-between transition-colors"
            >
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 text-gray-400">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
                <span class="truncate">{{ getTradeUnitButtonText() }}</span>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 transition-transform" [class.rotate-180]="isTradeUnitDropdownOpen">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            @if (isTradeUnitDropdownOpen) {
              <div
                (click)="$event.stopPropagation()"
                class="absolute left-0 right-0 mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg z-50"
              >
                <div class="max-h-[350px] overflow-y-auto p-2 space-y-1">
                  @for (unit of tradeUnits; track unit) {
                    <label class="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 rounded cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        [checked]="isTradeUnitSelected(unit)"
                        (change)="toggleTradeUnit(unit)"
                        class="rounded border-gray-300 text-green-600 focus:ring-green-500"
                      />
                      <span class="text-sm text-gray-900 dark:text-white">{{ unit }}</span>
                    </label>
                  }
                </div>
                @if (selectedTradeUnits.length > 0) {
                  <div class="border-t border-gray-200 dark:border-gray-600 p-2">
                    <button
                      (click)="clearAllTradeUnits()"
                      type="button"
                      class="w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-md transition-colors flex items-center justify-center gap-2"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6L6 18"/>
                        <path d="M6 6l12 12"/>
                      </svg>
                      Clear All
                    </button>
                  </div>
                }
              </div>
            }
          </div>

          <!-- Search Box -->
          <div class="relative">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
            <input
              type="text"
              [(ngModel)]="searchQuery"
              (ngModelChange)="applyFilters()"
              placeholder="Search customers..."
              class="w-full h-9 pl-10 pr-10 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            @if (searchQuery) {
              <button
                (click)="clearSearch()"
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                aria-label="Clear search"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 6L6 18"/>
                  <path d="M6 6l12 12"/>
                </svg>
              </button>
            }
          </div>
        </div>

        <!-- Saved Lists Filter — only shown after customers have loaded -->
        @if (!loading && getVisibleSavedLists().length > 0) {
          <div class="py-2 border-b border-gray-200 dark:border-gray-700 px-4">
            <select
              [(ngModel)]="selectedListId"
              (ngModelChange)="onSavedListChange()"
              class="w-full h-9 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="all">All Customers</option>
              @for (list of getVisibleSavedLists(); track list.id) {
                <option [value]="list.id" class="text-gray-900 dark:text-white">{{ list.name }}{{ selectedListId === '' + list.id && (list.customerIds || []).length ? ' (' + (list.customerIds || []).length + ')' : '' }}</option>
              }
            </select>
          </div>
        }

        <!-- Customer List -->
        <div #scrollContainer class="divide-y divide-gray-200 dark:divide-gray-700 overflow-y-auto" [style.max-height]="!loading && getVisibleSavedLists().length > 0 ? 'calc(100vh - 21rem)' : 'calc(100vh - 16rem)'"
        >
          @if (loading && selectedTradeUnits.length > 0) {
            <div class="p-8 text-center">
              <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-300 dark:border-gray-600 border-t-green-600 dark:border-t-green-500 mb-4"></div>
              <p class="text-gray-500 dark:text-gray-400 font-medium">Loading customers...</p>
            </div>
          } @else if (selectedTradeUnits.length === 0 && !searchQuery) {
            <div class="p-8 text-center text-gray-500">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 opacity-50">
                <path d="M3 3h18v18H3z"/>
                <path d="M9 3v18"/>
                <path d="M15 3v18"/>
                <path d="M3 9h18"/>
                <path d="M3 15h18"/>
              </svg>
              <p class="font-medium">Select Trade Units</p>
              <p class="text-sm mt-2">Choose one or more trade units from the dropdown above to view customers, or use the search box to search all trade units</p>
            </div>
          } @else if (filteredCustomers.length === 0) {
            <div class="p-8 text-center text-gray-500">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 opacity-50">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <p>No customers found</p>
            </div>
          } @else {
            @for (customer of filteredCustomers; track customer.id) {
              <div
                [id]="'customer-item-' + customer.id"
                (click)="selectCustomer.emit(customer)"
                [class]="getCustomerItemClass(customer)"
              >
                <!-- Row 1: Name and Acres -->
                <div class="flex items-center justify-between gap-2">
                  <h3 class="font-medium text-gray-900 dark:text-white truncate flex-1 min-w-0">{{ customer.name }}</h3>
                  <app-badge variant="secondary" class="flex-shrink-0 whitespace-nowrap">{{ customer.totalAcres | number }} acres</app-badge>
                </div>
                @if (customer.sourceCustomerId) {
                  <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{{ customer.sourceCustomerId }}</p>
                }

                <!-- Details - fixed height container -->
                <div class="space-y-1 mt-1.5 min-h-[88px]">
                  <p class="text-sm text-gray-600 dark:text-gray-400 truncate">{{ customer.farm }}</p>
                  <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                      <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <span class="truncate">{{ getFormattedLocation(customer) }}</span>
                  </div>
                  @if (customer.phone) {
                    <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                      </svg>
                      <span>{{ getFormattedPhone(customer.phone) }}</span>
                    </div>
                  }
                  @if (customer.email) {
                    <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect width="20" height="16" x="2" y="4" rx="2"/>
                        <path d="m2 7 8.97 5.7a1.94 1.94 0 0 0 2.06 0L22 7"/>
                      </svg>
                      <span class="truncate">{{ customer.email }}</span>
                    </div>
                  }
                  <div class="flex items-center gap-2 text-sm" [class]="lastContactCache.get(customer.id)?.cssClass || 'text-red-500'">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                      <line x1="16" x2="16" y1="2" y2="6"/>
                      <line x1="8" x2="8" y1="2" y2="6"/>
                      <line x1="3" x2="21" y1="10" y2="10"/>
                    </svg>
                    <span>{{ lastContactCache.get(customer.id)?.text || 'Never contacted' }}</span>
                  </div>
                </div>
              </div>
            }
          }
        </div>
      </app-card-content>
    </app-card>
  `
})
export class CustomerListComponent implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLElement>;

  @Input() customers: Customer[] = [];
  @Input() selectedCustomer: Customer | null = null;
  @Input() savedLists: SavedList[] = [];
  @Input() notes: Note[] = [];
  @Input() loading: boolean = false;
  @Input() producerDetailsMap = new Map<number, ProducerDetails>();
  @Output() selectCustomer = new EventEmitter<Customer>();
  @Output() tradeUnitChange = new EventEmitter<string[]>();

  private cdr = inject(ChangeDetectorRef);
  private apiService = inject(ApiService);
  private appStateService = inject(AppStateService);
  private nlqFilterService = inject(NlqFilterService);
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();

  searchQuery = '';
  selectedListId = 'all';
  selectedTradeUnits: string[] = [];
  tradeUnits: string[] = [];
  filteredCustomers: Customer[] = [];
  isTradeUnitDropdownOpen = false;

  // Performance optimization: Cache last contact info to avoid repeated filtering/sorting
  lastContactCache = new Map<number, LastContactInfo>();

  ngOnInit(): void {
    this.rebuildLastContactCache();

    // Restore state from service
    this.searchQuery = this.appStateService.searchQuery();
    this.selectedTradeUnits = this.appStateService.selectedTradeUnits();
    this.selectedListId = this.appStateService.selectedSavedListId() || 'all';

    // Re-run NLQ to populate customerIds for the restored list selection
    if (this.selectedListId !== 'all') {
      this.onSavedListChange();
    } else {
      this.applyFilters();
    }

    // Load trade units
    this.apiService.getTradeUnits().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (units) => {
        this.tradeUnits = units;
        this.cdr.markForCheck();
      },
      error: () => {}
    });

    // Set up search debouncing
    this.searchSubject$.pipe(
      debounceTime(150), // Wait 150ms after user stops typing
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(searchTerm => {
      this.performSearch(searchTerm);
    });
  }

  toggleTradeUnitDropdown(): void {
    this.isTradeUnitDropdownOpen = !this.isTradeUnitDropdownOpen;
  }

  closeDropdown(): void {
    this.isTradeUnitDropdownOpen = false;
  }

  toggleTradeUnit(unit: string): void {
    const index = this.selectedTradeUnits.indexOf(unit);
    if (index > -1) {
      this.selectedTradeUnits.splice(index, 1);
    } else {
      this.selectedTradeUnits.push(unit);
    }
    this.onTradeUnitsChange();
  }

  clearAllTradeUnits(): void {
    this.selectedTradeUnits = [];
    this.onTradeUnitsChange();
    // Keep dropdown open so user can make new selections
  }

  isTradeUnitSelected(unit: string): boolean {
    return this.selectedTradeUnits.includes(unit);
  }

  getTradeUnitButtonText(): string {
    if (this.selectedTradeUnits.length === 0) {
      return 'Select Trade Units';
    } else if (this.selectedTradeUnits.length === 1) {
      return this.selectedTradeUnits[0];
    } else {
      return `${this.selectedTradeUnits.length} trade units selected`;
    }
  }

  onTradeUnitsChange(): void {
    // Emit the array of selected trade units
    this.tradeUnitChange.emit(this.selectedTradeUnits);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    // Close dropdown when clicking outside
    if (this.isTradeUnitDropdownOpen) {
      this.closeDropdown();
      this.cdr.markForCheck();
    }
  }

  ngAfterViewInit(): void {
    // When this component is recreated after navigation (scroll position is lost),
    // scroll back to the last selected customer so they're still visible.
    const lastId = this.appStateService.lastScrolledCustomerId();
    if (lastId !== null) {
      setTimeout(() => {
        const el = this.scrollContainer?.nativeElement
          ?.querySelector<HTMLElement>(`#customer-item-${lastId}`);
        if (el) {
          this.scrollItemIntoView(el, 'auto');
        }
      }, 50);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Rebuild cache when notes or customers change (customers may load after notes)
    if (changes['notes'] || changes['customers']) {
      this.rebuildLastContactCache();
    }

    if (changes['savedLists'] && this.selectedListId !== 'all') {
      const stillExists = this.savedLists.some(l => String(l.id) === this.selectedListId);
      if (!stillExists) {
        this.selectedListId = 'all';
        this.appStateService.setSelectedSavedListId('all');
      }
    }

    if (changes['customers'] || changes['savedLists']) {
      this.applyFilters();
    }

    // Force UI update when selected customer changes
    if (changes['selectedCustomer'] || changes['notes']) {
      this.cdr.markForCheck();
    }

    // Scroll the selected customer into view only when the ID actually changes.
    // lastScrolledCustomerId lives in AppStateService so it survives navigation —
    // coming back to the same screen with the same customer will not re-scroll.
    if (changes['selectedCustomer'] && this.selectedCustomer) {
      const newId = this.selectedCustomer.id;
      if (newId !== this.appStateService.lastScrolledCustomerId()) {
        this.appStateService.setLastScrolledCustomerId(newId);
        setTimeout(() => {
          const el = this.scrollContainer?.nativeElement
            ?.querySelector<HTMLElement>(`#customer-item-${newId}`);
          if (el) {
            this.scrollItemIntoView(el, 'smooth');
          }
        }, 50);
      }
    }
  }

  /** Scroll a customer item into view within the list container only — never scrolls the document. */
  private scrollItemIntoView(el: HTMLElement, behavior: ScrollBehavior): void {
    const container = this.scrollContainer?.nativeElement;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const elTop = el.getBoundingClientRect().top;
    const offset = elTop - containerTop;
    const target = container.scrollTop + offset - (container.clientHeight / 2) + (el.clientHeight / 2);
    container.scrollTo({ top: target, behavior });
  }

  applyFilters(): void {
    const searchTerm = this.searchQuery.trim().toLowerCase();

    // Save search query to state service
    this.appStateService.setSearchQuery(this.searchQuery);

    // If there's a search term but no trade units selected, use API search to search all trade units
    if (searchTerm && this.selectedTradeUnits.length === 0) {
      this.searchSubject$.next(searchTerm);
      return;
    }

    // Client-side filtering (instant) when we have customers loaded
    let result = [...this.customers];

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
    if (this.selectedListId && this.selectedListId !== 'all') {
      const savedList = this.savedLists.find(l => String(l.id) === this.selectedListId);
      if (savedList && savedList.customerIds?.length) {
        result = result.filter(c => savedList.customerIds!.includes(c.id));
      }
    }

    this.filteredCustomers = result;
    this.cdr.markForCheck();
  }

  /** Returns saved lists whose trade units overlap with the currently selected trade units. */
  getVisibleSavedLists(): SavedList[] {
    if (this.selectedTradeUnits.length === 0) return this.savedLists;
    return this.savedLists.filter(list => {
      if (!list.tradeUnits) return true; // Legacy lists without trade units show everywhere
      const listUnits = list.tradeUnits.split(',').map(u => u.trim());
      return listUnits.some(u => this.selectedTradeUnits.includes(u));
    });
  }

  /** Called when the user selects a saved list from the dropdown. Runs the NLQ query dynamically. */
  onSavedListChange(): void {
    this.appStateService.setSelectedSavedListId(this.selectedListId);

    if (!this.selectedListId || this.selectedListId === 'all') {
      this.applyFilters();
      return;
    }

    const savedList = this.savedLists.find(l => String(l.id) === this.selectedListId);
    if (!savedList) {
      this.applyFilters();
      return;
    }

    // Build NLQ context from AppStateService cache
    const context: NlqFilterContext = {
      customers: this.customers,
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
    this.searchQuery = '';
    this.appStateService.setSearchQuery('');
    this.applyFilters();
  }

  private performSearch(searchTerm: string): void {
    // Pass selectedTradeUnits to search - if no trade units selected, searches all trade units
    const tradeUnits = this.selectedTradeUnits.length > 0 ? this.selectedTradeUnits : undefined;
    this.apiService.searchCustomers(searchTerm, tradeUnits).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (customers) => {
        // Merge producer details into search results (ODS doesn't return these fields)
        let result = customers.map(c => {
          const pd = this.producerDetailsMap.get(c.id);
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
        if (this.selectedListId) {
          const savedList = this.savedLists.find(l => String(l.id) === this.selectedListId);
          if (savedList) {
            result = result.filter(c => (savedList.customerIds || []).includes(c.id));
          }
        }
        this.filteredCustomers = result;
        this.cdr.markForCheck();
      },
      error: () => {
        // Fall back to showing initial customers on error
        this.filteredCustomers = [...this.customers];
        this.cdr.markForCheck();
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
  private rebuildLastContactCache(): void {
    this.lastContactCache.clear();

    // Group notes by customer ID - single pass through notes O(m)
    const notesByCustomer = new Map<number, Note[]>();
    for (const note of this.notes) {
      if (!notesByCustomer.has(note.customerId)) {
        notesByCustomer.set(note.customerId, []);
      }
      notesByCustomer.get(note.customerId)!.push(note);
    }

    // Calculate last contact for each customer - single pass O(n)
    for (const customer of this.customers) {
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

      const cssClass = this.getLastContactClass(daysAgo);

      this.lastContactCache.set(customer.id, { text, daysAgo, cssClass });
    }
  }

  getCustomerItemClass(customer: Customer): string {
    const isSelected = this.selectedCustomer?.id === customer.id;
    const baseClass = 'p-4 cursor-pointer transition-colors';
    const stateClass = isSelected
      ? 'bg-green-50 dark:bg-green-900/30'
      : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700';
    return `${baseClass} ${stateClass}`;
  }

  private getLastContactClass(daysAgo: number): string {
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
