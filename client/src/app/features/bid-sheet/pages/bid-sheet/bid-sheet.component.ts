import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, computed, viewChild, ElementRef, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, map, Subject, switchMap } from 'rxjs';
import { CdkDragDrop, CdkDrag, CdkDropList, CdkDragHandle, moveItemInArray } from '@angular/cdk/drag-drop';
import type * as Leaflet from 'leaflet';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { BidSheetEntry, BidSheetLocation, BidSheetLocationBid, Elevator, Commodity } from '@models';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';

interface EditBidsRow {
  name: string;
  type: 'elevator' | 'entry';
  elevatorCode?: string;
  tradeUnitCode?: string;
  latitude?: number;
  longitude?: number;
  bids: Record<string, string>;
  originalBids: Record<string, string>;
}

/** Status for a bid value vs the session reference. */
type BidStatus = 'reference' | 'beating' | 'matching' | 'none';

/** Row in the panel list view (`filteredBidItems`). */
interface BidSheetPanelItem {
  type: 'entry';
  name: string;
  isScoular: boolean;
  isRef: boolean;
  latitude: number | null;
  longitude: number | null;
  oldBid: string;
  newBid: string;
  oldStatus?: BidStatus;
  newStatus?: BidStatus;
  status: BidStatus;
}

/** Width threshold (px) below which the filter bar wraps the search/clear group to a centered second row. */
const FILTER_BAR_WRAP_WIDTH = 1050;

