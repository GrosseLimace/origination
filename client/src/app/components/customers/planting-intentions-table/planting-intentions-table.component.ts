import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '../../ui/table/table.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { Customer, PlantingIntention } from '../../../models';

@Component({
  selector: 'app-planting-intentions-table',
  standalone: true,
  imports: [
    CommonModule,
    TableComponent,
    TableHeaderComponent,
    TableBodyComponent,
    TableRowComponent,
    TableHeadComponent,
    TableCellComponent,
    ButtonComponent
  ],
  template: `
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">
        {{ currentYear }} Planting Intentions
      </h3>
      <app-button variant="primary" size="sm" (click)="add.emit()">
        <svg class="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        Add Intention
      </app-button>
    </div>

    @if (plantingIntentions.length === 0) {
      <div class="text-center py-8 text-gray-500 dark:text-gray-400">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064"/>
        </svg>
        <p class="mt-2">No planting intentions recorded</p>
        <p class="text-sm">Add planting intentions to track crop plans</p>
      </div>
    } @else {
      <app-table>
        <app-table-header>
          <app-table-row>
            <app-table-head>Crop</app-table-head>
            <app-table-head>Acres</app-table-head>
            <app-table-head>Expected Yield</app-table-head>
            <app-table-head>Est. Production</app-table-head>
            <app-table-head>Planting Date</app-table-head>
            <app-table-head></app-table-head>
          </app-table-row>
        </app-table-header>
        <app-table-body>
          @for (intention of plantingIntentions; track intention.id) {
            <!-- Main Row - Clickable -->
            <app-table-row
              [clickable]="true"
              (rowClick)="toggleRow(intention.id)"
            >
              <app-table-cell>
                <div class="flex items-center gap-2">
                  <svg
                    class="w-4 h-4 text-gray-400 transition-transform"
                    [class.rotate-180]="expandedRows.has(intention.id)"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                  </svg>
                  <span [class]="getCropColorClass(intention.crop)"></span>
                  <span class="font-medium">{{ intention.crop }}</span>
                </div>
              </app-table-cell>
              <app-table-cell>{{ intention.acres | number }} ac</app-table-cell>
              <app-table-cell>{{ intention.estimatedYield | number }} bu/ac</app-table-cell>
              <app-table-cell>{{ intention.acres * intention.estimatedYield | number }} bu</app-table-cell>
              <app-table-cell>{{ intention.plantingDate | date:'MMM d, y' }}</app-table-cell>
              <app-table-cell>
                <button
                  class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  (click)="onEditClick($event, intention)"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                </button>
              </app-table-cell>
            </app-table-row>

            <!-- Expanded Row -->
            @if (expandedRows.has(intention.id)) {
              <app-table-row>
                <app-table-cell [attr.colspan]="6">
                  <div class="py-4 bg-gray-50 dark:bg-gray-800/50 -mx-4 px-4">
                    <div class="grid grid-cols-2 gap-8">
                      <!-- Left Column -->
                      <div class="space-y-4">
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Total Production</p>
                          <p class="font-medium">{{ intention.acres * intention.estimatedYield | number }} bushels</p>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Yield per Acre</p>
                          <p class="font-medium">{{ intention.estimatedYield }} bu/acre</p>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Full Planting Date</p>
                          <p class="font-medium">{{ intention.plantingDate | date:'MMMM d, y' }}</p>
                        </div>
                      </div>

                      <!-- Right Column -->
                      <div class="space-y-4">
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Planting Timeline</p>
                          <p class="font-medium">{{ getPlantingTimelineText(intention.plantingDate) }}</p>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Variety Details</p>
                          <p class="font-medium">{{ intention.variety || '-' }}</p>
                        </div>
                        <div>
                          <p class="text-sm text-gray-500 dark:text-gray-400">Total Acreage</p>
                          <p class="font-medium">{{ intention.acres | number }} acres</p>
                        </div>
                      </div>
                    </div>

                    <!-- Notes -->
                    @if (intention.notes) {
                      <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <p class="text-sm text-gray-500 dark:text-gray-400">Notes</p>
                        <p class="font-medium">{{ intention.notes }}</p>
                      </div>
                    }
                  </div>
                </app-table-cell>
              </app-table-row>
            }
          }
        </app-table-body>
      </app-table>

      <!-- Summary -->
      <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p class="text-gray-500 dark:text-gray-400">Total Acres Planned</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ totalAcres | number }}</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Est. Total Production</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ totalProduction | number }} bu</p>
          </div>
          <div>
            <p class="text-gray-500 dark:text-gray-400">Crops</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ uniqueCrops }}</p>
          </div>
        </div>
      </div>
    }
  `
})
export class PlantingIntentionsTableComponent implements OnChanges {
  @Input() plantingIntentions: PlantingIntention[] = [];
  @Input() customer!: Customer;
  @Output() add = new EventEmitter<void>();
  @Output() edit = new EventEmitter<PlantingIntention>();

  expandedRows = new Set<string>();

  ngOnChanges(changes: SimpleChanges): void {
    // Reset expanded rows when planting intentions change (new customer selected)
    if (changes['plantingIntentions']) {
      this.expandedRows.clear();
    }
  }

  toggleRow(intentionId: string): void {
    if (this.expandedRows.has(intentionId)) {
      this.expandedRows.delete(intentionId);
    } else {
      this.expandedRows.add(intentionId);
    }
  }

  onEditClick(event: Event, intention: PlantingIntention): void {
    event.stopPropagation();
    this.edit.emit(intention);
  }

  get currentYear(): number {
    return new Date().getFullYear();
  }

  get totalAcres(): number {
    return this.plantingIntentions.reduce((sum, p) => sum + p.acres, 0);
  }

  get totalProduction(): number {
    return this.plantingIntentions.reduce((sum, p) => sum + (p.acres * p.estimatedYield), 0);
  }

  get uniqueCrops(): number {
    return new Set(this.plantingIntentions.map(p => p.crop)).size;
  }

  getPlantingTimelineText(plantingDate: Date): string {
    const now = new Date();
    const date = new Date(plantingDate);
    const diffTime = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      return `Planting in ${diffDays} days`;
    } else if (diffDays === 0) {
      return 'Planting today';
    } else {
      return `Planted ${Math.abs(diffDays)} days ago`;
    }
  }

  getCropColorClass(crop: string): string {
    const colors: { [key: string]: string } = {
      'Corn': 'w-3 h-3 rounded-full bg-yellow-500',
      'Soybeans': 'w-3 h-3 rounded-full bg-green-500',
      'Wheat': 'w-3 h-3 rounded-full bg-amber-600',
      'Sorghum': 'w-3 h-3 rounded-full bg-orange-500'
    };
    return colors[crop] || 'w-3 h-3 rounded-full bg-gray-500';
  }
}
