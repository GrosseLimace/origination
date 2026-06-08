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

/**
 * A table row. Either a normal single-crop intention, or the collapsed view of a Double Crop
 * pair. Extends PlantingIntention so every existing template binding (.id, .acres, .plantingYear,
 * .createdAt, .tradeUnit, .type, .crop) keeps working off the representative (primary) member.
 * `doubleCropMembers` holds both underlying rows when this row is a collapsed pair.
 */
interface PlantingRow extends PlantingIntention {
  doubleCropMembers?: PlantingIntention[];
}

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
  public add = output<{crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string, doubleCropGroupId?: string}>();
  public edit = output<{intentionId: number, crop: string, category?: string, type?: string, description?: string, acres: number, plantingYear: number}>();
  public delete = output<number>();
  public yearSelect = output<number>();

  allCommodities: Commodity[] = [];
  // Curated subset (ShowInPlantingIntentions) used ONLY for the crop dropdown suggestions.
  // Display/resolution still uses the full allCommodities list so existing intentions whose
  // crop isn't in the curated set keep showing their name/category.
  plantingCommodities: Commodity[] = [];
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

  // Second-crop search state (Add dialog only, shown when type === 'Double Crop').
  secondCropSearchInput = '';
  filteredSecondCrops: Commodity[] = [];
  showSecondCropSuggestions = false;

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

  /** Display label for the currently-selected Double Crop second crop (Add dialog) */
  get secondSelectedCropDisplay(): string {
    const c = this.allCommodities.find(c => c.code === this.addForm.secondCrop);
    return c ? `${c.name} (${c.code})` : '';
  }

  /** Display label for the currently-selected Double Crop second crop (Edit dialog) */
  get editSecondSelectedCropDisplay(): string {
    const c = this.allCommodities.find(c => c.code === this.editForm.secondCrop);
    return c ? `${c.name} (${c.code})` : '';
  }

  /** True when the Edit dialog is editing a Double Crop pair. */
  get isEditDoubleCrop(): boolean {
    return this.editGroupMemberIds.length > 1;
  }

  /** Crop label for the Edit/Delete dialogs ("Double Crop Corn/Wheat" or "[Type ]Category"). */
  get editDialogCropLabel(): string {
    if (this.isEditDoubleCrop) {
      const a = this.allCommodities.find(c => c.code === this.editForm.crop);
      const b = this.allCommodities.find(c => c.code === this.editForm.secondCrop);
      const an = a?.category || this.getCropCategory(this.editForm.crop);
      const bn = b?.category || this.getCropCategory(this.editForm.secondCrop);
      return `Double Crop ${an}/${bn}`;
    }
    return `${this.editForm.type ? this.editForm.type + ' ' : ''}${this.getCropCategory(this.editForm.crop)}`;
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
    tradeUnit: '',
    // Second crop for a "Double Crop" intention (producer plants this crop on the same
    // ground, same year, right after the primary crop). Only used when type === 'Double Crop';
    // on save it becomes its own planting-intention row sharing acres/year/trade unit.
    secondCrop: '',
    secondCategory: ''
  };

  editForm = {
    crop: '',
    category: '',
    type: '',
    description: '',
    acres: '',
    plantingYear: '',
    // Second crop when editing a Double Crop pair (shares acres/year with the primary).
    secondCrop: '',
    secondCategory: ''
  };

  originalEditForm = {
    crop: '',
    category: '',
    type: '',
    description: '',
    acres: '',
    plantingYear: '',
    secondCrop: '',
    secondCategory: ''
  };

  // When editing a collapsed Double Crop pair, the two underlying row ids (primary, second).
  // Empty for a normal single-row edit. Drives submitEdit/confirmDelete to act on both rows.
  editGroupMemberIds: number[] = [];

  // Edit-dialog second-crop search state (shown when editing a Double Crop pair).
  editSecondCropSearchInput = '';
  filteredEditSecondCrops: Commodity[] = [];
  showEditSecondCropSuggestions = false;

  /** Unique category options for the selected crop — includes Category + unique Tier2/Tier3 values, no duplicates. */
  get categoryOptionsForCrop(): string[] {
    return this._categoryOptionsFor(this.addForm.crop || this.editForm.crop);
  }

  /** Category options for the Double Crop second crop (Add + Edit dialogs). */
  get categoryOptionsForSecondCrop(): string[] {
    return this._categoryOptionsFor(this.addForm.secondCrop || this.editForm.secondCrop);
  }

  /** Unique category options for a crop code — Category + unique Tier2/Tier3 in its group, no dups. */
  private _categoryOptionsFor(crop: string): string[] {
    if (!crop) return [];
    const commodity = this.allCommodities.find(c => c.code === crop);
    if (!commodity) return [];
    const sameCategory = this.allCommodities.filter(c => c.category === commodity.category);
    const options = new Set<string>();
    if (commodity.category) options.add(commodity.category);
    for (const c of sameCategory) {
      if (c.tier2) options.add(c.tier2);
      if (c.tier3) options.add(c.tier3);
    }
    return [...options].sort();
  }

  /**
   * Collapse Double Crop pairs (rows sharing a doubleCropGroupId) into a single representative
   * row carrying both members, so the table shows one "Double Crop Corn/Wheat" line. Single-crop
   * rows pass through untouched. A group that somehow has only one member (lost its partner) is
   * shown as a normal row so nothing ever disappears.
   */
  private _collapseDoubleCrops(rows: PlantingIntention[]): PlantingRow[] {
    const out: PlantingRow[] = [];
    const groups = new Map<string, PlantingIntention[]>();
    for (const r of rows) {
      if (r.doubleCropGroupId) {
        const arr = groups.get(r.doubleCropGroupId) ?? [];
        arr.push(r);
        groups.set(r.doubleCropGroupId, arr);
      } else {
        out.push(r);
      }
    }
    for (const members of groups.values()) {
      if (members.length === 1) {
        out.push(members[0]);
      } else {
        // Representative = earliest-created member (stable primary crop ordering).
        const ordered = [...members].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        out.push({ ...ordered[0], doubleCropMembers: ordered });
      }
    }
    return out;
  }

  /** Crop-column label for a row: "Double Crop Corn/Wheat" for a pair, else "[Type ]Category". */
  rowCropLabel(row: PlantingRow): string {
    if (row.doubleCropMembers && row.doubleCropMembers.length > 1) {
      const crops = row.doubleCropMembers.map(m => this.getCropCategory(m.crop)).join('/');
      return `Double Crop ${crops}`;
    }
    return `${row.type ? row.type + ' ' : ''}${this.getCropCategory(row.crop)}`;
  }

  get sortedIntentions(): PlantingRow[] {
    // Collapse Double Crop pairs first so they sort/display as a single line.
    const collapsed = this._collapseDoubleCrops(this.plantingIntentions());

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
    if (this.allCommodities.length > 0 || this.isLoadingCommodities) return;
    this.isLoadingCommodities = true;
    // Full list — used for display/resolution everywhere in this component.
    this.apiService.getCommodities().subscribe({
      next: (commodities) => {
        this.allCommodities = commodities;
        this.isLoadingCommodities = false;
      },
      error: () => { this.isLoadingCommodities = false; }
    });
    // Curated subset — used only for the crop dropdown suggestions.
    this.apiService.getPlantingCommodities().subscribe({
      next: (commodities) => { this.plantingCommodities = commodities; },
      error: () => { this.plantingCommodities = []; }
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
    // "Double Crop" reveals the second-crop picker; switching away from it clears any
    // second crop so we don't accidentally create a phantom second row.
    if (this.addForm.type !== 'Double Crop') {
      this.clearSecondCrop();
    }
    if (this.addForm.crop) {
      this.onAddCropChange(this.addForm.crop);
    }
  }

  // ── Second-crop (Double Crop) search-and-select handlers ─────────────────
  onSecondCropSearch(): void {
    this.filteredSecondCrops = this._rankedCropMatches(this.secondCropSearchInput);
    this.showSecondCropSuggestions = true;
  }

  selectSecondCrop(commodity: Commodity): void {
    this.addForm.secondCrop = commodity.code;
    this.addForm.secondCategory = commodity.category || '';
    this.secondCropSearchInput = '';
    this.filteredSecondCrops = [];
    this.showSecondCropSuggestions = false;
  }

  selectFirstSecondCropSuggestion(): void {
    if (this.filteredSecondCrops.length > 0) {
      this.selectSecondCrop(this.filteredSecondCrops[0]);
    }
  }

  clearSecondCrop(): void {
    this.addForm.secondCrop = '';
    this.addForm.secondCategory = '';
    this.secondCropSearchInput = '';
    this.filteredSecondCrops = [];
    this.showSecondCropSuggestions = false;
  }

  hideSecondCropSuggestionsDelayed(): void {
    setTimeout(() => { this.showSecondCropSuggestions = false; }, 150);
  }

  // ── Edit-dialog second-crop (Double Crop) search-and-select handlers ─────
  onEditSecondCropSearch(): void {
    this.filteredEditSecondCrops = this._rankedCropMatches(this.editSecondCropSearchInput);
    this.showEditSecondCropSuggestions = true;
  }

  selectEditSecondCrop(commodity: Commodity): void {
    this.editForm.secondCrop = commodity.code;
    this.editForm.secondCategory = commodity.category || '';
    this.editSecondCropSearchInput = '';
    this.filteredEditSecondCrops = [];
    this.showEditSecondCropSuggestions = false;
  }

  selectFirstEditSecondCropSuggestion(): void {
    if (this.filteredEditSecondCrops.length > 0) {
      this.selectEditSecondCrop(this.filteredEditSecondCrops[0]);
    }
  }

  clearEditSecondCrop(): void {
    this.editForm.secondCrop = '';
    this.editForm.secondCategory = '';
    this.editSecondCropSearchInput = '';
    this.filteredEditSecondCrops = [];
    this.showEditSecondCropSuggestions = false;
  }

  hideEditSecondCropSuggestionsDelayed(): void {
    setTimeout(() => { this.showEditSecondCropSuggestions = false; }, 150);
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

    // Suggest only the curated planting commodities; fall back to the full list if the
    // curated set hasn't loaded (e.g. transient error) so the dropdown is never blank.
    const source = this.plantingCommodities.length > 0 ? this.plantingCommodities : this.allCommodities;
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
      tradeUnit: this.tradeUnits().length > 0 ? this.tradeUnits()[0] : '',
      secondCrop: '',
      secondCategory: ''
    };
    this.addCropSearchInput = '';
    this.filteredAddCrops = [];
    this.showAddCropSuggestions = false;
    this.secondCropSearchInput = '';
    this.filteredSecondCrops = [];
    this.showSecondCropSuggestions = false;
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

  /** True when the Add form is a Double Crop intention (needs a distinct second crop). */
  get isAddDoubleCrop(): boolean {
    return this.addForm.type === 'Double Crop';
  }

  isAddFormValid(): boolean {
    const acres = this._parseIntInput(this.addForm.acres);
    const year = this._parseIntInput(this.addForm.plantingYear);
    // Double Crop additionally requires a second crop that differs from the primary
    // (two rows with the same crop+type+year would just collide/accumulate).
    const doubleCropValid = !this.isAddDoubleCrop
      || (this.addForm.secondCrop !== '' && this.addForm.secondCrop !== this.addForm.crop);
    return this.addForm.crop !== ''
      && this.addForm.acres !== ''
      && !isNaN(acres) && acres > 0 && acres <= 100_000
      && this.addForm.plantingYear !== ''
      && !isNaN(year) && year >= 2020 && year <= 2100
      && this.addForm.tradeUnit !== ''
      && doubleCropValid;
  }

  /**
   * Emit one crop as either a new row (add) or an acre-accumulation onto an existing
   * matching row (edit). Shared by the primary crop and the Double Crop second crop so
   * both follow the identical "already exists → accumulate, else add" rule.
   */
  private _emitCropForAdd(
    crop: string,
    category: string | undefined,
    description: string | undefined,
    acres: number,
    year: number,
    type: string | undefined,
    tradeUnit: string,
    doubleCropGroupId?: string
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
      this.add.emit({ crop, category, type, description, acres, plantingYear: year, tradeUnit, doubleCropGroupId });
    }
  }

  submitAdd(): void {
    if (!this.isAddFormValid()) return;

    const newAcres = this._parseIntInput(this.addForm.acres);
    const newYear = this._parseIntInput(this.addForm.plantingYear);
    const newType = this.addForm.type || undefined;
    const tradeUnit = this.addForm.tradeUnit;
    const isDouble = this.isAddDoubleCrop && !!this.addForm.secondCrop && this.addForm.secondCrop !== this.addForm.crop;
    // One shared GUID links the two Double Crop rows so the table can collapse them into a
    // single line and edit/delete them as a unit. Undefined for a normal single-crop intention.
    const groupId = isDouble ? crypto.randomUUID() : undefined;

    // Primary crop.
    this._emitCropForAdd(
      this.addForm.crop,
      this.addForm.category || undefined,
      this.addForm.description || undefined,
      newAcres, newYear, newType, tradeUnit, groupId
    );

    // Double Crop: the second crop becomes its own row sharing the same acres / year /
    // trade unit / type / group id. Category + description are derived from the second crop's
    // commodity (the form's category/description describe the primary crop).
    if (isDouble) {
      const second = this.allCommodities.find(c => c.code === this.addForm.secondCrop);
      const secondCategory = this.addForm.secondCategory || second?.category || undefined;
      const secondDescription = [newType, second?.name].filter(Boolean).join(' ') || undefined;
      this._emitCropForAdd(
        this.addForm.secondCrop,
        secondCategory,
        secondDescription,
        newAcres, newYear, newType, tradeUnit, groupId
      );
    }

    this.closeAddDialog();
  }

  openEditDialog(row: PlantingRow): void {
    // For a collapsed Double Crop pair, edit both members together: primary crop, second
    // crop, and the shared acreage/year. Otherwise edit the single row as before.
    const members = row.doubleCropMembers && row.doubleCropMembers.length > 1 ? row.doubleCropMembers : null;
    const primary = members ? members[0] : row;
    this.selectedIntention = primary;
    this.editGroupMemberIds = members ? members.map(m => m.id) : [];

    // Resolve category: use saved value if set, otherwise look up from Commodities table
    const commodity = this.allCommodities.find(c => c.code === primary.crop);
    const category = primary.category || commodity?.category || '';
    const formData = {
      crop: primary.crop,
      category,
      type: primary.type || '',
      description: primary.description || '',
      acres: primary.acres.toString(),
      plantingYear: primary.plantingYear.toString(),
      secondCrop: members ? members[1].crop : '',
      secondCategory: members ? (members[1].category || this.allCommodities.find(c => c.code === members[1].crop)?.category || '') : ''
    };
    this.editForm = { ...formData };
    this.originalEditForm = { ...formData };
    this.editCropSearchInput = '';
    this.filteredEditCrops = [];
    this.showEditCropSuggestions = false;
    this.editSecondCropSearchInput = '';
    this.filteredEditSecondCrops = [];
    this.showEditSecondCropSuggestions = false;
    this._loadCommodities();
    this.showEditDialog = true;
    document.body.style.overflow = 'hidden';
  }

  closeEditDialog(): void {
    this.showEditDialog = false;
    this.selectedIntention = null;
    this.editGroupMemberIds = [];
    document.body.style.overflow = '';
  }

  hasEditFormChanged(): boolean {
    return this.editForm.crop !== this.originalEditForm.crop
      || this.editForm.category !== this.originalEditForm.category
      || this.editForm.type !== this.originalEditForm.type
      || this.editForm.description !== this.originalEditForm.description
      || this.editForm.acres !== this.originalEditForm.acres
      || this.editForm.plantingYear !== this.originalEditForm.plantingYear
      || this.editForm.secondCrop !== this.originalEditForm.secondCrop
      || this.editForm.secondCategory !== this.originalEditForm.secondCategory;
  }

  isEditFormValid(): boolean {
    const acres = this._parseIntInput(this.editForm.acres);
    const year = this._parseIntInput(this.editForm.plantingYear);
    // Editing a Double Crop pair requires a second crop that differs from the primary.
    const doubleCropValid = !this.isEditDoubleCrop
      || (this.editForm.secondCrop !== '' && this.editForm.secondCrop !== this.editForm.crop);
    return this.editForm.crop !== ''
      && this.editForm.acres !== ''
      && !isNaN(acres) && acres > 0 && acres <= 100_000
      && this.editForm.plantingYear !== ''
      && !isNaN(year) && year >= 2020 && year <= 2100
      && doubleCropValid
      && this.hasEditFormChanged();
  }

  submitEdit(): void {
    if (!this.isEditFormValid() || !this.selectedIntention) return;

    const acres = this._parseIntInput(this.editForm.acres);
    const year = this._parseIntInput(this.editForm.plantingYear);
    const type = this.editForm.type || undefined;

    if (this.isEditDoubleCrop) {
      // Update BOTH rows of the pair, sharing acres / year / type. Each row's category +
      // description are derived from its own crop so they stay correct if a crop was changed.
      const [primaryId, secondId] = this.editGroupMemberIds;
      const primaryCommodity = this.allCommodities.find(c => c.code === this.editForm.crop);
      const secondCommodity = this.allCommodities.find(c => c.code === this.editForm.secondCrop);
      this.edit.emit({
        intentionId: primaryId,
        crop: this.editForm.crop,
        category: this.editForm.category || primaryCommodity?.category || undefined,
        type,
        description: [type, primaryCommodity?.name].filter(Boolean).join(' ') || undefined,
        acres, plantingYear: year
      });
      this.edit.emit({
        intentionId: secondId,
        crop: this.editForm.secondCrop,
        category: this.editForm.secondCategory || secondCommodity?.category || undefined,
        type,
        description: [type, secondCommodity?.name].filter(Boolean).join(' ') || undefined,
        acres, plantingYear: year
      });
    } else {
      this.edit.emit({
        intentionId: this.selectedIntention.id,
        crop: this.editForm.crop,
        category: this.editForm.category || undefined,
        type,
        description: this.editForm.description || undefined,
        acres, plantingYear: year
      });
    }
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
    // For a Double Crop pair, delete BOTH rows; otherwise just the selected one.
    // Capture ids before closeEditDialog() clears editGroupMemberIds.
    const ids = this.isEditDoubleCrop
      ? [...this.editGroupMemberIds]
      : (this.selectedIntention ? [this.selectedIntention.id] : []);
    if (ids.length === 0) return;
    for (const id of ids) {
      this.delete.emit(id);
    }
    this.closeDeleteConfirm();
    this.closeEditDialog();
  }
}
