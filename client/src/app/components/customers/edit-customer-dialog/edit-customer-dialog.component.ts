import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '../../ui/dialog/dialog.component';
import { Customer, Ticket, Commodity } from '../../../models';
import { ApiService } from '../../../services/api.service';

@Component({
  selector: 'app-edit-customer-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogContentComponent,
    DialogFooterComponent
  ],
  template: `
    @if (isOpen && customer) {
      <app-dialog [isOpen]="true" (close)="onCancel()">
        <app-dialog-header>
          <app-dialog-title>Edit Producer Details</app-dialog-title>
          <app-dialog-description>Update farm details and manage associations for {{ customer.name }}</app-dialog-description>
        </app-dialog-header>

        <app-dialog-content>
          <div class="space-y-6">
            <!-- Producer Details Section -->
            <div class="space-y-4">
              <h4 class="font-medium text-gray-900 dark:text-white">Farm Details</h4>

              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <label class="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m10 11 11 .9a1 1 0 0 1 .8 1.1l-.665 4.158a1 1 0 0 1-.988.842H20"/>
                      <path d="M16 18h-5"/><path d="M18 5a1 1 0 0 0-1 1v5.573"/>
                      <path d="M3 4h8.129a1 1 0 0 1 .99.863L13 11.246"/>
                      <path d="M4 11V4"/><path d="M7 15h.01"/><path d="M8 10.1V4"/>
                      <circle cx="18" cy="18" r="2"/><circle cx="7" cy="15" r="5"/>
                    </svg>
                    Acres
                  </label>
                  <div class="relative">
                    <input
                      type="number"
                      [(ngModel)]="editAcres"
                      placeholder="e.g., 1200"
                      (focus)="clearZeroOnFocus('editAcres')"
                      (blur)="restoreZeroOnBlur('editAcres')"
                      class="w-full h-10 px-3 pr-8 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    @if (editAcres) {
                      <button type="button" (click)="editAcres = null" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                      </button>
                    }
                  </div>
                </div>

                <div class="space-y-2">
                  <label class="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/>
                    </svg>
                    Bin Capacity (bu)
                  </label>
                  <div class="relative">
                    <input
                      type="number"
                      [(ngModel)]="editBinCapacity"
                      placeholder="e.g., 45000"
                      (focus)="clearZeroOnFocus('editBinCapacity')"
                      (blur)="restoreZeroOnBlur('editBinCapacity')"
                      class="w-full h-10 px-3 pr-8 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    @if (editBinCapacity) {
                      <button type="button" (click)="editBinCapacity = null" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                      </button>
                    }
                  </div>
                </div>
              </div>

              <!-- Primary Contact -->
              <div class="space-y-2">
                <label class="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  Primary Contact
                </label>
                <div class="relative">
                  <input
                    type="text"
                    [(ngModel)]="editPrimaryContact"
                    placeholder="e.g., John Smith"
                    class="w-full h-10 px-3 pr-8 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  @if (editPrimaryContact) {
                    <button type="button" (click)="editPrimaryContact = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                    </button>
                  }
                </div>
              </div>

              <!-- Commodities -->
              <div class="space-y-2">
                <label class="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 22 16 8"/>
                    <path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
                    <path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
                    <path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
                    <path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z"/>
                    <path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>
                    <path d="M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>
                    <path d="M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>
                  </svg>
                  Commodities
                </label>
                @if (editCommodities.length > 0) {
                  <div class="flex flex-wrap gap-1.5 mb-2">
                    @for (commodity of editCommodities; track commodity) {
                      @if (isTicketCommodity(commodity)) {
                        <!-- Ticket-derived: read-only, no remove -->
                        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" title="From tickets">
                          {{ commodity }}
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-40">
                            <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                          </svg>
                        </span>
                      } @else {
                        <!-- User-added: removable -->
                        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                          {{ commodity }}
                          <button type="button" (click)="removeCommodity(commodity)" class="hover:text-amber-600 dark:hover:text-amber-200 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M18 6L6 18"/><path d="M6 6l12 12"/>
                            </svg>
                          </button>
                        </span>
                      }
                    }
                  </div>
                }
                <div class="relative">
                  <div class="relative">
                    <input
                      type="text"
                      [(ngModel)]="newCommodity"
                      placeholder="Search commodities..."
                      (input)="onCommoditySearch()"
                      (keydown.enter)="selectFirstSuggestion()"
                      (focus)="showSuggestions = true"
                      (blur)="hideSuggestionsDelayed()"
                      class="w-full h-10 px-3 pr-8 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    @if (newCommodity) {
                      <button type="button" (mousedown)="clearCommoditySearch()" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                      </button>
                    }
                  </div>
                  @if (showSuggestions && filteredCommodities.length > 0) {
                    <div class="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-y-auto">
                      @for (commodity of filteredCommodities; track commodity.id) {
                        <button
                          type="button"
                          class="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white transition-colors"
                          (mousedown)="selectCommodity(commodity)"
                        >
                          <span class="font-medium">{{ commodity.name }}</span>
                          <span class="text-gray-400 dark:text-gray-500 ml-1.5">({{ commodity.code }})</span>
                        </button>
                      }
                    </div>
                  }
                </div>
              </div>

            </div>

            <!-- Separator -->
            <div class="border-t border-gray-200 dark:border-gray-700"></div>

            <!-- Link Producers Section -->
            <div class="space-y-4">
              <h4 class="font-medium text-gray-900 dark:text-white">Link Producers</h4>

              @if (!editPrimaryContact.trim()) {
                <p class="text-sm text-amber-600 dark:text-amber-400">A Primary Contact is required before linking producers.</p>
              } @else {

                <!-- Outgoing Links: Producers this customer links to -->
                @if (editLinkedProducerIds.length > 0) {
                  <div class="space-y-2">
                    <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Linked To:</div>
                    @for (producerId of editLinkedProducerIds; track producerId) {
                      @if (getProducerById(producerId); as producer) {
                        <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                          <div>
                            <div class="font-medium text-gray-900 dark:text-white">{{ producer.name }}</div>
                            <div class="text-xs text-gray-500 dark:text-gray-400">{{ producer.sourceCustomerId || producer.location }}</div>
                          </div>
                          <button
                            type="button"
                            class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 w-8"
                            (click)="removeLinkedProducer(producerId)"
                            title="Unlink"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/>
                            </svg>
                          </button>
                        </div>
                      }
                    }
                  </div>
                }

                <!-- Incoming Links: Producers that link to this customer -->
                @if (getProducersLinkingToMe().length > 0) {
                  <div class="space-y-2">
                    <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Linked From:</div>
                    @for (producer of getProducersLinkingToMe(); track producer.id) {
                      <div class="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div>
                          <div class="font-medium text-gray-900 dark:text-white">{{ producer.name }}</div>
                          <div class="text-xs text-gray-500 dark:text-gray-400">{{ producer.sourceCustomerId || producer.location }}</div>
                        </div>
                        <button
                          type="button"
                          class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 w-8"
                          (click)="removeIncomingLink(producer.id.toString())"
                          title="Unlink from {{ producer.name }}"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    }
                  </div>
                }

                <!-- Search to add a linked producer -->
                <div class="space-y-2">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Search to Link Producer</label>
                  <div class="relative">
                    <input
                      type="text"
                      [(ngModel)]="newProducerSearch"
                      placeholder="Search by name, ID, or customer code..."
                      (input)="onProducerSearch()"
                      (focus)="showProducerSuggestions = true"
                      (blur)="hideProducerSuggestionsDelayed()"
                      class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    @if (newProducerSearch) {
                      <button type="button" (mousedown)="newProducerSearch = ''; filteredProducers = []; showProducerSuggestions = false" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                      </button>
                    }
                    @if (showProducerSuggestions && filteredProducers.length > 0) {
                      <div class="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        @for (producer of filteredProducers; track producer.id) {
                          <button
                            type="button"
                            class="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white transition-colors"
                            (mousedown)="selectProducer(producer)"
                          >
                            <span class="font-medium">{{ producer.name }}</span>
                            @if (producer.sourceCustomerId) {
                              <span class="text-gray-400 dark:text-gray-500 ml-1.5">{{ producer.sourceCustomerId }}</span>
                            }
                          </button>
                        }
                      </div>
                    }
                  </div>
                </div>

              }
            </div>
          </div>
        </app-dialog-content>

        <app-dialog-footer>
          <button
            type="button"
            class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-gray-300 dark:border-gray-600 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 h-10 px-4 py-2"
            (click)="onCancel()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-green-600 text-white hover:bg-green-700 h-10 px-4 py-2"
            [disabled]="!hasChanges()"
            (click)="onSave()"
          >
            Save Changes
          </button>
        </app-dialog-footer>
      </app-dialog>
    }
  `
})
export class EditCustomerDialogComponent implements OnChanges {
  private cdr = inject(ChangeDetectorRef);
  private apiService = inject(ApiService);

