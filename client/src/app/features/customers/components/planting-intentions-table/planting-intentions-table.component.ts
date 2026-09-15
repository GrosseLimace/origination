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
import { ToastService } from '@core/services/toast.service';
import { AppStateService } from '@core/services/app-state.service';
import { scopeCommodities } from '@shared/utils/commodity-scope';
import { plantingCategory, commodityPlantingCategory } from '@shared/utils/planting-category';

type SortColumn = 'crop' | 'acres' | 'plantingYear' | 'createdAt';
type SortDirection = 'none' | 'asc' | 'desc';

/** A table row — a single planting intention. (Alias kept so existing bindings/signatures stay stable.) */
type PlantingRow = PlantingIntention;

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
  private toast = inject(ToastService);
  private appState = inject(AppStateService);

  public isLoading = input(false);
  public plantingIntentions = input<PlantingIntention[]>([]);
  public customer = input.required<Customer>();
  public tradeUnits = input<string[]>([]);
  public customerCommodityCodes = input<string[]>([]);
  public selectedYear = input<number>(0);
  public add = output<{crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}>();
  public edit = output<{intentionId: number, crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number}>();
  public delete = output<number>();
  public yearSelect = output<number>();

  allCommodities: Commodity[] = [];
  // Curated subset (ShowInPlantingIntentions) used ONLY for the crop dropdown suggestions.
  // Display/resolution still uses the full allCommodities list so existing intentions whose
  // crop isn't in the curated set keep showing their name/category.
  plantingCommodities: Commodity[] = [];
  isLoadingCommodities = false;
  // Separate flag for the curated list so it loads INDEPENDENTLY of the full list and is retried
  // on each dialog open until it succeeds. A one-time miss must not leave the crop search stuck
  // falling back to the full ~250-commodity list for the rest of the session.
  isLoadingPlantingCommodities = false;

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

  /** Crop label for the Edit/Delete dialogs — "[Type ]Category" (e.g. "Double Crop Corn"). */
  get editDialogCropLabel(): string {
    return `${this.editForm.type ? this.editForm.type + ' ' : ''}${this.cropCategoryFor(this.editForm.crop, this.editForm.category)}`;
  }

  constructor() {
    this._loadCommodities();

    this.destroyRef.onDestroy(() => {
      if (this.showDeleteConfirm || this.showEditDialog || this.showAddDialog) {
        document.body.style.overflow = '';
      }
    });
  }

  /** Crop label for a row or a form (crop code + its stored category) — the same resolution the
   *  dashboard uses, so a YSBO row reads "Organic Soybeans" here too. See plantingCategory(). */
  cropCategoryFor(cropCode: string, storedCategory?: string): string {
    const commodity = this.allCommodities.find(c => c.code === cropCode);
    return plantingCategory({ crop: cropCode, category: storedCategory }, commodity);
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
    return this._categoryOptionsFor(this.addForm.crop || this.editForm.crop);
  }

  /** Unique category options for a crop code — its planting label + Category + unique Tier2/Tier3
   *  in its group, no dups. The planting label is added explicitly because the tiers are only
   *  loaded in Dev, and it is the default the form auto-fills, so it must always be a valid option. */
  private _categoryOptionsFor(crop: string): string[] {
    if (!crop) return [];
    const commodity = this.allCommodities.find(c => c.code === crop);
    if (!commodity) return [];
    const sameCategory = this.allCommodities.filter(c => c.category === commodity.category);
    const options = new Set<string>();
    const planting = commodityPlantingCategory(commodity);
    if (planting) options.add(planting);
    if (commodity.category) options.add(commodity.category);
    for (const c of sameCategory) {
      if (c.tier2) options.add(c.tier2);
      if (c.tier3) options.add(c.tier3);
    }
    return [...options].sort();
  }

  /** Crop-column label for a row: "[Type ]Category" (e.g. "Double Crop Corn", "Irrigated Wheat"). */
  rowCropLabel(row: PlantingRow): string {
    return `${row.type ? row.type + ' ' : ''}${this.cropCategoryFor(row.crop, row.category)}`;
  }

  get sortedIntentions(): PlantingRow[] {
    const collapsed = this.plantingIntentions();

    // Default sort: newest year first (descending by year)
    if (!this.currentSortColumn || this.currentSortDirection === 'none') {
      return [...collapsed].sort((a, b) => b.plantingYear - a.plantingYear);
    }

    // Special case: When sorting by plantingYear, sort across all data (don't group by year)
    if (this.currentSortColumn === 'plantingYear') {
      return [...collapsed].sort((a, b) => {
        const comparison = a.plantingYear - b.plantingYear;
        return this.currentSortDirection === 'desc' ? -comparison : comparison;
      });
    }

    // For other columns: Group by year, sort within each year group, then flatten
    const groupedByYear = collapsed.reduce((acc, intention) => {
      if (!acc[intention.plantingYear]) {
        acc[intention.plantingYear] = [];
      }
      acc[intention.plantingYear].push(intention);
      return acc;
    }, {} as Record<number, PlantingRow[]>);

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
    // Full list — used for display/resolution everywhere in this component.
    if (this.allCommodities.length === 0 && !this.isLoadingCommodities) {
      this.isLoadingCommodities = true;
      this.apiService.getCommodities().subscribe({
        next: (commodities) => {
          this.allCommodities = commodities;
          this.isLoadingCommodities = false;
        },
        // Log so a failed full-list load (which breaks crop name/category resolution) is captured
        // rather than silently swallowed. Retried on the next dialog open.
        error: (e: Error) => {
          this.isLoadingCommodities = false;
          console.error('[PlantingIntentions] Failed to load commodity list', e);
        }
      });
    }
    // Curated subset — drives the crop-search suggestions. Loaded independently of the full list and
    // retried on each dialog open until it succeeds, so a transient miss doesn't leave the search
    // permanently falling back to the full commodity list (the bug fix). The _rankedCropMatches
    // fallback to allCommodities remains only as a last resort so the dropdown is never blank.
    if (this.plantingCommodities.length === 0 && !this.isLoadingPlantingCommodities) {
      this.isLoadingPlantingCommodities = true;
      this.apiService.getPlantingCommodities().subscribe({
        next: (commodities) => {
          this.plantingCommodities = commodities;
          this.isLoadingPlantingCommodities = false;
        },
        // Surface the failure: when the curated list doesn't load, the crop search silently falls
        // back to the full ~250-commodity list. Warn the user (and log) so this is visible instead
        // of looking like the filter "isn't working". Retried on the next dialog open.
        error: (e: Error) => {
          this.isLoadingPlantingCommodities = false;
          console.error('[PlantingIntentions] Failed to load curated planting crop list', e);
          this.toast.warning('Couldn\'t load the planting crop list — showing all commodities. Reopen to retry.');
        }
      });
    }
  }

  onAddCropChange(code: string): void {
    const commodity = this.allCommodities.find(c => c.code === code);
    const name = commodity?.name || '';
    this.addForm.description = [this.addForm.type, name].filter(Boolean).join(' ');
    // Auto-populate category from the commodity's planting label ("Organic Soybeans" for YSBO),
    // falling back to its broad category. The user can still override from the dropdown.
    this.addForm.category = commodityPlantingCategory(commodity) || '';
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
    // Re-derive the description from the (now-current) type + crop.
    if (this.addForm.crop) {
      this.onAddCropChange(this.addForm.crop);
    }
  }

  onEditCropChange(code: string): void {
    const commodity = this.allCommodities.find(c => c.code === code);
    const name = commodity?.name || '';
    this.editForm.description = [this.editForm.type, name].filter(Boolean).join(' ');
    this.editForm.category = commodityPlantingCategory(commodity) || '';
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

    // Suggest only the curated planting commodities; fall back to the full list if the
    // curated set hasn't loaded (e.g. transient error) so the dropdown is never blank.
    // Drop commodities scoped to a trade group the user isn't in (organics). Read fresh rather
    // than cached: these are plain fields, not signals, but this runs per keystroke so it always
    // reflects the current selection. The fallback is scoped too, so a transient curated-list
    // failure can't leak organics into a conventional picker.
    const inScope = { groupNames: this.appState.inScopeGroupNames(), tradeUnitCodes: this.appState.inScopeTradeUnitCodes() };
    const curated = scopeCommodities(this.plantingCommodities, inScope);
    const source = curated.length > 0 ? curated : scopeCommodities(this.allCommodities, inScope);
    const matches: { c: Commodity; rank: number }[] = [];
    for (const c of source) {
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

  /**
   * Emit one crop as either a new row (add) or an acre-accumulation onto an existing
   * matching row (edit) — "already exists → accumulate, else add".
   */
  private _emitCropForAdd(
    crop: string,
    category: string | undefined,
    description: string | undefined,
    acres: number,
    year: number,
    type: string | undefined,
    tradeUnit: string
  ): void {
    const existing = this.plantingIntentions().find(pi =>
      pi.crop === crop &&
      (pi.type || undefined) === type &&
      pi.plantingYear === year
    );

    if (existing) {
      this.edit.emit({
        intentionId: existing.id,
        crop: existing.crop,
        category,
        type: existing.type || undefined,
        description: existing.description || undefined,
        acres: existing.acres + acres,
        plantingYear: existing.plantingYear
      });
    } else {
      this.add.emit({ crop, category, type, description, acres, plantingYear: year, tradeUnit });
    }
  }

  submitAdd(): void {
    if (!this.isAddFormValid()) return;

    const newAcres = this._parseIntInput(this.addForm.acres);
    const newYear = this._parseIntInput(this.addForm.plantingYear);
    const newType = this.addForm.type || undefined;
    const tradeUnit = this.addForm.tradeUnit;

    this._emitCropForAdd(
      this.addForm.crop,
      this.addForm.category || undefined,
      this.addForm.description || undefined,
      newAcres, newYear, newType, tradeUnit
    );

    this.closeAddDialog();
  }

  openEditDialog(row: PlantingRow): void {
    this.selectedIntention = row;

    // Resolve category: use saved value if set, otherwise look up from Commodities table
    const commodity = this.allCommodities.find(c => c.code === row.crop);
    const category = row.category || commodity?.category || '';
    const formData = {
      crop: row.crop,
      category,
      type: row.type || '',
      description: row.description || '',
      acres: row.acres.toString(),
      plantingYear: row.plantingYear.toString()
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
    if (!this.isEditFormValid() || !this.selectedIntention) return;

    const acres = this._parseIntInput(this.editForm.acres);
    const year = this._parseIntInput(this.editForm.plantingYear);
    const type = this.editForm.type || undefined;

    this.edit.emit({
      intentionId: this.selectedIntention.id,
      crop: this.editForm.crop,
      category: this.editForm.category || undefined,
      type,
      description: this.editForm.description || undefined,
      acres, plantingYear: year
    });
    this.closeEditDialog();
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
    if (!this.selectedIntention) return;
    this.delete.emit(this.selectedIntention.id);
    this.closeDeleteConfirm();
    this.closeEditDialog();
  }
}
