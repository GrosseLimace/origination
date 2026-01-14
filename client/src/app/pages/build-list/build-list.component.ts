import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, PlantingIntention, Note, StoredGrain, SavedList } from '../../models';
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
        <app-button [variant]="showMap ? 'default' : 'outline'" (onClick)="toggleMap()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2">
            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
            <line x1="9" x2="9" y1="3" y2="18"/>
            <line x1="15" x2="15" y1="6" y2="21"/>
          </svg>
          Map
        </app-button>
      </div>

      <!-- Map View (toggleable) - always shows all customers -->
      @if (showMap && customers.length > 0) {
        <app-customer-map
          [customers]="customers"
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
          <div class="mb-4">
            <textarea
              [(ngModel)]="queryText"
              (ngModelChange)="onQueryChange($event)"
              placeholder="Describe the type of customers you want to find... e.g., 'Show me farms in Nebraska' or 'Customers growing corn in Iowa'"
              rows="3"
              class="w-full p-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            ></textarea>
          </div>

          <!-- Generate Button -->
          <div class="mb-6">
            <app-button variant="default" (onClick)="processQuery()" [disabled]="!queryText.trim() || isProcessing">
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
                  (click)="useExampleQuery(example)"
                  class="px-3 py-1.5 text-sm rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-0"
                >
                  {{ example }}
                </button>
              }
            </div>
          </div>
        </app-card-content>
      </app-card>

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
                <h3 class="text-gray-500 dark:text-gray-400 mb-2">No Customers Found</h3>
                <p class="text-sm text-gray-400 dark:text-gray-500">Try adjusting your query</p>
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
                        <div class="font-medium text-gray-900 dark:text-white">{{ customer.name }}</div>
                        <div class="text-sm text-gray-500 dark:text-gray-400">{{ customer.farm }}</div>
                        <div class="flex items-center gap-2 mt-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400">
                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                            <circle cx="12" cy="10" r="3"/>
                          </svg>
                          <span class="text-xs text-gray-400">{{ customer.location }}</span>
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
          @if (savedLists.length === 0) {
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
                    <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ list.customerIds.length }} customers • Created from: "{{ list.query }}"</div>
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
    </div>
  `
})
export class BuildListComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  customers: Customer[] = [];
  contracts: Contract[] = [];
  plantingIntentions: PlantingIntention[] = [];
  notes: Note[] = [];
  storedGrain: StoredGrain[] = [];
  savedLists: SavedList[] = [];

  queryText = '';
  filteredCustomers: Customer[] = [];
  showSaveDialog = false;
  newListName = '';
  isProcessing = false;
  hasGenerated = false;
  showMap = false;
  detectedState: string | null = null;

  exampleQueries = [
    'Show me farms in Nebraska',
    'Customers with more than 1000 acres',
    'Farmers I have not contacted in over 60 days',
    'Customers contacted in the last 7 days',
    'Farms with grain in storage',
    'Customers planting corn this season',
    'Large operations over 2000 acres in Iowa',
    'Producers with soybeans in storage',
    'Top 10 largest operations'
  ];

  private stateNames: { [key: string]: string } = {
    'iowa': 'Iowa',
    'nebraska': 'Nebraska',
    'illinois': 'Illinois',
    'minnesota': 'Minnesota',
    'wisconsin': 'Wisconsin',
    'missouri': 'Missouri',
    'kansas': 'Kansas',
    'south dakota': 'South Dakota',
    'north dakota': 'North Dakota',
    'indiana': 'Indiana',
    'ohio': 'Ohio',
    'michigan': 'Michigan',
    'texas': 'Texas',
    'oklahoma': 'Oklahoma',
    'colorado': 'Colorado'
  };

  ngOnInit(): void {
    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadData(): void {
    forkJoin({
      customers: this.apiService.getCustomers(),
      contracts: this.apiService.getContracts(),
      plantingIntentions: this.apiService.getPlantingIntentions(),
      notes: this.apiService.getNotes(),
      storedGrain: this.apiService.getStoredGrain(),
      savedLists: this.apiService.getSavedLists()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.customers = data.customers;
        this.contracts = data.contracts;
        this.plantingIntentions = data.plantingIntentions;
        this.notes = data.notes;
        this.storedGrain = data.storedGrain;
        this.savedLists = data.savedLists;
      },
      error: () => {
        this.toastService.error('Failed to load data');
      }
    });
  }

  toggleMap(): void {
    this.showMap = !this.showMap;
  }

  getMapCustomers(): Customer[] {
    return this.hasGenerated ? this.filteredCustomers : this.customers;
  }

  onQueryChange(query: string): void {
    if (!query.trim()) {
      this.hasGenerated = false;
      this.filteredCustomers = [];
      this.detectedState = null;
    }
  }

  async useExampleQuery(example: string): Promise<void> {
    this.detectedState = null;
    this.hasGenerated = false;
    this.filteredCustomers = [];
    this.queryText = example;
    await this.processQuery();
  }

  async processQuery(): Promise<void> {
    if (!this.queryText.trim()) return;

    this.isProcessing = true;

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 800));

    // Detect state in query
    this.detectedState = this.detectStateInQuery(this.queryText);

    // Parse natural language query and filter
    this.filteredCustomers = this.parseAndFilter(this.queryText);
    this.hasGenerated = true;

    this.isProcessing = false;
  }

  private detectStateInQuery(query: string): string | null {
    const lowerQuery = query.toLowerCase();

    // Check for full state names first
    for (const state of Object.keys(this.stateNames)) {
      if (lowerQuery.includes(state)) {
        return state;
      }
    }

    // Also check for state abbreviations
    const stateAbbreviations: { [key: string]: string } = {
      ' ia ': 'iowa', ' ia,': 'iowa', ' ia.': 'iowa',
      ' ne ': 'nebraska', ' ne,': 'nebraska', ' ne.': 'nebraska',
      ' il ': 'illinois', ' il,': 'illinois', ' il.': 'illinois',
      ' mn ': 'minnesota', ' mn,': 'minnesota', ' mn.': 'minnesota',
      ' wi ': 'wisconsin', ' wi,': 'wisconsin', ' wi.': 'wisconsin',
      ' mo ': 'missouri', ' mo,': 'missouri', ' mo.': 'missouri',
      ' ks ': 'kansas', ' ks,': 'kansas', ' ks.': 'kansas',
      ' sd ': 'south dakota', ' sd,': 'south dakota', ' sd.': 'south dakota',
      ' nd ': 'north dakota', ' nd,': 'north dakota', ' nd.': 'north dakota',
      ',in ': 'indiana', ' in,': 'indiana', ' in.': 'indiana',
      ' oh ': 'ohio', ' oh,': 'ohio', ' oh.': 'ohio',
      ' mi ': 'michigan', ' mi,': 'michigan', ' mi.': 'michigan',
      ' tx ': 'texas', ' tx,': 'texas', ' tx.': 'texas',
      ' ok ': 'oklahoma', ' ok,': 'oklahoma', ' ok.': 'oklahoma',
      ' co ': 'colorado', ' co,': 'colorado', ' co.': 'colorado'
    };

    for (const [abbrev, state] of Object.entries(stateAbbreviations)) {
      if (lowerQuery.includes(abbrev)) {
        return state;
      }
    }

    return null;
  }

  getStateDisplayName(state: string): string {
    return this.stateNames[state.toLowerCase()] || state.charAt(0).toUpperCase() + state.slice(1);
  }

  private getStateAbbreviation(state: string): string {
    const abbrevs: { [key: string]: string } = {
      'iowa': 'ia', 'illinois': 'il', 'nebraska': 'ne', 'minnesota': 'mn',
      'wisconsin': 'wi', 'missouri': 'mo', 'kansas': 'ks', 'south dakota': 'sd',
      'north dakota': 'nd', 'indiana': 'in', 'ohio': 'oh', 'michigan': 'mi',
      'texas': 'tx', 'oklahoma': 'ok', 'colorado': 'co'
    };
    return abbrevs[state.toLowerCase()] || '';
  }

  private parseAndFilter(query: string): Customer[] {
    const lowerQuery = query.toLowerCase();
    let result = [...this.customers];

    // ==========================================
    // LOCATION/STATE FILTER
    // ==========================================
    if (this.detectedState) {
      const stateAbbrev = this.getStateAbbreviation(this.detectedState);
      result = result.filter(c =>
        c.location.toLowerCase().includes(this.detectedState!) ||
        c.location.toLowerCase().includes(stateAbbrev)
      );
    }

    // ==========================================
    // ACRES FILTER
    // ==========================================
    // "more than X acres", "over X acres", "at least X acres", "greater than X acres"
    const moreAcresMatch = lowerQuery.match(/(?:more than|over|at least|greater than|above|exceeding)\s*(\d+(?:,\d+)?)\s*acres?/);
    if (moreAcresMatch) {
      const minAcres = parseInt(moreAcresMatch[1].replace(',', ''));
      result = result.filter(c => c.totalAcres >= minAcres);
    }

    // "less than X acres", "under X acres", "fewer than X acres"
    const lessAcresMatch = lowerQuery.match(/(?:less than|under|fewer than|below)\s*(\d+(?:,\d+)?)\s*acres?/);
    if (lessAcresMatch) {
      const maxAcres = parseInt(lessAcresMatch[1].replace(',', ''));
      result = result.filter(c => c.totalAcres < maxAcres);
    }

    // "between X and Y acres"
    const betweenAcresMatch = lowerQuery.match(/between\s*(\d+(?:,\d+)?)\s*(?:and|to|-)\s*(\d+(?:,\d+)?)\s*acres?/);
    if (betweenAcresMatch) {
      const minAcres = parseInt(betweenAcresMatch[1].replace(',', ''));
      const maxAcres = parseInt(betweenAcresMatch[2].replace(',', ''));
      result = result.filter(c => c.totalAcres >= minAcres && c.totalAcres <= maxAcres);
    }

    // "large operations" or "big farms" (default to 1500+ acres)
    const isTopQuery = /top\s*\d+/.test(lowerQuery);
    if ((lowerQuery.includes('large') || lowerQuery.includes('big')) &&
        (lowerQuery.includes('operation') || lowerQuery.includes('farm')) &&
        !isTopQuery) {
      if (!moreAcresMatch) {
        result = result.filter(c => c.totalAcres >= 1500);
      }
    }

    // "small farms" (default to under 500 acres)
    if (lowerQuery.includes('small') && (lowerQuery.includes('operation') || lowerQuery.includes('farm'))) {
      if (!lessAcresMatch) {
        result = result.filter(c => c.totalAcres < 500);
      }
    }

    // ==========================================
    // LAST CONTACTED FILTER
    // ==========================================
    const isNotContactedQuery = lowerQuery.includes('have not contacted') ||
                                lowerQuery.includes("haven't contacted") ||
                                lowerQuery.includes('not contacted') ||
                                lowerQuery.includes('never contacted') ||
                                (lowerQuery.includes('contacted') && lowerQuery.includes('over') && lowerQuery.includes('days'));

    if (isNotContactedQuery) {
      const notContactedMatch = lowerQuery.match(/(\d+)\s*days?/);
      if (notContactedMatch) {
        const notContactedDays = parseInt(notContactedMatch[1]);
        const cutoffDate = new Date(Date.now() - notContactedDays * 24 * 60 * 60 * 1000);
        result = result.filter(c => {
          const lastNote = this.notes
            .filter(n => n.customerId === c.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
          return !lastNote || new Date(lastNote.createdAt) < cutoffDate;
        });
      } else if (lowerQuery.includes('never contacted') || lowerQuery.includes('no contact history')) {
        result = result.filter(c => !this.notes.some(n => n.customerId === c.id));
      }
    }

    // "contacted in the last X days" or "contacted within X days" or "recently contacted"
    if (!isNotContactedQuery) {
      const recentlyContactedMatch = lowerQuery.match(/contacted\s*(?:in|within)?\s*(?:the)?\s*(?:last|past)?\s*(\d+)\s*days?/);
      if (recentlyContactedMatch) {
        const recentDays = parseInt(recentlyContactedMatch[1]);
        const cutoffDate = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
        result = result.filter(c => {
          const lastNote = this.notes
            .filter(n => n.customerId === c.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
          return lastNote && new Date(lastNote.createdAt) >= cutoffDate;
        });
      } else if (lowerQuery.includes('recently contacted') || lowerQuery.includes('contacted recently')) {
        const cutoffDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        result = result.filter(c => {
          const lastNote = this.notes
            .filter(n => n.customerId === c.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
          return lastNote && new Date(lastNote.createdAt) >= cutoffDate;
        });
      }

      // "contacted last week"
      if (lowerQuery.includes('contacted last week') || lowerQuery.includes('contacted this week')) {
        const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        result = result.filter(c => {
          const lastNote = this.notes
            .filter(n => n.customerId === c.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
          return lastNote && new Date(lastNote.createdAt) >= cutoffDate;
        });
      }

      // "contacted last month" or "contacted this month"
      if (lowerQuery.includes('contacted last month') || lowerQuery.includes('contacted this month')) {
        const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        result = result.filter(c => {
          const lastNote = this.notes
            .filter(n => n.customerId === c.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
          return lastNote && new Date(lastNote.createdAt) >= cutoffDate;
        });
      }
    }

    // ==========================================
    // STORAGE FILTER
    // ==========================================
    // "with grain in storage", "have stored grain", "storing grain"
    if (lowerQuery.includes('in storage') || lowerQuery.includes('stored grain') ||
        lowerQuery.includes('storing grain') || lowerQuery.includes('have storage') ||
        lowerQuery.includes('with storage') || lowerQuery.includes('grain stored')) {
      const customersWithStorage = new Set(this.storedGrain.map(s => s.customerId));
      result = result.filter(c => customersWithStorage.has(c.id));
    }

    // "with corn in storage", "storing soybeans", etc.
    const storageGrains = ['corn', 'soybeans', 'wheat', 'oats', 'barley', 'sorghum'];
    for (const grain of storageGrains) {
      if (lowerQuery.includes(`${grain} in storage`) || lowerQuery.includes(`storing ${grain}`) ||
          lowerQuery.includes(`stored ${grain}`) || lowerQuery.includes(`${grain} stored`)) {
        const customersWithGrainStorage = new Set(
          this.storedGrain.filter(s => s.crop.toLowerCase().includes(grain)).map(s => s.customerId)
        );
        result = result.filter(c => customersWithGrainStorage.has(c.id));
        break;
      }
    }

    // "storage over X bushels" or "more than X bushels in storage"
    const storageQuantityMatch = lowerQuery.match(/(?:storage|stored|storing)\s*(?:over|more than|above|exceeding)?\s*(\d+(?:,\d+)?)\s*(?:bushels?|bu)/);
    if (storageQuantityMatch) {
      const minQuantity = parseInt(storageQuantityMatch[1].replace(',', ''));
      const customerTotals = new Map<string, number>();
      for (const sg of this.storedGrain) {
        const current = customerTotals.get(sg.customerId) || 0;
        customerTotals.set(sg.customerId, current + sg.quantity);
      }
      const customersWithMinStorage = new Set(
        Array.from(customerTotals.entries())
          .filter(([_, total]) => total >= minQuantity)
          .map(([customerId]) => customerId)
      );
      result = result.filter(c => customersWithMinStorage.has(c.id));
    }

    // "no storage" or "without storage"
    if (lowerQuery.includes('no storage') || lowerQuery.includes('without storage') ||
        lowerQuery.includes('not storing')) {
      const customersWithStorage = new Set(this.storedGrain.map(s => s.customerId));
      result = result.filter(c => !customersWithStorage.has(c.id));
    }

    // ==========================================
    // PLANTING INTENTIONS FILTER
    // ==========================================
    const plantingCrops = ['corn', 'soybeans', 'wheat', 'oats', 'barley', 'sorghum'];
    for (const crop of plantingCrops) {
      if (lowerQuery.includes(`planting ${crop}`) || lowerQuery.includes(`growing ${crop}`) ||
          lowerQuery.includes(`plant ${crop}`) || lowerQuery.includes(`plans to plant ${crop}`) ||
          lowerQuery.includes(`${crop} planting`) || lowerQuery.includes(`${crop} this season`)) {
        const customersWithCrop = new Set(
          this.plantingIntentions.filter(p => p.crop.toLowerCase().includes(crop)).map(p => p.customerId)
        );
        result = result.filter(c => customersWithCrop.has(c.id));
        break;
      }
    }

    // "with planting intentions" or "have planting plans"
    if (lowerQuery.includes('planting intention') || lowerQuery.includes('planting plan') ||
        lowerQuery.includes('planning to plant') || lowerQuery.includes('plans to grow')) {
      const customersWithPlanting = new Set(this.plantingIntentions.map(p => p.customerId));
      result = result.filter(c => customersWithPlanting.has(c.id));
    }

    // "planting over X acres" or "planting more than X acres"
    const plantingAcresMatch = lowerQuery.match(/planting\s*(?:over|more than|above)?\s*(\d+(?:,\d+)?)\s*acres?/);
    if (plantingAcresMatch) {
      const minPlantingAcres = parseInt(plantingAcresMatch[1].replace(',', ''));
      const customerTotals = new Map<string, number>();
      for (const pi of this.plantingIntentions) {
        const current = customerTotals.get(pi.customerId) || 0;
        customerTotals.set(pi.customerId, current + pi.acres);
      }
      const customersWithMinPlanting = new Set(
        Array.from(customerTotals.entries())
          .filter(([_, total]) => total >= minPlantingAcres)
          .map(([customerId]) => customerId)
      );
      result = result.filter(c => customersWithMinPlanting.has(c.id));
    }

    // "no planting intentions" or "without planting plans"
    if (lowerQuery.includes('no planting') || lowerQuery.includes('without planting') ||
        lowerQuery.includes('no plans to plant')) {
      const customersWithPlanting = new Set(this.plantingIntentions.map(p => p.customerId));
      result = result.filter(c => !customersWithPlanting.has(c.id));
    }

    // ==========================================
    // CONTRACT FILTER
    // ==========================================
    // "no active contracts"
    if (lowerQuery.includes('no active contract') || lowerQuery.includes('no contract') ||
        lowerQuery.includes('without contract') || lowerQuery.includes('no contracts')) {
      const customersWithActiveContracts = new Set(
        this.contracts
          .filter(c => c.status === 'Active' || c.status === 'Pending')
          .map(c => c.customerId)
      );
      result = result.filter(c => !customersWithActiveContracts.has(c.id));
    }

    // "with active contracts"
    if (lowerQuery.includes('with active contract') || lowerQuery.includes('have contract') ||
        lowerQuery.includes('active contracts')) {
      const customersWithActiveContracts = new Set(
        this.contracts
          .filter(c => c.status === 'Active' || c.status === 'Pending')
          .map(c => c.customerId)
      );
      result = result.filter(c => customersWithActiveContracts.has(c.id));
    }

    // "unsigned contracts"
    if (lowerQuery.includes('unsigned contract') || lowerQuery.includes('not signed')) {
      const customersWithUnsigned = new Set(
        this.contracts.filter(c => !c.signed).map(c => c.customerId)
      );
      result = result.filter(c => customersWithUnsigned.has(c.id));
    }

    // ==========================================
    // TOP/LARGEST FILTER
    // ==========================================
    const topMatch = lowerQuery.match(/top\s*(\d+)\s*(?:largest|biggest|customers?|farms?|operations?)?/);
    if (topMatch) {
      const topN = parseInt(topMatch[1]);
      result = result.sort((a, b) => b.totalAcres - a.totalAcres).slice(0, topN);
    } else if (lowerQuery.includes('largest') || lowerQuery.includes('biggest')) {
      result = result.sort((a, b) => b.totalAcres - a.totalAcres).slice(0, 10);
    }

    // "bottom X" or "smallest"
    const bottomMatch = lowerQuery.match(/(?:bottom|smallest)\s*(\d+)/);
    if (bottomMatch) {
      const bottomN = parseInt(bottomMatch[1]);
      result = result.sort((a, b) => a.totalAcres - b.totalAcres).slice(0, bottomN);
    } else if (lowerQuery.includes('smallest')) {
      result = result.sort((a, b) => a.totalAcres - b.totalAcres).slice(0, 10);
    }

    return result;
  }

  loadSavedList(list: SavedList): void {
    this.queryText = list.query;
    this.detectedState = this.detectStateInQuery(list.query);
    this.filteredCustomers = this.customers.filter(c => list.customerIds.includes(c.id));
    this.hasGenerated = true;
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

    this.apiService.createSavedList({
      name: this.newListName,
      query: this.queryText,
      customerIds: this.filteredCustomers.map(c => c.id)
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

  deleteList(listId: string): void {
    this.apiService.deleteSavedList(listId).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.toastService.info('List deleted');
        this.refreshSavedLists();
      },
      error: () => {
        this.toastService.error('Failed to delete list');
      }
    });
  }

  private refreshSavedLists(): void {
    this.apiService.getSavedLists().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => this.savedLists = data,
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

  getLastContactInfo(customerId: string): { text: string; colorClass: string } {
    const lastNote = this.notes
      .filter(n => n.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!lastNote) {
      return { text: 'Never contacted', colorClass: 'text-red-500' };
    }

    const daysAgo = Math.floor((Date.now() - new Date(lastNote.createdAt).getTime()) / (1000 * 60 * 60 * 24));

    if (daysAgo === 0) return { text: 'Contacted today', colorClass: 'text-green-500' };
    if (daysAgo === 1) return { text: 'Contacted yesterday', colorClass: 'text-green-500' };
    if (daysAgo < 7) return { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-green-500' };
    if (daysAgo < 30) return { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-yellow-500' };
    return { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-red-500' };
  }

  getCustomerCrops(customerId: string): string[] {
    return [...new Set(
      this.plantingIntentions
        .filter(p => p.customerId === customerId)
        .map(p => p.crop)
    )].slice(0, 3);
  }
}