  @Input() isOpen = false;
  @Input() customer: Customer | null = null;
  @Input() tickets: Ticket[] = [];
  @Input() allCustomers: Customer[] = [];

  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<{
    customerId: number;
    acres: number;
    binCapacity: number;
    commodities: string[];
    primaryContact: string;
    linkedProducerIds: string[];
    eSignEnabled: boolean;
  }>();

  editAcres: number | null = null;
  editBinCapacity: number | null = null;
  editCommodities: string[] = [];
  private ticketCommoditySet = new Set<string>();
  editLinkedProducerIds: string[] = [];
  editESignEnabled = false;
  editPrimaryContact = '';
  newCommodity = '';

  // Commodity lookup
  allCommodities: Commodity[] = [];
  filteredCommodities: Commodity[] = [];
  showSuggestions = false;

  // Producer search
  newProducerSearch = '';
  filteredProducers: Customer[] = [];
  showProducerSuggestions = false;

  // Original values to track changes
  private originalAcres: number = 0;
  private originalBinCapacity: number = 0;
  private originalCommodities: string[] = [];
  private originalLinkedProducerIds: string[] = [];
  private originalESignEnabled = false;
  private originalPrimaryContact = '';

  private initialized = false;

  ngOnChanges(changes: SimpleChanges): void {
    // When isOpen becomes true, initialize the form from the customer
    if (this.isOpen && this.customer && !this.initialized) {
      this.editAcres = this.customer.totalAcres || 0;
      this.editBinCapacity = this.customer.binCapacity || 0;
      const ticketCommodities = [...new Set(
        this.tickets.map(t => t.productCode || '').filter(Boolean)
      )];
      this.ticketCommoditySet = new Set(ticketCommodities);
      const userCommodities = this.customer.commodities || [];
      this.editCommodities = [...new Set([...ticketCommodities, ...userCommodities])].sort();
      this.editLinkedProducerIds = [...(this.customer.linkedProducerIds || [])];
      this.editESignEnabled = this.customer.eSignEnabled;
      this.editPrimaryContact = this.customer.primaryContact || '';

      // Store original values
      this.originalAcres = this.customer.totalAcres || 0;
      this.originalBinCapacity = this.customer.binCapacity || 0;
      this.originalCommodities = [...this.editCommodities];
      this.originalLinkedProducerIds = [...(this.customer.linkedProducerIds || [])];
      this.originalESignEnabled = this.customer.eSignEnabled;
      this.originalPrimaryContact = this.customer.primaryContact || '';

      // Load commodity lookup table
      if (this.allCommodities.length === 0) {
        this.apiService.getCommodities().subscribe(commodities => {
          this.allCommodities = commodities;
          this.cdr.markForCheck();
        });
      }

      this.initialized = true;
    }

    // Reset initialized flag when dialog closes
    if (!this.isOpen) {
      this.initialized = false;
    }

    // Force change detection
    this.cdr.markForCheck();
  }

