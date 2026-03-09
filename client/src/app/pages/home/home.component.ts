import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { Subject, forkJoin, of } from 'rxjs';
import { takeUntil, filter, catchError } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { NlqFilterService, NlqFilterContext } from '../../services/nlq-filter.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, SavedList, ProducerDetails, ContractPricingLine, DashboardPlantingEstimate, Commodity } from '../../models';
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
    <div class="grid grid-cols-1 lg:grid-cols-[33.3%_66.7%] xl:grid-cols-[25%_75%] 2xl:grid-cols-[22%_78%] gap-4 lg:gap-6">
      <!-- Customer List - Precisely sized for optimal space usage (22% on 2xl) -->
      <div class="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)]" [class.hidden]="selectedCustomer && isMobile" [class.lg:block]="true">
        <app-customer-list
          [customers]="customers"
          [selectedCustomer]="selectedCustomer"
          [savedLists]="savedLists"
          [notes]="notes"
          [loading]="loading"
          [producerDetailsMap]="producerDetailsMap"
          (selectCustomer)="handleSelectCustomer($event)"
          (tradeUnitChange)="handleTradeUnitChange($event)"
        />
      </div>

      <!-- Profile and Notes Container - Optimized content display (78% on 2xl) -->
      <div [class.hidden]="!selectedCustomer && isMobile" [class.lg:block]="true" class="pb-6 lg:min-h-[calc(100vh-6rem)]">
        <div class="xl:grid xl:grid-cols-[66.7%_33.3%] 2xl:grid-cols-[61.3%_38.7%] xl:gap-6 space-y-6 xl:space-y-0">
          <!-- Profile Section - Optimized for data visibility (61.3% on 2xl) -->
          <div class="space-y-6">
            @if (selectedCustomer) {
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
                [allCustomers]="customers"
                [selectedTradeUnits]="selectedTradeUnits"
                [contracts]="customerContracts"
                [tickets]="customerTickets"
                [pricingLines]="customerPricingLines"
                [plantingIntentions]="customerPlantingIntentions"
                [storedGrain]="customerStoredGrain"
                [notes]="customerNotes"
                [yieldEstimateCrops]="yieldEstimateCrops"
                [yieldEstimates]="yieldEstimates"
                [commodities]="commodities"
                [isLoadingEstimates]="isLoadingYieldData"
                [allCustomerContracts]="allCustomerContracts"
                [allCustomerTickets]="allCustomerTickets"
                [allCustomerPlantingIntentions]="allCustomerPlantingIntentions"
                [allCustomerStoredGrain]="allCustomerStoredGrain"
                (onAddPlanting)="addPlantingIntention($event)"
                (onEditPlanting)="editPlantingIntention($event)"
                (onDeletePlanting)="deletePlantingIntention($event)"
                [linkedCustomers]="selectedCustomer ? getLinkedGroup(selectedCustomer) : []"
                (onAddNote)="addNote($event)"
                (onTogglePin)="toggleNotePin($event)"
                (onSaveCustomer)="handleSaveCustomer($event)"
                (onSelectLinkedCustomer)="handleSelectLinkedCustomer($event)"
                [openContractId]="pendingContractId">
              </app-customer-profile>
            } @else {
              <!-- Empty state — shown on desktop when no customer is selected -->
              <div class="hidden lg:block rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <div class="p-8 text-center text-gray-500 dark:text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 opacity-40">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <p class="font-medium text-gray-700 dark:text-gray-300">Select a Customer</p>
                  <p class="text-sm mt-1">Choose a customer from the list to view their profile, contracts, tickets, and notes.</p>
                </div>
              </div>
            }
          </div>

          <!-- Notes Column - Below profile until xl, then right sidebar, sticky on xl+ (38.7% on 2xl) -->
          @if (selectedCustomer) {
            <div class="xl:sticky xl:top-20 xl:self-start xl:max-h-[calc(100vh-6rem)] xl:overflow-auto">
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
                    [customerCodeMap]="customerCodeMap"
                    [linkedCustomers]="selectedCustomer ? getLinkedGroup(selectedCustomer) : []"
                    (addNote)="addNote($event)"
                    (togglePin)="toggleNotePin($event)"
                    (editNote)="editNote($event)"
                    (deleteNote)="deleteNote($event)">
                  </app-customer-notes>
                </app-card-content>
              </app-card>
            </div>
          }
        </div>
      </div>
    </div>
  `
})
export class HomeComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private appState = inject(AppStateService);
  private toastService = inject(ToastService);
  private nlqFilterService = inject(NlqFilterService);
  private cdr = inject(ChangeDetectorRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroy$ = new Subject<void>();
  private resizeHandler = () => this.checkMobile();

  // Loading state to prevent concurrent data loads
  private isLoading = false;
  private isFirstLoad = true;
  private customerSelectInterval?: ReturnType<typeof setInterval>;

  customers: Customer[] = [];
  contracts: Contract[] = [];
  tickets: Ticket[] = [];
  plantingIntentions: PlantingIntention[] = [];
  notes: Note[] = [];
  storedGrain: StoredGrain[] = [];
  savedLists: SavedList[] = [];
  private pendingProducerDetails: ProducerDetails[] | null = null;
  producerDetailsMap = new Map<number, ProducerDetails>();

  selectedCustomer: Customer | null = null;
  pendingContractId: number | null = null;
  selectedTradeUnits: string[] = [];
  customerContracts: Contract[] = [];
  customerTickets: Ticket[] = [];
  customerPricingLines: ContractPricingLine[] = [];
  customerNotes: Note[] = [];
  customerCodeMap: Map<number, string> = new Map();
  customerPlantingIntentions: PlantingIntention[] = [];
  customerStoredGrain: StoredGrain[] = [];

  // Unfiltered customer data for Activity Summary (all farms)
  allCustomerContracts: Contract[] = [];
  allCustomerTickets: Ticket[] = [];
  allCustomerPlantingIntentions: PlantingIntention[] = [];
  allCustomerStoredGrain: StoredGrain[] = [];

  // Yield estimate crop codes from dashboard (for planting intentions dropdown)
  yieldEstimateCrops: string[] = [];
  yieldEstimates: DashboardPlantingEstimate[] = [];
  commodities: Commodity[] = [];
  isLoadingYieldData = false;

  isMobile = false;
  loading = false;

  ngOnInit(): void {
    this.checkMobile();
    window.addEventListener('resize', this.resizeHandler);

    // Restore state from service if it exists
    this.restoreStateFromService();

    // Always load producer details on init (independent of trade units)
    this.loadProducerDetails();

    // Only load data if trade units are selected AND we have no cached data yet.
    // If customers were restored from AppStateService, skip the heavy reload —
    // data will only be refreshed when the user explicitly changes trade units.
    if (this.selectedTradeUnits.length > 0 && this.customers.length === 0) {
      this.loadAllData(this.selectedTradeUnits);
    } else if (this.selectedTradeUnits.length > 0) {
      // Customers came from cache — still refresh yield estimates and commodities
      // so any changes saved on the Dashboard page are reflected immediately.
      this.loadYieldData();
    }

    // Handle customerId and contractId query params (from Insights and Build a List)
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const customerId = params['customerId'];
      if (customerId) {
        const contractId = params['contractId'];
        this.pendingContractId = contractId ? parseInt(contractId, 10) : null;
        this.selectCustomerById(customerId);
      }
    });

    // Reload data when navigating back to the home route
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: NavigationEnd) => {
      // Skip the first NavigationEnd event which happens during component initialization
      if (this.isFirstLoad) {
        this.isFirstLoad = false;
        return;
      }

      // Only reload if we're navigating TO the home route (check for root path or with query params)
      const isHomeRoute = event.urlAfterRedirects === '/' ||
                          event.urlAfterRedirects.startsWith('/?') ||
                          event.url === '/' ||
                          event.url.startsWith('/?');

      if (isHomeRoute && this.selectedTradeUnits.length > 0 && this.customers.length === 0) {
        this.loadAllData(this.selectedTradeUnits);
      }
    });
  }

  private restoreStateFromService(): void {
    // Always restore trade units so data reloads if navigation interrupted a prior load
    this.selectedTradeUnits = this.appState.selectedTradeUnits();

    // Restore data from state service
    const stateCustomers = this.appState.customers();
    const stateContracts = this.appState.contracts();
    const stateTickets = this.appState.tickets();
    const statePlantingIntentions = this.appState.plantingIntentions();
    const stateNotes = this.appState.notes();
    const stateStoredGrain = this.appState.storedGrain();
    const stateSavedLists = this.appState.savedLists();

    // If we have cached data, restore it
    if (stateCustomers.length > 0) {
      this.customers = stateCustomers;
      this.contracts = stateContracts;
      this.tickets = stateTickets;
      this.plantingIntentions = statePlantingIntentions;
      this.notes = stateNotes;
      this.storedGrain = stateStoredGrain;
      this.savedLists = stateSavedLists;
      this.enrichSavedLists();

      // Restore selected customer
      const stateSelectedCustomer = this.appState.selectedCustomer();
      if (stateSelectedCustomer) {
        this.selectedCustomer = stateSelectedCustomer;
        this.loadCustomerData(stateSelectedCustomer.id);
      }
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
    if (this.customerSelectInterval) clearInterval(this.customerSelectInterval);
    this.destroy$.next();
    this.destroy$.complete();
  }

  private checkMobile(): void {
    this.isMobile = window.innerWidth < 1024;
  }

  private selectCustomerById(customerId: string): void {
    // Convert customerId from query param string to number for comparison
    const customerIdNum = parseInt(customerId, 10);
    // If customers are already loaded, select immediately
    const customer = this.customers.find(c => c.id === customerIdNum);
    if (customer) {
      this.handleSelectCustomer(customer);
    } else {
      // Wait for customers to load, then select
      this.customerSelectInterval = setInterval(() => {
        const c = this.customers.find(cust => cust.id === customerIdNum);
        if (c) {
          clearInterval(this.customerSelectInterval);
          this.customerSelectInterval = undefined;
          this.handleSelectCustomer(c);
        }
      }, 100);
      // Clear interval after 5 seconds to avoid infinite loop
      setTimeout(() => {
        if (this.customerSelectInterval) {
          clearInterval(this.customerSelectInterval);
          this.customerSelectInterval = undefined;
          this.toastService.error('Customer not found. It may not be in the current trade unit selection.');
        }
      }, 5000);
    }
  }

  private loadAllData(tradeUnits?: string[]): void {
    // Prevent concurrent data loads
    if (this.isLoading) return;

    this.isLoading = true;
    this.loading = true;

    this.apiService.getCustomers(tradeUnits).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.customers = data;
        this.appState.setCustomers(data);
        this.loading = false;
        this.isLoading = false;
        this.enrichSavedLists();

        // Merge producer details into newly loaded customers
        if (this.pendingProducerDetails) {
          this.mergeProducerDetails(this.pendingProducerDetails);
          this.pendingProducerDetails = null;
        } else if (this.producerDetailsMap.size > 0) {
          // Re-merge from map for subsequent loads (e.g., trade unit changes)
          this.mergeProducerDetails(Array.from(this.producerDetailsMap.values()));
        }
      },
      error: () => {
        this.loading = false;
        this.isLoading = false;
      }
    });

    this.apiService.getContracts(tradeUnits).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        // Merge: the batch loads by customerCode, but FK loads (getContractsByCustomer)
        // may have added contracts not in this batch. Retain those extras.
        const batchIds = new Set(data.map(c => c.id));
        const fkExtras = this.contracts.filter(c => !batchIds.has(c.id));
        this.contracts = [...data, ...fkExtras];
        this.appState.setContracts(this.contracts);
      },
      error: () => { this.toastService.error('Failed to load contracts. Some data may be missing.'); }
    });

    this.apiService.getTickets(tradeUnits).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        // Merge: the batch loads by customerCode, but FK loads (getTicketsByCustomer)
        // may have added tickets not in this batch. Retain those extras.
        const batchIds = new Set(data.map(t => t.id));
        const fkExtras = this.tickets.filter(t => !batchIds.has(t.id));
        this.tickets = [...data, ...fkExtras];
        this.appState.setTickets(this.tickets);
      },
      error: () => { this.toastService.error('Failed to load tickets. Some data may be missing.'); }
    });

    this.apiService.getPlantingIntentions().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.plantingIntentions = data;
        this.appState.setPlantingIntentions(data);
      },
      error: () => { this.toastService.error('Failed to load planting intentions.'); }
    });

    this.apiService.getNotes().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.notes = data;
        this.appState.setNotes(data);
      },
      error: () => { this.toastService.error('Failed to load notes.'); }
    });

    this.apiService.getStoredGrain().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.storedGrain = data;
        this.appState.setStoredGrain(data);
      },
      error: () => {}
    });

    // Load yield estimates and commodities together (tracked via isLoadingYieldData)
    this.loadYieldData();

    this.apiService.getSavedLists().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.savedLists = data;
        this.appState.setSavedLists(data);
        this.enrichSavedLists();
      },
      error: () => {}
    });

  }

  private loadProducerDetails(): void {
    this.apiService.getAllProducerDetails().pipe(takeUntil(this.destroy$)).subscribe({
      next: (details) => {
        // Always store in map for use when selecting searched customers
        details.forEach(d => this.producerDetailsMap.set(d.customerId, d));

        if (this.customers.length > 0) {
          this.mergeProducerDetails(details);
        } else {
          // Customers haven't loaded yet — store for later merge
          this.pendingProducerDetails = details;
        }
      },
      error: () => {}
    });
  }

  private mergeProducerDetails(details: ProducerDetails[]): void {
    if (details.length === 0) return;
    // Store for later use when selecting searched customers
    details.forEach(d => this.producerDetailsMap.set(d.customerId, d));

    const detailsMap = new Map(details.map(d => [d.customerId, d]));
    let changed = false;

    this.customers = this.customers.map(customer => {
      const pd = detailsMap.get(customer.id);
      if (pd) {
        changed = true;
        return {
          ...customer,
          totalAcres: pd.totalAcres ?? customer.totalAcres,
          binCapacity: pd.binCapacity ?? customer.binCapacity,
          primaryContact: pd.primaryContact ?? customer.primaryContact,
          commodities: pd.commodities ? pd.commodities.split(',').map(c => c.trim()).filter(Boolean) : customer.commodities,
          linkedProducerIds: pd.linkedProducerIds ? pd.linkedProducerIds.split(',').filter(Boolean) : customer.linkedProducerIds
        };
      }
      return customer;
    });

    if (changed) {
      this.customers = [...this.customers];
      // Update appState cache so build-list and other pages see enriched data
      this.appState.setCustomers(this.customers);
      // Update selected customer if it was affected
      if (this.selectedCustomer) {
        const updated = this.customers.find(c => c.id === this.selectedCustomer!.id);
        if (updated) {
          this.selectedCustomer = updated;
        }
      }
      this.cdr.detectChanges();
    }
  }

  private loadYieldData(): void {
    const key = [...this.selectedTradeUnits].sort().join(',');
    if (!key) {
      this.yieldEstimates = [];
      this.yieldEstimateCrops = [];
      this.commodities = [];
      return;
    }

    // Set loading flag immediately (synchronously) so the spinner is visible
    // the moment a customer profile renders — before either API call returns.
    this.isLoadingYieldData = true;

    // Track both calls; clear flag only when both complete so the percentage
    // is never calculated with a partial dataset (estimates but no commodities,
    // or commodities but no estimates).
    let pending = 2;
    const done = () => {
      if (--pending === 0) {
        this.isLoadingYieldData = false;
        this.cdr.detectChanges();
      }
    };

    // ── Yield estimates (current + prior year merged) ─────────────────────────
    const currentYear = new Date().getFullYear();
    forkJoin([
      this.apiService.getDashboardPlantingEstimates(key, currentYear).pipe(catchError(() => of([]))),
      this.apiService.getDashboardPlantingEstimates(key, currentYear - 1).pipe(catchError(() => of([])))
    ]).pipe(takeUntil(this.destroy$)).subscribe({
      next: ([current, prior]) => {
        // Merge: start with prior year, then overwrite/add with current year entries
        const merged = [...prior];
        for (const est of current) {
          const idx = merged.findIndex(e => e.crop === est.crop);
          if (idx >= 0) {
            merged[idx] = est;
          } else {
            merged.push(est);
          }
        }
        this.yieldEstimates = merged;
        this.yieldEstimateCrops = merged.map(e => e.crop);
        done();
      },
      error: () => done()
    });

    // ── Commodities (needed for crop-code → category mapping) ─────────────────
    this.apiService.getCommodities().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => { this.commodities = data; done(); },
      error: () => done()
    });
  }

  private enrichSavedLists(): void {
    if (!this.savedLists.length || !this.customers.length) return;
    const context: NlqFilterContext = {
      customers: this.customers,
      contracts: this.contracts,
      tickets: this.tickets,
      notes: this.notes,
      plantingIntentions: this.plantingIntentions,
      storedGrain: this.storedGrain
    };
    this.savedLists = this.savedLists.map(list => {
      const nlqCustomers = this.nlqFilterService.parseAndFilter(list.query, context).customers;
      const refined = list.filters
        ? this.nlqFilterService.applyRefinementFilters(nlqCustomers, list.filters, this.contracts, this.notes)
        : nlqCustomers;
      return { ...list, customerIds: refined.map(c => c.id) };
    });
  }

  handleTradeUnitChange(tradeUnits: string[]): void {
    this.selectedTradeUnits = tradeUnits;
    this.appState.setTradeUnits(tradeUnits);
    this.selectedCustomer = null; // Clear selection when filter changes
    this.appState.selectCustomer(null);
    // Only load data if at least one trade unit is selected
    if (tradeUnits && tradeUnits.length > 0) {
      this.loadAllData(tradeUnits);
    }
  }

  handleSelectCustomer(customer: Customer): void {
    // Apply producer details if available (for searched customers not in initial batch)
    const pd = this.producerDetailsMap.get(customer.id);
    if (pd) {
      customer = {
        ...customer,
        totalAcres: pd.totalAcres ?? customer.totalAcres,
        binCapacity: pd.binCapacity ?? customer.binCapacity,
        primaryContact: pd.primaryContact ?? customer.primaryContact,
        commodities: pd.commodities ? pd.commodities.split(',').map(c => c.trim()) : customer.commodities
      };
    } else {
      // Map not populated yet — fetch for this specific customer as fallback
      this.apiService.getProducerDetails(customer.id).pipe(takeUntil(this.destroy$)).subscribe({
        next: (details) => {
          this.producerDetailsMap.set(details.customerId, details);
          if (this.selectedCustomer?.id === customer.id) {
            this.selectedCustomer = {
              ...this.selectedCustomer,
              totalAcres: details.totalAcres ?? this.selectedCustomer.totalAcres,
              binCapacity: details.binCapacity ?? this.selectedCustomer.binCapacity,
              primaryContact: details.primaryContact ?? this.selectedCustomer.primaryContact,
              commodities: details.commodities ? details.commodities.split(',').map(c => c.trim()) : this.selectedCustomer.commodities
            };
            this.cdr.detectChanges();
          }
        },
        error: () => {} // 404 if no producer details exist — that's fine
      });
    }

    this.selectedCustomer = customer;
    this.appState.selectCustomer(customer);

    // Always load contracts and tickets by FK for the selected customer.
    // The initial batch uses customerCode string matching which may not capture all tickets
    // (some tickets have a different customerCode but correct FK customerId).
    // Duplicate check inside loadCustomerContractsAndTickets prevents double-counting.
    this.loadCustomerContractsAndTickets(customer.id, customer.sourceCustomerId);

    this.loadCustomerData(customer.id);
    // Force change detection to ensure UI updates immediately
    this.cdr.detectChanges();
  }

  private loadCustomerContractsAndTickets(customerId: number, sourceCustomerId?: string): void {
    // Load pricing lines by customer (drives Price column in contracts table)
    if (sourceCustomerId) {
      this.customerPricingLines = [];
      this.apiService.getPricingLinesByCustomer(sourceCustomerId).pipe(takeUntil(this.destroy$)).subscribe({
        next: (lines) => { this.customerPricingLines = lines; },
        error: () => { this.customerPricingLines = []; }
      });
    }

    // Load contracts by customer
    this.apiService.getContractsByCustomer(customerId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (contracts) => {
        // Add any new contracts to our local array (avoid duplicates) for profile display.
        // Do NOT write back to appState — per-customer loads have no trade-unit filter and
        // would pollute the shared cache, causing Build a List pacing filters to see
        // cross-trade-unit contracts and produce inconsistent results.
        contracts.forEach(contract => {
          if (!this.contracts.some(existing => existing.id === contract.id)) {
            this.contracts.push(contract);
          }
        });
        this.contracts = [...this.contracts]; // Trigger change detection
        this.loadCustomerData(customerId);
        this.cdr.detectChanges();
      },
      error: () => {}
    });

    // Load tickets by customer
    this.apiService.getTicketsByCustomer(customerId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (tickets) => {
        // Add any new tickets to our local array (avoid duplicates) for profile display.
        // Do NOT write back to appState — same reason as contracts above.
        tickets.forEach(ticket => {
          if (!this.tickets.some(existing => existing.id === ticket.id)) {
            this.tickets.push(ticket);
          }
        });
        this.tickets = [...this.tickets]; // Trigger change detection
        this.loadCustomerData(customerId);

        // Silently persist any newly-discovered ticket commodities to ProducerDetails
        const customer = this.customers.find(c => c.id === customerId) || this.selectedCustomer;
        if (customer) {
          this.autoSaveCommodities(customer, tickets);
        }

        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  private loadCustomerData(customerId: number, customer?: Customer): void {
    const currentCustomer = customer || this.selectedCustomer;
    if (!currentCustomer) {
      return;
    }

    // Contracts and tickets use customer-based string matching
    const sourceId = currentCustomer.sourceCustomerId;
    this.allCustomerContracts = sourceId ? [...this.contracts.filter(c => c.ctrmCustomerId === sourceId)] : [];
    this.allCustomerTickets = sourceId ? [...this.tickets.filter(t => t.customerCode === sourceId)] : [];
    this.customerContracts = [...this.allCustomerContracts];
    this.customerTickets = [...this.allCustomerTickets];

    // Planting intentions and stored grain filter by customerId
    this.allCustomerPlantingIntentions = [...this.plantingIntentions.filter(p => p.customerId === customerId)];
    this.allCustomerStoredGrain = [...this.storedGrain.filter(s => s.customerId === customerId)];
    this.customerPlantingIntentions = [...this.allCustomerPlantingIntentions];
    this.customerStoredGrain = [...this.allCustomerStoredGrain];

    const linkedGroup = this.getLinkedGroup(currentCustomer);
    const linkedIds = new Set([customerId, ...linkedGroup.map(c => c.id)]);
    const codeMap = new Map<number, string>();
    [currentCustomer, ...linkedGroup].forEach(c => {
      if (c?.sourceCustomerId) codeMap.set(c.id, c.sourceCustomerId);
    });
    this.customerCodeMap = codeMap;
    this.customerNotes = [...this.notes.filter(n => linkedIds.has(n.customerId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())];
  }

  private autoSaveCommodities(customer: Customer, customerTickets: Ticket[]): void {
    const ticketCommodities = [...new Set(customerTickets.map(t => t.productCode || '').filter(Boolean))];
    if (ticketCommodities.length === 0) return;

    const storedCommodities = customer.commodities || [];
    const hasNew = ticketCommodities.some(tc => !storedCommodities.includes(tc));
    if (!hasNew) return;

    const merged = [...new Set([...storedCommodities, ...ticketCommodities])].sort();
    const existingPd = this.producerDetailsMap.get(customer.id);
    this.apiService.saveProducerDetails(customer.id, {
      sourceCustomerId: customer.sourceCustomerId || null,
      customerName: customer.name,
      totalAcres: existingPd?.totalAcres ?? null,
      binCapacity: existingPd?.binCapacity ?? null,
      primaryContact: existingPd?.primaryContact ?? null,
      commodities: merged.join(','),
      linkedProducerIds: existingPd?.linkedProducerIds ?? null
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (pd) => {
        this.producerDetailsMap.set(pd.customerId, pd);
        const updatedCustomer = { ...customer, commodities: merged };
        const index = this.customers.findIndex(c => c.id === customer.id);
        if (index >= 0) {
          this.customers[index] = updatedCustomer;
          this.customers = [...this.customers];
        }
        if (this.selectedCustomer?.id === customer.id) {
          this.selectedCustomer = updatedCustomer;
        }
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  handleSaveCustomer(data: { customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean }): void {
    // Find customer from array OR fall back to selectedCustomer (search scenario)
    const customer = this.customers.find(c => c.id === data.customerId)
      || (this.selectedCustomer?.id === data.customerId ? this.selectedCustomer : null);
    if (!customer) return;

    // Combine ticket-derived commodities (from loaded tickets) with user-added ones.
    // The full merged set is persisted so commodity history survives ticket aging.
    const ticketCommodities = [...new Set(
      this.allCustomerTickets.map(t => t.productCode || '').filter(Boolean)
    )];
    const allCommodities = [...new Set([...ticketCommodities, ...data.commodities])].sort();

    // Build the updated customer locally (preserve all ODS fields from original)
    const updated: Customer = {
      ...customer,
      totalAcres: data.acres,
      binCapacity: data.binCapacity,
      commodities: allCommodities,
      primaryContact: data.primaryContact,
      linkedProducerIds: data.linkedProducerIds,
      eSignEnabled: data.eSignEnabled
    };

    // Build the payload for ProducerDetails — use null (not undefined) for cleared fields
    // so JSON serialization sends them explicitly and the API clears the old value.
    const savedCommodities = allCommodities.length > 0 ? allCommodities.join(',') : null;
    const savedLinkedIds = data.linkedProducerIds.length > 0 ? data.linkedProducerIds.join(',') : null;
    const savePayload = {
      sourceCustomerId: customer.sourceCustomerId || null,
      customerName: customer.name,
      totalAcres: data.acres || null,
      binCapacity: data.binCapacity || null,
      primaryContact: data.primaryContact || null,
      commodities: savedCommodities,
      linkedProducerIds: savedLinkedIds
    };

    // Update producerDetailsMap immediately so re-selecting this customer
    // before the API responds still uses the latest values.
    const existingPd = this.producerDetailsMap.get(data.customerId);
    if (existingPd) {
      this.producerDetailsMap.set(data.customerId, {
        ...existingPd,
        totalAcres: data.acres || undefined,
        binCapacity: data.binCapacity || undefined,
        primaryContact: data.primaryContact || undefined,
        commodities: savedCommodities ?? undefined,
        linkedProducerIds: savedLinkedIds ?? undefined
      });
    }

    // Save producer details to ProducerDetails table (the only persistent store needed)
    this.apiService.saveProducerDetails(data.customerId, savePayload).pipe(takeUntil(this.destroy$)).subscribe({
      next: (pd) => {
        this.producerDetailsMap.set(pd.customerId, pd);
        this.toastService.success('Customer updated successfully');
      },
      error: () => {
        this.toastService.error('Failed to save producer details');
      }
    });

    // For each incoming link the user removed, update the OTHER customer's ProducerDetails
    // to remove the current customer from their linkedProducerIds.
    for (const linkedIdStr of data.removedIncomingIds) {
      const linkedCustomer = this.customers.find(c => c.sourceCustomerId === linkedIdStr);
      if (!linkedCustomer) continue;

      const currentSourceId = customer.sourceCustomerId || '';
      const updatedLinkedIds = (linkedCustomer.linkedProducerIds || []).filter(id => id !== currentSourceId);
      const linkedId = linkedCustomer.id;
      const existingPd = this.producerDetailsMap.get(linkedId);
      this.apiService.saveProducerDetails(linkedId, {
        sourceCustomerId: linkedCustomer.sourceCustomerId || null,
        customerName: linkedCustomer.name,
        totalAcres: existingPd?.totalAcres ?? null,
        binCapacity: existingPd?.binCapacity ?? null,
        primaryContact: existingPd?.primaryContact ?? null,
        commodities: existingPd?.commodities ?? null,
        linkedProducerIds: updatedLinkedIds.length > 0 ? updatedLinkedIds.join(',') : null
      }).pipe(takeUntil(this.destroy$)).subscribe({
        next: (pd) => {
          this.producerDetailsMap.set(pd.customerId, pd);
          // Update the linked customer locally so getLinkedGroup & getProducersLinkingToMe reflect the change
          const updatedLinkedCustomer: Customer = { ...linkedCustomer, linkedProducerIds: updatedLinkedIds };
          const idx = this.customers.findIndex(c => c.id === linkedId);
          if (idx >= 0) {
            this.customers[idx] = updatedLinkedCustomer;
            this.customers = [...this.customers];
            this.appState.setCustomers(this.customers);
          }
        },
        error: () => {}
      });
    }

    // For each NEWLY linked producer that has no primary contact, inherit the current
    // customer's primary contact. If they already have one, leave it alone.
    if (data.primaryContact) {
      const previousLinkedIds = new Set(customer.linkedProducerIds || []);
      const newlyLinkedIds = data.linkedProducerIds.filter(id => !previousLinkedIds.has(id));
      for (const linkedIdStr of newlyLinkedIds) {
        const linkedCustomer = this.customers.find(c => c.sourceCustomerId === linkedIdStr);
        if (!linkedCustomer) continue;
        const linkedId = linkedCustomer.id;
        const linkedPd = this.producerDetailsMap.get(linkedId);
        if (linkedPd?.primaryContact) continue; // already has one — leave it
        this.apiService.saveProducerDetails(linkedId, {
          sourceCustomerId: linkedCustomer.sourceCustomerId || null,
          customerName: linkedCustomer.name,
          totalAcres: linkedPd?.totalAcres ?? null,
          binCapacity: linkedPd?.binCapacity ?? null,
          primaryContact: data.primaryContact,
          commodities: linkedPd?.commodities ?? null,
          linkedProducerIds: linkedPd?.linkedProducerIds ?? null
        }).pipe(takeUntil(this.destroy$)).subscribe({
          next: (pd) => {
            this.producerDetailsMap.set(pd.customerId, pd);
            // Reflect the new primary contact on the local customer object
            const updatedLinkedCustomer: Customer = { ...linkedCustomer, primaryContact: data.primaryContact };
            const idx = this.customers.findIndex(c => c.id === linkedId);
            if (idx >= 0) {
              this.customers[idx] = updatedLinkedCustomer;
              this.customers = [...this.customers];
              this.appState.setCustomers(this.customers);
            }
          },
          error: () => {}
        });
      }
    }

    // Update customer in the array immediately (no ODS round-trip needed)
    const index = this.customers.findIndex(c => c.id === updated.id);
    if (index >= 0) {
      this.customers[index] = updated;
      this.customers = [...this.customers];
    } else {
      // Customer came from search — add to array so future saves work
      this.customers = [...this.customers, updated];
    }

    // Update selected customer
    this.selectedCustomer = updated;

    // Persist updated state to appState so navigation away and back restores correctly
    this.appState.setCustomers(this.customers);
    this.appState.selectCustomer(updated);

    // Reload customer data with the locally-updated customer
    this.loadCustomerData(updated.id, updated);
    this.cdr.detectChanges();
  }

  getLinkedGroup(customer: Customer): Customer[] {
    // Outgoing: customers this customer explicitly links to (stored as sourceCustomerId)
    const outgoing = (customer.linkedProducerIds || [])
      .map(id => this.customers.find(c => c.sourceCustomerId === id))
      .filter((c): c is Customer => !!c);
    // Incoming: customers in the loaded list that link to this customer (by sourceCustomerId)
    const incoming = this.customers.filter(c =>
      (c.linkedProducerIds || []).includes(customer.sourceCustomerId || '')
    );
    // Deduplicate by id, exclude current customer
    return [...new Map([...outgoing, ...incoming].map(c => [c.id, c])).values()]
      .filter(c => c.id !== customer.id);
  }

  handleSelectLinkedCustomer(customerId: number): void {
    const customer = this.customers.find(c => c.id === customerId);
    if (!customer || customer.id === this.selectedCustomer?.id) return;
    this.selectedCustomer = customer;
    // Do NOT call appState.selectCustomer() — keeps customer list highlighting on the originally selected customer
    this.loadCustomerContractsAndTickets(customer.id);
    this.cdr.detectChanges();
  }

  getLastContactedDate(): string {
    if (this.customerNotes.length === 0) return 'Never';

    // customerNotes is already sorted newest-first in loadCustomerData()
    const lastNote = this.customerNotes[0];
    const raw = typeof lastNote.createdAt === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(lastNote.createdAt as any)
      ? (lastNote.createdAt as any) + 'Z' : lastNote.createdAt;
    const diff = Date.now() - new Date(raw).getTime();
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

  addPlantingIntention(data: {crop: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}): void {
    if (!this.selectedCustomer) return;

    const apiData = {
      customerId: this.selectedCustomer.id,
      customerName: this.selectedCustomer.name,
      customerCode: this.selectedCustomer.sourceCustomerId || '',
      tradeUnit: data.tradeUnit,
      crop: data.crop,
      type: data.type,
      description: data.description,
      acres: data.acres,
      plantingYear: data.plantingYear
    };

    this.apiService.createPlantingIntention(apiData).pipe(takeUntil(this.destroy$)).subscribe({
      next: (intention) => {
        // Add to global list
        this.plantingIntentions = [...this.plantingIntentions, intention];
        this.appState.setPlantingIntentions(this.plantingIntentions);

        // Add to customer-specific list
        this.customerPlantingIntentions = [...this.customerPlantingIntentions, intention];

        // Update allCustomerPlantingIntentions for Activity Summary
        this.allCustomerPlantingIntentions = [...this.allCustomerPlantingIntentions, intention];

        this.toastService.success('Planting intention added');
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to add planting intention');
      }
    });
  }

  editPlantingIntention(data: {intentionId: number, crop: string, type?: string, description?: string, acres: number, plantingYear: number}): void {
    this.apiService.updatePlantingIntention(data.intentionId, {
      crop: data.crop,
      type: data.type,
      description: data.description,
      acres: data.acres,
      plantingYear: data.plantingYear
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (updatedIntention) => {
        // Update in global list
        this.plantingIntentions = this.plantingIntentions.map(p =>
          p.id === data.intentionId ? updatedIntention : p
        );
        this.appState.setPlantingIntentions(this.plantingIntentions);

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

  deletePlantingIntention(intentionId: number): void {
    this.apiService.deletePlantingIntention(intentionId).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        // Remove from global list
        this.plantingIntentions = this.plantingIntentions.filter(p => p.id !== intentionId);
        this.appState.setPlantingIntentions(this.plantingIntentions);

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

    const tradeUnit = this.selectedTradeUnits.length === 1 ? this.selectedTradeUnits[0] : undefined;
    this.apiService.createNote(this.selectedCustomer.id, content, tradeUnit).pipe(takeUntil(this.destroy$)).subscribe({
      next: (note) => {
        this.notes = [...this.notes, note];
        this.appState.setNotes(this.notes);
        this.customerNotes = [note, ...this.customerNotes];
        this.toastService.success('Note added');
      },
      error: () => {
        this.toastService.error('Failed to add note');
      }
    });
  }

  toggleNotePin(note: Note): void {
    this.apiService.toggleNotePin(note.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (updated) => {
        const index = this.notes.findIndex(n => n.id === updated.id);
        if (index >= 0) {
          this.notes[index] = updated;
          this.notes = [...this.notes];
          this.appState.setNotes(this.notes);
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

  editNote(data: { noteId: number; content: string }): void {
    this.apiService.updateNote(data.noteId, data.content).pipe(takeUntil(this.destroy$)).subscribe({
      next: (updated) => {
        // Update in global list
        const index = this.notes.findIndex(n => n.id === updated.id);
        if (index >= 0) {
          this.notes[index] = updated;
          this.notes = [...this.notes];
          this.appState.setNotes(this.notes);
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

  deleteNote(noteId: number): void {
    this.apiService.deleteNote(noteId).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        // Remove from global list
        this.notes = this.notes.filter(n => n.id !== noteId);
        this.appState.setNotes(this.notes);
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
