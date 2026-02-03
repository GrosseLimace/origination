import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, Farm, SavedList } from '../../models';
import { CustomerListComponent } from '../../components/customers/customer-list/customer-list.component';
import { CustomerProfileComponent } from '../../components/customers/customer-profile/customer-profile.component';
import { CustomerNotesComponent } from '../../components/customers/customer-notes/customer-notes.component';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent } from '../../components/ui/card/card.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    CustomerListComponent,
    CustomerProfileComponent,
    CustomerNotesComponent,
    CardComponent,
    CardContentComponent,
    CardHeaderComponent,
    CardTitleComponent
  ],
  template: `
    <!-- When no customer selected: centered layout -->
    @if (!selectedCustomer) {
      <div class="flex justify-center items-start min-h-[calc(100vh-8rem)] py-8">
        <div class="flex flex-col lg:flex-row gap-6 max-w-6xl w-full px-4">
          <!-- Customer List -->
          <div class="w-full lg:w-[400px] shrink-0">
            <app-customer-list
              [customers]="customers"
              [selectedCustomer]="selectedCustomer"
              [savedLists]="savedLists"
              [notes]="notes"
              (selectCustomer)="handleSelectCustomer($event)"
            />
          </div>
          <!-- Select Customer Prompt -->
          <div class="w-full lg:w-[700px]">
            <app-card class="p-12 text-center">
              <app-card-content>
                <div class="text-gray-500 dark:text-gray-400">
                  <svg class="mx-auto h-16 w-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                  </svg>
                  <h3 class="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">
                    Select a Customer
                  </h3>
                  <p class="mt-2">
                    Choose a customer from the list to view their details, contracts, tickets, and more.
                  </p>
                </div>
              </app-card-content>
            </app-card>
          </div>
        </div>
      </div>
    }

    <!-- When customer selected: 2-column layout -->
    @if (selectedCustomer) {
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <!-- Customer List - Wider on larger screens -->
        <div class="lg:col-span-3 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)]" [class.hidden]="isMobile">
          <app-customer-list
            [customers]="customers"
            [selectedCustomer]="selectedCustomer"
            [savedLists]="savedLists"
            [notes]="notes"
            (selectCustomer)="handleSelectCustomer($event)"
          />
        </div>

        <!-- Profile and Notes Container - Takes remaining space -->
        <div class="lg:col-span-9">
          <!-- Laptop: Stacked layout. Large Monitor (2xl+): Side-by-side layout -->
          <div class="2xl:grid 2xl:grid-cols-8 2xl:gap-6 space-y-6 2xl:space-y-0">
            <!-- Profile Section - Full width on laptop, 5/8 on large monitor -->
            <div class="2xl:col-span-5 space-y-6">
              <!-- Back button on mobile -->
              <button
                class="lg:hidden flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mb-4"
                (click)="selectedCustomer = null"
              >
                <svg class="h-5 w-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                </svg>
                Back to Customers
              </button>

              <!-- Profile -->
              <app-customer-profile
                [customer]="selectedCustomer"
                [farms]="customerFarms"
                [allFarms]="farms"
                [allCustomers]="customers"
                [contracts]="customerContracts"
                [tickets]="customerTickets"
                [plantingIntentions]="customerPlantingIntentions"
                [storedGrain]="customerStoredGrain"
                [notes]="customerNotes"
                [selectedFarmId]="selectedFarmId"
                [allCustomerContracts]="allCustomerContracts"
                [allCustomerTickets]="allCustomerTickets"
                [allCustomerPlantingIntentions]="allCustomerPlantingIntentions"
                [allCustomerStoredGrain]="allCustomerStoredGrain"
                (onAddPlanting)="addPlantingIntention($event)"
                (onEditPlanting)="editPlantingIntention($event)"
                (onDeletePlanting)="deletePlantingIntention($event)"
                (onAddNote)="addNote($event)"
                (onTogglePin)="toggleNotePin($event)"
                (onFarmChange)="handleFarmChange($event)"
                (onSaveCustomer)="handleSaveCustomer($event)"
                (onCreateFarm)="handleCreateFarm($event)">
              </app-customer-profile>
            </div>

            <!-- Notes Section - Below profile on laptop, beside on large monitor (2xl+) -->
            <div class="2xl:col-span-3 2xl:sticky 2xl:top-20 2xl:self-start 2xl:max-h-[calc(100vh-6rem)] 2xl:overflow-auto">
              <app-card>
                <app-card-header>
                  <div class="flex items-center justify-between">
                    <app-card-title>Notes</app-card-title>
                    <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                        <line x1="16" x2="16" y1="2" y2="6"/>
                        <line x1="8" x2="8" y1="2" y2="6"/>
                        <line x1="3" x2="21" y1="10" y2="10"/>
                      </svg>
                      <span class="hidden sm:inline">Last contacted: {{ getLastContactedDate() }}</span>
                    </div>
                  </div>
                </app-card-header>
                <app-card-content>
                  <app-customer-notes
                    [notes]="customerNotes"
                    [customer]="selectedCustomer"
                    (addNote)="addNote($event)"
                    (togglePin)="toggleNotePin($event)"
                    (editNote)="editNote($event)"
                    (deleteNote)="deleteNote($event)">
                  </app-customer-notes>
                </app-card-content>
              </app-card>
            </div>
          </div>
        </div>
      </div>
    }
  `
})
export class HomeComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private appState = inject(AppStateService);
  private toastService = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroy$ = new Subject<void>();
  private resizeHandler = () => this.checkMobile();

  // Loading state to prevent concurrent data loads
  private isLoading = false;
  private isFirstLoad = true;

  customers: Customer[] = [];
  contracts: Contract[] = [];
  tickets: Ticket[] = [];
  plantingIntentions: PlantingIntention[] = [];
  notes: Note[] = [];
  storedGrain: StoredGrain[] = [];
  farms: Farm[] = [];
  savedLists: SavedList[] = [];

  selectedCustomer: Customer | null = null;
  selectedFarmId: string | undefined = undefined;
  customerContracts: Contract[] = [];
  customerTickets: Ticket[] = [];
  customerNotes: Note[] = [];
  customerFarms: Farm[] = [];
  customerPlantingIntentions: PlantingIntention[] = [];
  customerStoredGrain: StoredGrain[] = [];

  // Unfiltered customer data for Activity Summary (all farms)
  allCustomerContracts: Contract[] = [];
  allCustomerTickets: Ticket[] = [];
  allCustomerPlantingIntentions: PlantingIntention[] = [];
  allCustomerStoredGrain: StoredGrain[] = [];

  isMobile = false;

  ngOnInit(): void {
    console.log('[Home] ngOnInit - Starting initial data load');
    this.loadAllData();
    this.checkMobile();
    window.addEventListener('resize', this.resizeHandler);

    // Handle customerId query param (from Build a List view customer link)
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const customerId = params['customerId'];
      if (customerId) {
        this.selectCustomerById(customerId);
      }
    });

    // Reload data when navigating back to the home route
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: NavigationEnd) => {
      console.log('[Home] Navigation event:', event.url, event.urlAfterRedirects);

      // Skip the first NavigationEnd event which happens during component initialization
      if (this.isFirstLoad) {
        console.log('[Home] Skipping first NavigationEnd (component initialization)');
        this.isFirstLoad = false;
        return;
      }

      // Only reload if we're navigating TO the home route (check for root path or with query params)
      const isHomeRoute = event.urlAfterRedirects === '/' ||
                          event.urlAfterRedirects.startsWith('/?') ||
                          event.url === '/' ||
                          event.url.startsWith('/?');

      if (isHomeRoute) {
        console.log('[Home] Reloading data after navigation to home');
        this.loadAllData();
      }
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.destroy$.next();
    this.destroy$.complete();
  }

  private checkMobile(): void {
    this.isMobile = window.innerWidth < 1024;
  }

  private selectCustomerById(customerId: string): void {
    // If customers are already loaded, select immediately
    const customer = this.customers.find(c => c.id === customerId);
    if (customer) {
      this.handleSelectCustomer(customer);
    } else {
      // Wait for customers to load, then select
      const checkInterval = setInterval(() => {
        const c = this.customers.find(cust => cust.id === customerId);
        if (c) {
          clearInterval(checkInterval);
          this.handleSelectCustomer(c);
        }
      }, 100);
      // Clear interval after 5 seconds to avoid infinite loop
      setTimeout(() => clearInterval(checkInterval), 5000);
    }
  }

  private loadAllData(): void {
    // Prevent concurrent data loads
    if (this.isLoading) {
      console.log('[Home] loadAllData() called but already loading, skipping...');
      return;
    }

    this.isLoading = true;
    const loadTimestamp = new Date().toISOString();
    console.log(`[Home] loadAllData() called at ${loadTimestamp}`);

    forkJoin({
      customers: this.apiService.getCustomers(),
      contracts: this.apiService.getContracts(),
      tickets: this.apiService.getTickets(),
      plantingIntentions: this.apiService.getPlantingIntentions(),
      notes: this.apiService.getNotes(),
      storedGrain: this.apiService.getStoredGrain(),
      farms: this.apiService.getFarms(),
      savedLists: this.apiService.getSavedLists()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        console.log(`[Home] Data received at ${new Date().toISOString()} (load started at ${loadTimestamp})`);
        console.log(`[Home] Customers: ${data.customers.length}, Contracts: ${data.contracts.length}, Tickets: ${data.tickets.length}, Planting Intentions: ${data.plantingIntentions.length}`);

        this.customers = data.customers;
        this.contracts = data.contracts;
        this.tickets = data.tickets;
        this.plantingIntentions = data.plantingIntentions;
        this.notes = data.notes;
        this.storedGrain = data.storedGrain;
        this.farms = data.farms;
        this.savedLists = data.savedLists;

        console.log('[Home] All data loaded, triggering final change detection');
        this.isLoading = false;
        this.cdr.detectChanges();

        // Restore selected customer after data loads and change detection completes
        // Use setTimeout to ensure data binding has completed before restoring selection
        const savedCustomer = this.appState.selectedCustomer();
        const savedFarmId = this.appState.selectedFarmId();
        console.log('[Home] Attempting to restore customer:', savedCustomer?.id, 'farm:', savedFarmId);

        if (savedCustomer) {
          // Use setTimeout to defer customer restoration until after current change detection cycle
          setTimeout(() => {
            // Find the customer in the newly loaded data
            const customer = this.customers.find(c => c.id === savedCustomer.id);
            if (customer) {
              console.log('[Home] Found customer in loaded data, restoring selection via handleSelectCustomer');
              // Use handleSelectCustomer to trigger the full selection flow
              this.selectedCustomer = customer;
              this.selectedFarmId = savedFarmId || undefined;
              this.appState.selectFarm(savedFarmId || null);
              this.loadCustomerData(customer.id, customer);
              console.log('[Home] Customer data loaded, planting intentions:', this.customerPlantingIntentions.length);
              this.cdr.detectChanges();
            } else {
              console.warn('[Home] Saved customer not found in loaded data');
            }
          }, 0);
        } else {
          console.log('[Home] No saved customer to restore');
        }
      },
      error: (err) => {
        console.error('[Home] Error loading data:', err);
        this.isLoading = false;
        this.toastService.error('Failed to load data');
        this.cdr.detectChanges();
      }
    });
  }

  handleSelectCustomer(customer: Customer): void {
    this.selectedCustomer = customer;
    this.selectedFarmId = undefined; // Reset farm selection when changing customers
    this.appState.selectCustomer(customer);
    this.loadCustomerData(customer.id);
    // Force change detection to ensure UI updates immediately
    this.cdr.detectChanges();
  }

  handleFarmChange(farmId: string): void {
    this.selectedFarmId = farmId;
    this.appState.selectFarm(farmId);
    // Reload customer data to filter by the newly selected farm
    if (this.selectedCustomer) {
      this.loadCustomerData(this.selectedCustomer.id);
    }
    this.cdr.detectChanges();
  }

  private loadCustomerData(customerId: string, customer?: Customer): void {
    console.log('[Home] loadCustomerData called for customer:', customerId);
    console.log('[Home] Available data - Contracts:', this.contracts.length, 'Planting Intentions:', this.plantingIntentions.length);

    // Create new array references to trigger change detection
    // Use provided customer or fall back to selectedCustomer
    const currentCustomer = customer || this.selectedCustomer;
    if (!currentCustomer) {
      console.warn('[Home] No customer found for loadCustomerData');
      return;
    }

    // Get linked producer IDs (customers this customer links to)
    const linkedProducerIds = currentCustomer.linkedProducerIds || [];

    // Also find customers that link TO this customer (bidirectional linking)
    const customersLinkingToMe = this.customers
      .filter(c => c.linkedProducerIds && c.linkedProducerIds.includes(customerId))
      .map(c => c.id);

    // Combine all linked customer IDs (both directions) - use Set to avoid duplicates
    const allLinkedIds = [...new Set([...linkedProducerIds, ...customersLinkingToMe])];

    // Get all relevant customer IDs (current customer + all linked producers)
    const allCustomerIds = [customerId, ...allLinkedIds];
    console.log('[Home] Loading data for customer IDs:', allCustomerIds);

    // Always load unfiltered data for Activity Summary (all farms from current customer + linked producers)
    this.allCustomerContracts = [...this.contracts.filter(c => allCustomerIds.includes(c.customerId))];
    this.allCustomerTickets = [...this.tickets.filter(t => allCustomerIds.includes(t.customerId))];
    this.allCustomerPlantingIntentions = [...this.plantingIntentions.filter(p => allCustomerIds.includes(p.customerId))];
    this.allCustomerStoredGrain = [...this.storedGrain.filter(s => allCustomerIds.includes(s.customerId))];

    // Load farms from current customer AND all linked producers (both directions)
    const allFarmIds: string[] = [...(currentCustomer.farmIds || [])];

    // Add farms from all linked producers
    allLinkedIds.forEach(producerId => {
      const linkedProducer = this.customers.find(c => c.id === producerId);
      if (linkedProducer && linkedProducer.farmIds) {
        allFarmIds.push(...linkedProducer.farmIds);
      }
    });

    // Filter and set customer farms
    this.customerFarms = [...this.farms.filter(f => allFarmIds.includes(f.id))];

    // Validate selectedFarmId - if it's set but no longer in the available farms, reset it
    if (this.selectedFarmId && !this.customerFarms.find(f => f.id === this.selectedFarmId)) {
      // Currently selected farm is no longer available (e.g., after unlinking), reset to first farm or undefined
      this.selectedFarmId = this.customerFarms.length > 0 ? this.customerFarms[0].id : undefined;
      this.appState.selectFarm(this.selectedFarmId || null);
    }

    // Set the selected farm to the first available farm if not already set
    if (!this.selectedFarmId && this.customerFarms.length > 0) {
      this.selectedFarmId = this.customerFarms[0].id;
    }

    // NOW filter by farm - this happens AFTER we've ensured selectedFarmId is set
    if (this.selectedFarmId) {
      // Filter data for the selected farm, regardless of which customer owns it
      this.customerContracts = [...this.contracts.filter(c => c.farmId === this.selectedFarmId)];
      this.customerTickets = [...this.tickets.filter(t => t.farmId === this.selectedFarmId)];
      this.customerPlantingIntentions = [...this.plantingIntentions.filter(p => p.farmId === this.selectedFarmId)];
      this.customerStoredGrain = [...this.storedGrain.filter(s => s.farmId === this.selectedFarmId)];
    } else {
      // If there are no farms, show all customer data
      this.customerContracts = [...this.contracts.filter(c => c.customerId === customerId)];
      this.customerTickets = [...this.tickets.filter(t => t.customerId === customerId)];
      this.customerPlantingIntentions = [...this.plantingIntentions.filter(p => p.customerId === customerId)];
      this.customerStoredGrain = [...this.storedGrain.filter(s => s.customerId === customerId)];
    }

    this.customerNotes = [...this.notes.filter(n => n.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())];

    console.log('[Home] Customer data loaded:', {
      contracts: this.customerContracts.length,
      tickets: this.customerTickets.length,
      plantingIntentions: this.customerPlantingIntentions.length,
      farms: this.customerFarms.length,
      selectedFarmId: this.selectedFarmId
    });
  }

  handleSaveCustomer(data: { customerId: string; location: string; phone: string; email: string; farmIds: string[]; linkedProducerIds: string[]; eSignEnabled: boolean }): void {
    const customer = this.customers.find(c => c.id === data.customerId);
    if (!customer) return;

    const updatedCustomer: Customer = {
      ...customer,
      location: data.location,
      phone: data.phone,
      email: data.email,
      farmIds: data.farmIds,
      linkedProducerIds: data.linkedProducerIds,
      eSignEnabled: data.eSignEnabled
    };

    this.apiService.updateCustomer(updatedCustomer).subscribe({
      next: (updated) => {
        // Update customer in the array
        const index = this.customers.findIndex(c => c.id === updated.id);
        if (index >= 0) {
          this.customers[index] = updated;
          this.customers = [...this.customers];
        }

        // Update selected customer
        this.selectedCustomer = updated;

        // If a new farm was added, select it automatically
        const newFarmIds = updated.farmIds.filter(id => !customer.farmIds.includes(id));
        if (newFarmIds.length > 0) {
          this.selectedFarmId = newFarmIds[0];
        }

        // If a farm was deleted and it was the currently selected farm, revert to default (first farm)
        const deletedFarmIds = customer.farmIds.filter(id => !updated.farmIds.includes(id));
        if (deletedFarmIds.length > 0 && this.selectedFarmId && deletedFarmIds.includes(this.selectedFarmId)) {
          // Reset to first available farm or undefined if no farms
          this.selectedFarmId = updated.farmIds.length > 0 ? updated.farmIds[0] : undefined;
        }

        // Reload customer data AFTER updating farm selection, passing the updated customer to include farms from linked producers
        this.loadCustomerData(updated.id, updated);

        this.toastService.success('Customer updated successfully');
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to update customer');
      }
    });
  }

  handleCreateFarm(data: { name: string; location: string; acres: number }): void {
    this.apiService.createFarm(data).subscribe({
      next: (newFarmId) => {
        const newFarm: Farm = {
          id: newFarmId,
          name: data.name,
          location: data.location,
          acres: data.acres
        };
        this.farms = [...this.farms, newFarm];

        // Reload customer data if a customer is selected to refresh the farm list
        if (this.selectedCustomer) {
          this.loadCustomerData(this.selectedCustomer.id);
        }

        this.toastService.success('Farm created successfully');
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to create farm');
      }
    });
  }

  getLastContactedDate(): string {
    if (this.customerNotes.length === 0) return 'Never';

    const sorted = [...this.customerNotes].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const lastNote = sorted[0];
    const diff = Date.now() - new Date(lastNote.createdAt).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;

    return new Date(lastNote.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  addPlantingIntention(data: {farmId: string, crop: string, acres: number, plantingYear: number, estimatedYield: number}): void {
    console.log('addPlantingIntention called with:', data);
    console.log('selectedCustomer:', this.selectedCustomer?.id);
    console.log('selectedFarmId:', this.selectedFarmId);

    if (!this.selectedCustomer) {
      console.log('No customer selected, returning');
      return;
    }

    const apiData = {
      customerId: this.selectedCustomer.id,
      farmId: data.farmId,
      crop: data.crop,
      acres: data.acres,
      plantingYear: data.plantingYear,
      estimatedYield: data.estimatedYield
    };
    console.log('Calling API with:', apiData);

    this.apiService.createPlantingIntention(apiData).subscribe({
      next: (intention) => {
        console.log('API returned intention:', intention);
        console.log('Current customerPlantingIntentions length:', this.customerPlantingIntentions.length);

        // Add to global list
        this.plantingIntentions = [...this.plantingIntentions, intention];

        // Add to customer-specific list if it matches the selected farm
        if (!this.selectedFarmId || intention.farmId === this.selectedFarmId) {
          this.customerPlantingIntentions = [...this.customerPlantingIntentions, intention];
          console.log('Added to customerPlantingIntentions, new length:', this.customerPlantingIntentions.length);
        } else {
          console.log('NOT added to customerPlantingIntentions - farm mismatch', {
            intentionFarmId: intention.farmId,
            selectedFarmId: this.selectedFarmId
          });
        }

        // Update allCustomerPlantingIntentions for Activity Summary
        this.allCustomerPlantingIntentions = [...this.allCustomerPlantingIntentions, intention];

        this.toastService.success('Planting intention added');
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('API error:', err);
        this.toastService.error('Failed to add planting intention');
      }
    });
  }

  editPlantingIntention(data: {intentionId: string, farmId: string, crop: string, acres: number, plantingYear: number, estimatedYield: number}): void {
    this.apiService.updatePlantingIntention(data.intentionId, {
      crop: data.crop,
      acres: data.acres,
      plantingYear: data.plantingYear,
      estimatedYield: data.estimatedYield
    }).subscribe({
      next: (updatedIntention) => {
        // Update in global list
        this.plantingIntentions = this.plantingIntentions.map(p =>
          p.id === data.intentionId ? updatedIntention : p
        );

        // Update in customer-specific list
        this.customerPlantingIntentions = this.customerPlantingIntentions.map(p =>
          p.id === data.intentionId ? updatedIntention : p
        );

        // Update in allCustomerPlantingIntentions for Activity Summary
        this.allCustomerPlantingIntentions = this.allCustomerPlantingIntentions.map(p =>
          p.id === data.intentionId ? updatedIntention : p
        );

        this.toastService.success('Planting intention updated');
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to update planting intention');
      }
    });
  }

  deletePlantingIntention(intentionId: string): void {
    this.apiService.deletePlantingIntention(intentionId).subscribe({
      next: () => {
        // Remove from global list
        this.plantingIntentions = this.plantingIntentions.filter(p => p.id !== intentionId);

        // Remove from customer-specific list
        this.customerPlantingIntentions = this.customerPlantingIntentions.filter(p => p.id !== intentionId);

        // Remove from allCustomerPlantingIntentions for Activity Summary
        this.allCustomerPlantingIntentions = this.allCustomerPlantingIntentions.filter(p => p.id !== intentionId);

        this.toastService.success('Planting intention deleted');
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to delete planting intention');
      }
    });
  }

  addNote(content: string): void {
    if (!this.selectedCustomer) return;

    this.apiService.createNote(this.selectedCustomer.id, content).subscribe({
      next: (note) => {
        this.notes = [...this.notes, note];
        this.customerNotes = [note, ...this.customerNotes];
        this.toastService.success('Note added');
      },
      error: () => {
        this.toastService.error('Failed to add note');
      }
    });
  }

  toggleNotePin(note: Note): void {
    this.apiService.toggleNotePin(note.id).subscribe({
      next: (updated) => {
        const index = this.notes.findIndex(n => n.id === updated.id);
        if (index >= 0) {
          this.notes[index] = updated;
          this.notes = [...this.notes];
        }
        const customerIndex = this.customerNotes.findIndex(n => n.id === updated.id);
        if (customerIndex >= 0) {
          this.customerNotes[customerIndex] = updated;
          this.customerNotes = [...this.customerNotes];
        }
        this.toastService.success(updated.isPinned ? 'Note pinned' : 'Note unpinned');
      },
      error: () => {
        this.toastService.error('Failed to update note');
      }
    });
  }

  editNote(data: { noteId: string; content: string }): void {
    this.apiService.updateNote(data.noteId, data.content).subscribe({
      next: (updated) => {
        // Update in global list
        const index = this.notes.findIndex(n => n.id === updated.id);
        if (index >= 0) {
          this.notes[index] = updated;
          this.notes = [...this.notes];
        }
        // Update in customer-specific list
        const customerIndex = this.customerNotes.findIndex(n => n.id === updated.id);
        if (customerIndex >= 0) {
          this.customerNotes[customerIndex] = updated;
          this.customerNotes = [...this.customerNotes];
        }
        this.toastService.success('Note updated');
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to update note');
      }
    });
  }

  deleteNote(noteId: string): void {
    this.apiService.deleteNote(noteId).subscribe({
      next: () => {
        // Remove from global list
        this.notes = this.notes.filter(n => n.id !== noteId);
        // Remove from customer-specific list
        this.customerNotes = this.customerNotes.filter(n => n.id !== noteId);
        this.toastService.success('Note deleted');
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to delete note');
      }
    });
  }
}
