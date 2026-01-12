import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogContentComponent, DialogFooterComponent } from '../../ui/dialog/dialog.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { InputComponent } from '../../ui/input/input.component';
import { Customer } from '../../../models';

@Component({
  selector: 'app-edit-customer-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogContentComponent,
    DialogFooterComponent,
    ButtonComponent,
    InputComponent
  ],
  template: `
    <app-dialog [isOpen]="isOpen" (close)="onCancel()">
      <app-dialog-header>
        <app-dialog-title>Edit Customer</app-dialog-title>
        <button
          class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          (click)="onCancel()"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </app-dialog-header>

      <app-dialog-content>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name
            </label>
            <input
              type="text"
              [(ngModel)]="editedCustomer.name"
              class="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Farm Name
            </label>
            <input
              type="text"
              [(ngModel)]="editedCustomer.farm"
              class="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Location
            </label>
            <input
              type="text"
              [(ngModel)]="editedCustomer.location"
              class="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Phone
              </label>
              <input
                type="tel"
                [(ngModel)]="editedCustomer.phone"
                class="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email
              </label>
              <input
                type="email"
                [(ngModel)]="editedCustomer.email"
                class="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Total Acres
            </label>
            <input
              type="number"
              [(ngModel)]="editedCustomer.totalAcres"
              class="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div class="flex items-center gap-2">
            <input
              type="checkbox"
              id="eSignEnabled"
              [(ngModel)]="editedCustomer.eSignEnabled"
              class="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <label for="eSignEnabled" class="text-sm text-gray-700 dark:text-gray-300">
              Enable e-Sign for contracts
            </label>
          </div>
        </div>
      </app-dialog-content>

      <app-dialog-footer>
        <app-button variant="outline" (click)="onCancel()">Cancel</app-button>
        <app-button variant="primary" (click)="onSave()">Save Changes</app-button>
      </app-dialog-footer>
    </app-dialog>
  `
})
export class EditCustomerDialogComponent {
  @Input() isOpen = false;
  @Input() set customer(value: Customer | null) {
    if (value) {
      this.editedCustomer = { ...value };
    }
  }

  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<Customer>();

  editedCustomer: Customer = {
    id: '',
    name: '',
    farm: '',
    location: '',
    phone: '',
    email: '',
    totalAcres: 0,
    farmIds: [],
    eSignEnabled: false
  };

  onCancel() {
    this.close.emit();
  }

  onSave() {
    this.save.emit(this.editedCustomer);
    this.close.emit();
  }
}
