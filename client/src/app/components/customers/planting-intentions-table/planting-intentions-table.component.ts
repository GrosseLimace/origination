import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '../../ui/dialog/dialog.component';
import { InputComponent } from '../../ui/input/input.component';
import { SelectComponent } from '../../ui/select/select.component';
import { Customer, PlantingIntention } from '../../../models';

type SortColumn = 'crop' | 'acres' | 'plantingYear' | 'estimatedYield' | 'totalProduction';
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
          @for (intention of sortedIntentions; track intention.id; let i = $index) {
            <!-- Year Separator -->
            @if (shouldShowYearSeparator(i, intention)) {
              <div class="flex items-center gap-2 py-2">
                <div class="h-px flex-1 bg-gray-300 dark:bg-gray-600"></div>
                <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {{ intention.plantingYear }} Planting Year
                </span>
                <div class="h-px flex-1 bg-gray-300 dark:bg-gray-600"></div>
              </div>
            }

            <!-- Card -->
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
                  <div class="text-xs text-gray-500 dark:text-gray-400">Planting Year</div>
                  <div class="text-sm text-gray-900 dark:text-white">{{ intention.plantingYear }}</div>
                </div>
              </div>

              <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  <span>Variety: {{ intention.variety || 'Not specified' }}</span>
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
                  <div class="flex items-center gap-1.5">
                    <span>Crop</span>
                    <span [class]="getSortIconClass('crop')">
                      @if (currentSortColumn === 'crop' && currentSortDirection === 'asc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                        </svg>
                      } @else if (currentSortColumn === 'crop' && currentSortDirection === 'desc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                        </svg>
                      } @else {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                        </svg>
                      }
                    </span>
                  </div>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('acres')" class="text-center">
                  <div class="flex items-center justify-center gap-1.5">
                    <span>Acres</span>
                    <span [class]="getSortIconClass('acres')">
                      @if (currentSortColumn === 'acres' && currentSortDirection === 'asc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                        </svg>
                      } @else if (currentSortColumn === 'acres' && currentSortDirection === 'desc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                        </svg>
                      } @else {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                        </svg>
                      }
                    </span>
                  </div>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('plantingYear')" class="text-center">
                  <div class="flex items-center justify-center gap-1.5">
                    <span>Planting Year</span>
                    <span [class]="getSortIconClass('plantingYear')">
                      @if (currentSortColumn === 'plantingYear' && currentSortDirection === 'asc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                        </svg>
                      } @else if (currentSortColumn === 'plantingYear' && currentSortDirection === 'desc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                        </svg>
                      } @else {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                        </svg>
                      }
                    </span>
                  </div>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('estimatedYield')" class="text-center">
                  <div class="flex items-center justify-center gap-1.5">
                    <span>Est. Yield (bu/acre)</span>
                    <span [class]="getSortIconClass('estimatedYield')">
                      @if (currentSortColumn === 'estimatedYield' && currentSortDirection === 'asc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                        </svg>
                      } @else if (currentSortColumn === 'estimatedYield' && currentSortDirection === 'desc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                        </svg>
                      } @else {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                        </svg>
                      }
                    </span>
                  </div>
                </app-table-head>
                <app-table-head [sortable]="true" (click)="handleSort('totalProduction')" class="text-center">
                  <div class="flex items-center justify-center gap-1.5">
                    <span>Total Est. Production</span>
                    <span [class]="getSortIconClass('totalProduction')">
                      @if (currentSortColumn === 'totalProduction' && currentSortDirection === 'asc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                        </svg>
                      } @else if (currentSortColumn === 'totalProduction' && currentSortDirection === 'desc') {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                        </svg>
                      } @else {
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                        </svg>
                      }
                    </span>
                  </div>
                </app-table-head>
                <app-table-head class="text-center"></app-table-head>
              </app-table-row>
            </app-table-header>
            <app-table-body>
              @for (intention of sortedIntentions; track intention.id; let i = $index) {
                <!-- Year Separator Row -->
                @if (shouldShowYearSeparator(i, intention)) {
                  <app-table-row>
                    <app-table-cell [colspan]="6" class="bg-gray-50 dark:bg-gray-800/50">
                      <div class="py-2 px-3 flex items-center gap-2">
                        <div class="h-px flex-1 bg-gray-300 dark:bg-gray-600"></div>
                        <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {{ intention.plantingYear }} Planting Year
                        </span>
                        <div class="h-px flex-1 bg-gray-300 dark:bg-gray-600"></div>
                      </div>
                    </app-table-cell>
                  </app-table-row>
                }

                <!-- Data Row -->
                <app-table-row>
                  <app-table-cell>
                    <span class="font-medium">{{ intention.crop }}</span>
                  </app-table-cell>
                  <app-table-cell class="text-center">{{ intention.acres | number }}</app-table-cell>
                  <app-table-cell class="text-center">{{ intention.plantingYear }}</app-table-cell>
                  <app-table-cell class="text-center">{{ intention.estimatedYield }}</app-table-cell>
                  <app-table-cell class="text-center">{{ intention.acres * intention.estimatedYield | number }} bu</app-table-cell>
                  <app-table-cell class="text-center">
                    <button
                      type="button"
                      class="h-10 w-10 inline-flex items-center justify-center text-gray-400 hover:text-green-600 dark:hover:text-green-400 bg-transparent border-0 p-0"
                      (click)="openEditDialog(intention)"
                    >
                      <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                      </svg>
                    </button>
                  </app-table-cell>
                </app-table-row>
              }
            </app-table-body>
          </app-table>
        </div>
      }

      <!-- Add Dialog -->
      <app-dialog [isOpen]="showAddDialog" (close)="closeAddDialog()" size="md">
        <app-dialog-header>
          <app-dialog-title>Add Planting Intention</app-dialog-title>
          <app-dialog-description>Record a new planting intention for {{ customer.name }}</app-dialog-description>
        </app-dialog-header>
        <app-dialog-content>
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
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Planting Year</label>
              <app-input type="number" [(ngModel)]="addForm.plantingYear" placeholder="Enter year (e.g., 2025)" min="2020" max="2100"></app-input>
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
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Planting Year</label>
              <app-input type="number" [(ngModel)]="editForm.plantingYear" min="2020" max="2100"></app-input>
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
                <span class="text-sm text-gray-600 dark:text-gray-400">Planting Year:</span>
                <span class="text-sm font-medium text-gray-900 dark:text-gray-300">{{ selectedIntention.plantingYear }}</span>
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
  @Output() add = new EventEmitter<{crop: string, acres: number, plantingYear: number, estimatedYield: number}>();
  @Output() edit = new EventEmitter<{intentionId: string, crop: string, acres: number, plantingYear: number, estimatedYield: number}>();
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
    plantingYear: ''
  };

  editForm = {
    crop: '',
    acres: '',
    plantingYear: ''
  };

  originalEditForm = {
    crop: '',
    acres: '',
    plantingYear: ''
  };

  get sortedIntentions(): PlantingIntention[] {
    // Default sort: newest year first (descending by year)
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      return [...this.plantingIntentions].sort((a, b) => b.plantingYear - a.plantingYear);
    }

    // Special case: When sorting by plantingYear, sort across all data (don't group by year)
    if (this.currentSortColumn === 'plantingYear') {
      return [...this.plantingIntentions].sort((a, b) => {
        const comparison = a.plantingYear - b.plantingYear;
        return this.currentSortDirection === 'desc' ? -comparison : comparison;
      });
    }

    // For other columns: Group by year, sort within each year group, then flatten
    const groupedByYear = this.plantingIntentions.reduce((acc, intention) => {
      if (!acc[intention.plantingYear]) {
        acc[intention.plantingYear] = [];
      }
      acc[intention.plantingYear].push(intention);
      return acc;
    }, {} as Record<number, PlantingIntention[]>);

    // Sort each year group
    const sortedGroups = Object.entries(groupedByYear).map(([year, intentions]) => {
      const sorted = [...intentions].sort((a, b) => {
        let comparison = 0;
        switch (this.currentSortColumn) {
          case 'crop':
            comparison = a.crop.localeCompare(b.crop);
            break;
          case 'acres':
            comparison = a.acres - b.acres;
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
      return { year: parseInt(year), intentions: sorted };
    });

    // Sort years descending (newest first) and flatten
    return sortedGroups
      .sort((a, b) => b.year - a.year)
      .flatMap(group => group.intentions);
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

  getSortIconClass(column: SortColumn): string {
    if (this.currentSortColumn === column) {
      return 'text-gray-600 dark:text-gray-300';
    }
    return 'text-gray-300 dark:text-gray-600';
  }

  shouldShowYearSeparator(index: number, intention: PlantingIntention): boolean {
    // Check if there are multiple years in the data
    const uniqueYears = new Set(this.plantingIntentions.map(i => i.plantingYear));
    if (uniqueYears.size <= 1) {
      return false; // Don't show separators if there's only one year
    }

    // Show separator for the first item
    if (index === 0) {
      return true;
    }

    // Show separator when the year changes from the previous item
    const previousIntention = this.sortedIntentions[index - 1];
    return previousIntention.plantingYear !== intention.plantingYear;
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

  getFarmName(farmId: string): string {
    return this.customer?.farm || '';
  }

  /**
   * Get the estimated yield for a given crop from the yield estimates table.
   * Returns 0 if the crop is not found in the table.
   */
  getEstimatedYield(crop: string): number {
    return this.YIELD_ESTIMATES[crop] || 0;
  }

  get editIntentionFarmName(): string {
    return this.customer?.farm || '';
  }

  openAddDialog(): void {
    const lastYear = new Date().getFullYear() - 1;

    this.addForm = {
      crop: '',
      acres: '',
      plantingYear: lastYear.toString()
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
      && this.addForm.plantingYear !== ''
      && !isNaN(parseInt(this.addForm.plantingYear));
  }

  submitAdd(): void {
    if (this.isAddFormValid()) {
      const data = {
        crop: this.addForm.crop,
        acres: parseInt(this.addForm.acres),
        plantingYear: parseInt(this.addForm.plantingYear),
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
      plantingYear: intention.plantingYear.toString()
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
      || this.editForm.plantingYear !== this.originalEditForm.plantingYear;
  }

  isEditFormValid(): boolean {
    return this.editForm.crop !== ''
      && this.editForm.acres !== ''
      && !isNaN(parseInt(this.editForm.acres))
      && this.editForm.plantingYear !== ''
      && !isNaN(parseInt(this.editForm.plantingYear))
      && this.hasEditFormChanged();
  }

  submitEdit(): void {
    if (this.isEditFormValid() && this.selectedIntention) {
      this.edit.emit({
        intentionId: this.selectedIntention.id,
        crop: this.editForm.crop,
        acres: parseInt(this.editForm.acres),
        plantingYear: parseInt(this.editForm.plantingYear),
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
