import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, Farm, SavedList } from '../../models';
import { CustomerListComponent } from '../../components/customers/customer-list/customer-list.component';
import { CustomerProfileComponent } from '../../components/customers/customer-profile/customer-profile.component';
import { CustomerMapComponent } from '../../components/customers/customer-map/customer-map.component';
import { EditCustomerDialogComponent } from '../../components/customers/edit-customer-dialog/edit-customer-dialog.component';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent } from '../../components/ui/card/card.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    CustomerListComponent,
    CustomerProfileComponent,
    CustomerMapComponent,
    EditCustomerDialogComponent,
    CardComponent,
    CardContentComponent,
    CardHeaderComponent,
    CardTitleComponent
  ],
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
            Back to list
          </button>

          <!-- Map -->
          <app-card>
            <app-card-header>
              <app-card-title>Location</app-card-title>
            </app-card-header>
            <app-card-content class="p-0">
              <div class="h-64">
                <app-customer-map
                  [customers]="customers"
                  [selectedCustomer]="selectedCustomer"
                  (customerClick)="handleSelectCustomer($event)">
                </app-customer-map>
              </div>
            </app-card-content>
          </app-card>

          <!-- Profile with tabs -->
          <app-customer-profile
            [customer]="selectedCustomer"
            [farms]="customerFarms"
            [contracts]="customerContracts"
            [tickets]="customerTickets"
            [plantingIntentions]="customerPlantingIntentions"
            [storedGrain]="customerStoredGrain"
            [notes]="customerNotes"
            (onEdit)="openEditDialog()"
            (onAddPlanting)="addPlantingIntention()"
            (onEditPlanting)="editPlantingIntention($event)"
            (onAddNote)="addNote($event)"
            (onTogglePin)="toggleNotePin($event)">
          </app-customer-profile>
        } @else {
          <!-- No customer selected -->
          <app-card>
            <app-card-content class="p-12">
              <div class="text-center text-gray-500 dark:text-gray-400">
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

          <!-- Territory Map -->
          <app-card>
            <app-card-header>
              <app-card-title>Territory Overview</app-card-title>
            </app-card-header>
            <app-card-content class="p-0">
              <div class="h-96">
                <app-customer-map
                  [customers]="customers"
                  (customerClick)="handleSelectCustomer($event)">
                </app-customer-map>
              </div>
            </app-card-content>
          </app-card>
        }
      </div>
    </div>

    <!-- Edit Customer Dialog -->
    <app-edit-customer-dialog
      [isOpen]="editDialogOpen"
      [customer]="selectedCustomer"
      (close)="closeEditDialog()"
      (save)="saveCustomer($event)">
    </app-edit-customer-dialog>
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
  customerFarms: Farm[] = [];
  customerPlantingIntentions: PlantingIntention[] = [];
  customerStoredGrain: StoredGrain[] = [];

  editDialogOpen = false;
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
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    this.customerFarms = this.farms.filter(f => this.selectedCustomer?.farmIds.includes(f.id));
    this.customerPlantingIntentions = this.plantingIntentions.filter(p => p.customerId === customerId);
    this.customerStoredGrain = this.storedGrain.filter(s => s.customerId === customerId);
  }

  openEditDialog(): void {
    this.editDialogOpen = true;
  }

  closeEditDialog(): void {
    this.editDialogOpen = false;
  }

  saveCustomer(customer: Customer): void {
    this.apiService.updateCustomer(customer).subscribe({
      next: (updated) => {
        const index = this.customers.findIndex(c => c.id === updated.id);
        if (index >= 0) {
          this.customers[index] = updated;
          this.customers = [...this.customers];
        }
        this.selectedCustomer = updated;
        this.toastService.success('Customer updated successfully');
      },
      error: () => {
        this.toastService.error('Failed to update customer');
      }
    });
  }

  addPlantingIntention(): void {
    this.toastService.info('Add planting intention - coming soon');
  }

  editPlantingIntention(intention: PlantingIntention): void {
    this.toastService.info('Edit planting intention - coming soon');
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
