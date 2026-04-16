import { Component, input, output, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableComponent, TableHeaderComponent, TableBodyComponent, TableRowComponent, TableHeadComponent, TableCellComponent } from '@shared/components/table/table.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '@shared/components/dialog/dialog.component';
import { InputComponent } from '@shared/components/input/input.component';
import { SelectComponent } from '@shared/components/select/select.component';
import { Customer, PlantingIntention, Commodity } from '@models';
import { ApiService } from '@core/services/api.service';

type SortColumn = 'crop' | 'acres' | 'plantingYear' | 'createdAt';
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
  templateUrl: './planting-intentions-table.component.html'
})
export class PlantingIntentionsTableComponent {
  private apiService = inject(ApiService);
  private destroyRef = inject(DestroyRef);

  public isLoading = input(false);
  public plantingIntentions = input<PlantingIntention[]>([]);
  public customer = input.required<Customer>();
  public tradeUnits = input<string[]>([]);
  public customerCommodityCodes = input<string[]>([]);
  public yieldEstimateCrops = input<string[]>([]);
  public selectedYear = input<number>(0);
  public add = output<{crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}>();
  public edit = output<{intentionId: number, crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number}>();
  public delete = output<number>();
  public yearSelect = output<number>();

  allCommodities: Commodity[] = [];
  isLoadingCommodities = false;

  get availableCrops(): Commodity[] {
    if (this.customerCommodityCodes().length === 0) return this.allCommodities;
    const keys = this.customerCommodityCodes().map(s => s.toLowerCase());
    const matched = this.allCommodities.filter(c =>
      keys.includes(c.code.toLowerCase()) ||
      (c.name && keys.includes(c.name.toLowerCase())) ||
      (c.category && keys.includes(c.category.toLowerCase()))
    );
    return matched.length > 0 ? matched : this.allCommodities;
  }

  get showNoCropsMessage(): boolean {
    return this.customerCommodityCodes().length === 0 && this.allCommodities.length > 0;
  }

  constructor() {
    this._loadCommodities();

    this.destroyRef.onDestroy(() => {
      if (this.showDeleteConfirm || this.showEditDialog || this.showAddDialog) {
        document.body.style.overflow = '';
      }
    });
  }

  getCropCategory(cropCode: string): string {
    const commodity = this.allCommodities.find(c => c.code === cropCode);
    return commodity?.category || cropCode;
  }

  expandedRows = new Set<number>();
  currentSortColumn: SortColumn | null = null;
  currentSortDirection: SortDirection = 'none';

  showAddDialog = false;
  showEditDialog = false;
  showDeleteConfirm = false;
  selectedIntention: PlantingIntention | null = null;

  addForm = {
    crop: '',
    category: '',
    type: '',
    description: '',
    acres: '',
    plantingYear: '',
    tradeUnit: ''
  };

  editForm = {
    crop: '',
    category: '',
    type: '',
    description: '',
    acres: '',
    plantingYear: ''
  };

  originalEditForm = {
    crop: '',
    category: '',
    type: '',
    description: '',
    acres: '',
    plantingYear: ''
  };

  /** Unique category options for the selected crop — includes Category + unique Tier2/Tier3 values, no duplicates. */
  get categoryOptionsForCrop(): string[] {
    const crop = this.addForm.crop || this.editForm.crop;
    if (!crop) return [];
    const commodity = this.allCommodities.find(c => c.code === crop);
    if (!commodity) return [];
    // Collect unique values from category and tiers for this commodity's category group
    const sameCategory = this.allCommodities.filter(c => c.category === commodity.category);
    const options = new Set<string>();
    if (commodity.category) options.add(commodity.category);
    for (const c of sameCategory) {
      if (c.tier2) options.add(c.tier2);
      if (c.tier3) options.add(c.tier3);
    }
    return [...options].sort();
  }

  get sortedIntentions(): PlantingIntention[] {
    // Default sort: newest year first (descending by year)
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      return [...this.plantingIntentions()].sort((a, b) => b.plantingYear - a.plantingYear);
    }

    // Special case: When sorting by plantingYear, sort across all data (don't group by year)
    if (this.currentSortColumn === 'plantingYear') {
      return [...this.plantingIntentions()].sort((a, b) => {
        const comparison = a.plantingYear - b.plantingYear;
        return this.currentSortDirection === 'desc' ? -comparison : comparison;
      });
    }

