import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, Farm, SavedList } from '../../models';
import { CustomerListComponent } from '../../components/customers/customer-list/customer-list.component';
import { CustomerProfileComponent } from '../../components/customers/customer-profile/customer-profile.component';
import { CardComponent, CardContentComponent } from '../../components/ui/card/card.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    CustomerListComponent,
    CustomerProfileComponent,
    CardComponent,
    CardContentComponent
  ],
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Customer List - Sticky on desktop (top accounts for header height ~73px + padding) -->
      <div class="lg:col-span-1 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)]" [class.hidden]="selectedCustomer && isMobile" [class.lg:block]="true">
        <app-customer-list
          [customers]="customers"
          [selectedCustomer]="selectedCustomer"
          [savedLists]="savedLists"
          [notes]="notes"
          (selectCustomer)="handleSelectCustomer($event)"
        />
      </div>

      <!-- Customer Profile -->
      <div class="lg:col-span-2 space-y-6" [class.hidden]="!selectedCustomer && isMobile" [class.lg:block]="true">
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
            [farms]="customerFarms"
            [allFarms]="farms"
            [contracts]="customerContracts"
            [tickets]="customerTickets"
            [plantingIntentions]="customerPlantingIntentions"
            [storedGrain]="customerStoredGrain"
            [notes]="customerNotes"
            (onAddPlanting)="addPlantingIntention($event)"
            (onEditPlanting)="editPlantingIntention($event)"
            (onAddNote)="addNote($event)"
            (onTogglePin)="toggleNotePin($event)"
            (onSaveCustomer)="handleSaveCustomer($event)"
            (onCreateFarm)="handleCreateFarm($event)">
          </app-customer-profile>
        } @else {
          <!-- No customer selected - matches Blazor: just the prompt card, no map -->
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
        }
      </div>
    </div>
  `
})
export class HomeComponent implements OnInit {
  private apiService = inject(ApiService);
  private appState = inject(AppStateService);
  private toastService = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);
  private route = inject(ActivatedRoute);

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
  customerFarms: Farm[] = [];
  customerPlantingIntentions: PlantingIntention[] = [];
  customerStoredGrain: StoredGrain[] = [];

  isMobile = false;

  ngOnInit(): void {
    this.loadAllData();
    this.checkMobile();
    window.addEventListener('resize', () => this.checkMobile());

    // Handle customerId query param (from Build a List view customer link)
    this.route.queryParams.subscribe(params => {
      const customerId = params['customerId'];
      if (customerId) {
        this.selectCustomerById(customerId);
      }
    });
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
    // Force change detection to ensure UI updates immediately
    this.cdr.detectChanges();
  }

  private loadCustomerData(customerId: string): void {
    // Create new array references to trigger change detection
    this.customerContracts = [...this.contracts.filter(c => c.customerId === customerId)];
    this.customerTickets = [...this.tickets.filter(t => t.customerId === customerId)];
    this.customerNotes = [...this.notes.filter(n => n.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())];
    this.customerFarms = [...this.farms.filter(f => this.selectedCustomer?.farmIds.includes(f.id))];
    this.customerPlantingIntentions = [...this.plantingIntentions.filter(p => p.customerId === customerId)];
    this.customerStoredGrain = [...this.storedGrain.filter(s => s.customerId === customerId)];
  }

  handleSaveCustomer(data: { customerId: string; location: string; phone: string; email: string; farmIds: string[]; eSignEnabled: boolean }): void {
    const customer = this.customers.find(c => c.id === data.customerId);
    if (!customer) return;

    const updatedCustomer: Customer = {
      ...customer,
      location: data.location,
      phone: data.phone,
      email: data.email,
      farmIds: data.farmIds,
      eSignEnabled: data.eSignEnabled
    };

    this.apiService.updateCustomer(updatedCustomer).subscribe({
      next: (updated) => {
        const index = this.customers.findIndex(c => c.id === updated.id);
        if (index >= 0) {
          this.customers[index] = updated;
          this.customers = [...this.customers];
        }
        this.selectedCustomer = updated;
        this.loadCustomerData(updated.id);
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
        this.toastService.success('Farm created successfully');
      },
      error: () => {
        this.toastService.error('Failed to create farm');
      }
    });
  }

  addPlantingIntention(data: {crop: string, acres: number, variety: string, plantingDate: Date, estimatedYield: number}): void {
    this.toastService.info(`Adding ${data.crop} planting intention - coming soon`);
  }

  editPlantingIntention(data: {intentionId: string, crop: string, acres: number, variety: string, plantingDate: Date, estimatedYield: number}): void {
    this.toastService.info(`Editing ${data.crop} intention - coming soon`);
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
}
