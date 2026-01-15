import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '../../ui/dialog/dialog.component';
import { InputComponent } from '../../ui/input/input.component';
import { SelectComponent } from '../../ui/select/select.component';
import { Customer, PlantingIntention } from '../../../models';

type SortColumn = 'crop' | 'acres' | 'variety' | 'plantingDate' | 'estimatedYield' | 'totalProduction';
type SortDirection = 'none' | 'asc' | 'desc';

@Component({
  selector: 'app-planting-intentions-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableComponent,
    TableHeaderComponent,
    TableBodyComponent,
    TableRowComponent,
    TableHeadComponent,
    TableCellComponent,
    ButtonComponent,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogContentComponent,
    DialogFooterComponent,
    InputComponent,
    SelectComponent
  ],
  template: `
    <div class="w-full">
      @if (plantingIntentions.length === 0) {
        <div class="space-y-4">
          <div class="text-center py-8 text-gray-500 dark:text-gray-400">
            <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <p class="mt-2">No planting intentions recorded for this customer</p>
          </div>
          <div class="flex justify-center">
            <app-button variant="default" (onClick)="openAddDialog()">
              <svg class="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Add Planting Intention
            </app-button>
          </div>
        </div>
      } @else {
        <!-- Add Button -->
        <div class="flex justify-end mb-4">
          <app-button variant="default" (onClick)="openAddDialog()">
            <svg class="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            Add Planting Intention
          </app-button>
        </div>

        <!-- Mobile Card View -->
        <div class="md:hidden space-y-3">
          @for (intention of sortedIntentions; track intention.id) {
            <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
              <div class="flex items-start justify-between mb-3">
                <div class="flex-1">
                  <div class="font-medium text-gray-900 dark:text-white">{{ intention.crop }}</div>
                  <div class="text-sm text-gray-500 dark:text-gray-400">{{ intention.variety }}</div>
                </div>
                <button
                  type="button"
                  class="h-10 w-10 inline-flex items-center justify-center text-gray-400 hover:text-green-600 dark:hover:text-green-400 bg-transparent border-0 p-0"
                  (click)="openEditDialog(intention)"
                >
                  <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                  </svg>
                </button>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Acres</div>
                  <div class="text-sm text-gray-900 dark:text-white">{{ intention.acres | number }}</div>
                </div>
                <div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Est. Yield</div>
                  <div class="text-sm text-gray-900 dark:text-white">{{ intention.estimatedYield }} bu/acre</div>
                </div>
                <div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Total Production</div>
                  <div class="text-sm font-medium text-green-600 dark:text-green-400">{{ intention.acres * intention.estimatedYield | number }} bu</div>
                </div>
                <div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">Planting Date</div>
                  <div class="text-sm text-gray-900 dark:text-white">{{ intention.plantingDate | date:'MMM d, yyyy' }}</div>
                </div>
              </div>

              <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  @if (getDaysUntilPlanting(intention) > 0) {
                    <span>{{ getDaysUntilPlanting(intention) }} days until planting</span>
                  } @else if (getDaysUntilPlanting(intention) === 0) {
                    <span class="text-green-600">Planting today</span>
                  } @else {
                    <span>Planted {{ -getDaysUntilPlanting(intention) }} days ago</span>
                  }
                </div>
              </div>
            </div>
          }
        </div>

        <!-- Desktop Table View -->
        <div class="hidden md:block">
          <app-table>
            <app-table-header>
              <app-table-row>
                <app-table-head [sortable]="true" (click)="handleSort('crop')">
                  <span class="flex items-center gap-1">
                    Crop
                    <span [innerHTML]="getSortIcon('crop')"></span>
                  </span>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('acres')">
                  <span class="flex items-center gap-1">
                    Acres
                    <span [innerHTML]="getSortIcon('acres')"></span>
                  </span>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('variety')">
                  <span class="flex items-center gap-1">
                    Variety
                    <span [innerHTML]="getSortIcon('variety')"></span>
                  </span>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('plantingDate')">
                  <span class="flex items-center gap-1">
                    Planting Date
                    <span [innerHTML]="getSortIcon('plantingDate')"></span>
                  </span>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('estimatedYield')">
                  <span class="flex items-center gap-1">
                    Est. Yield (bu/acre)
                    <span [innerHTML]="getSortIcon('estimatedYield')"></span>
                  </span>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('totalProduction')">
                  <span class="flex items-center gap-1">
                    Total Est. Production
                    <span [innerHTML]="getSortIcon('totalProduction')"></span>
                  </span>
                </app-table-head>
                <app-table-head></app-table-head>
              </app-table-row>
            </app-table-header>
            <app-table-body>
              @for (intention of sortedIntentions; track intention.id) {
                <app-table-row [clickable]="true" (rowClick)="toggleRow(intention.id)">
                  <app-table-cell>
                    <div class="flex items-center gap-2">
                      <span class="text-gray-400">
                        @if (isExpanded(intention.id)) {
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                          </svg>
                        } @else {
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                          </svg>
                        }
                      </span>
                      <span class="font-medium">{{ intention.crop }}</span>
                    </div>
                  </app-table-cell>
                  <app-table-cell>{{ intention.acres | number }}</app-table-cell>
                  <app-table-cell>{{ intention.variety || '-' }}</app-table-cell>
                  <app-table-cell>{{ intention.plantingDate | date:'MMM d, yyyy' }}</app-table-cell>
                  <app-table-cell>{{ intention.estimatedYield }}</app-table-cell>
                  <app-table-cell>{{ intention.acres * intention.estimatedYield | number }} bu</app-table-cell>
                  <app-table-cell>
                    <button
                      type="button"
                      class="h-10 w-10 inline-flex items-center justify-center text-gray-400 hover:text-green-600 dark:hover:text-green-400 bg-transparent border-0 p-0"
                      (click)="openEditDialog(intention); $event.stopPropagation()"
                    >
                      <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                      </svg>
                    </button>
                  </app-table-cell>
                </app-table-row>

                @if (isExpanded(intention.id)) {
                  <app-table-row class="bg-gray-50 dark:bg-gray-800/50">
                    <app-table-cell [colspan]="7">
                      <div class="py-4">
                        <div class="grid grid-cols-2 gap-8">
                          <!-- Left column -->
                          <div class="space-y-6">
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Total Production</p>
                              <p class="text-gray-900 dark:text-gray-100">{{ intention.acres * intention.estimatedYield | number }} bushels</p>
                            </div>
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Yield per Acre</p>
                              <p class="text-gray-900 dark:text-gray-100">{{ intention.estimatedYield }} bu/acre</p>
                            </div>
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Full Planting Date</p>
                              <p class="text-gray-900 dark:text-gray-100">{{ intention.plantingDate | date:'MMMM d, yyyy' }}</p>
                            </div>
                          </div>

                          <!-- Right column -->
                          <div class="space-y-6">
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Planting Timeline</p>
                              <p class="text-gray-900 dark:text-gray-100">
                                @if (getDaysUntilPlanting(intention) > 0) {
                                  Planting in {{ getDaysUntilPlanting(intention) }} days
                                } @else if (getDaysUntilPlanting(intention) === 0) {
                                  Planting today
                                } @else {
                                  Planted {{ -getDaysUntilPlanting(intention) }} days ago
                                }
                              </p>
                            </div>
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Variety Details</p>
                              <p class="text-gray-900 dark:text-gray-100">{{ intention.variety || '-' }}</p>
                            </div>
                            <div>
                              <p class="text-sm text-gray-500 dark:text-gray-400">Total Acreage</p>
                              <p class="text-gray-900 dark:text-gray-100">{{ intention.acres | number }} acres</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </app-table-cell>
                  </app-table-row>
                }
              }
            </app-table-body>
          </app-table>
        </div>
      }

      <!-- Add Dialog -->
      <app-dialog [isOpen]="showAddDialog" (close)="closeAddDialog()" size="sm">
        <app-dialog-header>
          <app-dialog-title>Add Planting Intention</app-dialog-title>
          <app-dialog-description>Record a new planting intention for {{ customer.name }}</app-dialog-description>
        </app-dialog-header>
        <app-dialog-content>
          <div class="space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Crop</label>
              <app-select [(ngModel)]="addForm.crop" placeholder="Select a crop">
                <option value="Corn">Corn</option>
                <option value="Soybeans">Soybeans</option>
                <option value="Wheat">Wheat</option>
                <option value="Oats">Oats</option>
              </app-select>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Acres</label>
              <app-input type="number" [(ngModel)]="addForm.acres" placeholder="Enter acres"></app-input>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Variety</label>
              <app-input type="text" [(ngModel)]="addForm.variety" placeholder="e.g., Pioneer P1197"></app-input>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Planting Date</label>
              <app-input type="date" [(ngModel)]="addForm.plantingDate"></app-input>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Estimated Yield (bu/acre)</label>
              <app-input type="number" [(ngModel)]="addForm.estimatedYield" placeholder="Enter estimated yield per acre"></app-input>
            </div>
          </div>
        </app-dialog-content>
        <app-dialog-footer>
          <app-button variant="outline" (onClick)="closeAddDialog()">Cancel</app-button>
          <app-button variant="default" (onClick)="submitAdd()" [disabled]="!isAddFormValid()">Add Intention</app-button>
        </app-dialog-footer>
      </app-dialog>

      <!-- Edit Dialog -->
      <app-dialog [isOpen]="showEditDialog" (close)="closeEditDialog()" size="sm">
        <app-dialog-header>
          <app-dialog-title>Edit Planting Intention</app-dialog-title>
          <app-dialog-description>Update planting intention for {{ customer.name }}</app-dialog-description>
        </app-dialog-header>
        <app-dialog-content>
          <div class="space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Crop</label>
              <app-select [(ngModel)]="editForm.crop">
                <option value="Corn">Corn</option>
                <option value="Soybeans">Soybeans</option>
                <option value="Wheat">Wheat</option>
                <option value="Oats">Oats</option>
              </app-select>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Acres</label>
              <app-input type="number" [(ngModel)]="editForm.acres"></app-input>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Variety</label>
              <app-input type="text" [(ngModel)]="editForm.variety"></app-input>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Planting Date</label>
              <app-input type="date" [(ngModel)]="editForm.plantingDate"></app-input>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Estimated Yield (bu/acre)</label>
              <app-input type="number" [(ngModel)]="editForm.estimatedYield"></app-input>
            </div>
          </div>
        </app-dialog-content>
        <app-dialog-footer>
          <app-button variant="outline" (onClick)="closeEditDialog()">Cancel</app-button>
          <app-button variant="default" (onClick)="submitEdit()" [disabled]="!isEditFormValid()">Save Changes</app-button>
        </app-dialog-footer>
      </app-dialog>
    </div>
  `
})
export class PlantingIntentionsTableComponent {
  @Input() plantingIntentions: PlantingIntention[] = [];
  @Input() customer!: Customer;
  @Output() add = new EventEmitter<{crop: string, acres: number, variety: string, plantingDate: Date, estimatedYield: number}>();
  @Output() edit = new EventEmitter<{intentionId: string, crop: string, acres: number, variety: string, plantingDate: Date, estimatedYield: number}>();

