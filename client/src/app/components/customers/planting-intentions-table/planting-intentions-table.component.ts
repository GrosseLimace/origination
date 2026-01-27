import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '../../ui/dialog/dialog.component';
import { InputComponent } from '../../ui/input/input.component';
import { SelectComponent } from '../../ui/select/select.component';
import { Customer, PlantingIntention, Farm } from '../../../models';

type SortColumn = 'crop' | 'acres' | 'plantingDate' | 'estimatedYield' | 'totalProduction';
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
          @if (!selectedFarmId) {
            <div class="flex justify-center">
              <div class="text-center px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 rounded-lg">
                <p class="text-sm">Please select a farm from the dropdown above to add planting intentions</p>
              </div>
            </div>
          } @else {
            <div class="flex justify-center">
              <app-button variant="default" (onClick)="openAddDialog()">
                <svg class="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                Add Planting Intention
              </app-button>
            </div>
          }
        </div>
      } @else {
        <!-- Add Button -->
        @if (!selectedFarmId) {
          <div class="mb-4 px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 rounded-lg">
            <p class="text-sm">Please select a farm from the dropdown above to add planting intentions</p>
          </div>
        } @else {
          <div class="flex justify-end mb-4">
            <app-button variant="default" (onClick)="openAddDialog()">
              <svg class="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Add Planting Intention
            </app-button>
          </div>
        }

        <!-- Mobile Card View -->
        <div class="md:hidden space-y-3">
          @for (intention of sortedIntentions; track intention.id) {
            <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
              <div class="flex items-start justify-between mb-3">
                <div class="flex-1">
                  <div class="font-medium text-gray-900 dark:text-white">{{ intention.crop }}</div>
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
                    <app-table-cell [colspan]="6">
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
      <app-dialog [isOpen]="showAddDialog" (close)="closeAddDialog()" size="md">
        <app-dialog-header>
          <app-dialog-title>Add Planting Intention</app-dialog-title>
          <app-dialog-description>Record a new planting intention for {{ customer.name }} at {{ selectedFarmName }}</app-dialog-description>
        </app-dialog-header>
        <app-dialog-content>
          @if (!selectedFarmId) {
            <div class="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 rounded-lg border border-red-200 dark:border-red-800">
              <p class="text-sm font-medium">No farm selected</p>
              <p class="text-sm mt-1">Please close this dialog and select a farm from the dropdown before adding planting intentions.</p>
            </div>
          }
          <div class="space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Crop</label>
              <app-select [(ngModel)]="addForm.crop" placeholder="Select a crop">
                <option value="IR HRWW">IR HRWW</option>
                <option value="DL HRWW">DL HRWW</option>
                <option value="IR Corn">IR Corn</option>
                <option value="DL YC">DL YC</option>
                <option value="IR Milo">IR Milo</option>
                <option value="DL Milo">DL Milo</option>
                <option value="IR Beans">IR Beans</option>
                <option value="DL YSB">DL YSB</option>
              </app-select>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Acres</label>
              <app-input type="number" [(ngModel)]="addForm.acres" placeholder="Enter acres"></app-input>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Planting Date</label>
              <app-input type="date" [(ngModel)]="addForm.plantingDate"></app-input>
            </div>
          </div>
        </app-dialog-content>
        <app-dialog-footer>
          <app-button variant="outline" (onClick)="closeAddDialog()">Cancel</app-button>
          <app-button variant="default" (onClick)="submitAdd()" [disabled]="!isAddFormValid()">Add Intention</app-button>
        </app-dialog-footer>
      </app-dialog>

      <!-- Edit Dialog -->
      <app-dialog [isOpen]="showEditDialog" (close)="closeEditDialog()" size="md">
        <app-dialog-header>
          <app-dialog-title>Edit Planting Intention</app-dialog-title>
          <app-dialog-description>Update planting intention for {{ customer.name }} at {{ editIntentionFarmName }}</app-dialog-description>
        </app-dialog-header>
        <app-dialog-content>
          <div class="space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Crop</label>
              <app-select [(ngModel)]="editForm.crop">
                <option value="IR HRWW">IR HRWW</option>
                <option value="DL HRWW">DL HRWW</option>
                <option value="IR Corn">IR Corn</option>
                <option value="DL YC">DL YC</option>
                <option value="IR Milo">IR Milo</option>
                <option value="DL Milo">DL Milo</option>
                <option value="IR Beans">IR Beans</option>
                <option value="DL YSB">DL YSB</option>
              </app-select>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Acres</label>
              <app-input type="number" [(ngModel)]="editForm.acres"></app-input>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Planting Date</label>
              <app-input type="date" [(ngModel)]="editForm.plantingDate"></app-input>
            </div>
          </div>
        </app-dialog-content>
        <app-dialog-footer>
          <div class="flex justify-between items-center w-full">
            <app-button variant="outline" (onClick)="openDeleteConfirm()" class="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20">
              <svg class="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
              Delete
            </app-button>
            <div class="flex gap-2">
              <app-button variant="outline" (onClick)="closeEditDialog()">Cancel</app-button>
              <app-button variant="default" (onClick)="submitEdit()" [disabled]="!isEditFormValid()">Save Changes</app-button>
            </div>
          </div>
        </app-dialog-footer>
      </app-dialog>

      <!-- Delete Confirmation Dialog -->
      @if (showDeleteConfirm && selectedIntention) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-hidden" (click)="closeDeleteConfirm()">
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6 overflow-y-auto max-h-[90vh]" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Delete Planting Intention?</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Are you sure you want to delete this planting intention? This action cannot be undone.
            </p>
            <div class="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 mb-4 space-y-2">
              <div class="pb-2 mb-2 border-b border-gray-200 dark:border-gray-600">
                <span class="text-sm font-semibold text-gray-900 dark:text-gray-200">{{ customer.name }} | {{ getFarmName(selectedIntention.farmId) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-sm text-gray-600 dark:text-gray-400">Crop:</span>
                <span class="text-sm font-medium text-gray-900 dark:text-gray-300">{{ selectedIntention.crop }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-sm text-gray-600 dark:text-gray-400">Acres:</span>
                <span class="text-sm font-medium text-gray-900 dark:text-gray-300">{{ selectedIntention.acres | number }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-sm text-gray-600 dark:text-gray-400">Planting Date:</span>
                <span class="text-sm font-medium text-gray-900 dark:text-gray-300">{{ selectedIntention.plantingDate | date:'mediumDate' }}</span>
              </div>
            </div>
            <div class="flex justify-end gap-2">
              <app-button variant="outline" (onClick)="closeDeleteConfirm()">Cancel</app-button>
              <app-button variant="default" (onClick)="confirmDelete()" class="bg-red-600 hover:bg-red-700 text-white">Delete</app-button>
            </div>
          </div>
        </div>
      }
    </div>
  `
})
export class PlantingIntentionsTableComponent implements OnDestroy {
  @Input() plantingIntentions: PlantingIntention[] = [];
  @Input() customer!: Customer;
  @Input() selectedFarmId: string | null = null;
  @Input() farms: Farm[] = [];
  @Output() add = new EventEmitter<{farmId: string, crop: string, acres: number, plantingDate: Date, estimatedYield: number}>();
  @Output() edit = new EventEmitter<{intentionId: string, farmId: string, crop: string, acres: number, plantingDate: Date, estimatedYield: number}>();
  @Output() delete = new EventEmitter<string>();

  // Average Yield Estimates (bu/acre) - Used for auto-calculating estimated yield
  private readonly YIELD_ESTIMATES: Record<string, number> = {
    'IR HRWW': 75,      // Irrigated Hard Red Winter Wheat
    'DL HRWW': 50,      // Dryland Hard Red Winter Wheat
    'IR Corn': 215,     // Irrigated Corn
    'DL YC': 100,       // Dryland Yellow Corn
    'IR Milo': 120,     // Irrigated Milo
    'DL Milo': 75,      // Dryland Milo
    'IR Beans': 60,     // Irrigated Beans
    'DL YSB': 30        // Dryland Yellow Soybeans
  };

  expandedRows = new Set<string>();
  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';

  showAddDialog = false;
  showEditDialog = false;
  showDeleteConfirm = false;
  selectedIntention: PlantingIntention | null = null;

  addForm = {
    crop: '',
    acres: '',
    plantingDate: ''
  };

  editForm = {
    crop: '',
    acres: '',
    plantingDate: ''
  };

  originalEditForm = {
    crop: '',
    acres: '',
    plantingDate: ''
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

  getFarmName(farmId: string): string {
    const farm = this.farms.find(f => f.id === farmId);
    return farm ? farm.name : 'Unknown Farm';
  }

  /**
   * Get the estimated yield for a given crop from the yield estimates table.
   * Returns 0 if the crop is not found in the table.
   */
  getEstimatedYield(crop: string): number {
    return this.YIELD_ESTIMATES[crop] || 0;
  }

  get selectedFarmName(): string {
    if (!this.selectedFarmId) return '';
    const farm = this.farms.find(f => f.id === this.selectedFarmId);
    return farm ? farm.name : '';
  }

  get editIntentionFarmName(): string {
    if (!this.selectedIntention) return '';
    const farm = this.farms.find(f => f.id === this.selectedIntention!.farmId);
    return farm ? farm.name : '';
  }

  openAddDialog(): void {
    const now = new Date();

    this.addForm = {
      crop: '',
      acres: '',
      plantingDate: now.toISOString().split('T')[0]
    };
    this.showAddDialog = true;
    // Prevent body scroll when dialog opens
    document.body.style.overflow = 'hidden';
  }

  closeAddDialog(): void {
    this.showAddDialog = false;
    // Restore body scroll when dialog closes
    document.body.style.overflow = '';
  }

  isAddFormValid(): boolean {
    return this.addForm.crop !== ''
      && this.addForm.acres !== ''
      && !isNaN(parseInt(this.addForm.acres))
      && this.addForm.plantingDate !== '';
  }

  submitAdd(): void {
    if (this.isAddFormValid() && this.selectedFarmId) {
      const data = {
        farmId: this.selectedFarmId,
        crop: this.addForm.crop,
        acres: parseInt(this.addForm.acres),
        plantingDate: new Date(this.addForm.plantingDate),
        estimatedYield: this.getEstimatedYield(this.addForm.crop)
      };
      this.add.emit(data);
      this.closeAddDialog();
    }
  }

  openEditDialog(intention: PlantingIntention): void {
    this.selectedIntention = intention;
    const formData = {
      crop: intention.crop,
      acres: intention.acres.toString(),
      plantingDate: new Date(intention.plantingDate).toISOString().split('T')[0]
    };
    this.editForm = { ...formData };
    this.originalEditForm = { ...formData };
    this.showEditDialog = true;
    // Prevent body scroll when dialog opens
    document.body.style.overflow = 'hidden';
  }

  closeEditDialog(): void {
    this.showEditDialog = false;
    this.selectedIntention = null;
    // Restore body scroll when dialog closes
    document.body.style.overflow = '';
  }

  hasEditFormChanged(): boolean {
    return this.editForm.crop !== this.originalEditForm.crop
      || this.editForm.acres !== this.originalEditForm.acres
      || this.editForm.plantingDate !== this.originalEditForm.plantingDate;
  }

  isEditFormValid(): boolean {
    return this.editForm.crop !== ''
      && this.editForm.acres !== ''
      && !isNaN(parseInt(this.editForm.acres))
      && this.editForm.plantingDate !== ''
      && this.hasEditFormChanged();
  }

  submitEdit(): void {
    if (this.isEditFormValid() && this.selectedIntention) {
      this.edit.emit({
        intentionId: this.selectedIntention.id,
        farmId: this.selectedIntention.farmId,
        crop: this.editForm.crop,
        acres: parseInt(this.editForm.acres),
        plantingDate: new Date(this.editForm.plantingDate),
        estimatedYield: this.getEstimatedYield(this.editForm.crop)
      });
      this.closeEditDialog();
    }
  }

  openDeleteConfirm(): void {
    this.showDeleteConfirm = true;
    // Prevent body scroll when dialog opens
    document.body.style.overflow = 'hidden';
  }

  closeDeleteConfirm(): void {
    this.showDeleteConfirm = false;
    // Restore body scroll when dialog closes
    document.body.style.overflow = '';
  }

  confirmDelete(): void {
    if (this.selectedIntention) {
      this.delete.emit(this.selectedIntention.id);
      this.closeDeleteConfirm();
      this.closeEditDialog();
    }
  }

  ngOnDestroy(): void {
    // Ensure body scroll is restored if component is destroyed while any dialog is open
    if (this.showDeleteConfirm || this.showEditDialog || this.showAddDialog) {
      document.body.style.overflow = '';
    }
  }
}