    // For other columns: Group by year, sort within each year group, then flatten
    const groupedByYear = this.plantingIntentions().reduce((acc, intention) => {
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
          case 'createdAt':
            comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
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
    // Always show separator for the first item (acts as year selector)
    if (index === 0) {
      return true;
    }

    // Show separator when the year changes from the previous item
    const previousIntention = this.sortedIntentions[index - 1];
    return previousIntention.plantingYear !== intention.plantingYear;
  }

  toggleRow(id: number): void {
    if (this.expandedRows.has(id)) {
      this.expandedRows.delete(id);
    } else {
      this.expandedRows.add(id);
    }
  }

  isExpanded(id: number): boolean {
    return this.expandedRows.has(id);
  }

  // ── Commodity dropdown ───────────────────────────────────────────────────────

  private _loadCommodities(): void {
    if (this.allCommodities.length > 0 || this.isLoadingCommodities) return;
    this.isLoadingCommodities = true;
    this.apiService.getCommodities().subscribe({
      next: (commodities) => {
        this.allCommodities = commodities;
        this.isLoadingCommodities = false;
      },
      error: () => { this.isLoadingCommodities = false; }
    });
  }

  onAddCropChange(code: string): void {
    const commodity = this.availableCrops.find(c => c.code === code);
    const name = commodity?.name || '';
    this.addForm.description = [this.addForm.type, name].filter(Boolean).join(' ');
    // Auto-populate category from the commodity's category
    this.addForm.category = commodity?.category || '';
  }

  onAddTypeChange(): void {
    if (this.addForm.crop) {
      this.onAddCropChange(this.addForm.crop);
    }
  }

  onEditCropChange(code: string): void {
    const commodity = this.availableCrops.find(c => c.code === code);
    const name = commodity?.name || '';
    this.editForm.description = [this.editForm.type, name].filter(Boolean).join(' ');
    this.editForm.category = commodity?.category || '';
  }

  onEditTypeChange(): void {
    if (this.editForm.crop) {
      this.onEditCropChange(this.editForm.crop);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────

  openAddDialog(): void {
    const lastYear = new Date().getFullYear() - 1;

    this.addForm = {
      crop: '',
      category: '',
      type: '',
      description: '',
      acres: '',
      plantingYear: lastYear.toString(),
      tradeUnit: this.tradeUnits().length > 0 ? this.tradeUnits()[0] : ''
    };
    this._loadCommodities();
    this.showAddDialog = true;
    document.body.style.overflow = 'hidden';
  }

  closeAddDialog(): void {
    this.showAddDialog = false;
    document.body.style.overflow = '';
  }

  private _parseIntInput(value: string): number {
    return parseInt(value.replace(/[^0-9]/g, ''), 10);
  }

  isAddFormValid(): boolean {
    const acres = this._parseIntInput(this.addForm.acres);
    const year = this._parseIntInput(this.addForm.plantingYear);
    return this.addForm.crop !== ''
      && this.addForm.acres !== ''
      && !isNaN(acres) && acres > 0 && acres <= 100_000
      && this.addForm.plantingYear !== ''
      && !isNaN(year) && year >= 2020 && year <= 2100
      && this.addForm.tradeUnit !== '';
  }

  submitAdd(): void {
    if (this.isAddFormValid()) {
      const newAcres = this._parseIntInput(this.addForm.acres);
      const newYear = this._parseIntInput(this.addForm.plantingYear);
      const newType = this.addForm.type || undefined;
      const newCrop = this.addForm.crop;

      // If a row already exists for this type+crop+year, accumulate acres into it
      const existing = this.plantingIntentions().find(pi =>
        pi.crop === newCrop &&
        (pi.type || undefined) === newType &&
        pi.plantingYear === newYear
      );

      if (existing) {
        this.edit.emit({
          intentionId: existing.id,
          crop: existing.crop,
          category: this.addForm.category || undefined,
          type: existing.type || undefined,
          description: existing.description || undefined,
          acres: existing.acres + newAcres,
          plantingYear: existing.plantingYear
        });
      } else {
        this.add.emit({
          crop: newCrop,
          category: this.addForm.category || undefined,
          type: newType,
          description: this.addForm.description || undefined,
          acres: newAcres,
          plantingYear: newYear,
          tradeUnit: this.addForm.tradeUnit
        });
      }
      this.closeAddDialog();
    }
  }

  openEditDialog(intention: PlantingIntention): void {
    this.selectedIntention = intention;
    // Resolve category: use saved value if set, otherwise look up from Commodities table
    const commodity = this.allCommodities.find(c => c.code === intention.crop);
    const category = intention.category || commodity?.category || '';
    const formData = {
      crop: intention.crop,
      category,
      type: intention.type || '',
      description: intention.description || '',
      acres: intention.acres.toString(),
      plantingYear: intention.plantingYear.toString()
    };
    this.editForm = { ...formData };
    this.originalEditForm = { ...formData };
    this._loadCommodities();
    this.showEditDialog = true;
    document.body.style.overflow = 'hidden';
  }

  closeEditDialog(): void {
    this.showEditDialog = false;
    this.selectedIntention = null;
    document.body.style.overflow = '';
  }

  hasEditFormChanged(): boolean {
    return this.editForm.crop !== this.originalEditForm.crop
      || this.editForm.category !== this.originalEditForm.category
      || this.editForm.type !== this.originalEditForm.type
      || this.editForm.description !== this.originalEditForm.description
      || this.editForm.acres !== this.originalEditForm.acres
      || this.editForm.plantingYear !== this.originalEditForm.plantingYear;
  }

  isEditFormValid(): boolean {
    const acres = this._parseIntInput(this.editForm.acres);
    const year = this._parseIntInput(this.editForm.plantingYear);
    return this.editForm.crop !== ''
      && this.editForm.acres !== ''
      && !isNaN(acres) && acres > 0 && acres <= 100_000
      && this.editForm.plantingYear !== ''
      && !isNaN(year) && year >= 2020 && year <= 2100
      && this.hasEditFormChanged();
  }

  submitEdit(): void {
    if (this.isEditFormValid() && this.selectedIntention) {
      this.edit.emit({
        intentionId: this.selectedIntention.id,
        crop: this.editForm.crop,
        category: this.editForm.category || undefined,
        type: this.editForm.type || undefined,
        description: this.editForm.description || undefined,
        acres: this._parseIntInput(this.editForm.acres),
        plantingYear: this._parseIntInput(this.editForm.plantingYear)
      });
      this.closeEditDialog();
    }
  }

  openDeleteConfirm(): void {
    this.showDeleteConfirm = true;
    document.body.style.overflow = 'hidden';
  }

  closeDeleteConfirm(): void {
    this.showDeleteConfirm = false;
    document.body.style.overflow = '';
  }

  confirmDelete(): void {
    if (this.selectedIntention) {
      this.delete.emit(this.selectedIntention.id);
      this.closeDeleteConfirm();
      this.closeEditDialog();
    }
  }
}