  hasChanges(): boolean {
    if (!this.customer) return false;

    const linkedProducerIdsChanged = this.editLinkedProducerIds.length !== this.originalLinkedProducerIds.length
      || this.editLinkedProducerIds.some(id => !this.originalLinkedProducerIds.includes(id));

    const commoditiesChanged = this.editCommodities.length !== this.originalCommodities.length
      || this.editCommodities.some(c => !this.originalCommodities.includes(c));

    return (this.editAcres || 0) !== this.originalAcres
      || (this.editBinCapacity || 0) !== this.originalBinCapacity
      || commoditiesChanged
      || this.editESignEnabled !== this.originalESignEnabled
      || this.editPrimaryContact !== this.originalPrimaryContact
      || linkedProducerIdsChanged;
  }

  addCommodity(): void {
    const commodity = this.newCommodity.trim();
    if (commodity && !this.editCommodities.includes(commodity)) {
      this.editCommodities = [...this.editCommodities, commodity];
      this.newCommodity = '';
    }
  }

  isTicketCommodity(commodity: string): boolean {
    return this.ticketCommoditySet.has(commodity);
  }

  removeCommodity(commodity: string): void {
    if (this.isTicketCommodity(commodity)) return;
    this.editCommodities = this.editCommodities.filter(c => c !== commodity);
  }