  expandedRows = new Set<string>();
  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';

  showAddDialog = false;
  showEditDialog = false;
  selectedIntention: PlantingIntention | null = null;

  addForm = {
    crop: '',
    acres: '',
    variety: '',
    plantingDate: '',
    estimatedYield: ''
  };

  editForm = {
    crop: '',
    acres: '',
    variety: '',
    plantingDate: '',
    estimatedYield: ''
  };

  originalEditForm = {
    crop: '',
    acres: '',
    variety: '',
    plantingDate: '',
    estimatedYield: ''
  };

  get sortedIntentions(): PlantingIntention[] {
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      return this.plantingIntentions;
    }

    const sorted = [...this.plantingIntentions].sort((a, b) => {
      let comparison = 0;
      switch (this.currentSortColumn) {
        case 'crop':
          comparison = a.crop.localeCompare(b.crop);
          break;
        case 'acres':
          comparison = a.acres - b.acres;
          break;
        case 'variety':
          comparison = (a.variety || '').localeCompare(b.variety || '');
          break;
        case 'plantingDate':
          comparison = new Date(a.plantingDate).getTime() - new Date(b.plantingDate).getTime();
          break;
        case 'estimatedYield':
          comparison = a.estimatedYield - b.estimatedYield;
          break;
        case 'totalProduction':
          comparison = (a.acres * a.estimatedYield) - (b.acres * b.estimatedYield);
          break;
      }
      return this.currentSortDirection === 'desc' ? -comparison : comparison;
    });

