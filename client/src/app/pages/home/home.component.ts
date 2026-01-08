import { Component, OnInit, inject } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, Farm, SavedList } from '../../models';
import { CustomerListComponent } from '../../components/customers/customer-list/customer-list.component';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent } from '../../components/ui/card/card.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CustomerListComponent, CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent],
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Customer List -->
      <div class="lg:col-span-1" [class.hidden]="selectedCustomer && isMobile" [class.lg:block]="true">
        <app-customer-list
          [customers]="customers"
          [selectedCustomer]="selectedCustomer"
          [savedLists]="savedLists"
          [notes]="notes"
          (selectCustomer)="handleSelectCustomer($event)"
        />
      </div>

      <!-- Customer Profile -->
      <div class="lg:col-span-2" [class.hidden]="!selectedCustomer && isMobile" [class.lg:block]="true">
        @if (selectedCustomer) {
          <app-card>
            <app-card-header>
              <app-card-title>{{ selectedCustomer.name }}</app-card-title>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ selectedCustomer.farm }}</p>
            </app-card-header>
            <app-card-content>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Location</p>
                  <p class="text-gray-900 dark:text-white">{{ selectedCustomer.location }}</p>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Total Acres</p>
                  <p class="text-gray-900 dark:text-white">{{ selectedCustomer.totalAcres | number }}</p>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Phone</p>
                  <p class="text-gray-900 dark:text-white">{{ selectedCustomer.phone }}</p>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-500 dark:text-gray-400">Email</p>
                  <p class="text-gray-900 dark:text-white">{{ selectedCustomer.email }}</p>
                </div>
              </div>

              <!-- Contracts Summary -->
              @if (customerContracts.length > 0) {
                <div class="mt-6">
                  <h4 class="font-medium text-gray-900 dark:text-white mb-3">Contracts ({{ customerContracts.length }})</h4>
                  <div class="space-y-2">
                    @for (contract of customerContracts; track contract.id) {
                      <div class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div class="flex justify-between items-center">
                          <span class="font-medium text-gray-900 dark:text-white">{{ contract.crop }}</span>
                          <span class="text-sm text-gray-500 dark:text-gray-400">{{ contract.quantity | number }} {{ contract.unit }}</span>
                        </div>
                        <div class="text-sm text-gray-500 dark:text-gray-400">\${{ contract.price }}/bu</div>
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- Notes Summary -->
              @if (customerNotes.length > 0) {
                <div class="mt-6">
                  <h4 class="font-medium text-gray-900 dark:text-white mb-3">Recent Notes</h4>
                  <div class="space-y-2">
                    @for (note of customerNotes.slice(0, 3); track note.id) {
                      <div class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <p class="text-sm text-gray-900 dark:text-white">{{ note.content }}</p>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ note.originatorName }} - {{ note.timestamp | date:'short' }}</p>
                      </div>
                    }
                  </div>
                </div>
              }
            </app-card-content>
          </app-card>
        } @else {
          <app-card class="p-12 text-center">
            <div class="flex flex-col items-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-300 dark:text-gray-600 mb-4">
                <path d="M22 9 12 5 2 9l10 4 10-4v6"/>
                <path d="m6 11 6 2.5 6-2.5"/>
                <path d="M6 15.5 12 18l6-2.5"/>
              </svg>
              <h3 class="text-gray-500 dark:text-gray-400 mb-2">No Customer Selected</h3>
              <p class="text-sm text-gray-400 dark:text-gray-500">Select a customer from the list to view their profile</p>
            </div>
          </app-card>
        }
      </div>
    </div>
  `
})
export class HomeComponent implements OnInit {
  private apiService = inject(ApiService);
  private appState = inject(AppStateService);
  private toastService = inject(ToastService);

  customers: Customer[] = [];
  contracts: Contract[] = [];
  tickets: Ticket[] = [];
  plantingIntentions: PlantingIntention[] = [];
  notes: Note[] = [];
  storedGrain: StoredGrain[] = [];
  farms: Farm[] = [];
  savedLists: SavedList[] = [];

  selectedCustomer: Customer | null = null;
  customerContracts: Contract[] = [];
  customerTickets: Ticket[] = [];
  customerNotes: Note[] = [];

  isMobile = false;

  ngOnInit(): void {
    this.loadAllData();
    this.checkMobile();
    window.addEventListener('resize', () => this.checkMobile());
  }

  private checkMobile(): void {
    this.isMobile = window.innerWidth < 1024;
  }

  private loadAllData(): void {
    this.apiService.getCustomers().subscribe(data => this.customers = data);
    this.apiService.getContracts().subscribe(data => this.contracts = data);
    this.apiService.getTickets().subscribe(data => this.tickets = data);
    this.apiService.getPlantingIntentions().subscribe(data => this.plantingIntentions = data);
    this.apiService.getNotes().subscribe(data => this.notes = data);
    this.apiService.getStoredGrain().subscribe(data => this.storedGrain = data);
    this.apiService.getFarms().subscribe(data => this.farms = data);
    this.apiService.getSavedLists().subscribe(data => this.savedLists = data);
  }

  handleSelectCustomer(customer: Customer): void {
    this.selectedCustomer = customer;
    this.appState.selectCustomer(customer);
    this.loadCustomerData(customer.id);
  }

  private loadCustomerData(customerId: string): void {
    this.customerContracts = this.contracts.filter(c => c.customerId === customerId);
    this.customerTickets = this.tickets.filter(t => t.customerId === customerId);
    this.customerNotes = this.notes.filter(n => n.customerId === customerId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
}
