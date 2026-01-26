import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, ChangeDetectorRef, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Customer, SavedList, Note } from '../../../models';
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
        <!-- Title and Search -->
        <div class="px-4 pt-3 pb-2">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Customers</h3>
        </div>
        <div class="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
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
              class="w-full h-10 pl-10 pr-4 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>

        <!-- Saved Lists Filter -->
        @if (savedLists.length > 0) {
          <div class="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
            <select
              [(ngModel)]="selectedListId"
              (ngModelChange)="applyFilters()"
              class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">All Customers</option>
              @for (list of savedLists; track list.id) {
                <option [value]="list.id">{{ list.name }} ({{ list.customerIds.length }})</option>
              }
            </select>
          </div>
        }

        <!-- Customer List -->
        <div class="divide-y divide-gray-200 dark:divide-gray-700 max-h-[calc(100vh-12rem)] lg:max-h-[calc(100vh-16rem)] overflow-y-auto">
          @if (filteredCustomers.length === 0) {
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
                (click)="selectCustomer.emit(customer)"
                [class]="getCustomerItemClass(customer)"
              >
                <!-- Row 1: Name and Acres -->
                <div class="flex items-center justify-between">
                  <h3 class="font-medium text-gray-900 dark:text-white truncate">{{ customer.name }}</h3>
                  <app-badge variant="secondary">{{ customer.totalAcres | number }} acres</app-badge>
                </div>

                <!-- Details - fixed height container -->
                <div class="space-y-1 mt-2 min-h-[88px]">
                  <p class="text-sm text-gray-600 dark:text-gray-400 truncate">{{ customer.farm }}</p>
                  <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                      <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <span class="truncate">{{ customer.location }}</span>
                  </div>
                  <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 h-5">
                    @if (customer.phone) {
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                      </svg>
                      <span>{{ customer.phone }}</span>
                    }
                  </div>
                  <div class="flex items-center gap-2 text-sm" [class]="lastContactCache.get(customer.id)?.cssClass || 'text-red-500'">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                      <line x1="16" x2="16" y1="2" y2="6"/>
                      <line x1="8" x2="8" y1="2" y2="6"/>
                      <line x1="3" x2="21" y1="10" y2="10"/>
                    </svg>
                    <span>{{ lastContactCache.get(customer.id)?.text || 'No contact' }}</span>
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
export class CustomerListComponent implements OnInit, OnChanges {
  @Input() customers: Customer[] = [];
  @Input() selectedCustomer: Customer | null = null;
  @Input() savedLists: SavedList[] = [];
  @Input() notes: Note[] = [];
  @Output() selectCustomer = new EventEmitter<Customer>();

  private cdr = inject(ChangeDetectorRef);

  searchQuery = '';
  selectedListId = '';
  filteredCustomers: Customer[] = [];

  // Performance optimization: Cache last contact info to avoid repeated filtering/sorting
  lastContactCache = new Map<string, LastContactInfo>();

  ngOnInit(): void {
    this.rebuildLastContactCache();
    this.applyFilters();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Rebuild cache when notes change
    if (changes['notes']) {
      this.rebuildLastContactCache();
    }

    if (changes['customers'] || changes['savedLists']) {
      this.applyFilters();
    }

    // Force UI update when selected customer changes
    if (changes['selectedCustomer'] || changes['notes']) {
      this.cdr.markForCheck();
    }
  }

  applyFilters(): void {
    let result = [...this.customers];

    // Apply search filter
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.farm.toLowerCase().includes(query) ||
        c.location.toLowerCase().includes(query) ||
        c.email.toLowerCase().includes(query)
      );
    }

    // Apply saved list filter
    if (this.selectedListId) {
      const savedList = this.savedLists.find(l => l.id === this.selectedListId);
      if (savedList) {
        result = result.filter(c => savedList.customerIds.includes(c.id));
      }
    }

    this.filteredCustomers = result;
    this.cdr.markForCheck();
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
    const notesByCustomer = new Map<string, Note[]>();
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
          text: 'No contact',
          daysAgo: -1,
          cssClass: 'text-red-500'
        });
        continue;
      }

      // Find most recent note
      const lastNote = customerNotes.reduce((latest, note) => {
        return new Date(note.createdAt).getTime() > new Date(latest.createdAt).getTime() ? note : latest;
      }, customerNotes[0]);

      const daysAgo = Math.floor((Date.now() - new Date(lastNote.createdAt).getTime()) / (1000 * 60 * 60 * 24));

      let text: string;
      if (daysAgo === 0) text = 'Today';
      else if (daysAgo === 1) text = 'Yesterday';
      else if (daysAgo < 7) text = `${daysAgo} days ago`;
      else if (daysAgo < 30) text = `${Math.floor(daysAgo / 7)} weeks ago`;
      else if (daysAgo < 365) text = `${Math.floor(daysAgo / 30)} months ago`;
      else text = `${Math.floor(daysAgo / 365)} years ago`;

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
}