  onCommoditySearch(): void {
    const term = this.newCommodity.trim().toLowerCase();
    if (!term) {
      this.filteredCommodities = [];
      return;
    }
    this.filteredCommodities = this.allCommodities.filter(c =>
      (c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term))
      && !this.editCommodities.some(ec => ec === c.name || ec === c.code)
    );
    this.showSuggestions = true;
  }

  selectCommodity(commodity: Commodity): void {
    if (!this.editCommodities.some(ec => ec === commodity.name || ec === commodity.code)) {
      this.editCommodities = [...this.editCommodities, commodity.name];
    }
    this.newCommodity = '';
    this.filteredCommodities = [];
    this.showSuggestions = false;
  }

  selectFirstSuggestion(): void {
    if (this.filteredCommodities.length > 0) {
      this.selectCommodity(this.filteredCommodities[0]);
    }
  }

  clearZeroOnFocus(field: 'editAcres' | 'editBinCapacity'): void {
    if (this[field] === 0) {
      this[field] = null;
    }
  }

  restoreZeroOnBlur(field: 'editAcres' | 'editBinCapacity'): void {
    if (this[field] === null || this[field] === undefined) {
      this[field] = 0;
    }
  }

  clearCommoditySearch(): void {
    this.newCommodity = '';
    this.filteredCommodities = [];
    this.showSuggestions = false;
  }

  hideSuggestionsDelayed(): void {
    // Delay to allow mousedown on suggestion to fire first
    setTimeout(() => { this.showSuggestions = false; }, 200);
  }

  getProducerById(producerId: string): Customer | undefined {
    const producerIdNum = parseInt(producerId, 10);
    return this.allCustomers.find(c => c.id === producerIdNum);
  }

  getProducersLinkingToMe(): Customer[] {
    if (!this.customer) return [];
    return this.allCustomers.filter(c =>
      c.linkedProducerIds && c.linkedProducerIds.includes(this.customer!.id.toString())
    );
  }

  onProducerSearch(): void {
    const term = this.newProducerSearch.trim().toLowerCase();
    if (!term) {
      this.filteredProducers = [];
      return;
    }
    this.filteredProducers = this.allCustomers.filter(c =>
      c.id !== this.customer?.id &&
      !this.editLinkedProducerIds.includes(c.id.toString()) &&
      (
        c.name.toLowerCase().includes(term) ||
        c.id.toString().includes(term) ||
        (c.sourceCustomerId || '').toLowerCase().includes(term)
      )
    );
    this.showProducerSuggestions = true;
  }

  selectProducer(producer: Customer): void {
    const idStr = producer.id.toString();
    if (!this.editLinkedProducerIds.includes(idStr)) {
      this.editLinkedProducerIds = [...this.editLinkedProducerIds, idStr];
    }
    this.newProducerSearch = '';
    this.filteredProducers = [];
    this.showProducerSuggestions = false;
  }

  hideProducerSuggestionsDelayed(): void {
    setTimeout(() => { this.showProducerSuggestions = false; }, 200);
  }

  removeLinkedProducer(producerId: string): void {
    this.editLinkedProducerIds = this.editLinkedProducerIds.filter(id => id !== producerId);
  }

  removeIncomingLink(producerId: string): void {
    alert(`To unlink from ${this.getProducerById(producerId)?.name}, please edit that producer and remove this link from there.`);
  }

  onCancel(): void {
    // Reset all fields back to original values
    this.editAcres = this.originalAcres || null;
    this.editBinCapacity = this.originalBinCapacity || null;
    this.editCommodities = [...this.originalCommodities];
    this.editLinkedProducerIds = [...this.originalLinkedProducerIds];
    this.editESignEnabled = this.originalESignEnabled;
    this.editPrimaryContact = this.originalPrimaryContact;
    this.newCommodity = '';
    this.filteredCommodities = [];
    this.showSuggestions = false;
    this.newProducerSearch = '';
    this.filteredProducers = [];
    this.showProducerSuggestions = false;
    this.initialized = false;
    this.close.emit();
  }

  onSave(): void {
    if (this.customer) {
      // Only save user-added commodities to ProducerDetails — ticket-derived ones are
      // always re-derived fresh from current tickets, so they should never be persisted.
      this.save.emit({
        customerId: this.customer.id,
        acres: this.editAcres || 0,
        binCapacity: this.editBinCapacity || 0,
        commodities: this.editCommodities.filter(c => !this.isTicketCommodity(c)),
        primaryContact: this.editPrimaryContact,
        linkedProducerIds: this.editLinkedProducerIds,
        eSignEnabled: this.editESignEnabled
      });
      this.initialized = false;
      this.close.emit();
    }
  }
}
