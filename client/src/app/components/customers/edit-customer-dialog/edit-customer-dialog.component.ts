import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '../../ui/dialog/dialog.component';
import { Customer, Farm } from '../../../models';

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
          <app-dialog-title>Edit Customer Information</app-dialog-title>
          <app-dialog-description>Update contact details and manage farm associations for {{ customer.name }}</app-dialog-description>
        </app-dialog-header>

        <app-dialog-content>
          <div class="space-y-6">
            <!-- Contact Information Section -->
            <div class="space-y-4">
              <h4 class="font-medium text-gray-900 dark:text-white">Contact Information</h4>

              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Location</label>
                <input
                  type="text"
                  [(ngModel)]="editLocation"
                  placeholder="e.g., Iowa County, IA"
                  class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Phone</label>
                <input
                  type="tel"
                  [(ngModel)]="editPhone"
                  placeholder="e.g., (319) 555-0123"
                  class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
                <input
                  type="email"
                  [(ngModel)]="editEmail"
                  placeholder="e.g., john@example.com"
                  class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <!-- eSign Toggle -->
              <div class="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  role="switch"
                  [attr.aria-checked]="editESignEnabled"
                  class="peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  [class]="editESignEnabled ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'"
                  (click)="editESignEnabled = !editESignEnabled"
                >
                  <span
                    class="pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform"
                    [class]="editESignEnabled ? 'translate-x-5' : 'translate-x-0'"
                  ></span>
                </button>
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer" (click)="editESignEnabled = !editESignEnabled">
                  eSign Enabled
                </label>
              </div>
            </div>

            <!-- Separator -->
            <div class="border-t border-gray-200 dark:border-gray-700"></div>

            <!-- Link Producers Section -->
            <div class="space-y-4">
              <h4 class="font-medium text-gray-900 dark:text-white">Link Producers</h4>
              <p class="text-sm text-gray-500 dark:text-gray-400">Link this producer with others to combine their farms and activity data</p>

              <!-- Outgoing Links: Producers this customer links to -->
              @if (editLinkedProducerIds.length > 0) {
                <div class="space-y-2">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Linked To:</div>
                  @for (producerId of editLinkedProducerIds; track producerId) {
                    @if (getProducerById(producerId); as producer) {
                      <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                        <div>
                          <div class="font-medium text-gray-900 dark:text-white">{{ producer.name }}</div>
                          <div class="text-sm text-gray-500 dark:text-gray-400">{{ producer.location }}</div>
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
                        <div class="text-sm text-gray-500 dark:text-gray-400">{{ producer.location }}</div>
                      </div>
                      <button
                        type="button"
                        class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 w-8"
                        (click)="removeIncomingLink(producer.id)"
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

              <!-- Add Linked Producer -->
              @if (getAvailableProducers().length > 0) {
                <div class="space-y-2">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Add Producer to Link</label>
                  <select
                    class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    (change)="addLinkedProducer($event)"
                  >
                    <option value="">Select a producer to link</option>
                    @for (producer of getAvailableProducers(); track producer.id) {
                      <option [value]="producer.id">{{ producer.name }} - {{ producer.location }}</option>
                    }
                  </select>
                </div>
              }
            </div>

            <!-- Separator -->
            <div class="border-t border-gray-200 dark:border-gray-700"></div>

            <!-- Farm Associations Section -->
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <h4 class="font-medium text-gray-900 dark:text-white">Farm Associations</h4>
                <button
                  type="button"
                  class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-gray-300 dark:border-gray-600 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 h-9 px-3"
                  (click)="showNewFarmForm = !showNewFarmForm"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/>
                  </svg>
                  New Farm
                </button>
              </div>

              <!-- New Farm Form (collapsible) -->
              @if (showNewFarmForm) {
                <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-4 bg-gray-100 dark:bg-gray-800/50">
                  <div class="space-y-2">
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Farm Name</label>
                    <input
                      type="text"
                      [(ngModel)]="newFarmName"
                      placeholder="e.g., North Field Farm"
                      class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div class="space-y-2">
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Location</label>
                    <input
                      type="text"
                      [(ngModel)]="newFarmLocation"
                      placeholder="e.g., Johnson County, IA"
                      class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div class="space-y-2">
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Acres</label>
                    <input
                      type="number"
                      [(ngModel)]="newFarmAcres"
                      placeholder="e.g., 500"
                      class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div class="flex gap-2 pt-2">
                    <button
                      type="button"
                      class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-green-600 text-white hover:bg-green-700 h-10 px-4 py-2"
                      [disabled]="!newFarmName || !newFarmAcres"
                      (click)="createAndAddFarm()"
                    >
                      Add Farm
                    </button>
                    <button
                      type="button"
                      class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-gray-300 dark:border-gray-600 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 h-10 px-4 py-2"
                      (click)="showNewFarmForm = false"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              }

              <!-- Current Farms -->
              <div class="space-y-3">
                @for (farmId of editFarmIds; track farmId) {
                  @if (getFarmById(farmId); as farm) {
                    <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                      <div class="space-y-1">
                        <div class="font-medium text-gray-900 dark:text-white">{{ farm.name }}</div>
                        <div class="text-sm text-gray-500 dark:text-gray-400">{{ farm.location }}</div>
                        <div class="text-sm text-gray-500 dark:text-gray-400">{{ farm.acres | number }} acres</div>
                      </div>
                      @if (editFarmIds.length > 1) {
                        <button
                          type="button"
                          class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 w-8"
                          (click)="removeFarm(farmId)"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>
                          </svg>
                        </button>
                      }
                    </div>
                  }
                }
              </div>

              <!-- Add Existing Farm -->
              @if (getAvailableFarms().length > 0) {
                <div class="space-y-2">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Add Existing Farm</label>
                  <select
                    class="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    (change)="addExistingFarm($event)"
                  >
                    <option value="">Select a farm to add</option>
                    @for (farm of getAvailableFarms(); track farm.id) {
                      <option [value]="farm.id">{{ farm.name }} ({{ farm.acres | number }} acres)</option>
                    }
                  </select>
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

  @Input() isOpen = false;
  @Input() customer: Customer | null = null;
  @Input() allFarms: Farm[] = [];
  @Input() allCustomers: Customer[] = [];

  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<{
    customerId: string;
    location: string;
    phone: string;
    email: string;
    farmIds: string[];
    linkedProducerIds: string[];
    eSignEnabled: boolean;
  }>();
  @Output() createFarm = new EventEmitter<{ name: string; location: string; acres: number }>();

  editLocation = '';
  editPhone = '';
  editEmail = '';
  editFarmIds: string[] = [];
  editLinkedProducerIds: string[] = [];
  editESignEnabled = false;

  // Original values to track changes
  private originalLocation = '';
  private originalPhone = '';
  private originalEmail = '';
  private originalFarmIds: string[] = [];
  private originalLinkedProducerIds: string[] = [];
  private originalESignEnabled = false;

  showNewFarmForm = false;
  newFarmName = '';
  newFarmLocation = '';
  newFarmAcres: number | null = null;

  private initialized = false;

  ngOnChanges(changes: SimpleChanges): void {
    // When isOpen becomes true, initialize the form from the customer
    if (this.isOpen && this.customer && !this.initialized) {
      this.editLocation = this.customer.location;
      this.editPhone = this.customer.phone;
      this.editEmail = this.customer.email;
      this.editFarmIds = [...this.customer.farmIds];
      this.editLinkedProducerIds = [...(this.customer.linkedProducerIds || [])];
      this.editESignEnabled = this.customer.eSignEnabled;

      // Store original values
      this.originalLocation = this.customer.location;
      this.originalPhone = this.customer.phone;
      this.originalEmail = this.customer.email;
      this.originalFarmIds = [...this.customer.farmIds];
      this.originalLinkedProducerIds = [...(this.customer.linkedProducerIds || [])];
      this.originalESignEnabled = this.customer.eSignEnabled;

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

    const farmIdsChanged = this.editFarmIds.length !== this.originalFarmIds.length
      || this.editFarmIds.some(id => !this.originalFarmIds.includes(id));

    const linkedProducerIdsChanged = this.editLinkedProducerIds.length !== this.originalLinkedProducerIds.length
      || this.editLinkedProducerIds.some(id => !this.originalLinkedProducerIds.includes(id));

    return this.editLocation !== this.originalLocation
      || this.editPhone !== this.originalPhone
      || this.editEmail !== this.originalEmail
      || this.editESignEnabled !== this.originalESignEnabled
      || farmIdsChanged
      || linkedProducerIdsChanged;
  }

  getFarmById(farmId: string): Farm | undefined {
    return this.allFarms.find(f => f.id === farmId);
  }

  getAvailableFarms(): Farm[] {
    return this.allFarms.filter(f => !this.editFarmIds.includes(f.id));
  }

  addExistingFarm(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const farmId = select.value;
    if (farmId && !this.editFarmIds.includes(farmId)) {
      this.editFarmIds = [...this.editFarmIds, farmId];
      select.value = '';
    }
  }

  removeFarm(farmId: string): void {
    if (this.editFarmIds.length > 1) {
      this.editFarmIds = this.editFarmIds.filter(id => id !== farmId);
    }
  }

  getProducerById(producerId: string): Customer | undefined {
    return this.allCustomers.find(c => c.id === producerId);
  }

  getAvailableProducers(): Customer[] {
    // Get producers that link to this customer (so we don't show them in the available list)
    const producersLinkingToMe = this.allCustomers
      .filter(c => c.linkedProducerIds && c.linkedProducerIds.includes(this.customer?.id || ''))
      .map(c => c.id);

    return this.allCustomers.filter(c =>
      c.id !== this.customer?.id &&
      !this.editLinkedProducerIds.includes(c.id) &&
      !producersLinkingToMe.includes(c.id)
    );
  }

  getProducersLinkingToMe(): Customer[] {
    if (!this.customer) return [];
    return this.allCustomers.filter(c =>
      c.linkedProducerIds && c.linkedProducerIds.includes(this.customer!.id)
    );
  }

  addLinkedProducer(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const producerId = select.value;
    if (producerId && !this.editLinkedProducerIds.includes(producerId)) {
      this.editLinkedProducerIds = [...this.editLinkedProducerIds, producerId];
      select.value = '';
    }
  }

  removeLinkedProducer(producerId: string): void {
    this.editLinkedProducerIds = this.editLinkedProducerIds.filter(id => id !== producerId);
  }

  removeIncomingLink(producerId: string): void {
    // This will require updating the other producer's linkedProducerIds
    // We'll emit a special event that the parent can handle
    // For now, we'll show a message that they need to unlink from the other producer's edit dialog
    alert(`To unlink from ${this.getProducerById(producerId)?.name}, please edit that producer and remove this link from there.`);
  }

  createAndAddFarm(): void {
    if (this.newFarmName && this.newFarmAcres) {
      this.createFarm.emit({
        name: this.newFarmName,
        location: this.newFarmLocation,
        acres: this.newFarmAcres
      });
      this.showNewFarmForm = false;
      this.newFarmName = '';
      this.newFarmLocation = '';
      this.newFarmAcres = null;
    }
  }

  onCancel(): void {
    this.showNewFarmForm = false;
    this.newFarmName = '';
    this.newFarmLocation = '';
    this.newFarmAcres = null;
    this.initialized = false;
    this.close.emit();
  }

  onSave(): void {
    if (this.customer) {
      this.save.emit({
        customerId: this.customer.id,
        location: this.editLocation,
        phone: this.editPhone,
        email: this.editEmail,
        farmIds: this.editFarmIds,
        linkedProducerIds: this.editLinkedProducerIds,
        eSignEnabled: this.editESignEnabled
      });
      this.initialized = false;
      this.close.emit();
    }
  }
}
