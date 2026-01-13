import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, PlantingIntention, Note, StoredGrain, SavedList } from '../../models';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent } from '../../components/ui/card/card.component';
import { ButtonComponent } from '../../components/ui/button/button.component';
import { BadgeComponent } from '../../components/ui/badge/badge.component';

@Component({
  selector: 'app-build-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent, ButtonComponent, BadgeComponent],
  template: `
    <div class="space-y-6">
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

      <!-- Natural Language Query Card -->
      <app-card>
        <app-card-content class="p-6">
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
              placeholder="Describe the type of customers you want to find... e.g., 'Show me farms in Nebraska' or 'Customers growing corn in Iowa'"
              rows="3"
              class="w-full p-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            ></textarea>
          </div>

          <!-- Generate Button -->
          <div class="mb-6">
            <app-button (onClick)="executeQuery()" [disabled]="!queryText.trim() || isProcessing">
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
                  class="px-3 py-1.5 text-sm rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none"
                >
                  {{ example }}
                </button>
              }
            </div>
          </div>
        </app-card-content>
      </app-card>

      <!-- Results Section (only shown after generating) -->
      @if (hasGenerated && queryText.trim()) {
        <app-card>
          <app-card-header>
            <div class="flex items-center justify-between">
              <div>
                <app-card-title>Results</app-card-title>
                <app-card-description>
                  Found {{ results.length }} customer(s) matching your criteria
                </app-card-description>
              </div>
              @if (results.length > 0) {
                <div class="flex gap-2">
                  <app-button variant="outline" size="sm" (onClick)="openSaveDialog()">
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
            @if (results.length === 0) {
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
                @for (customer of results; track customer.id) {
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

      <!-- Save Dialog -->
      @if (showSaveDialog) {
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div class="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Save List</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">Give this list a name so you can easily access it later</p>
            <input
              [(ngModel)]="listName"
              placeholder="e.g., High Priority Prospects"
              class="w-full p-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 mb-4"
            />
            <div class="flex justify-end gap-2">
              <app-button variant="outline" (onClick)="closeSaveDialog()">Cancel</app-button>
              <app-button (onClick)="saveList()" [disabled]="!listName.trim()">Save List</app-button>
            </div>
          </div>
        </div>
      }
    </div>
  `
})
export class BuildListComponent implements OnInit {
  private apiService = inject(ApiService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  customers: Customer[] = [];
  contracts: Contract[] = [];
  plantingIntentions: PlantingIntention[] = [];
  notes: Note[] = [];
  storedGrain: StoredGrain[] = [];
  savedLists: SavedList[] = [];

  queryText = '';
  results: Customer[] = [];
  showSaveDialog = false;
  listName = '';
  isProcessing = false;
  hasGenerated = false;
  showMap = false;

  exampleQueries = [
    'Show me farms in Nebraska',
    'Customers with more than 1000 acres',
    'Farmers I have not contacted in over 60 days',
    'Contacted in the last 7 days',
    'Farms with grain in storage',
    'Customers planting corn this season',
    'Large operations over 2000 acres in Iowa',
    'Top 10 largest operations'
  ];

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.apiService.getCustomers().subscribe(data => this.customers = data);
    this.apiService.getContracts().subscribe(data => this.contracts = data);
    this.apiService.getPlantingIntentions().subscribe(data => this.plantingIntentions = data);
    this.apiService.getNotes().subscribe(data => this.notes = data);
    this.apiService.getStoredGrain().subscribe(data => this.storedGrain = data);
    this.apiService.getSavedLists().subscribe(data => this.savedLists = data);
  }

  toggleMap(): void {
    this.showMap = !this.showMap;
  }

  useExampleQuery(example: string): void {
    this.queryText = example;
    this.executeQuery();
  }