@Component({
  selector: 'app-bid-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule, TradeUnitSelectorComponent, CdkDropList, CdkDrag, CdkDragHandle],
  templateUrl: './bid-sheet.component.html',
  styleUrl: './bid-sheet.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BidSheetComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly usageTracking = inject(UsageTrackingService);

  // --- Filters ---
  /** True when any TUs are active — either via individual checkboxes or group selection. Enables bid values, statuses, and reference features. */
  readonly hasIndividualTu = computed(() => this.activeTradeUnits().length > 0);
  selectedYear = signal<number>(new Date().getFullYear());
  selectedCrop = signal<string>('');
  searchQuery = signal<string>('');
  selectedBasis = signal<string>('all');
  selectedMonth = signal<number>(0); // 0=yearly, 1-12=monthly

  // --- Data ---
  allElevators = signal<Elevator[]>([]);           // ALL elevators from ODS (loaded once)
  tradeUnitElevators = signal<Elevator[]>([]);     // Filtered to selected trade unit
  allMapLocations = signal<BidSheetLocation[]>([]); // ALL locations across all TUs (for map)
  bidLocations = signal<BidSheetLocation[]>([]);
  /** Flattened view of locations — uses TU-filtered bidLocations when a TU is active, otherwise allMapLocations. */
  readonly bidEntries = computed<BidSheetEntry[]>(() => {
    const source = this.activeTradeUnits().length > 0 ? this.bidLocations() : this.allMapLocations();
    return source.flatMap(loc =>
      (loc.bids ?? []).map(bid => ({
        id: bid.id,
        locationId: loc.id,
        name: loc.name,
        address: loc.address,
        city: loc.city,
        state: loc.state,
        latitude: loc.latitude,
        longitude: loc.longitude,
        elevatorCode: loc.elevatorCode,
        tradeUnitCode: loc.tradeUnitCode,
        groupName: loc.groupName,
        commodityCode: bid.commodityCode,
        commodityName: bid.commodityName,
        commodityCategory: bid.commodityCategory,
        cropYear: bid.cropYear,
        month: bid.month,
        bid: bid.bid,
        createdBy: bid.createdBy,
        createdAt: bid.createdAt,
        modifiedBy: bid.modifiedBy,
        modifiedAt: bid.modifiedAt
      }))
    );
  });
  /** Pre-computed lookup: "name|commodityCode|cropYear|month" → latest BidSheetEntry (by modifiedAt then createdAt). O(1) lookups instead of repeated filter+sort. */
  private readonly bidLookup = computed(() => {
    const lookup = new Map<string, BidSheetEntry>();
    for (const e of this.bidEntries()) {
      const key = `${e.name}|${e.commodityCode}|${e.cropYear}|${e.month}`;
      const existing = lookup.get(key);
      if (!existing || new Date(e.modifiedAt || e.createdAt).getTime() > new Date(existing.modifiedAt || existing.createdAt).getTime()) {
        lookup.set(key, e);
      }
    }
    return lookup;
  });
  cropYears = signal<number[]>([]);
  crops = signal<string[]>([]);
  isLoading = signal<boolean>(false);
  isRefreshing = signal<boolean>(false);

  // --- Old/New year logic (data-driven, navigable) ---
  // yearOffset 0 = latest two years, -1 = shift one year earlier, etc.
  yearOffset = signal(0);
  oldYear = computed(() => {
    const years = this.cropYears();
    if (years.length < 2) return null;
    const idx = years.length - 2 + this.yearOffset();
    return idx >= 0 && idx < years.length ? years[idx] : null;
  });
  newYear = computed(() => {
    const years = this.cropYears();
    if (years.length < 1) return null;
    const idx = years.length - 1 + this.yearOffset();
    return idx >= 0 && idx < years.length ? years[idx] : null;
  });
  canShiftYearsBack = computed(() => {
    if (this.selectedMonth() > 0) return true; // monthly mode always allows shift back
    const years = this.cropYears();
    return years.length >= 2 && (years.length - 2 + this.yearOffset()) > 0;
  });
  canShiftYearsForward = computed(() => {
    if (this.selectedMonth() > 0) return true; // monthly mode always allows shift forward
    return this.yearOffset() < 0;
  });

  // --- Old/New (month, year) pair for the panel comparison columns ---
  // Yearly mode: returns just years (month=0).
  // Monthly mode: returns the previous month vs selected month, rolling years over at January.
  newDisplay = computed(() => ({ month: this.selectedMonth(), year: this.selectedYear() }));
  oldDisplay = computed(() => {
    const month = this.selectedMonth();
    const year = this.selectedYear();
    if (month === 0) {
      // Yearly mode — old year column (one less than new)
      return { month: 0, year: this.oldYear() ?? year - 1 };
    }
    // Monthly mode — previous month, rolling year at January
    if (month === 1) return { month: 12, year: year - 1 };
    return { month: month - 1, year };
  });
  /** Returns "Mar 26" / "Apr 26" / "2025" / "2026" depending on month context. */
  formatMonthYear(month: number, year: number | null): string {
    if (year == null) return '';
    if (month === 0) return year.toString();
    const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[month]} ${year.toString().slice(-2)}`;
  }

  // --- Location order (per trade unit, persisted to DB) ---
  private locationOrderByTu = signal<Map<string, string[]>>(new Map());
  // --- Crop column order (per trade unit, persisted in BidSheetPreferences.CropOrder) ---
  private cropOrderByTu = signal<Map<string, string[]>>(new Map());

  // --- Panel ---
  showPanel = signal<boolean>(false);
  showLegend = signal<boolean>(true);
  showFilters = signal<boolean>(true);
  /** True when the filter bar container is narrow enough that search/clear should wrap to a centered second row. */
  filterBarNarrow = signal<boolean>(false);
  private _filterBarObserver: ResizeObserver | null = null;
  /** Reference to the filter bar div so we can observe its width with ResizeObserver. */
  private filterBarRef = viewChild<ElementRef<HTMLElement>>('filterBar');
  /** Reference to the map container div for Leaflet initialization (replaces document.getElementById). */
  private mapElRef = viewChild<ElementRef<HTMLElement>>('mapEl');
  filteredBidItems = signal<BidSheetPanelItem[]>([]);
  selectedLocationName = signal<string>('');
  panelSelectedLocation = signal<string>('');
  showDeleteLocationConfirm = signal(false);
  deleteMode = signal(false);
  showDeleteCropConfirm = signal(false);
  pendingDeleteCrop = signal<string>('');
  editingLocationName = signal(false);
  editLocationNameValue = signal('');

  /** All crop/bid rows for the location selected in the panel */
  readonly panelLocationBids = computed(() => {
    const name = this.panelSelectedLocation();
    if (!name) return [];
    const oldD = this.oldDisplay();
    const newD = this.newDisplay();
    const entries = this.bidEntries().filter(e => e.name === name);
    let cropSet = [...new Set(entries.map(e => e.commodityCode).filter(Boolean))].sort();
    // Only show crops that have bids for the displayed old/new periods
    cropSet = cropSet.filter(crop =>
      this._getLatestBid(name, newD.year, crop!, newD.month) ||
      this._getLatestBid(name, oldD.year, crop!, oldD.month));

    // Reference comparison — color-code each crop row vs the session reference (selectedLocationName)
    const refName = this.selectedLocationName();
    const isRef = refName === name;

    return cropSet.map(crop => {
      const oldBid = this._getLatestBid(name, oldD.year, crop!, oldD.month);
      const newBid = this._getLatestBid(name, newD.year, crop!, newD.month);
      // Get reference bid for this crop (if any). If reference doesn't have this crop → leave white (status 'none').
      const oldRefBid = refName && !isRef ? this._parseBid(this._getLatestBid(refName, oldD.year, crop!, oldD.month)) : null;
      const newRefBid = refName && !isRef ? this._parseBid(this._getLatestBid(refName, newD.year, crop!, newD.month)) : null;
      const oldStatus = isRef ? 'reference' : this._computeItemStatus(oldBid, false, oldRefBid);
      const newStatus = isRef ? 'reference' : this._computeItemStatus(newBid, false, newRefBid);
      return { crop: crop!, oldBid, newBid, oldStatus, newStatus };
    });
  });

  // --- Edit Bids ---
  editBidsMode = signal(false);
  showAddCommoditySearch = signal(false);
  addCommodityQuery = signal('');
  editBidsYear = signal<number>(new Date().getFullYear());
  editBidsMonths = signal<number[]>([0]); // [0]=yearly, [4,5,6]=Apr+May+Jun
  showMonthDropdown = signal(false);
  /** Crop code currently being dragged (for group highlight). Empty when not dragging. */
  draggingCrop = signal<string>('');
  /** Pending month selection (staged until user clicks Done). */
  pendingMonths = signal<number[]>([0]);
  /** Pending hidden crop selection (staged until user clicks Done). */
  pendingHiddenCrops = signal<Set<string>>(new Set());
  editBidsRows = signal<EditBidsRow[]>([]);
  /** Set of crop codes hidden by the user via the multi-select crop dropdown. Empty = all visible. */
  hiddenCrops = signal<Set<string>>(new Set());
  showCropDropdown = signal(false);
  editBidsSaving = signal(false);
  editBidsGridLoading = signal(false);

  readonly editBidsCrops = computed(() => {
    const hidden = this.hiddenCrops();
    let result = [...this.crops()].filter(c => !hidden.has(c));
    // Apply saved crop column order (unknown crops go to end)
    const savedOrder = this.cropOrderByTu().get(this.activeTradeUnitKey());
    if (savedOrder && savedOrder.length > 0) {
      const orderMap = new Map(savedOrder.map((code, idx) => [code, idx]));
      result.sort((a, b) => {
        const ai = orderMap.get(a) ?? Number.MAX_SAFE_INTEGER;
        const bi = orderMap.get(b) ?? Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
    }
    return result;
  });

  /** Month name abbreviations for column labels. */
  private static readonly MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** Grid column definitions: in yearly mode columns = crops, in monthly mode columns = crop x month pairs. */
  readonly editGridColumns = computed(() => {
    const months = this.editBidsMonths();
    const crops = this.editBidsCrops();
    const year = this.editBidsYear();
    // Cross-product of crops × selected months. Yearly (0) goes LAST (after specific months).
    const sortedMonths = [...months].sort((a, b) => {
      if (a === 0) return 1;  // yearly goes to end
      if (b === 0) return -1;
      return a - b;           // months in calendar order
    });
    return crops.flatMap(crop =>
      sortedMonths.map(m => ({
        key: `${crop}#${m}`,
        crop,
        month: m,
        label: m === 0 ? `${crop} ${year}` : `${crop} ${BidSheetComponent.MONTH_NAMES[m]}`
      }))
    );
  });

  // --- Commodities lookup ---
  allCommodities = signal<Commodity[]>([]);

  // --- Add competitor modal ---
  addLocationMode = signal<boolean>(false);       // map is in "pick location" mode
  addLocationOrigin = signal<'editBids' | null>(null); // where the add-location flow was launched from
  showAddLocationForm = signal<boolean>(false);    // form popup is open
  newLocationName = signal<string>('');
  newLocationElevatorCode = signal<string>('');
  newLocationAddress = signal<string>('');
  newLocationCity = signal<string>('');
  newLocationState = signal<string>('');
  newLocationLat = signal<number | null>(null);
  newLocationLng = signal<number | null>(null);
  newLocationTu = signal<string>('');
  newLocationCrops = signal<{ commodityCode: string; searchQuery: string; showDropdown: boolean; oldYear: number; oldBid: string; newYear: number; newBid: string }[]>([]);
  readonly addLocationYears: number[] = (() => { const y = new Date().getFullYear(); return [y - 1, y]; })();
  // (commodityCode stores the category value, e.g. "CORN", "WHEAT")
  private _addLocationPin: Leaflet.Marker | null = null;

  // TUs available for selection when adding a location.
  // Falls back to all TUs the user has access to when no TU/group is selected.
  readonly addLocationTus = computed(() => {
    const active = this.activeTradeUnits();
    if (active.length > 0) return active;
    const all = new Set<string>();
    this.appState.userGroups().forEach(g => g.tradeUnitCodes.forEach(c => all.add(c.trim())));
    return [...all].sort();
  });

  private static readonly _excludedCommodityCategories = new Set([
    'CURRENCY', 'TRANSPORTATION', 'FEED & FERT INGREDIENTS', 'FEED &FERT INGREDIENTS'
  ]);

  // Returns unique grain crop categories (Corn, Wheat, Milo, etc.) matching the query
  private static readonly _commodityAliases: Record<string, string[]> = {
    'milo': ['milo', 'sorghum', 'sor', 'sg'],
    'sorghum': ['milo', 'sorghum', 'sor', 'sg'],
    'beans': ['soybeans', 'soy', 'beans', 'sb'],
    'soy': ['soybeans', 'soy', 'beans', 'sb'],
  };

  filteredCommodities(query: string): { code: string; name: string }[] {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    const searchTerms = BidSheetComponent._commodityAliases[q] ?? [q];
    const seen = new Set<string>();
    const results: { code: string; name: string }[] = [];
    for (const c of this.allCommodities()) {
      const code = (c.code ?? '').trim();
      const cat = (c.category ?? '').trim().toUpperCase();
      const desc = (c.name ?? '').trim();
      if (!code || seen.has(code) || BidSheetComponent._excludedCommodityCategories.has(cat)) continue;
      const codeLower = code.toLowerCase();
      const descLower = desc.toLowerCase();
      const catLower = cat.toLowerCase();
      if (searchTerms.some(t => codeLower.includes(t) || descLower.includes(t) || catLower.includes(t))) {
        seen.add(code);
        results.push({ code, name: `${(desc || cat).toUpperCase()} (${code.toUpperCase()})` });
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
  }

  selectCommodity(index: number, item: { code: string; name: string }): void {
    this.newLocationCrops.update(rows => rows.map((r, i) =>
      i === index ? { ...r, commodityCode: item.code, searchQuery: item.name, showDropdown: false } : r
    ));
    this.cropDropdownIndex.set(-1);
  }

  onCropSearchInput(index: number, value: string): void {
    this.newLocationCrops.update(rows => rows.map((r, i) =>
      i === index ? { ...r, searchQuery: value, commodityCode: '', showDropdown: true } : r
    ));
    this.cropDropdownIndex.set(index);
    // Auto-scroll the form container so the dropdown is visible
    setTimeout(() => {
      const container = document.querySelector('.add-location-scroll');
      if (container) container.scrollTop = container.scrollHeight;
    }, 50);
  }

  cropDropdownIndex = signal<number>(-1);

  hideCropDropdownDelayed(): void {
    setTimeout(() => {
      const idx = this.cropDropdownIndex();
      if (idx >= 0) {
        const rows = this.newLocationCrops();
        if (rows[idx] && !rows[idx].commodityCode) {
          this.newLocationCrops.update(r => r.map((row, i) => i === idx ? { ...row, searchQuery: '' } : row));
        }
      }
      this.cropDropdownIndex.set(-1);
    }, 200);
  }

  // --- Refresh timer ---
  lastRefreshed = signal<Date>(new Date());
  timeSinceRefresh = signal<string>('Just now');
  private _refreshTimer: ReturnType<typeof setInterval> | null = null;

  // --- Map ---
  private _map: Leaflet.Map | null = null;
  // markercluster's MarkerClusterGroup isn't in @types/leaflet — keep loose-typed
  private _clusterGroup: any = null;
  private _isMapInitialized = false;
  private _lastTuSet = '';
  private _searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _zoomDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Emits to cancel the previous _loadBidData subscription when TU selection changes rapidly. */
  private readonly _loadBidData$ = new Subject<{ tus: string[]; onLoaded?: () => void }>();

  // Geocode cache removed — coordinates now come from API (dbo.ElevatorCoordinates)

  // --- Active trade units (TU codes to display on map) ---
  // Individual TU selections take precedence; group selection is the fallback when none are checked.
  readonly activeTradeUnits = computed(() => {
    const selectedUnits = this.appState.selectedTradeUnits();
    if (selectedUnits.length > 0) return selectedUnits.map(c => c.trim());

    const selectedGroups = this.appState.selectedGroupNames();
    const allGroups = this.appState.userGroups();
    const codes = new Set<string>();
    for (const g of allGroups) {
      if (selectedGroups.includes(g.groupName)) {
        g.tradeUnitCodes.forEach(c => codes.add(c.trim()));
      }
    }
    return [...codes];
  });

  // Primary TU for bid data — first individual selection, then first in group
  readonly activeTradeUnit = computed(() => {
    const units = this.appState.selectedTradeUnits();
    if (units.length > 0) return units[0];
    return this.activeTradeUnits()[0] ?? '';
  });

  /** Sorted, comma-joined key for the current TU selection. Used as the reference lookup key.
   *  E.g. "2040" or "2040,2050" — same key regardless of whether TUs came from group or individual checkboxes. */
  readonly activeTradeUnitKey = computed(() => [...this.activeTradeUnits()].sort().join(','));

  constructor() {
    // Observe the filter bar's actual width so we can wrap search/clear to a centered second row when narrow.
    effect(() => {
      const ref = this.filterBarRef();
      if (this._filterBarObserver) { this._filterBarObserver.disconnect(); this._filterBarObserver = null; }
      if (!ref?.nativeElement) return;
      this._filterBarObserver = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width ?? 0;
        const narrow = width > 0 && width < FILTER_BAR_WRAP_WIDTH;
        if (this.filterBarNarrow() !== narrow) this.filterBarNarrow.set(narrow);
      });
      this._filterBarObserver.observe(ref.nativeElement);
    });

    // Load all bid sheet locations for map display (once)
    this._loadAllMapLocations();

    // Load commodities on init (once)
    this.apiService.getCommodities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (commodities) => this.allCommodities.set(commodities),
      error: () => {}
    });

    // switchMap pipeline: cancels the previous _loadBidData request when TU selection changes rapidly
    this._loadBidData$.pipe(
      switchMap(({ tus, onLoaded }) => {
        this.isLoading.set(true);
        // Set edit grid loading here (inside switchMap) so it survives cancellation of
        // the previous request. The previous onLoaded callback will never fire, but this
        // new emission takes ownership of the loading state.
        if (onLoaded && this.editBidsMode()) this.editBidsGridLoading.set(true);
        return forkJoin(
          tus.map(tu => forkJoin({
            locations: this.apiService.getBidSheetLocations(tu),
            cropYears: this.apiService.getBidCropYears(tu),
            bidCommodities: this.apiService.getBidCommodities(tu)
          }))
        ).pipe(map(results => ({ results, onLoaded })));
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: ({ results, onLoaded }) => {
        const allLocations = results.flatMap(r => r.locations);
        let cropYears = [...new Set(results.flatMap(r => r.cropYears))].sort((a, b) => a - b);
        const bidCommodities = [...new Set(results.flatMap(r => r.bidCommodities))].sort();

        this.bidLocations.set(allLocations);
        this.crops.set(bidCommodities);

        // Always ensure a crop is selected (first available if current is invalid)
        if (bidCommodities.length > 0 && !bidCommodities.includes(this.selectedCrop())) {
          this.selectedCrop.set(bidCommodities[0]);
        }

        const currentYear = new Date().getFullYear();
        if (cropYears.length === 0) cropYears = [currentYear];
        this.cropYears.set(cropYears);
        this.yearOffset.set(0);
        if (!cropYears.includes(this.selectedYear())) {
          this.selectedYear.set(cropYears.includes(currentYear) ? currentYear : cropYears[cropYears.length - 1]);
        }

        this.isLoading.set(false);
        this.filterBids();
        this._refreshMapMarkers();
        onLoaded?.();
      },
      error: () => {
        this.isLoading.set(false);
        this.editBidsGridLoading.set(false);
        this.toastService.error('Failed to load bid data');
      }
    });

    // React to trade unit / group changes — skip if same set (prevents re-zoom on nav back)
    effect(() => {
      const tus = this.activeTradeUnits();
      const key = [...tus].sort().join(',');
      if (key === this._lastTuSet) return;
      this._lastTuSet = key;
      this._onTradeUnitsChanged(tus);
    });

    this._startRefreshTimer();
    this._initializeMapWhenReady();

    this.destroyRef.onDestroy(() => {
      this._destroyMap();
      if (this._refreshTimer) clearInterval(this._refreshTimer);
      if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
      if (this._zoomDebounceTimer) clearTimeout(this._zoomDebounceTimer);
      if (this._filterBarObserver) this._filterBarObserver.disconnect();
    });
  }

  // =========================================================================
  // Data Loading

  private _loadAllMapLocations(): void {
    this.apiService.getAllBidSheetLocations().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (locs) => {
        this.allMapLocations.set(locs);
        if (this.activeTradeUnits().length === 0) {
          this.filterBids();
        }
        this._refreshMapMarkers();
      },
      error: () => this.toastService.error('Failed to load map locations')
    });
  }

  // =========================================================================

  private _onTradeUnitsChanged(tus: string[]): void {
    if (tus.length > 0) {
      // If a TU is selected but no group, auto-select the parent group
      if (this.appState.selectedGroupNames().length === 0) {
        const groups = this.appState.userGroups();
        const matchingGroup = groups.find(g => g.tradeUnitCodes.some(c => tus.includes(c.trim())));
        if (matchingGroup) {
          this.appState.setSelectedGroupNames([matchingGroup.groupName]);
        }
      }
      // Filter all elevators to any of the active TU codes (kept for add-location / reference lookup)
      const tuSet = new Set(tus);
      const tuElevators = this.allElevators().filter(e => tuSet.has((e.tradeUnitCode ?? '').trim()));
      this.tradeUnitElevators.set(tuElevators);
      // Load bid data and references for all active TUs
      if (this.editBidsMode()) this.editBidsGridLoading.set(true);
      this._loadBidData(tus, () => {
        this._zoomToBidLocations();
        // Apply saved crop preference after bid data loads (so we know available crops)
        this._loadPreference(tus);
        // If edit bids is open, rebuild the grid with new data
        if (this.editBidsMode()) {
          this._buildEditGrid(this.editBidsYear());
          this.editBidsGridLoading.set(false);
        }
      });
      this._loadLocationOrder(tus);
    } else {
      this.tradeUnitElevators.set([]);
      this.bidLocations.set([]);
      this.locationOrderByTu.set(new Map());
      this.crops.set([]);
      this.cropYears.set([]);
      this.yearOffset.set(0);
      this.selectedCrop.set('');
      this.selectedBasis.set('all');
      this.filterBids();
      this._refreshMapMarkers();
      // Reset map to US overview
      if (this._map) this._map.setView([38.5, -98.0], 5);
    }
  }

  private _loadLocationOrder(tus: string[]): void {
    if (tus.length === 0) return;
    const key = [...tus].sort().join(',');
    this.apiService.getBidSheetLocationOrder(key).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      const orderMap = new Map(this.locationOrderByTu());
      if (result?.locationOrder) {
        try { orderMap.set(key, JSON.parse(result.locationOrder)); }
        catch { orderMap.delete(key); }
      } else {
        orderMap.delete(key);
      }
      this.locationOrderByTu.set(orderMap);
      if (this.editBidsMode()) {
        this._buildEditGrid(this.editBidsYear());
      }
    });
  }

  /** Special key used to store the user's global (cross-TU) crop preference. */
  private static readonly GLOBAL_PREF_KEY = '__global__';

  /** Loads saved preferences (crop, month, year) for the current TU combo, falling back to global if no per-key entry. */
  private _loadPreference(tus: string[]): void {
    if (tus.length === 0) return;
    const key = [...tus].sort().join(',');
    forkJoin({
      perKey: this.apiService.getBidSheetPreference(key),
      global: this.apiService.getBidSheetPreference(BidSheetComponent.GLOBAL_PREF_KEY)
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ perKey, global }) => {
      // Per-key takes priority; fall back to global if per-key is missing the field
      const desiredCrop = perKey?.cropCode ?? global?.cropCode ?? null;
      const desiredMonth = perKey?.month ?? global?.month ?? null;
      const desiredYear = perKey?.cropYear ?? global?.cropYear ?? null;

      let changed = false;

      // Apply crop if available
      const available = this.crops();
      if (desiredCrop && available.includes(desiredCrop) && this.selectedCrop() !== desiredCrop) {
        this.selectedCrop.set(desiredCrop);
        changed = true;
      }

      // Apply month (always valid 0-12)
      if (desiredMonth != null && this.selectedMonth() !== desiredMonth) {
        this.selectedMonth.set(desiredMonth);
        changed = true;
      }

      // Apply year if available in current cropYears
      if (desiredYear != null && this.cropYears().includes(desiredYear) && this.selectedYear() !== desiredYear) {
        const years = this.cropYears();
        const idx = years.indexOf(desiredYear);
        this.selectedYear.set(desiredYear);
        if (idx >= 0) this.yearOffset.set(idx - (years.length - 1));
        changed = true;
      }

      // Apply hidden crops if available
      const hiddenCropsJson = perKey?.hiddenCrops ?? null;
      if (hiddenCropsJson) {
        try { this.hiddenCrops.set(new Set(JSON.parse(hiddenCropsJson))); }
        catch { this.hiddenCrops.set(new Set()); }
      } else {
        this.hiddenCrops.set(new Set());
      }

      // Apply selected months if available
      const selectedMonthsJson = perKey?.selectedMonths ?? null;
      if (selectedMonthsJson) {
        try { this.editBidsMonths.set(JSON.parse(selectedMonthsJson)); }
        catch { this.editBidsMonths.set([0]); }
      }

      // Apply crop column order if available
      const cropOrderJson = perKey?.cropOrder ?? null;
      if (cropOrderJson) {
        try {
          const orderMap = new Map(this.cropOrderByTu());
          orderMap.set(key, JSON.parse(cropOrderJson));
          this.cropOrderByTu.set(orderMap);
        } catch { /* invalid JSON — skip */ }
      }

      if (changed) {
        this.filterBids();
        this._refreshMapMarkers();
      }
    });
  }

  /** Persists the current crop, month, and year preferences for the active TU combo AND globally (fire-and-forget). */
  private _savePreference(): void {
    const cropCode = this.selectedCrop() || null;
    const month = this.selectedMonth();
    const cropYear = this.selectedYear() || null;
    const key = this.activeTradeUnitKey();
    if (key) {
      this.apiService.setBidSheetPreference(key, cropCode, month, cropYear)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save per-TU bid sheet preference', err); } });
    }
    // Always save globally so choices carry over to new TU/group selections
    this.apiService.setBidSheetPreference(BidSheetComponent.GLOBAL_PREF_KEY, cropCode, month, cropYear)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save global bid sheet preference', err); } });
  }

  /** Pixel width of the side panel when open. */
  private static readonly PANEL_WIDTH_PX = 440;

  /** Computes the lat/lng that, when used as map center, places (lat, lng) at the visual center of the map area not covered by the panel. */
  private _offsetCenter(lat: number, lng: number, zoom: number): Leaflet.LatLng {
    if (!this._map || !this._L) return this._L!.latLng(lat, lng);
    if (!this.showPanel()) return this._L.latLng(lat, lng);
    // Panel covers right side. To keep marker centered in the visible area,
    // we shift the map center LEFT (in pixel space) by half the panel width.
    const point = this._map.project([lat, lng], zoom);
    const adjusted = point.add([BidSheetComponent.PANEL_WIDTH_PX / 2, 0]);
    return this._map.unproject(adjusted, zoom);
  }

  /** Smoothly moves the map to a single location, accounting for the side panel if open. */
  private _flyToLocation(lat: number, lng: number, zoom?: number): void {
    if (!this._map || !this._L) return;
    const targetZoom = zoom ?? Math.max(this._map.getZoom(), 11);
    const center = this._offsetCenter(lat, lng, targetZoom);
    this._map.flyTo(center, targetZoom, { duration: 0.6 });
  }

  private _zoomToBidLocations(): void {
    if (!this._map || !this._L) return;
    const locs = this.bidLocations().filter(l => l.latitude && l.longitude);
    if (locs.length === 0) return;

    // Prioritize: selected location → first location
    const refName = this.selectedLocationName();
    const refLoc = refName ? locs.find(l => l.name === refName) : null;
    const panelOpen = this.showPanel();
    const rightPad = panelOpen ? BidSheetComponent.PANEL_WIDTH_PX + 20 : 50;

    if (refLoc) {
      this._flyToLocation(refLoc.latitude!, refLoc.longitude!, 10);
    } else if (locs.length === 1) {
      this._flyToLocation(locs[0].latitude!, locs[0].longitude!, 10);
    } else {
      const bounds = this._L.latLngBounds(locs.map(l => [l.latitude!, l.longitude!] as [number, number]));
      // fitBounds with right padding ensures bounds fit in the visible area (excluding the panel)
      this._map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [rightPad, 80], maxZoom: 12 });
    }
  }

  /** Triggers bid data load via switchMap — automatically cancels any previous in-flight request. */
  private _loadBidData(tradeUnitCodes: string[], onLoaded?: () => void): void {
    if (tradeUnitCodes.length === 0) return;
    this._loadBidData$.next({ tus: tradeUnitCodes, onLoaded });
  }

  // =========================================================================
  // Filter & Display (Panel)
  // =========================================================================

  onFilterChange(): void {
    if (this._map) this._map.closePopup();
    this.filterBids();
    this._refreshMapMarkers();
  }

  onMapCropChange(): void {
    this.onFilterChange();
    this._savePreference();
  }

  onYearDropdownChange(year: number): void {
    this.selectedYear.set(year);
    // Sync yearOffset so newYear() matches the dropdown selection
    const years = this.cropYears();
    const idx = years.indexOf(year);
    if (idx >= 0) {
      this.yearOffset.set(idx - (years.length - 1));
    }
    this.onFilterChange();
    this._savePreference();
  }

  onMonthDropdownChange(month: number): void {
    this.selectedMonth.set(month);
    this.onFilterChange();
    this._savePreference();
  }

  shiftYearsBack(): void {
    // Monthly mode: shift by one month (rolling year at January)
    if (this.selectedMonth() > 0) {
      const m = this.selectedMonth();
      if (m === 1) {
        this.selectedMonth.set(12);
        this.selectedYear.update(y => y - 1);
      } else {
        this.selectedMonth.set(m - 1);
      }
      this.onFilterChange();
      this._savePreference();
      return;
    }
    // Yearly mode: shift the year offset
    if (this.canShiftYearsBack()) {
      this.yearOffset.update(o => o - 1);
      const yr = this.newYear();
      if (yr) this.selectedYear.set(yr);
      this.onFilterChange();
    }
  }

  shiftYearsForward(): void {
    // Monthly mode: shift by one month forward (rolling year at December)
    if (this.selectedMonth() > 0) {
      const m = this.selectedMonth();
      if (m === 12) {
        this.selectedMonth.set(1);
        this.selectedYear.update(y => y + 1);
      } else {
        this.selectedMonth.set(m + 1);
      }
      this.onFilterChange();
      this._savePreference();
      return;
    }
    if (this.canShiftYearsForward()) {
      this.yearOffset.update(o => o + 1);
      const yr = this.newYear();
      if (yr) this.selectedYear.set(yr);
      this.onFilterChange();
    }
  }

  /** Search input only filters map pins — panel stays full (debounced 250ms) */
  onSearchInput(): void {
    if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
    this._searchDebounceTimer = setTimeout(() => this._refreshMapMarkers(), 250);
  }

  filterBids(): void {
    const hasTu = this.activeTradeUnits().length > 0;
    const hasIndividualTu = this.hasIndividualTu();
    const basis = this.selectedBasis();

    let items: BidSheetPanelItem[] = [];

    if (!hasTu) {
      // No selection — show all locations by name, no bid values
      const seen = new Set<string>();
      for (const loc of this.allMapLocations()) {
        if (seen.has(loc.name)) continue;
        seen.add(loc.name);
        items.push({
          type: 'entry',
          name: loc.name,
          isScoular: false,
          isRef: false,
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
          oldBid: '',
          newBid: '',
          status: 'none'
        });
      }
    } else {
      const crop = this.selectedCrop();
      const oldD = this.oldDisplay();
      const newD = this.newDisplay();

      // Compute reference bids per period for status comparison
      const refName = this.selectedLocationName();
      const selectedYr = this.selectedYear();
      const month = this.selectedMonth();
      let oldRefBid: number | null = null;
      let newRefBid: number | null = null;
      let selectedRefBid: number | null = null;
      if (hasIndividualTu && refName) {
        oldRefBid = this._parseBid(this._getLatestBid(refName, oldD.year, crop, oldD.month));
        newRefBid = this._parseBid(this._getLatestBid(refName, newD.year, crop, newD.month));
        selectedRefBid = this._parseBid(this._getLatestBid(refName, selectedYr, crop, month));
      }

      // Add location entries — filter by crop if one is selected
      const entries = crop
        ? this.bidEntries().filter(e => e.commodityCode === crop)
        : this.bidEntries();
      const uniqueNames = new Set(entries.map(e => e.name));

      // Ensure reference location always appears even if it has no bid for the selected crop
      if (hasIndividualTu && refName && !uniqueNames.has(refName)) {
        uniqueNames.add(refName);
      }

      for (const name of uniqueNames) {
        const oldBid = this._getLatestBid(name, oldD.year, crop, oldD.month);
        const newBid = this._getLatestBid(name, newD.year, crop, newD.month);
        const selectedBid = this._getLatestBid(name, selectedYr, crop, month);
        const entryWithCoords = this.bidEntries().find(e => e.name === name);
        const isRef = hasIndividualTu && name === refName;

        items.push({
          type: 'entry',
          name,
          isScoular: false,
          isRef,
          latitude: entryWithCoords?.latitude ?? null,
          longitude: entryWithCoords?.longitude ?? null,
          oldBid,
          newBid,
          oldStatus: isRef ? 'reference' : (hasIndividualTu ? this._computeItemStatus(oldBid, false, oldRefBid) : 'none'),
          newStatus: isRef ? 'reference' : (hasIndividualTu ? this._computeItemStatus(newBid, false, newRefBid) : 'none'),
          status: isRef ? 'reference' : (hasIndividualTu ? this._computeItemStatus(selectedBid, false, selectedRefBid) : 'none')
        });
      }

      // Include locations with no bids yet (only when no crop filter is active)
      if (!crop) {
        for (const loc of this.bidLocations()) {
          if (uniqueNames.has(loc.name)) continue;
          const isRef = hasIndividualTu && loc.name === refName;
          items.push({
            type: 'entry',
            name: loc.name,
            isScoular: false,
            isRef,
            latitude: loc.latitude ?? null,
            longitude: loc.longitude ?? null,
            oldBid: '',
            newBid: '',
            oldStatus: 'none',
            newStatus: 'none',
            status: isRef ? 'reference' : 'none'
          });
        }
      }
    }

    // Status (basis) filter — always keep the reference item
    if (basis !== 'all') {
      items = items.filter(item => item.status === 'reference' || item.status === basis);
    }

    // Sort: reference first, then alphabetical
    items.sort((a, b) => {
      if (a.isRef) return -1;
      if (b.isRef) return 1;
      return a.name.localeCompare(b.name);
    });

    this.filteredBidItems.set(items);
  }

  private _getLatestBid(name: string, year: number | null, commodityCode: string, month: number): string {
    if (!year || !commodityCode) return '';
    return this.bidLookup().get(`${name}|${commodityCode}|${year}|${month}`)?.bid ?? '';
  }

  private _getLatestEntry(name: string, year: number | null, commodityCode: string, month: number): BidSheetEntry | null {
    if (!year || !commodityCode) return null;
    return this.bidLookup().get(`${name}|${commodityCode}|${year}|${month}`) ?? null;
  }

  private _parseBid(bid: string): number | null {
    const n = parseFloat(bid);
    return isNaN(n) ? null : n;
  }

  private _computeItemStatus(bidStr: string, isRef: boolean, refBid: number | null): BidStatus {
    if (isRef) return 'reference';
    const num = this._parseBid(bidStr);
    if (refBid !== null && num !== null) {
      if (num > refBid) return 'beating';
      if (num === refBid) return 'matching';
    }
    return 'none';
  }

  // =========================================================================
  // Competitor Entry CRUD
  // =========================================================================

  openAddCommodity(): void {
    this.showAddCommoditySearch.set(true);
    this.addCommodityQuery.set('');
  }

  selectEditBidCommodity(item: { code: string; name: string }): void {
    this.usageTracking.postClickEvent('interaction', 'bidsheet', 'commodities-added', item.code);
    if (!this.crops().includes(item.code)) {
      this.crops.update(arr => [...arr, item.code].sort());
    }
    this.showAddCommoditySearch.set(false);
    this.addCommodityQuery.set('');
  }

  closeAddCommoditySearch(): void {
    this.showAddCommoditySearch.set(false);
    this.addCommodityQuery.set('');
  }

  addLocationFromEditBids(): void {
    this.addLocationOrigin.set('editBids');
    this.editBidsMode.set(false);
    this.enterAddLocationMode();
  }

  enterAddLocationMode(): void {
    this.addLocationMode.set(true);
    this.showPanel.set(false);
    // Clear existing markers to show clean map
    if (this._clusterGroup) this._clusterGroup.clearLayers();
  }

  exitAddLocationMode(): void {
    this.addLocationMode.set(false);
    this.showAddLocationForm.set(false);
    this._removeAddLocationPin();
    this._resetAddForm();
    this._refreshMapMarkers();
    this.addLocationOrigin.set(null);
  }

  private _onMapClick(e: any): void {
    if (!this.addLocationMode()) return;

    // Remove previous pin
    this._removeAddLocationPin();

    // Place pin
    const { lat, lng } = e.latlng;
    this.newLocationLat.set(lat);
    this.newLocationLng.set(lng);

    const _L = this._L!;
    const pinIcon = _L.divIcon({
      className: 'custom-marker',
      html: `<div style="width:28px;height:28px;background:#EF4623;border:3px solid #DF3410;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    if (!this._map) return;
    this._addLocationPin = _L.marker([lat, lng], { icon: pinIcon }).addTo(this._map);

    // Auto-select TU if only one is available
    const tus = this.addLocationTus();
    this.newLocationTu.set(tus.length === 1 ? tus[0] : '');

    // Open the form
    const defOldYear = this.oldYear() ?? (this.selectedYear() - 1);
    const defNewYear = this.newYear() ?? this.selectedYear();
    this.newLocationCrops.set([{ commodityCode: '', searchQuery: '', showDropdown: false, oldYear: defOldYear, oldBid: '', newYear: defNewYear, newBid: '' }]);
    this.showAddLocationForm.set(true);
  }

  canSaveLocation = computed(() => {
    const name = this.newLocationName().trim();
    const tu = this.newLocationTu();
    const hasCoords = this.newLocationLat() !== null;
    if (this.addLocationOrigin() === 'editBids') {
      return !!name && !!tu && hasCoords;
    }
    const crops = this.newLocationCrops().filter(c => c.commodityCode.trim() && c.oldBid.trim() && c.newBid.trim());
    return !!name && !!tu && crops.length > 0 && hasCoords;
  });

  clearCropSelection(index: number): void {
    this.newLocationCrops.update(rows => rows.map((r, i) =>
      i === index ? { ...r, commodityCode: '', searchQuery: '', showDropdown: false } : r
    ));
  }

  addCropRow(): void {
    const defOldYear = this.oldYear() ?? (this.selectedYear() - 1);
    const defNewYear = this.newYear() ?? this.selectedYear();
    this.newLocationCrops.update(rows => [...rows, { commodityCode: '', searchQuery: '', showDropdown: false, oldYear: defOldYear, oldBid: '', newYear: defNewYear, newBid: '' }]);
  }

  removeCropRow(index: number): void {
    this.newLocationCrops.update(rows => rows.filter((_, i) => i !== index));
  }

  updateCropOldBid(index: number, value: string): void {
    this.newLocationCrops.update(rows => rows.map((r, i) => i === index ? { ...r, oldBid: value } : r));
  }

  updateCropNewBid(index: number, value: string): void {
    this.newLocationCrops.update(rows => rows.map((r, i) => i === index ? { ...r, newBid: value } : r));
  }

  confirmAddLocation(): void {
    this.usageTracking.postClickEvent('interaction', 'bidsheet', 'locations-added');
    const name = this.newLocationName().trim();
    const tu = this.newLocationTu();
    const lat = this.newLocationLat();
    const lng = this.newLocationLng();
    const fromEditBids = this.addLocationOrigin() === 'editBids';

    if (!name) { this.toastService.error('Enter a location name'); return; }
    if (!tu) { this.toastService.error('Select a trade unit'); return; }

    const crops = fromEditBids
      ? []
      : this.newLocationCrops().filter(c => c.commodityCode.trim() && c.oldBid.trim() && c.newBid.trim());

    if (!fromEditBids && crops.length === 0) { this.toastService.error('Add at least one crop with both bids'); return; }

    // Build bids payload (2 per crop row: oldYear + newYear)
    const commodityLookup = new Map(this.allCommodities().map(c => [c.code, c]));
    const bids = crops.flatMap(crop => {
      const code = crop.commodityCode.trim();
      const commodity = commodityLookup.get(code);
      const commodityName = commodity?.name ?? code;
      const commodityCategory = commodity?.category ?? undefined;
      return [
        { commodityCode: code, commodityName, commodityCategory, cropYear: crop.oldYear, bid: crop.oldBid.trim(), month: 0 },
        { commodityCode: code, commodityName, commodityCategory, cropYear: crop.newYear, bid: crop.newBid.trim(), month: 0 }
      ];
    });

    this.apiService.createBidSheetLocation({
      name,
      elevatorCode: this.newLocationElevatorCode().trim() || undefined,
      address: this.newLocationAddress().trim() || undefined,
      city: this.newLocationCity().trim() || undefined,
      state: this.newLocationState().trim() || undefined,
      latitude: lat ?? undefined,
      longitude: lng ?? undefined,
      tradeUnitCode: tu,
      groupName: this._getGroupNameForTu(tu) || undefined,
      bids
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        // Immediately update local state so UI reflects the new location
        this.bidLocations.update(locs => [saved, ...locs]);
        this.allMapLocations.update(locs => [saved, ...locs]);
        for (const b of saved.bids ?? []) {
          if (!this.crops().includes(b.commodityCode)) {
            this.crops.update(arr => [...arr, b.commodityCode].sort());
          }
          if (!this.cropYears().includes(b.cropYear)) {
            this.cropYears.update(yrs => [...yrs, b.cropYear].sort((a, b) => a - b));
          }
        }
        if (!this.selectedCrop() && this.crops().length > 0) {
          this.selectedCrop.set(this.crops()[0]);
        }
        this.toastService.success(`Added ${name}`);
        this.exitAddLocationMode();

        // Reload all data so panel, map, and edit grid are fully in sync
        this._loadAllMapLocations();
        const tus = this.activeTradeUnits();
        if (tus.length > 0) {
          this._loadBidData(tus, () => {
            this.filterBids();
            this._refreshMapMarkers();
            if (fromEditBids) { this.openEditBids(); }
          });
        } else {
          this.filterBids();
          this._refreshMapMarkers();
          if (fromEditBids) { this.openEditBids(); }
        }
      },
      error: () => {
        this.toastService.error('Failed to add location');
      }
    });
  }

  cancelAddLocation(): void {
    const fromEditBids = this.addLocationOrigin() === 'editBids';
    this.exitAddLocationMode();
    if (fromEditBids) { this.openEditBids(); }
  }

  private _getGroupNameForTu(tuCode: string): string {
    return this.appState.userGroups()
      .find(g => g.tradeUnitCodes.some(c => c.trim() === tuCode.trim()))
      ?.groupName ?? '';
  }

  // =========================================================================
  // Edit Bids
  // =========================================================================

  openEditBids(): void {
    const year = this.selectedYear();
    const focusLocation = this.panelSelectedLocation();
    // Sync year with the panel; keep persisted month selection if it exists, otherwise use panel's month
    this.editBidsYear.set(year);
    if (this.editBidsMonths().length === 1 && this.editBidsMonths()[0] === 0 && this.selectedMonth() > 0) {
      // No persisted multi-month — initialize from the panel's single month
      this.editBidsMonths.set([this.selectedMonth()]);
    }
    this._buildEditGrid(year);
    this.editBidsMode.set(true);

    // Focus the first crop input for the selected location
    if (focusLocation) {
      setTimeout(() => {
        const rowIdx = this.editBidsRows().findIndex(r => r.name === focusLocation);
        const firstCol = this.editGridColumns()[0];
        if (rowIdx >= 0 && firstCol) {
          const el = document.getElementById(`bid-${rowIdx}-${firstCol.key}`);
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            (el as HTMLInputElement).focus();
          }
        }
      }, 100);
    }
  }

  prevEditYear(): void {
    const months = this.editBidsMonths();
    if (months.length > 0 && months[0] !== 0) {
      // Monthly mode: shift all months back by 1 (rolling year at January)
      const shifted = months.map(m => m === 1 ? 12 : m - 1);
      const yearChange = months.some(m => m === 1);
      this.editBidsMonths.set(shifted);
      this.onEditBidsYearChange(this.editBidsYear() + (yearChange ? -1 : 0));
      return;
    }
    this.onEditBidsYearChange(this.editBidsYear() - 1);
  }

  nextEditYear(): void {
    const months = this.editBidsMonths();
    if (months.length > 0 && months[0] !== 0) {
      const shifted = months.map(m => m === 12 ? 1 : m + 1);
      const yearChange = months.some(m => m === 12);
      this.editBidsMonths.set(shifted);
      this.onEditBidsYearChange(this.editBidsYear() + (yearChange ? 1 : 0));
      return;
    }
    this.onEditBidsYearChange(this.editBidsYear() + 1);
  }

  private _buildEditGrid(year: number): void {
    const lookup = this.bidLookup();
    const columns = this.editGridColumns();
    const rows: EditBidsRow[] = [];
    const addedNames = new Set<string>();

    // Add locations that have bid entries
    const uniqueNames = [...new Set(this.bidEntries().map(e => e.name))];
    for (const name of uniqueNames) {
      addedNames.add(name);
      const rep = this.bidEntries().find(e => e.name === name);
      const bids: Record<string, string> = {};
      for (const col of columns) {
        bids[col.key] = lookup.get(`${name}|${col.crop}|${year}|${col.month}`)?.bid ?? '';
      }
      rows.push({ name, type: 'entry', elevatorCode: rep?.elevatorCode, tradeUnitCode: rep?.tradeUnitCode, latitude: rep?.latitude, longitude: rep?.longitude, bids, originalBids: { ...bids } });
    }

    // Also include locations with no bids yet (e.g. just added from Edit Bids)
    for (const loc of this.bidLocations()) {
      if (addedNames.has(loc.name)) continue;
      addedNames.add(loc.name);
      const bids: Record<string, string> = {};
      for (const col of columns) { bids[col.key] = ''; }
      rows.push({ name: loc.name, type: 'entry', elevatorCode: loc.elevatorCode, tradeUnitCode: loc.tradeUnitCode, latitude: loc.latitude, longitude: loc.longitude, bids, originalBids: { ...bids } });
    }

    // Apply saved location order (unknown names go to end)
    const savedOrder = this.locationOrderByTu().get(this.activeTradeUnitKey());
    if (savedOrder && savedOrder.length > 0) {
      const orderMap = new Map(savedOrder.map((name, idx) => [name, idx]));
      rows.sort((a, b) => {
        const ai = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
        const bi = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
    }

    this.editBidsRows.set(rows);
  }

  onRowDrop(event: CdkDragDrop<EditBidsRow[]>): void {
    if (event.previousIndex === event.currentIndex) return;

    this.editBidsRows.update(rows => {
      const updated = [...rows];
      moveItemInArray(updated, event.previousIndex, event.currentIndex);
      return updated;
    });

    // Persist the new order
    const key = this.activeTradeUnitKey();
    if (!key) return;
    const names = this.editBidsRows().map(r => r.name);
    const orderMap = new Map(this.locationOrderByTu());
    orderMap.set(key, names);
    this.locationOrderByTu.set(orderMap);

    this.apiService.setBidSheetLocationOrder(key, JSON.stringify(names))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.toastService.success('Location order saved'),
        error: () => this.toastService.error('Failed to save row order')
      });
  }

  /** Called when a crop column header is dragged to a new position in the edit grid.
   *  In monthly mode (crop×month columns), moving one column moves ALL columns for that crop as a group. */
  onCropColumnDrop(event: CdkDragDrop<string[]>): void {
    if (event.previousIndex === event.currentIndex) return;

    const columns = this.editGridColumns();
    const draggedCrop = columns[event.previousIndex]?.crop;
    const targetCrop = columns[event.currentIndex]?.crop;
    if (!draggedCrop || !targetCrop || draggedCrop === targetCrop) return;

    // Reorder at the CROP level (not individual columns) so all months for a crop move together
    const visible = [...this.editBidsCrops()];
    const fromIdx = visible.indexOf(draggedCrop);
    const toIdx = visible.indexOf(targetCrop);
    if (fromIdx === -1 || toIdx === -1) return;
    moveItemInArray(visible, fromIdx, toIdx);

    // Rebuild the full crops list: visible crops in new order, then hidden crops at the end
    const hidden = this.crops().filter(c => this.hiddenCrops().has(c));
    this.crops.set([...visible, ...hidden]);

    // Persist the new order
    const key = this.activeTradeUnitKey();
    if (!key) return;
    const orderedCrops = this.crops();
    const orderMap = new Map(this.cropOrderByTu());
    orderMap.set(key, orderedCrops);
    this.cropOrderByTu.set(orderMap);

    // Save via preference (cropOrder only — don't overwrite crop/month/year)
    this.apiService.setBidSheetPreference(key, this.selectedCrop() || null, this.selectedMonth(), this.selectedYear() || null, JSON.stringify(orderedCrops))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.toastService.success('Crop order saved'),
        error: (err) => { if (isDevMode()) console.warn('Failed to save crop order', err); this.toastService.error('Failed to save crop order'); }
      });
  }

  /** Opens the crop dropdown with the current hidden set staged as pending. */
  openCropDropdown(): void {
    this.pendingHiddenCrops.set(new Set(this.hiddenCrops()));
    this.showCropDropdown.set(true);
  }

  /** Toggles a crop's visibility in the pending set (not yet applied). */
  toggleCropVisibility(crop: string): void {
    this.pendingHiddenCrops.update(set => {
      const updated = new Set(set);
      if (updated.has(crop)) updated.delete(crop);
      else updated.add(crop);
      return updated;
    });
  }

  /** Applies the pending crop visibility and closes the dropdown. */
  confirmCropSelection(): void {
    const changed = [...this.pendingHiddenCrops()].sort().join(',') !== [...this.hiddenCrops()].sort().join(',');
    this.hiddenCrops.set(new Set(this.pendingHiddenCrops()));
    this.showCropDropdown.set(false);
    this._buildEditGrid(this.editBidsYear());
    if (changed) {
      this._saveHiddenCrops();
      this.toastService.success('Crop selection saved');
    }
  }

  /** Cancels pending crop changes and closes the dropdown. */
  cancelCropSelection(): void {
    this.pendingHiddenCrops.set(new Set(this.hiddenCrops()));
    this.showCropDropdown.set(false);
  }

  /** Persists hidden crops to the preference API. */
  private _saveHiddenCrops(): void {
    const key = this.activeTradeUnitKey();
    if (!key) return;
    const hidden = [...this.hiddenCrops()];
    this.apiService.setBidSheetPreference(key, this.selectedCrop() || null, this.selectedMonth(), this.selectedYear() || null, undefined, JSON.stringify(hidden))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save hidden crops', err); } });
  }

  applyEditBidsTuFilter(): void {
    const tus = this.activeTradeUnits();
    if (tus.length === 0) return;
    this.editBidsGridLoading.set(true);
    this._loadLocationOrder(tus);
    this._loadBidData(tus, () => {
      this._buildEditGrid(this.editBidsYear());
      this.editBidsGridLoading.set(false);
      this.filterBids();
      this._refreshMapMarkers();
    });
  }

  onEditBidsYearChange(year: number): void {
    this.editBidsYear.set(year);
    this.editBidsGridLoading.set(true);
    requestAnimationFrame(() => {
      this._buildEditGrid(year);
      this.editBidsGridLoading.set(false);
    });
  }

  /** Opens the month dropdown with the current selection staged as pending. */
  openMonthDropdown(): void {
    this.pendingMonths.set([...this.editBidsMonths()]);
    this.showMonthDropdown.set(true);
  }

  /** Toggles a month in the pending selection (not yet applied). Yearly (0) can be selected alongside specific months. */
  toggleEditMonth(month: number): void {
    this.pendingMonths.update(arr => {
      let updated = [...arr];
      if (updated.includes(month)) {
        updated = updated.filter(m => m !== month);
      } else {
        updated.push(month);
      }
      // If nothing selected, fall back to yearly
      return updated.length === 0 ? [0] : updated;
    });
  }

  /** Applies the pending month selection and closes the dropdown. */
  confirmMonthSelection(): void {
    const changed = JSON.stringify(this.pendingMonths()) !== JSON.stringify(this.editBidsMonths());
    this.editBidsMonths.set([...this.pendingMonths()]);
    this.showMonthDropdown.set(false);
    this._buildEditGrid(this.editBidsYear());
    if (changed) {
      this._saveSelectedMonths();
      this.toastService.success('Month selection saved');
    }
  }

  /** Cancels the pending month selection and closes the dropdown. */
  cancelMonthSelection(): void {
    this.pendingMonths.set([...this.editBidsMonths()]);
    this.showMonthDropdown.set(false);
  }

  private _saveSelectedMonths(): void {
    const key = this.activeTradeUnitKey();
    if (!key) return;
    this.apiService.setBidSheetPreference(key, this.selectedCrop() || null, this.selectedMonth(), this.selectedYear() || null, undefined, undefined, JSON.stringify(this.editBidsMonths()))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save selected months', err); } });
  }

  /** Pushes editBidsYear/editBidsMonths back to the panel/map state (selectedYear, selectedMonth, yearOffset) and saves preference. */
  /** Handles arrow key navigation between bid input cells in the edit grid. */
  onBidKeyDown(event: KeyboardEvent, rowIdx: number, colIdx: number): void {
    const key = event.key;
    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    const columns = this.editGridColumns();
    const rowCount = this.editBidsRows().length;
    let targetRow = rowIdx;
    let targetCol = colIdx;
    if (key === 'ArrowUp') targetRow = Math.max(0, rowIdx - 1);
    else if (key === 'ArrowDown') targetRow = Math.min(rowCount - 1, rowIdx + 1);
    else if (key === 'ArrowLeft') targetCol = Math.max(0, colIdx - 1);
    else if (key === 'ArrowRight') targetCol = Math.min(columns.length - 1, colIdx + 1);
    if (targetRow === rowIdx && targetCol === colIdx) return;
    event.preventDefault();
    const targetKey = columns[targetCol]?.key;
    if (!targetKey) return;
    const el = document.getElementById(`bid-${targetRow}-${targetKey}`) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
  }

  updateBid(rowIndex: number, crop: string, value: string): void {
    this.editBidsRows.update(rows => {
      const updated = [...rows];
      updated[rowIndex] = { ...updated[rowIndex], bids: { ...updated[rowIndex].bids, [crop]: value } };
      return updated;
    });
  }

  saveEditBids(): void {
    this.usageTracking.postClickEvent('interaction', 'bidsheet', 'bids-changed');
    const year = this.editBidsYear();
    const tu = this.activeTradeUnit();
    const commodityLookup = new Map(this.allCommodities().map(c => [c.code, c]));
    const toCreate: Array<{ name?: string; elevatorCode?: string; tradeUnitCode?: string; groupName?: string; latitude?: number; longitude?: number; commodityCode: string; commodityName?: string; commodityCategory?: string; cropYear: number; bid: string }> = [];

    for (const row of this.editBidsRows()) {
      for (const col of this.editGridColumns()) {
        const current = (row.bids[col.key] ?? '').trim();
        const original = (row.originalBids[col.key] ?? '').trim();
        if (current !== original && current) {
          const commodity = commodityLookup.get(col.crop);
          toCreate.push({
            name: row.name,
            latitude: row.latitude,
            longitude: row.longitude,
            elevatorCode: row.elevatorCode,
            tradeUnitCode: row.tradeUnitCode || tu,
            groupName: this._getGroupNameForTu(row.tradeUnitCode || tu) || undefined,
            commodityCode: col.crop,
            commodityName: commodity?.name,
            commodityCategory: commodity?.category ?? undefined,
            cropYear: year,
            bid: current,
            month: col.month
          } as any);
        }
      }
    }

    if (toCreate.length === 0) {
      this._closeEditBids();
      this.toastService.info('No changes to save');
      return;
    }

    this.editBidsSaving.set(true);
    this.apiService.bulkUpsertBidSheetBids(toCreate)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.editBidsSaving.set(false);
          this._closeEditBids();
          this.toastService.success(`Saved ${toCreate.length} bid ${toCreate.length !== 1 ? 'changes' : 'change'} successfully`, 4000);
          this._loadBidData(this.activeTradeUnits());
        },
        error: () => {
          this.editBidsSaving.set(false);
          this.toastService.error('Failed to save bids');
        }
      });
  }

  cancelEditBids(): void {
    this._closeEditBids();
    this.editBidsRows.set([]);
  }

  private _closeEditBids(): void {
    // Close the edit grid but keep the session reference and panel state intact
    this.editBidsMode.set(false);
    this._refreshMapMarkers();
  }

  private _removeAddLocationPin(): void {
    if (this._addLocationPin && this._map) {
      this._map.removeLayer(this._addLocationPin);
      this._addLocationPin = null;
    }
  }

  private _resetAddForm(): void {
    this.newLocationName.set('');
    this.newLocationElevatorCode.set('');
    this.newLocationAddress.set('');
    this.newLocationCity.set('');
    this.newLocationState.set('');
    this.newLocationLat.set(null);
    this.newLocationLng.set(null);
    this.newLocationTu.set('');
    this.newLocationCrops.set([]);
  }

  // =========================================================================
  // Panel helpers
  // =========================================================================

  selectItemFromTable(item: BidSheetPanelItem): void {
    // Open the detail view for this location — does NOT set it as the session reference.
    // Use the "Set as Reference" button in the detail view to make it the reference.
    const alreadyOpen = this.panelSelectedLocation() === item.name;
    this.panelSelectedLocation.set(alreadyOpen ? '' : item.name);
    this.showPanel.set(true);

    // Populate the TU dropdown if no individual TU is selected (group-only counts as empty here),
    // or if the location's TU isn't already in the individual selection.
    if (!alreadyOpen && item.latitude != null) {
      const loc = this.allMapLocations().find(l => l.name === item.name);
      const tu = loc?.tradeUnitCode;
      if (tu) {
        const individualTus = this.appState.selectedTradeUnits();
        if (!individualTus.includes(tu)) {
          this.appState.setTradeUnits([tu]);
        }
      }
    }

    // Pan the map to the selected location so the user can see the enlarged pin
    if (!alreadyOpen && item.latitude != null && item.longitude != null) {
      this._flyToLocation(item.latitude, item.longitude);
    }

    this._refreshMapMarkers();
  }

  /** Sets the currently-open panel detail location as the session reference. */
  panelSetReference(): void {
    const name = this.panelSelectedLocation();
    if (!name) return;
    // Toggle: clicking again clears the reference
    if (this.selectedLocationName() === name) {
      this.selectedLocationName.set('');
    } else {
      this.selectedLocationName.set(name);
    }
    this.filterBids();
    this._refreshMapMarkers();
  }

  panelGoBack(): void {
    // Close detail view but keep the session reference (selectedLocationName) intact
    this.panelSelectedLocation.set('');
    this.showDeleteLocationConfirm.set(false);
    this.deleteMode.set(false);
    this.showDeleteCropConfirm.set(false);
    this.pendingDeleteCrop.set('');
    this._refreshMapMarkers();
  }

  confirmDeleteLocation(): void {
    const name = this.panelSelectedLocation();
    if (!name) return;
    const loc = this.allMapLocations().find(l => l.name === name);
    if (!loc) return;
    const tu = loc.tradeUnitCode ?? this.activeTradeUnit();

    this.apiService.deleteBidSheetLocation(loc.id, tu).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.bidLocations.update(locs => locs.filter(l => l.id !== loc.id));
        this.allMapLocations.update(locs => locs.filter(l => l.id !== loc.id));
        this.showDeleteLocationConfirm.set(false);
        this.deleteMode.set(false);
        this.panelSelectedLocation.set('');
        this.selectedLocationName.set('');
        this.toastService.success(`Deleted ${name}`);
        this.filterBids();
        this._refreshMapMarkers();
      },
      error: () => {
        this.showDeleteLocationConfirm.set(false);
        this.toastService.error('Failed to delete location');
      }
    });
  }

  requestDeleteCrop(crop: string): void {
    this.pendingDeleteCrop.set(crop);
    this.showDeleteCropConfirm.set(true);
  }

  cancelDeleteCrop(): void {
    this.pendingDeleteCrop.set('');
    this.showDeleteCropConfirm.set(false);
  }

  confirmDeleteCrop(): void {
    const crop = this.pendingDeleteCrop();
    const name = this.panelSelectedLocation();
    if (!crop || !name) return;
    const loc = this.allMapLocations().find(l => l.name === name)
             ?? this.bidLocations().find(l => l.name === name);
    if (!loc) return;
    const tu = loc.tradeUnitCode ?? this.activeTradeUnit();

    this.apiService.deleteBidSheetBids(loc.id, crop, tu).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        // Remove bids locally from both caches
        this.bidLocations.update(locs => locs.map(l =>
          l.id === loc.id ? { ...l, bids: (l.bids ?? []).filter(b => b.commodityCode !== crop) } : l
        ));
        this.allMapLocations.update(locs => locs.map(l =>
          l.id === loc.id ? { ...l, bids: (l.bids ?? []).filter(b => b.commodityCode !== crop) } : l
        ));
        this.showDeleteCropConfirm.set(false);
        this.pendingDeleteCrop.set('');
        this.toastService.success(`Deleted ${crop} bids from ${name}`);
        this.filterBids();
        this._refreshMapMarkers();
      },
      error: () => {
        this.showDeleteCropConfirm.set(false);
        this.pendingDeleteCrop.set('');
        this.toastService.error('Failed to delete crop bids');
      }
    });
  }

  startEditLocationName(): void {
    this.editLocationNameValue.set(this.panelSelectedLocation());
    this.editingLocationName.set(true);
  }

  cancelEditLocationName(): void {
    this.editingLocationName.set(false);
    this.editLocationNameValue.set('');
  }

  saveLocationName(): void {
    const newName = this.editLocationNameValue().trim();
    const oldName = this.panelSelectedLocation();
    if (!newName || newName === oldName) {
      this.cancelEditLocationName();
      return;
    }
    const loc = this.allMapLocations().find(l => l.name === oldName);
    if (!loc) return;

    this.apiService.updateBidSheetLocation(loc.id, {
      name: newName,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      latitude: loc.latitude,
      longitude: loc.longitude,
      elevatorCode: loc.elevatorCode,
      tradeUnitCode: loc.tradeUnitCode,
      groupName: loc.groupName,
      bids: []
    } as any).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.editingLocationName.set(false);
        this.editLocationNameValue.set('');
        this.panelSelectedLocation.set(newName);
        this.selectedLocationName.set(newName);
        this.toastService.success(`Location renamed to ${newName}`);
        // Reload data to reflect the change
        this._loadAllMapLocations();
        const tus = this.activeTradeUnits();
        if (tus.length > 0) this._loadBidData(tus);
      },
      error: () => this.toastService.error('Failed to rename location')
    });
  }

  selectPanelItem(item: BidSheetPanelItem): void {
    if (item.type === 'entry') {
      this.selectItemFromTable(item);
    }
    // Pan map to the selected location, offset for the panel if open
    if (item.latitude != null && item.longitude != null) {
      this._flyToLocation(item.latitude, item.longitude);
    }
  }

  /** Called when a map pin is clicked — populates filters with that location's TU/group and loads bid data. */
  private _selectMapLocation(loc: BidSheetLocation): void {
    const tu = (loc.tradeUnitCode ?? '').trim();
    const groupName = (loc.groupName ?? '').trim();

    // Toggle selected location for highlighted pin
    const alreadySelected = this.selectedLocationName() === loc.name;
    this.selectedLocationName.set(alreadySelected ? '' : loc.name);
    if (alreadySelected) {
      this._refreshMapMarkers();
      return;
    }

    // Populate the TU dropdown if no individual TU is selected, OR if the clicked location's TU
    // isn't already in the individual selection. Keeps existing selection when the TU is already there.
    const individualTus = this.appState.selectedTradeUnits();
    const tuInIndividual = tu && individualTus.includes(tu);
    if (!tuInIndividual) {
      if (groupName && this.appState.selectedGroupNames().length === 0) {
        this.appState.setSelectedGroupNames([groupName]);
      }
      if (tu) {
        this.appState.setTradeUnits([tu]);
      }
    }

    // Open the panel BEFORE flying so the offset calculation knows about it
    this.panelSelectedLocation.set('');
    this.showPanel.set(true);
    if (loc.latitude && loc.longitude) {
      this._flyToLocation(loc.latitude, loc.longitude);
    }
    this.filterBids();
    this._refreshMapMarkers();
  }

  clearAllFilters(): void {
    this.appState.setSelectedGroupNames([]);
    this.appState.setTradeUnits([]);
    this.searchQuery.set('');
    this.selectedBasis.set('all');
    this.selectedCrop.set('');
    this.selectedLocationName.set('');
    this.showPanel.set(false);
    this.panelSelectedLocation.set('');
    this._refreshMapMarkers();
  }

  togglePanel(): void { this.showPanel.set(!this.showPanel()); }

  refreshBids(): void {
    this.isRefreshing.set(true);
    if (this.editBidsMode()) this.editBidsGridLoading.set(true);
    const tus = this.activeTradeUnits();
    if (tus.length > 0) {
      // Refresh map locations and TU bid data in parallel
      this._loadAllMapLocations();
      this._loadBidData(tus, () => {
        // If edit bids is open, rebuild the grid with the fresh data
        if (this.editBidsMode()) {
          this._buildEditGrid(this.editBidsYear());
          this.editBidsGridLoading.set(false);
        }
        this.isRefreshing.set(false);
        this.toastService.success('Bids refreshed');
      });
    } else {
      // No TU selected — just refresh the map locations
      this.apiService.getAllBidSheetLocations().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (locs) => {
          this.allMapLocations.set(locs);
          this.filterBids();
          this._refreshMapMarkers();
          this.isRefreshing.set(false);
          this.toastService.success('Bids refreshed');
        },
        error: () => {
          this.isRefreshing.set(false);
          this.toastService.error('Failed to refresh');
        }
      });
    }
    this._startRefreshTimer();
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private _startRefreshTimer(): void {
    this.lastRefreshed.set(new Date());
    this.timeSinceRefresh.set('Just now');
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(() => this._updateTimeSinceRefresh(), 10000);
  }

  private _updateTimeSinceRefresh(): void {
    const seconds = Math.floor((new Date().getTime() - this.lastRefreshed().getTime()) / 1000);
    if (seconds < 60) this.timeSinceRefresh.set('A few seconds ago');
    else if (seconds < 3600) this.timeSinceRefresh.set(`${Math.floor(seconds / 60)}m ago`);
    else this.timeSinceRefresh.set(`${Math.floor(seconds / 3600)}h ago`);
  }

  // =========================================================================
  // Map
  // =========================================================================

  private _mapRetries = 0;
  private _resizeObserver: ResizeObserver | null = null;
  private _L: typeof Leaflet | null = null;

  private async _initializeMapWhenReady(): Promise<void> {
    if (this._isMapInitialized) return;

    // Dynamically import leaflet + markercluster (only once)
    if (!this._L) {
      try {
        const leaflet = await import('leaflet');
        await import('leaflet.markercluster');
        this._L = leaflet.default ?? leaflet;
      } catch {
        return;
      }
    }

    const mapElement = this.mapElRef()?.nativeElement;
    if (mapElement && mapElement.offsetHeight > 0) {
      this._initializeMap(mapElement);
    } else if (this._mapRetries < 30) {
      this._mapRetries++;
      setTimeout(() => this._initializeMapWhenReady(), 200);
    }
  }

  private _initializeMap(mapElement: HTMLElement): void {
    if (this._isMapInitialized || !this._L) return;
    const L = this._L;

    try {
      this._map = L.map(mapElement).setView([38.5, -98.0], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this._map);

      this._clusterGroup = (L as any).markerClusterGroup({
        maxClusterRadius: 12,
        disableClusteringAtZoom: 5,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true
      });
      this._map.addLayer(this._clusterGroup);

      this._isMapInitialized = true;

      // Watch for container resize and tell Leaflet to recalculate
      this._resizeObserver = new ResizeObserver(() => {
        if (this._map) this._map.invalidateSize();
      });
      this._resizeObserver.observe(mapElement);

      // Re-render markers when zoom changes (dot vs label at different zoom levels, debounced 200ms)
      this._map.on('zoomend', () => {
        if (this._zoomDebounceTimer) clearTimeout(this._zoomDebounceTimer);
        this._zoomDebounceTimer = setTimeout(() => this._refreshMapMarkers(), 200);
      });

      // Left-click to place pin in add-location mode
      this._map.on('click', (e: any) => this._onMapClick(e));

      this._refreshMapMarkers();
    } catch { /* map init failed — will retry on next navigation */ }
  }

  private _refreshMapMarkers(): void {
    if (!this._map || !this._clusterGroup || !this._L) return;
    const L = this._L;
    this._clusterGroup.clearLayers();
    // Keep map clean during add-location mode
    if (this.addLocationMode()) return;

    const activeTus = this.activeTradeUnits();
    const hasTu = activeTus.length > 0;
    const zoom = this._map.getZoom();
    const month = this.selectedMonth();

    const locKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const activeTuSet = new Set(activeTus);
    const crop = this.selectedCrop();
    const year = this.selectedYear();

    // Reference bid for status comparison — use selectedYear (same year used for bid pill lookups)
    const refName = this.selectedLocationName();
    const refBid = this._parseBid(refName ? this._getLatestBid(refName, year, crop, month) : '');

    const statusColors: Record<string, { bg: string; border: string }> = {
      reference: { bg: '#2563eb', border: '#1d4ed8' },
      beating:   { bg: '#dc2626', border: '#991b1b' },
      matching:  { bg: '#eab308', border: '#a16207' },
      none:      { bg: '#6b7280', border: '#4b5563' }
    };

    // Search query — only filter map pins, panel stays full
    const searchQ = this.searchQuery().toLowerCase();

    // Group all map locations by coordinates
    const locsByPos = new Map<string, BidSheetLocation[]>();
    for (const loc of this.allMapLocations()) {
      if (!loc.latitude || !loc.longitude) continue;
      const key = locKey(loc.latitude, loc.longitude);
      const arr = locsByPos.get(key) || [];
      arr.push(loc);
      locsByPos.set(key, arr);
    }

    const selectedName = this.selectedLocationName();
    const panelOpenName = this.panelSelectedLocation();

    // Build set of location names visible in the panel (respects crop/TU/search filters)
    const panelNames = new Set(this.filteredBidItems().map(i => i.name));

    for (const [, locs] of locsByPos) {
      // If searching, skip this pin group unless at least one location name matches
      if (searchQ && !locs.some(l => l.name.toLowerCase().includes(searchQ))) continue;
      const lat = locs[0].latitude!;
      const lng = locs[0].longitude!;
      const names = locs.map(l => l.name);
      const isActiveTu = locs.some(l => activeTuSet.has(l.tradeUnitCode ?? ''));
      const hasIndividualTu = this.hasIndividualTu();
      const showBidValues = isActiveTu && hasIndividualTu && crop;
      const isRef = hasIndividualTu && refName && names.includes(refName);
      const isPanelOpen = panelOpenName && names.includes(panelOpenName);

      // When filters are active, only show locations that appear in the panel
      if (hasTu && !names.some(n => panelNames.has(n))) continue;
      // Skip locations with no bid for the selected crop/year/month
      if (crop && !names.some(n => this._getLatestBid(n, year, crop, month))) continue;

      // Panel-open location — render expanded with name + bid (uses status color if reference, otherwise gray)
      if (isPanelOpen) {
        const bidStr = crop ? this._getLatestBid(panelOpenName, year, crop, month) : '';
        let pinBg = '#6b7280', pinBorder = '#4b5563';
        if (isRef) { pinBg = '#2563eb'; pinBorder = '#1d4ed8'; }
        else if (hasIndividualTu && refName && bidStr) {
          const status = this._computeItemStatus(bidStr, false, refBid);
          const c = statusColors[status] ?? statusColors['none'];
          pinBg = c.bg; pinBorder = c.border;
        } else if (isActiveTu && hasIndividualTu) { pinBg = '#00875F'; pinBorder = '#006B4C'; }
        const expandedIcon = this._buildHoverIcon(panelOpenName, bidStr, pinBg, pinBorder);
        const marker = L.marker([lat, lng], { icon: expandedIcon, zIndexOffset: 1000 });
        marker.on('click', () => this._selectMapLocation(locs[0]));
        this._clusterGroup.addLayer(marker);
        continue;
      }

      // Below zoom threshold: colored dot — but when searching, always show name labels
      if (zoom < 8 && !searchQ) {
        // Compute dot color from bid status (matches the pill colors used when zoomed in)
        let color: string, border: string;
        if (isRef) {
          color = statusColors['reference'].bg; border = statusColors['reference'].border;
        } else if (hasIndividualTu && refName && crop) {
          // Use beating/matching/none color based on this location's bid vs the reference
          const bidVal = this._getLatestBid(locs[0].name, year, crop, month);
          const status = bidVal ? this._computeItemStatus(bidVal, false, refBid) : 'none';
          color = statusColors[status].bg; border = statusColors[status].border;
        } else if (isActiveTu && hasIndividualTu) {
          color = '#00875F'; border = '#006B4C';
        } else {
          color = '#9ca3af'; border = '#6b7280';
        }
        const dotIcon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="width:14px;height:14px;background:${color};border:2px solid ${border};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7]
        });
        const m = L.marker([lat, lng], { icon: dotIcon });
        m.on('click', () => this._selectMapLocation(locs[0]));
        const hoverBid2 = crop ? this._getLatestBid(locs[0].name, year, crop, month) : '';
        this._bindHoverExpand(m, dotIcon, locs[0].name, hoverBid2, color, border);
        this._clusterGroup.addLayer(m);
        continue;
      }

      if (showBidValues) {
        // Active TU with crop selected — show bid values with status colors
        const bidItems = names
          .map(n => {
            const isNameRef = hasIndividualTu && n === refName;
            const bidVal = this._getLatestBid(n, year, crop, month);
            if (isNameRef) {
              const { bg, border } = statusColors['reference'];
              return { name: n, label: bidVal || '--', bg, border };
            }
            if (!bidVal) return null;
            const status = this._computeItemStatus(bidVal, false, refBid);
            const { bg, border } = statusColors[status] ?? statusColors['none'];
            return { name: n, label: bidVal, bg, border };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        if (bidItems.length > 0) {
          const linesHtml = bidItems.map(({ label, bg, border }) => {
            const isGrey = bg === '#d1d5db';
            const pillBg = isGrey ? '#6b7280' : bg;
            const pillBorder = isGrey ? '#4b5563' : border;
            return `<div style="background:${pillBg};border:2px solid ${pillBorder};border-radius:6px;padding:5px 6px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);line-height:1.2;cursor:pointer;">${this._esc(label)}</div>`;
          }).join('');
          const maxWidth = Math.max(58, ...bidItems.map(({ label }) => label.length * 7 + 16));
          const height = bidItems.length * 28 + 16;
          const primaryBg = bidItems[0].bg;
          const divIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;">
              ${linesHtml}
              <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${primaryBg};margin:-1px auto 0;"></div>
            </div>`,
            iconSize: [maxWidth, height],
            iconAnchor: [maxWidth / 2, height]
          });
          const marker = L.marker([lat, lng], { icon: divIcon });
          marker.on('click', () => this._selectMapLocation(locs[0]));
          const hoverBid3 = crop ? this._getLatestBid(locs[0].name, year, crop, month) : '';
          this._bindHoverExpand(marker, divIcon, locs[0].name, hoverBid3, primaryBg, bidItems[0].border);
          this._clusterGroup.addLayer(marker);
          continue;
        }
      }

      // Default: name labels — match the pill color story used elsewhere
      let bg: string, border: string;
      if (isRef) {
        bg = statusColors['reference'].bg; border = statusColors['reference'].border;
      } else if (hasIndividualTu && refName && crop) {
        // Use beating/matching/none color based on this location's bid vs the reference
        const bidVal = this._getLatestBid(locs[0].name, year, crop, month);
        const status = bidVal ? this._computeItemStatus(bidVal, false, refBid) : 'none';
        bg = statusColors[status].bg; border = statusColors[status].border;
      } else if (isActiveTu && hasIndividualTu) {
        bg = '#00875F'; border = '#006B4C';
      } else {
        bg = '#9ca3af'; border = '#6b7280';
      }
      const maxWidth = Math.max(80, ...names.map(n => n.length * 6 + 20));
      const nameIcon = L.divIcon({
        className: 'custom-marker',
        html: this._buildStackedLabel(names, bg, border),
        iconSize: [maxWidth, names.length * 26 + 8],
        iconAnchor: [maxWidth / 2, names.length * 26 + 8]
      });
      const marker = L.marker([lat, lng], { icon: nameIcon });
      marker.on('click', () => this._selectMapLocation(locs[0]));
      const hoverBid4 = crop ? this._getLatestBid(locs[0].name, year, crop, month) : '';
      this._bindHoverExpand(marker, nameIcon, locs[0].name, hoverBid4, bg, border);
      this._clusterGroup.addLayer(marker);
    }
  }

  private _buildStackedLabel(names: string[], bg: string, border: string): string {
    const isGrey = bg === '#d1d5db' || bg === '#9ca3af';
    const textColor = '#fff';
    const labelBg = isGrey ? '#6b7280' : bg;
    const labelBorder = isGrey ? '#4b5563' : border;
    const maxWidth = Math.min(150, Math.max(85, ...names.map(n => n.length * 7 + 22)));
    const linesHtml = names.map(n =>
      `<div style="background:${labelBg};border:2px solid ${labelBorder};border-radius:5px;padding:4px 8px;font-size:11px;font-weight:700;color:${textColor};white-space:nowrap;line-height:1.2;overflow:hidden;text-overflow:ellipsis;max-width:${maxWidth}px;">${this._esc(n)}</div>`
    ).join('');
    return `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;">
      ${linesHtml}
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${labelBorder};margin:-1px auto 0;"></div>
    </div>`;
  }

  /** Creates an expanded hover icon showing location name + bid value. */
  private _buildHoverIcon(name: string, bid: string, bg: string, border: string): any {
    const L = this._L!;
    const nameHtml = `<div style="font-size:11px;font-weight:700;color:#fff;white-space:nowrap;line-height:1.2;">${this._esc(name)}</div>`;
    const bidLabel = bid || '--';
    const subHtml = bid
      ? `<div style="font-size:10px;font-weight:500;color:rgba(255,255,255,0.85);white-space:nowrap;line-height:1.2;margin-top:2px;">${this._esc(bidLabel)}</div>`
      : '';
    const textLen = Math.max(name.length, bidLabel.length + 3);
    const w = Math.max(100, textLen * 7 + 24);
    const h = bid ? 50 : 36;
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="position:relative;text-align:center;display:flex;flex-direction:column;align-items:center;">
        <div style="background:${bg};border:2px solid ${border};border-radius:8px;padding:5px 9px;box-shadow:0 3px 10px rgba(0,0,0,0.3);cursor:pointer;">${nameHtml}${subHtml}</div>
        <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${bg};margin:-1px auto 0;"></div>
      </div>`,
      iconSize: [w, h],
      iconAnchor: [w / 2, h]
    });
  }

  /** Binds hover expand behavior to a marker — swaps icon on mouseover/mouseout. */
  private _bindHoverExpand(marker: any, originalIcon: any, name: string, bid: string, bg: string, border: string): void {
    const hoverIcon = this._buildHoverIcon(name, bid, bg, border);
    marker.on('mouseover', () => marker.setIcon(hoverIcon));
    marker.on('mouseout', () => marker.setIcon(originalIcon));
  }

  private _esc(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  private _destroyMap(): void {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._map) {
      this._map.remove();
      this._map = null;
      this._clusterGroup = null;
      this._isMapInitialized = false;
    }
  }

}