    return sorted;
  }

  handleSort(column: SortColumn): void {
    if (this.currentSortColumn === column) {
      if (this.currentSortDirection === 'none') {
        this.currentSortDirection = 'asc';
      } else if (this.currentSortDirection === 'asc') {
        this.currentSortDirection = 'desc';
      } else {
        this.currentSortDirection = 'none';
        this.currentSortColumn = null;
      }
    } else {
      this.currentSortColumn = column;
      this.currentSortDirection = 'asc';
    }
  }

  getSortIcon(column: SortColumn): string {
    if (this.currentSortColumn !== column) {
      return '<svg class="h-3 w-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>';
    }
    if (this.currentSortDirection === 'asc') {
      return '<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>';
    }
    if (this.currentSortDirection === 'desc') {
      return '<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';
    }
    return '<svg class="h-3 w-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>';
  }

  toggleRow(id: string): void {
    if (this.expandedRows.has(id)) {
      this.expandedRows.delete(id);
    } else {
      this.expandedRows.add(id);
    }
  }

  isExpanded(id: string): boolean {
    return this.expandedRows.has(id);
  }

  getDaysUntilPlanting(intention: PlantingIntention): number {
    const now = new Date();
    const plantingDate = new Date(intention.plantingDate);
    const diffTime = plantingDate.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  openAddDialog(): void {
    const now = new Date();
    const defaultDate = now.getMonth() >= 5
      ? new Date(now.getFullYear() + 1, 3, 15)
      : new Date(now.getFullYear(), 3, 15);

    this.addForm = {
      crop: '',
      acres: '',
      variety: '',
      plantingDate: defaultDate.toISOString().split('T')[0],
      estimatedYield: ''
    };
    this.showAddDialog = true;
  }

  closeAddDialog(): void {
    this.showAddDialog = false;
  }

  isAddFormValid(): boolean {
    return this.addForm.crop !== ''
      && this.addForm.acres !== ''
      && !isNaN(parseInt(this.addForm.acres))
      && this.addForm.variety !== ''
      && this.addForm.plantingDate !== ''
      && this.addForm.estimatedYield !== ''
      && !isNaN(parseInt(this.addForm.estimatedYield));
  }

  submitAdd(): void {
    if (this.isAddFormValid()) {
      this.add.emit({
        crop: this.addForm.crop,
        acres: parseInt(this.addForm.acres),
        variety: this.addForm.variety,
        plantingDate: new Date(this.addForm.plantingDate),
        estimatedYield: parseInt(this.addForm.estimatedYield)
      });
      this.closeAddDialog();
    }
  }

  openEditDialog(intention: PlantingIntention): void {
    this.selectedIntention = intention;
    const formData = {
      crop: intention.crop,
      acres: intention.acres.toString(),
      variety: intention.variety || '',
      plantingDate: new Date(intention.plantingDate).toISOString().split('T')[0],
      estimatedYield: intention.estimatedYield.toString()
    };
    this.editForm = { ...formData };
    this.originalEditForm = { ...formData };
    this.showEditDialog = true;
  }

  closeEditDialog(): void {
    this.showEditDialog = false;
    this.selectedIntention = null;
  }

  hasEditFormChanged(): boolean {
    return this.editForm.crop !== this.originalEditForm.crop
      || this.editForm.acres !== this.originalEditForm.acres
      || this.editForm.variety !== this.originalEditForm.variety
      || this.editForm.plantingDate !== this.originalEditForm.plantingDate
      || this.editForm.estimatedYield !== this.originalEditForm.estimatedYield;
  }

  isEditFormValid(): boolean {
    return this.editForm.crop !== ''
      && this.editForm.acres !== ''
      && !isNaN(parseInt(this.editForm.acres))
      && this.editForm.variety !== ''
      && this.editForm.plantingDate !== ''
      && this.editForm.estimatedYield !== ''
      && !isNaN(parseInt(this.editForm.estimatedYield))
      && this.hasEditFormChanged();
  }

  submitEdit(): void {
    if (this.isEditFormValid() && this.selectedIntention) {
      this.edit.emit({
        intentionId: this.selectedIntention.id,
        crop: this.editForm.crop,
        acres: parseInt(this.editForm.acres),
        variety: this.editForm.variety,
        plantingDate: new Date(this.editForm.plantingDate),
        estimatedYield: parseInt(this.editForm.estimatedYield)
      });
      this.closeEditDialog();
    }
  }
}
