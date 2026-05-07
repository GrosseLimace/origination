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

  // ── Crop search-and-select state (Add + Edit dialogs) ─────────────────────
  // Mirrors the pattern in edit-customer-dialog: user types into a search box,
  // commodities table is filtered into a dropdown of suggestions, picking one
  // sets the form's `crop` field. The producer is no longer limited to crops
  // already on their producer-details — anything in the commodities table is
  // selectable, and the parent auto-syncs the new crop into producer-details
  // on save.
  addCropSearchInput = '';
  filteredAddCrops: Commodity[] = [];
  showAddCropSuggestions = false;

  editCropSearchInput = '';
  filteredEditCrops: Commodity[] = [];
  showEditCropSuggestions = false;

  private readonly _commodityAliases: Record<string, string[]> = {
    'milo':    ['milo', 'sorghum', 'sor', 'sg'],
    'sorghum': ['milo', 'sorghum', 'sor', 'sg'],
    'beans':   ['soybeans', 'soy', 'beans', 'sb'],
    'soy':     ['soybeans', 'soy', 'beans', 'sb'],
  };

  /** Display label for the currently-selected Add crop ("Yellow Corn (YC)") */
  get addSelectedCropDisplay(): string {
    const c = this.allCommodities.find(c => c.code === this.addForm.crop);
    return c ? `${c.name} (${c.code})` : '';
  }

  /** Display label for the currently-selected Edit crop */
  get editSelectedCropDisplay(): string {
    const c = this.allCommodities.find(c => c.code === this.editForm.crop);
    return c ? `${c.name} (${c.code})` : '';
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
    const commodity = this.allCommodities.find(c => c.code === code);
    const name = commodity?.name || '';
    this.addForm.description = [this.addForm.type, name].filter(Boolean).join(' ');
    // Auto-populate category from the commodity's category
    this.addForm.category = commodity?.category || '';
  }

  // ── Add Crop search-and-select handlers ──────────────────────────────────
  onAddCropSearch(): void {
    this.filteredAddCrops = this._rankedCropMatches(this.addCropSearchInput);
    this.showAddCropSuggestions = true;
  }

  selectAddCrop(commodity: Commodity): void {
    this.addForm.crop = commodity.code;
    this.addCropSearchInput = '';
    this.filteredAddCrops = [];
    this.showAddCropSuggestions = false;
    this.onAddCropChange(commodity.code);
  }

  selectFirstAddCropSuggestion(): void {
    if (this.filteredAddCrops.length > 0) {
      this.selectAddCrop(this.filteredAddCrops[0]);
    }
  }

  clearAddCrop(): void {
    this.addForm.crop = '';
    this.addForm.category = '';
    this.addCropSearchInput = '';
    this.filteredAddCrops = [];
    this.showAddCropSuggestions = false;
  }

  hideAddCropSuggestionsDelayed(): void {
    setTimeout(() => { this.showAddCropSuggestions = false; }, 150);
  }

  onAddTypeChange(): void {
    if (this.addForm.crop) {
      this.onAddCropChange(this.addForm.crop);
    }
  }

  onEditCropChange(code: string): void {
    const commodity = this.allCommodities.find(c => c.code === code);
    const name = commodity?.name || '';
    this.editForm.description = [this.editForm.type, name].filter(Boolean).join(' ');
    this.editForm.category = commodity?.category || '';
  }

  // ── Edit Crop search-and-select handlers ─────────────────────────────────
  onEditCropSearch(): void {
    this.filteredEditCrops = this._rankedCropMatches(this.editCropSearchInput);
    this.showEditCropSuggestions = true;
  }

  /**
   * Filter + rank commodities for the crop search dropdown. Result is sorted so
   * that **code matches sort above name matches**, with this priority ladder:
   *   0 — exact code match  (typing "YC" → Yellow Corn (YC) tops the list)
   *   1 — code starts with the term
   *   2 — code contains the term
   *   3 — name starts with the term
   *   4 — name contains the term
   * Within a tier rows are alphabetised by name. Aliases ("milo", "beans", etc.)
   * expand into multiple search terms — we take the BEST rank across them.
   */
  private _rankedCropMatches(input: string): Commodity[] {
    const term = input.trim().toLowerCase();
    if (!term) return [];
    const searchTerms = this._commodityAliases[term] ?? [term];

    const matches: { c: Commodity; rank: number }[] = [];
    for (const c of this.allCommodities) {
      const name = c.name.toLowerCase();
      const code = c.code.toLowerCase();
      let best = Number.POSITIVE_INFINITY;
      for (const t of searchTerms) {
        if (code === t) best = Math.min(best, 0);
        else if (code.startsWith(t)) best = Math.min(best, 1);
        else if (code.includes(t)) best = Math.min(best, 2);
        else if (name.startsWith(t)) best = Math.min(best, 3);
        else if (name.includes(t)) best = Math.min(best, 4);
      }
      if (best < Number.POSITIVE_INFINITY) matches.push({ c, rank: best });
    }
    matches.sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name));
    return matches.map(m => m.c);
  }

  selectEditCrop(commodity: Commodity): void {
    this.editForm.crop = commodity.code;
    this.editCropSearchInput = '';
    this.filteredEditCrops = [];
    this.showEditCropSuggestions = false;
    this.onEditCropChange(commodity.code);
  }

  selectFirstEditCropSuggestion(): void {
    if (this.filteredEditCrops.length > 0) {
      this.selectEditCrop(this.filteredEditCrops[0]);
    }
  }

  clearEditCrop(): void {
    this.editForm.crop = '';
    this.editForm.category = '';
    this.editCropSearchInput = '';
    this.filteredEditCrops = [];
    this.showEditCropSuggestions = false;
  }

  hideEditCropSuggestionsDelayed(): void {
    setTimeout(() => { this.showEditCropSuggestions = false; }, 150);
  }

  onEditTypeChange(): void {
    if (this.editForm.crop) {
      this.onEditCropChange(this.editForm.crop);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────

  openAddDialog(): void {
    const currentYear = new Date().getFullYear();

    this.addForm = {
      crop: '',
      category: '',
      type: '',
      description: '',
      acres: '',
      plantingYear: currentYear.toString(),
      tradeUnit: this.tradeUnits().length > 0 ? this.tradeUnits()[0] : ''
    };
    this.addCropSearchInput = '';
    this.filteredAddCrops = [];
    this.showAddCropSuggestions = false;
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
    this.editCropSearchInput = '';
    this.filteredEditCrops = [];
    this.showEditCropSuggestions = false;
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
