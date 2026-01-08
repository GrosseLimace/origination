import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, PlantingIntention, Note, StoredGrain, SavedList } from '../../models';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent } from '../../components/ui/card/card.component';
import { ButtonComponent } from '../../components/ui/button/button.component';
import { BadgeComponent } from '../../components/ui/badge/badge.component';

@Component({
  selector: 'app-build-list',
  standalone: true,
  imports: [FormsModule, CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent, ButtonComponent, BadgeComponent],
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Query Builder -->
      <app-card>
        <app-card-header>
          <app-card-title>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-2">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
            Build Customer List
          </app-card-title>
          <app-card-description>Use natural language to find customers matching your criteria</app-card-description>
        </app-card-header>
        <app-card-content>
          <div class="space-y-4">
            <div>
              <textarea
                [(ngModel)]="queryText"
                placeholder="Example: customers with more than 1000 acres who grow corn"
                rows="3"
                class="w-full p-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              ></textarea>
            </div>
            <app-button (onClick)="executeQuery()" [disabled]="!queryText.trim()">
              Search Customers
            </app-button>

            <!-- Quick Filters -->
            <div class="pt-4 border-t border-gray-200 dark:border-gray-700">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quick Filters:</p>
              <div class="flex flex-wrap gap-2">
                <button (click)="setQuery('customers with more than 1000 acres')" class="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300">
                  Large farms (1000+ acres)
                </button>
                <button (click)="setQuery('customers who grow corn')" class="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300">
                  Corn growers
                </button>
                <button (click)="setQuery('customers in Iowa')" class="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300">
                  Iowa customers
                </button>
                <button (click)="setQuery('customers with esign enabled')" class="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300">
                  E-Sign enabled
                </button>
              </div>
            </div>
          </div>
        </app-card-content>
      </app-card>

      <!-- Results -->
      <app-card>
        <app-card-header>
          <app-card-title>
            Results
            @if (results.length > 0) {
              <app-badge variant="secondary" class="ml-2">{{ results.length }}</app-badge>
            }
          </app-card-title>
          @if (results.length > 0) {
            <div class="flex gap-2 mt-2">
              <app-button variant="outline" size="sm" (onClick)="openSaveDialog()">
                Save List
              </app-button>
              <app-button variant="ghost" size="sm" (onClick)="clearResults()">
                Clear
              </app-button>
            </div>
          }
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
              <p class="text-gray-500 dark:text-gray-400">Enter a query to find matching customers</p>
            </div>
          } @else {
            <div class="space-y-2 max-h-[400px] overflow-y-auto">
              @for (customer of results; track customer.id) {
                <div class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="font-medium text-gray-900 dark:text-white">{{ customer.name }}</p>
                      <p class="text-sm text-gray-500 dark:text-gray-400">{{ customer.farm }} - {{ customer.location }}</p>
                    </div>
                    <app-badge variant="secondary">{{ customer.totalAcres | number }} acres</app-badge>
                  </div>
                </div>
              }
            </div>
          }
        </app-card-content>
      </app-card>
    </div>

    <!-- Saved Lists -->
    <app-card class="mt-6">
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
              <div class="flex items-center gap-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <button (click)="loadSavedList(list)" class="flex-1 text-left min-w-0">
                  <div class="font-medium text-gray-900 dark:text-white truncate">{{ list.name }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ list.customerIds.length }} customers - Created from: "{{ list.query }}"</div>
                </button>
                <button (click)="deleteList(list.id)" class="text-red-500 hover:text-red-600 bg-transparent border-0 p-0">
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

    <!-- Save Dialog (simple implementation) -->
    @if (showSaveDialog) {
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Save List</h3>
          <input
            [(ngModel)]="listName"
            placeholder="Enter list name..."
            class="w-full p-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 mb-4"
          />
          <div class="flex justify-end gap-2">
            <app-button variant="outline" (onClick)="closeSaveDialog()">Cancel</app-button>
            <app-button (onClick)="saveList()" [disabled]="!listName.trim()">Save</app-button>
          </div>
        </div>
      </div>
    }
  `
})
export class BuildListComponent implements OnInit {
  private apiService = inject(ApiService);
  private toastService = inject(ToastService);

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

  setQuery(query: string): void {
    this.queryText = query;
    this.executeQuery();
  }

  executeQuery(): void {
    if (!this.queryText.trim()) return;

    const query = this.queryText.toLowerCase();
    let filtered = [...this.customers];

    // Natural language query parsing
    // Acres filter
    const acresMatch = query.match(/more than (\d+) acres/);
    if (acresMatch) {
      const minAcres = parseInt(acresMatch[1]);
      filtered = filtered.filter(c => c.totalAcres > minAcres);
    }

    const lessAcresMatch = query.match(/less than (\d+) acres/);
    if (lessAcresMatch) {
      const maxAcres = parseInt(lessAcresMatch[1]);
      filtered = filtered.filter(c => c.totalAcres < maxAcres);
    }

    // Crop filter
    const crops = ['corn', 'soybeans', 'wheat'];
    for (const crop of crops) {
      if (query.includes(crop)) {
        const cropContracts = this.contracts.filter(c => c.crop.toLowerCase() === crop);
        const cropPlanting = this.plantingIntentions.filter(p => p.crop.toLowerCase() === crop);
        const customerIds = new Set([
          ...cropContracts.map(c => c.customerId),
          ...cropPlanting.map(p => p.customerId)
        ]);
        filtered = filtered.filter(c => customerIds.has(c.id));
      }
    }

    // Location filter
    const states = ['iowa', 'illinois', 'nebraska', 'kansas', 'missouri'];
    for (const state of states) {
      if (query.includes(state)) {
        filtered = filtered.filter(c => c.location.toLowerCase().includes(state));
      }
    }

    // E-sign filter
    if (query.includes('esign') || query.includes('e-sign')) {
      filtered = filtered.filter(c => c.eSignEnabled);
    }

    this.results = filtered;
    this.toastService.info(`Found ${filtered.length} matching customers`);
  }

  clearResults(): void {
    this.results = [];
    this.queryText = '';
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
      this.apiService.getSavedLists().subscribe(data => this.savedLists = data);
    });
  }

  loadSavedList(list: SavedList): void {
    this.queryText = list.query;
    this.results = this.customers.filter(c => list.customerIds.includes(c.id));
    this.toastService.info(`Loaded list "${list.name}" with ${this.results.length} customers`);
  }

  deleteList(listId: string): void {
    this.apiService.deleteSavedList(listId).subscribe(() => {
      this.toastService.info('List deleted');
      this.apiService.getSavedLists().subscribe(data => this.savedLists = data);
    });
  }
}