  async executeQuery(): Promise<void> {
    if (!this.queryText.trim()) return;

    this.isProcessing = true;

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const query = this.queryText.toLowerCase();
    let filtered = [...this.customers];

    // Location/state filter
    const states: { [key: string]: string } = {
      'iowa': 'ia', 'illinois': 'il', 'nebraska': 'ne', 'minnesota': 'mn',
      'wisconsin': 'wi', 'missouri': 'mo', 'kansas': 'ks'
    };
    for (const [state, abbrev] of Object.entries(states)) {
      if (query.includes(state)) {
        filtered = filtered.filter(c =>
          c.location.toLowerCase().includes(state) ||
          c.location.toLowerCase().includes(abbrev)
        );
        break;
      }
    }

    // Acres filter - "more than X acres", "over X acres"
    const moreAcresMatch = query.match(/(?:more than|over|at least|greater than|above)\s*(\d+(?:,\d+)?)\s*acres?/);
    if (moreAcresMatch) {
      const minAcres = parseInt(moreAcresMatch[1].replace(',', ''));
      filtered = filtered.filter(c => c.totalAcres >= minAcres);
    }

    // Acres filter - "less than X acres"
    const lessAcresMatch = query.match(/(?:less than|under|fewer than|below)\s*(\d+(?:,\d+)?)\s*acres?/);
    if (lessAcresMatch) {
      const maxAcres = parseInt(lessAcresMatch[1].replace(',', ''));
      filtered = filtered.filter(c => c.totalAcres < maxAcres);
    }

    // Large operations (1500+ acres by default)
    if ((query.includes('large') || query.includes('big')) &&
        (query.includes('operation') || query.includes('farm')) &&
        !moreAcresMatch) {
      filtered = filtered.filter(c => c.totalAcres >= 1500);
    }

    // Contact time filter - "not contacted in over X days"
    const notContactedMatch = query.match(/(?:not contacted|haven't contacted|have not contacted).*?(\d+)\s*days?/);
    if (notContactedMatch) {
      const days = parseInt(notContactedMatch[1]);
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      filtered = filtered.filter(c => {
        const lastNote = this.notes
          .filter(n => n.customerId === c.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        return !lastNote || new Date(lastNote.createdAt) < cutoffDate;
      });
    }

    // Contact time filter - "contacted in the last X days"
    const recentContactMatch = query.match(/contacted\s*(?:in|within)?\s*(?:the)?\s*(?:last|past)?\s*(\d+)\s*days?/);
    if (recentContactMatch && !notContactedMatch) {
      const days = parseInt(recentContactMatch[1]);
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      filtered = filtered.filter(c => {
        const lastNote = this.notes
          .filter(n => n.customerId === c.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        return lastNote && new Date(lastNote.createdAt) >= cutoffDate;
      });
    }

    // Storage filter
    if (query.includes('in storage') || query.includes('stored grain') || query.includes('grain in storage')) {
      const customersWithStorage = new Set(this.storedGrain.map(s => s.customerId));
      filtered = filtered.filter(c => customersWithStorage.has(c.id));
    }

    // Planting crop filter
    const plantingCrops = ['corn', 'soybeans', 'wheat', 'oats', 'barley', 'sorghum'];
    for (const crop of plantingCrops) {
      if (query.includes(`planting ${crop}`) || query.includes(`growing ${crop}`) || query.includes(`${crop} this season`)) {
        const customersWithCrop = new Set(
          this.plantingIntentions.filter(p => p.crop.toLowerCase().includes(crop)).map(p => p.customerId)
        );
        filtered = filtered.filter(c => customersWithCrop.has(c.id));
        break;
      }
    }

    // Top X filter
    const topMatch = query.match(/top\s*(\d+)/);
    if (topMatch) {
      const topN = parseInt(topMatch[1]);
      filtered = filtered.sort((a, b) => b.totalAcres - a.totalAcres).slice(0, topN);
    }

    // E-sign filter
    if (query.includes('esign') || query.includes('e-sign')) {
      filtered = filtered.filter(c => c.eSignEnabled);
    }

    this.results = filtered;
    this.hasGenerated = true;
    this.isProcessing = false;
    this.toastService.info(`Found ${filtered.length} matching customers`);
  }

  clearResults(): void {
    this.results = [];
    this.queryText = '';
    this.hasGenerated = false;
  }

  openSaveDialog(): void {
    this.showSaveDialog = true;
    this.listName = '';
  }

  closeSaveDialog(): void {
    this.showSaveDialog = false;
  }

  saveList(): void {
    if (!this.listName.trim() || this.results.length === 0) return;

    this.apiService.createSavedList({
      name: this.listName,
      query: this.queryText,
      customerIds: this.results.map(c => c.id)
    }).subscribe(() => {
      this.toastService.success(`List "${this.listName}" saved with ${this.results.length} customers`);
      this.closeSaveDialog();
      this.clearResults();
      this.apiService.getSavedLists().subscribe(data => this.savedLists = data);
    });
  }

  loadSavedList(list: SavedList): void {
    this.queryText = list.query;
    this.results = this.customers.filter(c => list.customerIds.includes(c.id));
    this.hasGenerated = true;
  }

  deleteList(listId: string): void {
    this.apiService.deleteSavedList(listId).subscribe(() => {
      this.toastService.info('List deleted');
      this.apiService.getSavedLists().subscribe(data => this.savedLists = data);
    });
  }

  selectCustomer(customer: Customer): void {
    this.router.navigate(['/'], { queryParams: { customerId: customer.id } });
  }

  getInitials(name: string): string {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  }

  getLastContactInfo(customerId: string): { text: string; colorClass: string } {
    const customerNotes = this.notes
      .filter(n => n.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const lastNote = customerNotes[0];
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
