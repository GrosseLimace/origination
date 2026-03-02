import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AppStateService, BuildListState } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { NlqFilterService, NlqFilterContext } from '../../services/nlq-filter.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, SavedList, ProducerDetails } from '../../models';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent } from '../../components/ui/card/card.component';
import { ButtonComponent } from '../../components/ui/button/button.component';
import { BadgeComponent } from '../../components/ui/badge/badge.component';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '../../components/ui/dialog/dialog.component';
import { InputComponent } from '../../components/ui/input/input.component';
import { CustomerMapComponent } from '../../components/map/customer-map.component';

@Component({
  selector: 'app-build-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    CardContentComponent,
    CardHeaderComponent,
    CardTitleComponent,
    CardDescriptionComponent,
    ButtonComponent,
    BadgeComponent,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogContentComponent,
    DialogFooterComponent,
    InputComponent,
    CustomerMapComponent
  ],
  template: `
    <div class="space-y-8">
      <!-- Header -->
      <div class="flex items-start justify-between">
        <div>
          <h2 class="text-2xl font-semibold text-gray-900 dark:text-white">Build a List</h2>
          <p class="text-gray-500 dark:text-gray-400">Use natural language to create a custom customer list based on your criteria</p>
        </div>
        <app-button
          [variant]="showMap ? 'default' : 'outline'"
          (onClick)="hasTradeUnits && toggleMap()"
          [disabled]="!hasTradeUnits"
          [class.opacity-50]="!hasTradeUnits"
          [class.cursor-not-allowed]="!hasTradeUnits"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2">
            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
            <line x1="9" x2="9" y1="3" y2="18"/>
            <line x1="15" x2="15" y1="6" y2="21"/>
          </svg>
          Map
        </app-button>
      </div>

      <!-- No trade unit selected banner -->
      @if (!hasTradeUnits) {
        <app-card>
          <app-card-content class="!p-6">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 dark:text-green-400">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
              </div>
              <div>
                <p class="font-semibold text-gray-900 dark:text-white">Select a Trade Unit to Get Started</p>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Use the Trade Unit filter on the Customers panel to select one or more trade units. Once selected, you can build lists and view customer locations on the map.</p>
              </div>
            </div>
          </app-card-content>
        </app-card>
      }

      <!-- Map View (toggleable) - shows filtered customers if NLQ ran, otherwise all -->
      @if (showMap && getMapCustomers().length > 0) {
        <app-customer-map
          [customers]="getMapCustomers()"
          [focusedState]="detectedState"
          (close)="toggleMap()"
          (selectCustomer)="selectCustomer($event)"
        />
      }

      <!-- Natural Language Query Card -->
      <app-card>
        <app-card-content class="!p-6">
          <!-- Card Header -->
          <div class="flex items-center gap-2 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #22c55e;">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
              <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
            </svg>
            <h3 class="font-semibold text-gray-900 dark:text-white">Natural Language Query</h3>
          </div>

          <!-- Query Input -->
          <div class="relative mb-4">
            <textarea
              [(ngModel)]="queryText"
              (ngModelChange)="onQueryChange($event)"
              placeholder="Describe the customers you want to find... e.g., 'Customers with more than 500 acres' or 'Farmers I have not contacted in over 30 days'"
              rows="3"
              [disabled]="!hasTradeUnits || loading"
              class="w-full p-3 pr-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            ></textarea>
            @if (queryText.trim()) {
              <button
                type="button"
                (click)="clearQuery()"
                title="Clear query"
                class="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                </svg>
              </button>
            }
          </div>

          <!-- Generate Button -->
          <div class="mb-6">
            <app-button variant="default" (onClick)="processQuery()" [disabled]="!hasTradeUnits || !queryText.trim() || isProcessing || loading">
              @if (isProcessing) {
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2 animate-spin">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                Generating...
              } @else {
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2">
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                  <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
                </svg>
                Generate List
              }
            </app-button>
          </div>

          <!-- Example Queries -->
          <div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-3">Example queries:</p>
            <div class="flex flex-wrap gap-2">
              @for (example of exampleQueries; track example) {
                <button
                  type="button"
                  (click)="hasTradeUnits && useExampleQuery(example)"
                  [disabled]="!hasTradeUnits"
                  class="px-3 py-1.5 text-sm rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  {{ example }}
                </button>
              }
            </div>
          </div>
        </app-card-content>
      </app-card>

      <!-- Unrecognized Query Warning (non-blocking — results still shown below) -->
      @if (queryUnrecognized && hasGenerated && queryText.trim()) {
        <div class="flex items-start gap-3 px-4 py-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
            <path d="M12 9v4"/><path d="M12 17h.01"/>
          </svg>
          <p class="text-sm text-yellow-800 dark:text-yellow-300">Query not recognized — no customers matched. Try using keywords like <strong>acres</strong>, <strong>contracted</strong>, <strong>delivered</strong>, <strong>planting</strong>, <strong>storage</strong>, or <strong>contacted</strong>.</p>
        </div>
      }

      <!-- Results Section (only shown after generating and when query has text) -->
      @if (hasGenerated && queryText.trim()) {
        <app-card>
          <app-card-header>
            <div class="flex items-center justify-between">
              <div>
                <app-card-title>Results</app-card-title>
                <app-card-description>
                  Found {{ filteredCustomers.length }} customer(s) matching your criteria
                  @if (detectedState) {
                    <span> in {{ getStateDisplayName(detectedState) }}</span>
                  }
                </app-card-description>
              </div>
              @if (filteredCustomers.length > 0) {
                <div class="flex gap-2">
                  @if (!showMap) {
                    <app-button variant="outline" (onClick)="toggleMap()">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2">
                        <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
                        <line x1="9" x2="9" y1="3" y2="18"/>
                        <line x1="15" x2="15" y1="6" y2="21"/>
                      </svg>
                      Show on Map
                    </app-button>
                  }
                  <app-button variant="outline" (onClick)="openSaveDialog()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2">
                      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
                    </svg>
                    Save List
                  </app-button>
                </div>
              }
            </div>
          </app-card-header>
          <app-card-content>
            @if (filteredCustomers.length === 0) {
              <div class="text-center py-8">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 text-gray-300 dark:text-gray-600">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                @if (queryUnrecognized) {
                  <h3 class="text-gray-500 dark:text-gray-400 mb-2">Query Not Recognized</h3>
                  <p class="text-sm text-gray-400 dark:text-gray-500 mt-1">Rephrase using keywords like <strong>acres</strong>, <strong>contracted</strong>, <strong>delivered</strong>, <strong>planting</strong>, <strong>storage</strong>, or <strong>contacted</strong>.</p>
                } @else {
                  <h3 class="text-gray-500 dark:text-gray-400 mb-2">No Customers Found</h3>
                  <p class="text-sm text-gray-400 dark:text-gray-500 mt-1">No customers matched your criteria. Try broadening your query or adjusting the filters.</p>
                }
                <button
                  type="button"
                  (click)="queryText = ''; hasGenerated = false; filteredCustomers = []"
                  class="mt-3 text-sm text-green-600 hover:text-green-700 dark:text-green-400 underline"
                >
                  Clear query
                </button>
              </div>
            } @else {
              <div class="divide-y divide-gray-200 dark:divide-gray-700">
                @for (customer of filteredCustomers; track customer.id) {
                  <div
                    class="py-4 flex items-start justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-6 px-6 cursor-pointer transition-colors"
                    (click)="selectCustomer(customer)"
                  >
                    <div class="flex items-start gap-3">
                      <div class="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
                        <span class="text-sm font-medium text-green-700 dark:text-green-300">{{ getInitials(customer.name) }}</span>
                      </div>
                      <div>
                        <div class="font-medium text-gray-900 dark:text-white">{{ customer.name }} <span class="text-gray-400 dark:text-gray-500 font-normal">({{ customer.sourceCustomerId }})</span></div>
                        <div class="text-sm text-gray-500 dark:text-gray-400">{{ customer.farm }}</div>
                        <div class="flex items-center gap-2 mt-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400">
                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                            <circle cx="12" cy="10" r="3"/>
                          </svg>
                          <span class="text-xs text-gray-400">{{ getFormattedLocation(customer) }}</span>
                          <span class="text-gray-300 dark:text-gray-600">•</span>
                          <span class="text-sm text-gray-500 dark:text-gray-400">{{ customer.totalAcres | number }} acres</span>
                        </div>
                      </div>
                    </div>
                    <div class="text-right">
                      <span [class]="getLastContactInfo(customer.id).colorClass + ' text-sm'">
                        {{ getLastContactInfo(customer.id).text }}
                      </span>
                      <div class="flex gap-1 mt-2 justify-end">
                        @for (crop of getCustomerCrops(customer.id); track crop) {
                          <app-badge variant="outline" class="text-xs">{{ crop }}</app-badge>
                        }
                      </div>
                    </div>
                  </div>
                }
              </div>
            }
          </app-card-content>
        </app-card>
      }

      <!-- Saved Lists Section - Always visible -->
      <app-card>
        <app-card-header>
          <app-card-title>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-2">
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
            </svg>
            Saved Lists
          </app-card-title>
          <app-card-description>Your saved customer lists for quick access</app-card-description>
        </app-card-header>
        <app-card-content>
          @if (loading) {
            <div class="p-8 text-center">
              <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-300 dark:border-gray-600 border-t-green-600 dark:border-t-green-500 mb-4"></div>
              <p class="text-gray-500 dark:text-gray-400 font-medium">Loading customers...</p>
            </div>
          } @else if (savedLists.length === 0) {
            <div class="text-center py-8">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 text-gray-300 dark:text-gray-600">
                <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
              </svg>
              <h3 class="text-gray-500 dark:text-gray-400 mb-2">No Saved Lists</h3>
              <p class="text-sm text-gray-400 dark:text-gray-500">Generate a list above and save it for quick access later</p>
            </div>
          } @else {
            <div class="space-y-2">
              @for (list of savedLists; track list.id) {
                <div class="flex items-center justify-between gap-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <button type="button" (click)="loadSavedList(list)" class="flex-1 text-left min-w-0">
                    <div class="font-medium text-gray-900 dark:text-white truncate">{{ list.name }}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 truncate">"{{ list.query }}"</div>
                  </button>
                  <button type="button" (click)="deleteList(list.id)" class="text-red-500 hover:text-red-600 bg-transparent border-0 p-0 flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18"/>
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                      <line x1="10" x2="10" y1="11" y2="17"/>
                      <line x1="14" x2="14" y1="11" y2="17"/>
                    </svg>
                  </button>
                </div>
              }
            </div>
          }
        </app-card-content>
      </app-card>

      <!-- Save List Dialog -->
      <app-dialog [isOpen]="showSaveDialog" (close)="closeSaveDialog()" size="sm">
        <app-dialog-header>
          <app-dialog-title>Save List</app-dialog-title>
          <app-dialog-description>Give this list a name so you can easily access it later</app-dialog-description>
        </app-dialog-header>
        <app-dialog-content>
          <div class="space-y-2">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300">List Name</label>
            <app-input
              type="text"
              [(ngModel)]="newListName"
              placeholder="e.g., High Priority Prospects"
            />
          </div>
        </app-dialog-content>
        <app-dialog-footer>
          <app-button variant="outline" (onClick)="closeSaveDialog()">Cancel</app-button>
          <app-button (onClick)="saveList()" [disabled]="!newListName.trim()">Save List</app-button>
        </app-dialog-footer>
      </app-dialog>

      <!-- Delete Confirmation Dialog -->
      <app-dialog [isOpen]="showDeleteDialog" (close)="closeDeleteDialog()" size="sm">
        <app-dialog-header>
          <app-dialog-title>Delete List</app-dialog-title>
          <app-dialog-description>Are you sure you want to delete this list? This action cannot be undone.</app-dialog-description>
        </app-dialog-header>
        <app-dialog-footer>
          <app-button variant="outline" (onClick)="closeDeleteDialog()">Cancel</app-button>
          <app-button variant="destructive" (onClick)="confirmDeleteList()">Delete</app-button>
        </app-dialog-footer>
      </app-dialog>
    </div>
  `
})
export class BuildListComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private appState = inject(AppStateService);
  private toastService = inject(ToastService);
  private nlqFilterService = inject(NlqFilterService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  // Trade units captured at init — used to detect changes in ngOnDestroy
  private initTradeUnits: string[] = [];
  private initialized = false;

  // effect() runs in the injection context (class field initializer).
  // The initial run fires during construction (initialized = false → skipped).
  // Every subsequent run means TUs changed while the component is alive.
  private _tuEffect = effect(() => {
    this.appState.selectedTradeUnits(); // establish reactive dependency
    if (this.initialized) {
      untracked(() => this.clearQuery());
    }
  }, { allowSignalWrites: true });

  customers: Customer[] = [];
  contracts: Contract[] = [];
  tickets: Ticket[] = [];
  plantingIntentions: PlantingIntention[] = [];
  notes: Note[] = [];
  storedGrain: StoredGrain[] = [];
  savedLists: SavedList[] = [];

  get hasTradeUnits(): boolean {
    return this.appState.selectedTradeUnits().length > 0;
  }

  queryText = '';
  filteredCustomers: Customer[] = [];
  showSaveDialog = false;
  showDeleteDialog = false;
  deleteListId: number | null = null;
  newListName = '';
  isProcessing = false;
  hasGenerated = false;
  showMap = false;
  loading = false;
  detectedState: string | null = null;
  queryUnrecognized = false;

  private lastContactCache = new Map<number, { text: string; colorClass: string }>();
  private customerCropsCache = new Map<number, string[]>();

  exampleQueries = [
    'Top 10 largest operations',
    'Customers with more than 500 acres',
    'Farmers not contacted in over 30 days',
    'Producers with active contracts',
    'Growers who delivered corn this year',
    'Customers with overdue contracts',
    'Farmers with no email',
    'Customers planting soybeans in 2026'
  ];


  ngOnInit(): void {
    this.initTradeUnits = this.appState.selectedTradeUnits().slice();
    this.initialized = true;
    this.loadData();
  }

  ngOnDestroy(): void {
    // If trade units changed while this component was alive, discard state entirely
    // so re-mounting shows a blank query for the new selection.
    const currentTus = this.appState.selectedTradeUnits();
    const tradeUnitsChanged = currentTus.length !== this.initTradeUnits.length ||
      currentTus.some(tu => !this.initTradeUnits.includes(tu));

    if (tradeUnitsChanged) {
      this.appState.clearBuildListState();
    } else {
      this.appState.setBuildListState({
        queryText: this.queryText,
        filteredCustomerIds: this.filteredCustomers.map(c => c.id),
        hasGenerated: this.hasGenerated,
        showMap: this.showMap,
        detectedState: this.detectedState,
        queryUnrecognized: this.queryUnrecognized,
        tradeUnits: this.initTradeUnits
      });
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadData(): void {
    this.loading = true;

    // Use cached data from AppStateService if already loaded (trade-unit-filtered by home)
    const cachedCustomers = this.appState.customers();
    if (cachedCustomers.length > 0) {
      this.customers = cachedCustomers;
      this.contracts = this.appState.contracts();
      this.tickets = this.appState.tickets();
      this.plantingIntentions = this.appState.plantingIntentions();
      this.notes = this.appState.notes();
      this.storedGrain = this.appState.storedGrain();
      this.savedLists = this.appState.savedLists();
      this.rebuildCaches();
      // Restore UI state if we have it
      this.restoreUIState();
      // Load and merge ProducerDetails (commodities, bin capacity, etc.) if not already merged
      this.loadAndMergeProducerDetails();
      return;
    }

    // No cache — load from API respecting selected trade units
    const tradeUnits = this.appState.selectedTradeUnits();
    const tuParam = tradeUnits.length > 0 ? tradeUnits : undefined;
    forkJoin({
      customers: this.apiService.getCustomers(tuParam),
      contracts: this.apiService.getContracts(tuParam),
      tickets: this.apiService.getTickets(tuParam),
      plantingIntentions: this.apiService.getPlantingIntentions(),
      notes: this.apiService.getNotes(),
      storedGrain: this.apiService.getStoredGrain(),
      savedLists: this.apiService.getSavedLists()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.customers = data.customers;
        this.contracts = data.contracts;
        this.tickets = data.tickets;
        this.plantingIntentions = data.plantingIntentions;
        this.notes = data.notes;
        this.storedGrain = data.storedGrain;
        this.savedLists = data.savedLists;
        this.appState.setCustomers(data.customers);
        this.appState.setContracts(data.contracts);
        this.appState.setTickets(data.tickets);
        this.appState.setPlantingIntentions(data.plantingIntentions);
        this.appState.setNotes(data.notes);
        this.appState.setStoredGrain(data.storedGrain);
        this.appState.setSavedLists(data.savedLists);
        this.rebuildCaches();
        this.restoreUIState();
        // Load and merge ProducerDetails (commodities, bin capacity, etc.)
        this.loadAndMergeProducerDetails();
      },
      error: () => {
        this.loading = false;
        this.toastService.error('Failed to load data');
      }
    });
  }

  private loadAndMergeProducerDetails(): void {
    this.apiService.getAllProducerDetails().pipe(takeUntil(this.destroy$)).subscribe({
      next: (details) => {
        if (details.length === 0) {
          this.loading = false;
          this.cdr.detectChanges();
          return;
        }
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
              commodities: pd.commodities ? pd.commodities.split(',').map(c => c.trim()) : customer.commodities,
              linkedProducerIds: pd.linkedProducerIds ? pd.linkedProducerIds.split(',').filter(Boolean) : customer.linkedProducerIds
            };
          }
          return customer;
        });
        if (changed) {
          this.customers = [...this.customers];
          this.appState.setCustomers(this.customers);
          this.customerCropsCache.clear();
        }
        // Re-apply the current query with the newly merged customer data
        // (uses cached contracts/tickets/notes — no extra API calls needed here)
        if (this.hasGenerated && this.queryText.trim()) {
          this.applyNlqFilter();
        }
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private restoreUIState(): void {
    const saved = this.appState.buildListState();
    if (!saved) return;

    // If trade units changed since state was saved, clear everything —
    // the user must re-enter and regenerate for the new selection.
    const currentTus = this.appState.selectedTradeUnits();
    const savedTus = saved.tradeUnits ?? [];
    const tradeUnitsMatch = currentTus.length === savedTus.length &&
      currentTus.every(tu => savedTus.includes(tu));

    if (!tradeUnitsMatch) {
      this.appState.clearBuildListState();
      return;
    }

    this.queryText = saved.queryText;
    this.hasGenerated = saved.hasGenerated;
    this.showMap = saved.showMap;
    this.detectedState = saved.detectedState;
    this.queryUnrecognized = saved.queryUnrecognized;
    if (saved.hasGenerated && saved.filteredCustomerIds.length > 0) {
      const idSet = new Set(saved.filteredCustomerIds);
      this.filteredCustomers = this.customers.filter(c => idSet.has(c.id));
    }
  }

  toggleMap(): void {
    this.showMap = !this.showMap;
  }

  getMapCustomers(): Customer[] {
    return this.hasGenerated ? this.filteredCustomers : this.customers;
  }

  clearQuery(): void {
    this.queryText = '';
    this.hasGenerated = false;
    this.filteredCustomers = [];
    this.detectedState = null;
    this.queryUnrecognized = false;
    this.showMap = false;
    this.appState.clearBuildListState();
  }

  onQueryChange(query: string): void {
    if (!query.trim()) {
      this.hasGenerated = false;
      this.filteredCustomers = [];
      this.detectedState = null;
      this.queryUnrecognized = false;
    }
  }

  useExampleQuery(example: string): void {
    if (this.loading) return;
    this.detectedState = null;
    this.hasGenerated = false;
    this.filteredCustomers = [];
    this.queryUnrecognized = false;
    this.queryText = example;
    this.processQuery();
  }

  processQuery(): void {
    if (!this.queryText.trim()) return;

    this.isProcessing = true;
    const tradeUnits = this.appState.selectedTradeUnits();
    const tuParam = tradeUnits.length > 0 ? tradeUnits : undefined;

    // Always fetch fresh data before filtering so the query sees the latest
    // notes, contracts, tickets, ProducerDetails, and planting intentions.
    forkJoin({
      customers: this.apiService.getCustomers(tuParam),
      contracts: this.apiService.getContracts(tuParam),
      tickets: this.apiService.getTickets(tuParam),
      plantingIntentions: this.apiService.getPlantingIntentions(),
      notes: this.apiService.getNotes(),
      storedGrain: this.apiService.getStoredGrain(),
      producerDetails: this.apiService.getAllProducerDetails()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        // Merge ProducerDetails into customer objects
        const detailsMap = new Map(data.producerDetails.map(d => [d.customerId, d]));
        this.customers = data.customers.map(customer => {
          const pd = detailsMap.get(customer.id);
          if (!pd) return customer;
          return {
            ...customer,
            totalAcres: pd.totalAcres ?? customer.totalAcres,
            binCapacity: pd.binCapacity ?? customer.binCapacity,
            primaryContact: pd.primaryContact ?? customer.primaryContact,
            commodities: pd.commodities ? pd.commodities.split(',').map((c: string) => c.trim()) : customer.commodities,
            linkedProducerIds: pd.linkedProducerIds ? pd.linkedProducerIds.split(',').filter(Boolean) : customer.linkedProducerIds
          };
        });
        this.contracts = data.contracts;
        this.tickets = data.tickets;
        this.notes = data.notes;
        this.plantingIntentions = data.plantingIntentions;
        this.storedGrain = data.storedGrain;

        // Update appState cache so other pages see the fresh data too
        this.appState.setCustomers(this.customers);
        this.appState.setContracts(this.contracts);
        this.appState.setTickets(this.tickets);
        this.appState.setNotes(this.notes);
        this.appState.setPlantingIntentions(this.plantingIntentions);
        this.appState.setStoredGrain(this.storedGrain);

        this.rebuildCaches();
        this.applyNlqFilter();
        this.isProcessing = false;
      },
      error: () => {
        this.toastService.error('Failed to load data for query');
        this.isProcessing = false;
      }
    });
  }

  /** Runs the NLQ filter against the current in-memory data and updates filteredCustomers. */
  private applyNlqFilter(): void {
    const context: NlqFilterContext = {
      customers: this.customers,
      contracts: this.contracts,
      tickets: this.tickets,
      notes: this.notes,
      plantingIntentions: this.plantingIntentions,
      storedGrain: this.storedGrain
    };
    const result = this.nlqFilterService.parseAndFilter(this.queryText, context);
    this.detectedState = result.detectedState;
    this.hasGenerated = true;
    this.queryUnrecognized = result.matchedPatterns.length === 0;
    // When unrecognized, show 0 results rather than the confusing "all customers" default
    this.filteredCustomers = this.queryUnrecognized ? [] : result.customers;
    this.rebuildCaches();
  }


  private rebuildCaches(): void {
    this.lastContactCache.clear();
    this.customerCropsCache.clear();
  }

  getStateDisplayName(state: string): string {
    return this.nlqFilterService.getStateDisplayName(state);
  }

  loadSavedList(list: SavedList): void {
    if (this.loading) return;
    this.queryText = list.query;
    this.processQuery();
  }

  openSaveDialog(): void {
    this.showSaveDialog = true;
    this.newListName = '';
  }

  closeSaveDialog(): void {
    this.showSaveDialog = false;
  }

  saveList(): void {
    if (!this.newListName.trim() || this.filteredCustomers.length === 0) return;

    const tradeUnits = this.appState.selectedTradeUnits();
    this.apiService.createSavedList({
      name: this.newListName,
      query: this.queryText,
      tradeUnits: tradeUnits.length > 0 ? tradeUnits.join(',') : undefined
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.toastService.success(`List "${this.newListName}" saved with ${this.filteredCustomers.length} customers`);
        this.newListName = '';
        this.showSaveDialog = false;
        this.queryText = '';
        this.hasGenerated = false;
        this.filteredCustomers = [];
        this.detectedState = null;
        this.refreshSavedLists();
      },
      error: () => {
        this.toastService.error('Failed to save list');
      }
    });
  }

  deleteList(listId: number): void {
    this.deleteListId = listId;
    this.showDeleteDialog = true;
  }

  closeDeleteDialog(): void {
    this.showDeleteDialog = false;
    this.deleteListId = null;
  }

  confirmDeleteList(): void {
    if (!this.deleteListId) return;
    const listId = this.deleteListId;
    this.closeDeleteDialog();

    // Remove from local array immediately for instant UI feedback
    this.savedLists = this.savedLists.filter(l => l.id !== listId);
    this.appState.setSavedLists(this.savedLists);

    this.apiService.deleteSavedList(listId).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.toastService.info('List deleted');
      },
      error: () => {
        this.toastService.error('Failed to delete list');
        this.refreshSavedLists(); // Re-fetch on error to restore
      }
    });
  }

  private refreshSavedLists(): void {
    this.apiService.getSavedLists().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.savedLists = data;
        this.appState.setSavedLists(data);
      },
      error: () => this.toastService.error('Failed to refresh lists')
    });
  }

  selectCustomer(customer: Customer): void {
    this.router.navigate(['/'], { queryParams: { customerId: customer.id } });
  }

  getInitials(name: string): string {
    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return '??';
  }

  getFormattedLocation(customer: Customer): string {
    if (customer.extendedCity && customer.extendedStateProvince) {
      return `${customer.extendedCity}, ${customer.extendedStateProvince}`;
    }
    if (customer.location && customer.stateProvince) {
      return `${customer.location}, ${customer.stateProvince}`;
    }
    return customer.extendedCity || customer.location || customer.stateProvince || '';
  }

  getLastContactInfo(customerId: number): { text: string; colorClass: string } {
    const cached = this.lastContactCache.get(customerId);
    if (cached !== undefined) {
      return cached;
    }

    const lastNote = this.notes
      .filter(n => n.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    let result: { text: string; colorClass: string };

    if (!lastNote) {
      result = { text: 'Never contacted', colorClass: 'text-red-500' };
    } else {
      const daysAgo = Math.floor((Date.now() - new Date(lastNote.createdAt).getTime()) / (1000 * 60 * 60 * 24));

      if (daysAgo === 0) result = { text: 'Contacted today', colorClass: 'text-green-500' };
      else if (daysAgo === 1) result = { text: 'Contacted yesterday', colorClass: 'text-green-500' };
      else if (daysAgo < 7) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-green-500' };
      else if (daysAgo < 30) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-yellow-500' };
      else result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-red-500' };
    }

    this.lastContactCache.set(customerId, result);
    return result;
  }

  getCustomerCrops(customerId: number): string[] {
    const cached = this.customerCropsCache.get(customerId);
    if (cached !== undefined) {
      return cached;
    }

    const customer = this.customers.find(c => c.id === customerId);
    // Farmer detail commodities (ProducerDetails) — primary source
    const detailCrops = customer?.commodities?.length ? [...customer.commodities] : [];
    // Contract commodities (ODS data) — supplemental source
    const contractCrops = customer?.sourceCustomerId
      ? [...new Set(
          this.contracts
            .filter(c => c.ctrmCustomerId === customer.sourceCustomerId)
            .map(c => c.commodityCode)
            .filter((crop): crop is string => !!crop)
        )]
      : [];
    // Planting intentions as supplemental source
    const intentionCrops = [...new Set(
      this.plantingIntentions.filter(p => p.customerId === customerId).map(p => p.crop)
    )];
    const result = [...new Set([...detailCrops, ...contractCrops, ...intentionCrops])].slice(0, 5);

    this.customerCropsCache.set(customerId, result);
    return result;
  }
}
