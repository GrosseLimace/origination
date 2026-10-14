import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, computed, viewChild, ElementRef, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, map, Subject, switchMap, catchError, of, retry, timer } from 'rxjs';
import { CdkDragDrop, CdkDrag, CdkDropList, CdkDragHandle, moveItemInArray } from '@angular/cdk/drag-drop';
import type * as Leaflet from 'leaflet';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { BidSheetEntry, BidSheetLocation, BidSheetLocationBid, Elevator, Commodity } from '@models';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';
import { commodityHex } from '@shared/utils/commodity-color';
import { scopeCommodities } from '@shared/utils/commodity-scope';
import {
  buildPrintLayout, cellStyleMap, DEFAULT_PRINT_LAYOUT_STYLE, parsePrintLayoutStyle, PRINT_GEOMETRY, renderPrintDocument, tableColWidthPcts,
  PrintCropGroup, PrintColumn, PrintLayoutModel, PrintLayoutStyle, PrintLocation
} from '../../utils/print-layout';
import {
  addLocationPinIcon, bidPillFill, bidPillsIcon, BidPillItem, dotIcon, EXPANDED_PIN_GREY, hoverIcon, nameLabelIcon, pinFill
} from '../../utils/map-markers';
import { spreadOverlappingPins } from '../../utils/pin-spread';
import {
  BidSheetPanelItem, BidStatus, buildBidLookup, buildPanelItems, buildPanelLocationBids, computeItemStatus, deriveAllProducersFilters,
  flattenBidEntries, formatMonthYear, lookupBid, parseBid
} from '../../utils/bid-math';
import {
  applyBidsToLocations, arrowKeyTarget, buildDirtyBids, buildEditGridColumns, buildEditGridRows, clearDirtyForSaved, defaultMonthOrder,
  DirtyBid, EditBidsRow, editBidsMonthsLabel, orderEditBidsCrops, reorderCropsByColumnDrop, savedBidKey, setRowBid, toggleMonth, withHiddenCropsLast
} from '../../utils/edit-grid';

/** One row in the Yearly print columns builder. The resolved crop year = editBidsYear() + offset
 *  (relative, so it rolls over). oldNew picks the header style: '' = just the year, 'old'/'new' = "Old/New Crop (YYYY)". */
interface PrintYearRow {
  id: string;
  enabled: boolean;
  offset: number;            // -2..+2 relative to the viewed year
  oldNew: '' | 'old' | 'new';
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
  /** The bids grid is read-only in "All Producers" mode (no single TU to save against) — it's a
   *  view of every location's bids for the selected year. Editing requires picking a trade unit. */
  readonly editBidsReadOnly = computed(() => !this.hasIndividualTu());
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
  /** Set of location IDs that are marked as Scoular facilities — used for row highlighting in edit bids grid and print. */
  readonly scoularLocationIds = computed<Set<number>>(() => {
    const ids = new Set<number>();
    for (const loc of this.allMapLocations()) {
      if (loc.isScoularFacility) ids.add(loc.id);
    }
    return ids;
  });
  /** Set of location names that are marked as Scoular facilities — used for row highlighting in edit bids grid (which keys rows by name). */
  readonly scoularLocationNames = computed<Set<string>>(() => {
    const names = new Set<string>();
    for (const loc of this.allMapLocations()) {
      if (loc.isScoularFacility) names.add(loc.name);
    }
    for (const loc of this.bidLocations()) {
      if (loc.isScoularFacility) names.add(loc.name);
    }
    return names;
  });
  /** True if the currently-selected panel location is a Scoular facility. */
  readonly panelSelectedIsScoular = computed<boolean>(() => {
    const name = this.panelSelectedLocation();
    if (!name) return false;
    return this.allMapLocations().some(l => l.name === name && l.isScoularFacility);
  });
  /** Flattened view of locations — uses TU-filtered bidLocations when a TU is active, otherwise allMapLocations. */
  readonly bidEntries = computed<BidSheetEntry[]>(() =>
    flattenBidEntries(this.activeTradeUnits().length > 0 ? this.bidLocations() : this.allMapLocations()));
  /** Pre-computed lookup: "name|commodityCode|cropYear|month" → latest BidSheetEntry (by modifiedAt then createdAt). O(1) lookups instead of repeated filter+sort. */
  private readonly bidLookup = computed(() => buildBidLookup(this.bidEntries()));
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
    return formatMonthYear(month, year);
  }

  // --- Location order (per trade unit, persisted to DB) ---
  private locationOrderByTu = signal<Map<string, string[]>>(new Map());
  // --- Crop column order (per trade unit, persisted in BidSheetPreferences.CropOrder) ---
  private cropOrderByTu = signal<Map<string, string[]>>(new Map());

  // --- Panel ---
  showPanel = signal<boolean>(false);
  showLegend = signal<boolean>(true);
  /** Active base map: 'street' (OpenStreetMap) or 'satellite' (Esri aerial imagery + labels). */
  mapView = signal<'street' | 'satellite'>('street');
  /** True while a base-layer switch is loading its tiles — drives a brief loading overlay so the
   *  map doesn't visibly flash/pop tiles during the toggle. */
  mapSwitching = signal<boolean>(false);
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
    return buildPanelLocationBids(name, this.bidEntries(), this.bidLookup(), this.oldDisplay(), this.newDisplay(), this.selectedLocationName());
  });

  // --- Edit Bids ---
  editBidsMode = signal(false);
  showAddCommoditySearch = signal(false);
  addCommodityQuery = signal('');
  editBidsYear = signal<number>(new Date().getFullYear());
  editBidsMonths = signal<number[]>([0]); // [0]=yearly, [4,5,6]=Apr+May+Jun

  /** Label shown on the month-selector button.
   *  Year-only → "Year". Months only → "N Months". Mixed → "N Months + Year". */
  readonly editBidsMonthsLabel = computed(() => editBidsMonthsLabel(this.editBidsMonths()));
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
  editBidsSaving = signal(false); // gates ONLY the Done button; silent auto-save never touches it
  addLocationSaving = signal(false); // in-flight guard for the Add-Location "Done" button
  editBidsGridLoading = signal(false);
  // Silent auto-save coordination (blur / navigation). Plain fields — they don't drive UI.
  private _autoSaving = false;
  private _autoSaveRerun = false;
  private _pendingOnDone: (() => void) | null = null;
  // Distinct bid cells saved during the current edit session (incl. silent auto-saves), so "Done"
  // can report the session total. Keyed by name|commodity|cropYear|month; reset when the grid opens.
  private _editBidsSavedKeys = new Set<string>();

  /** Visible crops (hidden removed) in the saved crop column order (unknown crops go to end). */
  readonly editBidsCrops = computed(() =>
    orderEditBidsCrops(this.crops(), this.hiddenCrops(), this.cropOrderByTu().get(this.activeTradeUnitKey())));

  /** Grid column definitions: in yearly mode columns = crops, in monthly mode columns = crop x month pairs. */
  readonly editGridColumns = computed(() =>
    buildEditGridColumns(this.editBidsCrops(), this.editBidsMonths(), this.editBidsYear()));

  // --- Commodities lookup ---
  allCommodities = signal<Commodity[]>([]);
  // Curated "Planting Intentions" commodity set — drives the Add-Location crop search so the picker
  // matches the rest of the app. Full allCommodities is still used for code->name resolution.
  plantingCommodities = signal<Commodity[]>([]);

  // --- Add competitor modal ---
  addLocationMode = signal<boolean>(false);       // map is in "pick location" mode
  addLocationOrigin = signal<'editBids' | null>(null); // where the add-location flow was launched from
  showAddLocationForm = signal<boolean>(false);    // form popup is open
  newLocationName = signal<string>('');
  newLocationLat = signal<number | null>(null);
  newLocationLng = signal<number | null>(null);
  newLocationTu = signal<string>('');
  newLocationIsScoular = signal<boolean>(false);
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

  filteredCommodities(query: string): { code: string; name: string }[] {
    if (!query || query.length < 1) return [];
    // Split on whitespace so multi-word queries (e.g. "yellow corn") narrow results
    // instead of broadening them. Every word must appear somewhere in the code OR name.
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const seen = new Set<string>();
    const results: { code: string; name: string; rank: number }[] = [];
    // Search the curated Planting Intentions list; fall back to the full list if it's not loaded
    // so the picker never goes blank.
    // Drop commodities scoped to a trade group the user isn't in (organics). Applied to the
    // fallback too, or a failed curated fetch would leak them into a conventional picker.
    const inScope = { groupNames: this.appState.inScopeGroupNames(), tradeUnitCodes: this.appState.inScopeTradeUnitCodes() };
    const curated = scopeCommodities(this.plantingCommodities(), inScope);
    const source = curated.length > 0 ? curated : scopeCommodities(this.allCommodities(), inScope);
    for (const c of source) {
      const code = (c.code ?? '').trim();
      const cat = (c.category ?? '').trim().toUpperCase();
      const desc = (c.name ?? '').trim();
      if (!code || seen.has(code) || BidSheetComponent._excludedCommodityCategories.has(cat)) continue;
      const codeLower = code.toLowerCase();
      const descLower = desc.toLowerCase();
      // AND match: every word must be in either the code or the name (category ignored)
      const allMatch = words.every(w => codeLower.includes(w) || descLower.includes(w));
      if (!allMatch) continue;
      seen.add(code);
      // Rank: exact code match (0) < code starts-with (1) < name starts-with (2) < contains (3)
      const fullQ = words.join(' ');
      let rank = 3;
      if (codeLower === fullQ) rank = 0;
      else if (codeLower.startsWith(fullQ)) rank = 1;
      else if (descLower.startsWith(fullQ)) rank = 2;
      results.push({ code, name: `${(desc || cat).toUpperCase()} (${code.toUpperCase()})`, rank });
    }
    return results
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .slice(0, 20)
      .map(({ code, name }) => ({ code, name }));
  }


  // --- Refresh timer ---
  lastRefreshed = signal<Date>(new Date());
  timeSinceRefresh = signal<string>('Just now');
  private _refreshTimer: ReturnType<typeof setInterval> | null = null;

  // --- Map ---
  private _map: Leaflet.Map | null = null;
  /** Track the currently-hovered marker so we can force-reset its icon when another marker is hovered.
   *  Fixes Leaflet's stuck-hover bug where setIcon() swaps the DOM element and a pending mouseout never fires. */
  private _hoveredMarker: { marker: Leaflet.Marker; resetIcon: Leaflet.DivIcon } | null = null;
  // Typed by @types/leaflet.markercluster, which augments the leaflet namespace.
  private _clusterGroup: Leaflet.MarkerClusterGroup | null = null;
  // Base layers for the street/satellite toggle. _satelliteLayer is a layerGroup
  // (Esri World Imagery + road/place label overlays) for a hybrid aerial view.
  private _streetLayer: Leaflet.TileLayer | null = null;
  private _satelliteLayer: Leaflet.LayerGroup | null = null;
  // The imagery tile layer inside _satelliteLayer — watched for its 'load' event so we can hide the
  // switching spinner / drop the old base only once the new tiles are actually painted.
  private _satelliteImageryLayer: Leaflet.TileLayer | null = null;
  private _isMapInitialized = false;
  private _lastTuSet = '';
  private _searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _zoomDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Emits to cancel the previous _loadBidData subscription when TU selection changes rapidly. */
  private readonly _loadBidData$ = new Subject<{ tus: string[]; onLoaded?: () => void; mode: 'initial' | 'refresh' }>();

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

    // Load commodities on init (once). Two lists:
    //  - allCommodities (full): used to resolve a bid's commodity code -> name (existing bids may
    //    carry any code), so display never loses a name.
    //  - plantingCommodities (curated "Planting Intentions" set): drives the Add-Location crop
    //    SEARCH so the picker offers the same clean set as the rest of the app.
    this.apiService.getCommodities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (commodities) => this.allCommodities.set(commodities),
      // Without it crops lose their names and print colours, and the crop search can come up empty
      // — which reads as "no such crop" unless the user is told.
      error: () => this.toastService.error('Failed to load the commodity list — crop names, colors and the crop search may be incomplete.')
    });
    this.apiService.getPlantingCommodities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (commodities) => this.plantingCommodities.set(commodities),
      // Deliberately quiet: filteredCommodities falls back to the full list when this one is empty,
      // so the crop search still works, and a failure of that list is reported above.
      error: () => {}
    });

    // switchMap pipeline: cancels the previous _loadBidData request when TU selection changes rapidly.
    // Each trade unit's fetch retries transient failures, then degrades to null (caught) so ONE
    // trade unit hiccupping can't sink the whole reload. A 'refresh' load (run after a successful
    // save) never shows the red "failed" error — the save already committed; at worst a soft notice.
    this._loadBidData$.pipe(
      switchMap(({ tus, onLoaded, mode }) => {
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
          }).pipe(
            // GETs are idempotent — give a transient blip a couple of quiet retries before giving up.
            retry({ count: 2, delay: () => timer(400) }),
            catchError(() => of(null))
          ))
        ).pipe(map(perTu => ({ perTu, onLoaded, mode })));
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: ({ perTu, onLoaded, mode }) => {
        // If any trade unit failed (even after retries), don't replace the screen with a partial
        // set (that would drop a TU's locations). Keep what's shown — optimistic local updates
        // already reflect the just-saved change — and surface only a soft notice, never a red error.
        if (perTu.some(r => r == null)) {
          this.isLoading.set(false);
          this.editBidsGridLoading.set(false);
          onLoaded?.();
          if (mode === 'refresh') this.toastService.info('Your changes were saved — some bid data couldn’t be refreshed. Pull to refresh if needed.');
          else this.toastService.error('Failed to load bid data');
          return;
        }
        const results = perTu as NonNullable<(typeof perTu)[number]>[];
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
        if (!cropYears.includes(this.selectedYear())) {
          this.selectedYear.set(cropYears.includes(currentYear) ? currentYear : cropYears[cropYears.length - 1]);
        }
        // Anchor the old/new comparison window to the SELECTED year so the panel's "prior" column is
        // always selectedYear-1 — not the second-latest year. Previously this reset yearOffset to 0
        // (= latest two years); when the selected year wasn't the latest (e.g. 2026 with 2027 bids
        // present), the "prior" column collided with the selected year and both showed the same year
        // with the same bid after a refresh/Done.
        const selIdx = cropYears.indexOf(this.selectedYear());
        this.yearOffset.set(selIdx >= 0 ? selIdx - (cropYears.length - 1) : 0);

        this.isLoading.set(false);
        this.filterBids();
        this._refreshMapMarkers();
        onLoaded?.();
      },
      error: () => {
        // Per-TU failures are caught above, so this only fires on an unexpected pipeline error.
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
          this._applyAllProducersFilters();
          this.filterBids();
        }
        this._refreshMapMarkers();
      },
      error: () => this.toastService.error('Failed to load map locations')
    });
  }

  /**
   * "All Producers" mode has no trade unit, so the per-TU bid load (which fills crops/cropYears)
   * is skipped. Derive the crop + crop-year lists from every location's bids (allMapLocations) so
   * the same crop / year / month filters and the old/new comparison work across all producers.
   * Defaults the selected crop/year to a valid value so the comparison shows bids.
   */
  private _applyAllProducersFilters(): void {
    const { crops, years } = deriveAllProducersFilters(this.allMapLocations());
    this.crops.set(crops);
    this.cropYears.set(years);
    if (!this.selectedCrop() || !crops.includes(this.selectedCrop())) {
      this.selectedCrop.set(crops[0] ?? '');
    }
    if (years.length > 0 && !years.includes(this.selectedYear())) {
      this.selectedYear.set(years[years.length - 1]);
      this.yearOffset.set(0);
    }
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
      this.selectedBasis.set('all');
      // All Producers: derive crop/year filters from every location's bids so they still work
      // (allMapLocations may already be loaded; if not, _loadAllMapLocations re-applies on arrival).
      this._applyAllProducersFilters();
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

      // Apply saved print/export layout if available (per-key then global). Sanitize on read so
      // malformed/out-of-range persisted data can't break the year pickers.
      const printLayoutJson = perKey?.printLayout ?? global?.printLayout ?? null;
      if (printLayoutJson) {
        try {
          const l = JSON.parse(printLayoutJson);
          if (Array.isArray(l?.yearlyRows) && l.yearlyRows.length) {
            this.printYearlyRows.set(
              l.yearlyRows.slice(0, BidSheetComponent.MAX_PRINT_YEARLY_ROWS).map((r: { enabled?: unknown; offset?: unknown; oldNew?: unknown }) => ({
                id: this._newRowId(),
                enabled: r?.enabled !== false,
                offset: Math.max(-2, Math.min(2, Math.trunc(Number(r?.offset)) || 0)),
                oldNew: (r?.oldNew === 'old' || r?.oldNew === 'new') ? r.oldNew : '' as const
              }))
            );
          }
          if (typeof l?.address === 'string') this.printAddress.set(l.address);
          if (typeof l?.phone === 'string') this.printPhone.set(l.phone);
          if (typeof l?.highlightScoular === 'boolean') this.printHighlightScoularLocations.set(l.highlightScoular);
          // Retired 'sideBySide' / 'stacked' values fall back to the default; the next save rewrites them.
          this.printLayoutStyle.set(parsePrintLayoutStyle(l?.layoutStyle));
        } catch { /* invalid JSON — keep defaults */ }
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

  /** Triggers bid data load via switchMap — automatically cancels any previous in-flight request.
   *  mode 'refresh' (a reload AFTER a successful save) degrades transient failures to a soft notice
   *  instead of a red error, so a refresh hiccup never looks like the save failed. */
  private _loadBidData(tradeUnitCodes: string[], onLoaded?: () => void, mode: 'initial' | 'refresh' = 'initial'): void {
    if (tradeUnitCodes.length === 0) return;
    this._loadBidData$.next({ tus: tradeUnitCodes, onLoaded, mode });
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
    this.filteredBidItems.set(buildPanelItems({
      hasTu: this.activeTradeUnits().length > 0,
      hasCropYears: this.cropYears().length > 0,
      basis: this.selectedBasis(),
      crop: this.selectedCrop(),
      oldD: this.oldDisplay(),
      newD: this.newDisplay(),
      selected: { month: this.selectedMonth(), year: this.selectedYear() },
      refName: this.selectedLocationName(),
      entries: this.bidEntries(),
      lookup: this.bidLookup(),
      allMapLocations: this.allMapLocations(),
      bidLocations: this.bidLocations()
    }));
  }

  private _getLatestBid(name: string, year: number | null, commodityCode: string, month: number): string {
    return lookupBid(this.bidLookup(), name, year, commodityCode, month);
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
    if (this.editBidsReadOnly()) return; // view-only grid has no add-location row
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

  private _onMapClick(e: Leaflet.LeafletMouseEvent): void {
    if (!this.addLocationMode()) return;

    // Remove previous pin
    this._removeAddLocationPin();

    // Place pin
    const { lat, lng } = e.latlng;
    this.newLocationLat.set(lat);
    this.newLocationLng.set(lng);

    const _L = this._L!;
    const pinIcon = _L.divIcon(addLocationPinIcon());
    if (!this._map) return;
    this._addLocationPin = _L.marker([lat, lng], { icon: pinIcon }).addTo(this._map);

    // Auto-select TU if only one is available
    const tus = this.addLocationTus();
    this.newLocationTu.set(tus.length === 1 ? tus[0] : '');

    // Open the form (just name + Scoular star; bids are entered later in the grid)
    this.showAddLocationForm.set(true);
  }

  canSaveLocation = computed(() => {
    const name = this.newLocationName().trim();
    const tu = this.newLocationTu();
    const hasCoords = this.newLocationLat() !== null;
    // Bids are entered afterward in the Edit Bids grid, so creating a location only needs a
    // name, a trade unit, and the coordinates picked on the map.
    return !!name && !!tu && hasCoords;
  });

  confirmAddLocation(): void {
    if (this.addLocationSaving()) return; // guard against a double-click firing two creates
    this.usageTracking.postClickEvent('interaction', 'bidsheet', 'locations-added');
    const name = this.newLocationName().trim();
    const tu = this.newLocationTu();
    const lat = this.newLocationLat();
    const lng = this.newLocationLng();

    if (!name) { this.toastService.error('Enter a location name'); return; }
    if (!tu) { this.toastService.error('Select a trade unit'); return; }

    this.addLocationSaving.set(true);
    // Create the location with NO bids — bids are entered next in the Edit Bids grid.
    this.apiService.createBidSheetLocation({
      name,
      latitude: lat ?? undefined,
      longitude: lng ?? undefined,
      tradeUnitCode: tu,
      groupName: this._getGroupNameForTu(tu) || undefined,
      isScoularFacility: this.newLocationIsScoular(),
      bids: []
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.addLocationSaving.set(false);
        // Optimistically add the new location so the grid can open instantly without a network wait.
        this.bidLocations.update(locs => [saved, ...locs]);
        this.allMapLocations.update(locs => [saved, ...locs]);
        this.toastService.success(`Added ${name}`);
        this.exitAddLocationMode();

        // Open the Edit Bids grid IMMEDIATELY from in-memory data — _buildEditGrid includes
        // bidLocations with no bids yet, so the new location shows as an empty row to fill in
        // (existing locations' bids are already loaded). No round-trip before the screen appears.
        // Pass saved.name only as the grid's focus target — do NOT set panelSelectedLocation, or
        // the side panel would open in single-location DETAIL mode (for the new location) after the
        // grid closes, instead of the full list.
        this.filterBids();
        this._refreshMapMarkers();
        this.openEditBids(saved.name);

        // Sync map/panel with the server in the background. Pass NO onLoaded callback: the grid is
        // already open and built from in-memory data, and an onLoaded callback would flip
        // editBidsGridLoading on (see _loadBidData) and show a grid spinner that the success path
        // doesn't clear. The load's own success path already runs filterBids() + _refreshMapMarkers().
        this._loadAllMapLocations();
        const tus = this.activeTradeUnits();
        if (tus.length > 0) {
          this._loadBidData(tus, undefined, 'refresh');
        }
      },
      error: (err) => {
        this.addLocationSaving.set(false);
        if (isDevMode()) console.error('[BidSheet] add location failed', err);
        this.toastService.error(err?.message ? `Failed to add location: ${err.message}` : 'Failed to add location');
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

  openEditBids(focusLocationName?: string): void {
    const year = this.selectedYear();
    // Focus target for the grid: an explicit name (e.g. a just-added location) or, by default, the
    // panel's selected location. Passing it as an argument avoids forcing the panel into detail mode.
    const focusLocation = focusLocationName ?? this.panelSelectedLocation();
    // Sync year with the panel; keep persisted month selection if it exists, otherwise use panel's month
    this.editBidsYear.set(year);
    if (this.editBidsMonths().length === 1 && this.editBidsMonths()[0] === 0 && this.selectedMonth() > 0) {
      // No persisted multi-month — initialize from the panel's single month
      this.editBidsMonths.set([this.selectedMonth()]);
    }
    this._buildEditGrid(year);
    this._editBidsSavedKeys.clear();
    this.editBidsMode.set(true);
    this.usageTracking.postClickEvent('interaction', 'bidsheet', 'edit-bids-opened');

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
    this.onEditBidsYearChange(this.editBidsYear() - 1);
  }

  nextEditYear(): void {
    this.onEditBidsYearChange(this.editBidsYear() + 1);
  }

  private _buildEditGrid(year: number): void {
    this.editBidsRows.set(buildEditGridRows(
      this.bidEntries(), this.bidLocations(), this.editGridColumns(), this.bidLookup(), year,
      this.locationOrderByTu().get(this.activeTradeUnitKey())));
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

    // Reorder at the CROP level (not individual columns) so all months for a crop move together
    const reordered = reorderCropsByColumnDrop(
      this.editGridColumns(), this.editBidsCrops(), this.crops(), this.hiddenCrops(), event.previousIndex, event.currentIndex);
    if (!reordered) return;
    this.crops.set(reordered);

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
    // Save edits against the CURRENT columns before hiddenCrops changes (which reshapes editGridColumns).
    this._saveDirtyBids(() => {
      this.hiddenCrops.set(new Set(this.pendingHiddenCrops()));
      this.showCropDropdown.set(false);
      this._buildEditGrid(this.editBidsYear());
      if (changed) {
        this._saveHiddenCrops();
        this.toastService.success('Crop selection saved');
      }
    });
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
    // Save edits for the current TU set first (rows still carry the pre-switch tradeUnitCode), then reload.
    this._saveDirtyBids(() => {
      this.editBidsGridLoading.set(true);
      this._loadLocationOrder(tus);
      this._loadBidData(tus, () => {
        this._buildEditGrid(this.editBidsYear());
        this.editBidsGridLoading.set(false);
        this.filterBids();
        this._refreshMapMarkers();
      });
    });
  }

  onEditBidsYearChange(year: number): void {
    // Save edits for the CURRENT year first (cropYear is captured from editBidsYear()),
    // then switch the year and rebuild. On save error the year does not change and edits are kept.
    this._saveDirtyBids(() => {
      this.editBidsYear.set(year);
      this.editBidsGridLoading.set(true);
      requestAnimationFrame(() => {
        this._buildEditGrid(year);
        this.editBidsGridLoading.set(false);
      });
    });
  }

  /** Opens the month dropdown with the current selection staged as pending. */
  openMonthDropdown(): void {
    this.pendingMonths.set([...this.editBidsMonths()]);
    this.showMonthDropdown.set(true);
  }

  /** Toggles a month in the pending selection (not yet applied). Yearly (0) can be selected alongside specific months. */
  toggleEditMonth(month: number): void {
    this.pendingMonths.update(arr => toggleMonth(arr, month));
  }

  /** Applies the pending month selection and closes the dropdown. */
  confirmMonthSelection(): void {
    const changed = JSON.stringify(this.pendingMonths()) !== JSON.stringify(this.editBidsMonths());
    // Save edits against the CURRENT columns before editBidsMonths changes (which reshapes editGridColumns).
    this._saveDirtyBids(() => {
      // Selecting months (re)applies the default order (Yearly first); drag in the print dialog customizes it.
      this.editBidsMonths.set(defaultMonthOrder(this.pendingMonths()));
      this.showMonthDropdown.set(false);
      this._buildEditGrid(this.editBidsYear());
      if (changed) {
        this._saveSelectedMonths();
        this.toastService.success('Month selection saved');
      }
    });
  }

  /** Reorders the period columns (grid + print) when a month is dragged in the print dialog's Months list.
   *  editBidsMonths is the canonical order; editGridColumns/printCropGroups react to it (bids are keyed by
   *  crop#month, so no grid rebuild is needed — and we avoid discarding any in-grid state). */
  onPrintMonthDrop(event: CdkDragDrop<number[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.editBidsMonths.update(months => {
      const updated = [...months];
      moveItemInArray(updated, event.previousIndex, event.currentIndex);
      return updated;
    });
    this._saveSelectedMonths();
  }

  /** Reorders the crop tables (grid + print) when a crop is dragged in the print dialog's Crops list.
   *  editBidsCrops follows the saved crop order, so updating it flows to both the grid and the print. */
  onPrintCropDrop(event: CdkDragDrop<string[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const visible = [...this.editBidsCrops()];
    moveItemInArray(visible, event.previousIndex, event.currentIndex);
    const orderedCrops = withHiddenCropsLast(visible, this.crops(), this.hiddenCrops()); // keep hidden crops parked at the end
    this.crops.set(orderedCrops);
    this._saveCropOrder(orderedCrops);
  }

  /** Persists the crop column order for the active TU (mirrors the grid's column-drag persistence). */
  private _saveCropOrder(orderedCrops: string[]): void {
    const key = this.activeTradeUnitKey();
    if (!key) return;
    const orderMap = new Map(this.cropOrderByTu());
    orderMap.set(key, orderedCrops);
    this.cropOrderByTu.set(orderMap);
    this.apiService.setBidSheetPreference(key, this.selectedCrop() || null, this.selectedMonth(), this.selectedYear() || null, JSON.stringify(orderedCrops))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save crop order', err); } });
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
    const columns = this.editGridColumns();
    const target = arrowKeyTarget(event.key, rowIdx, colIdx, this.editBidsRows().length, columns.length);
    if (!target) return;
    event.preventDefault();
    const targetKey = columns[target.col]?.key;
    if (!targetKey) return;
    const el = document.getElementById(`bid-${target.row}-${targetKey}`) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
  }

  updateBid(rowIndex: number, crop: string, value: string): void {
    if (this.editBidsReadOnly()) return; // All Producers grid is view-only
    this.editBidsRows.update(rows => setRowBid(rows, rowIndex, crop, value));
  }

  /** Diff the current grid against the snapshot and build the upsert payload for changed cells.
   *  Reads editBidsYear() and editGridColumns() at CALL TIME — callers that navigate (year/month/crop
   *  change) must invoke a save BEFORE mutating those, so the payload reflects the cells the user edited. */
  private _buildDirtyBids(): DirtyBid[] {
    return buildDirtyBids(
      this.editBidsRows(), this.editGridColumns(), this.editBidsYear(), this.activeTradeUnit(),
      this.allCommodities(), tu => this._getGroupNameForTu(tu));
  }

  /** Silently persists any changed cells (no toast, no reload, no close). Fired on input blur and
   *  before any grid-rebuilding navigation, so an in-progress bid is never lost. The green "changed"
   *  highlight clears as cells are confirmed saved (the only feedback). On success runs onDone (used by
   *  navigation to rebuild AFTER the save). On error, onDone is NOT called — the edit is preserved.
   *  Concurrency: at most one upsert in flight; edits arriving mid-flight coalesce into a single re-run. */
  private _saveDirtyBids(onDone?: () => void): void {
    const dirty = this._buildDirtyBids();
    if (dirty.length === 0) { onDone?.(); return; }

    if (this._autoSaving) {
      // A save is already running — coalesce. Remember the latest navigation callback so it still fires.
      this._autoSaveRerun = true;
      if (onDone) this._pendingOnDone = onDone;
      return;
    }

    this._autoSaving = true;
    this.apiService.bulkUpsertBidSheetBids(dirty)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this._autoSaving = false;
          this._clearDirtyForSaved(dirty);
          this._applyBidsToLocalCache(dirty);
          this._recordSaved(dirty);
          if (this._autoSaveRerun) {
            // Edits happened during the request — run once more; defer the callback to that final save.
            // Prefer the latest coalesced navigation (_pendingOnDone) over this save's original onDone.
            this._autoSaveRerun = false;
            const next = this._pendingOnDone ?? onDone ?? undefined;
            this._pendingOnDone = null;
            this._saveDirtyBids(next);
          } else {
            const cb = this._pendingOnDone ?? onDone ?? undefined;
            this._pendingOnDone = null;
            cb?.();
          }
        },
        error: (err) => {
          this._autoSaving = false;
          this._autoSaveRerun = false;
          this._pendingOnDone = null;
          if (isDevMode()) console.error('[BidSheet] auto-save bids failed', err);
          this.toastService.error(err?.message ? `Failed to save bids: ${err.message}` : 'Failed to save bids');
          // Deliberately NOT calling onDone — preserves the edit and aborts any pending navigation.
        }
      });
  }

  /** Marks the saved cells clean so the "changed" highlight clears (see clearDirtyForSaved). */
  private _clearDirtyForSaved(dirty: DirtyBid[]): void {
    this.editBidsRows.update(rows => clearDirtyForSaved(rows, dirty));
  }

  /** Optimistically writes saved bids into the local location cache (bidLocations / allMapLocations),
   *  which feed the computed bidEntries → bidLookup that _buildEditGrid reads. Without this, navigating
   *  to another year and back rebuilds the grid from the stale cache and shows the pre-edit value until
   *  a full server refresh. Mirrors the optimistic update confirmAddLocation does for a new location. */
  private _applyBidsToLocalCache(dirty: DirtyBid[]): void {
    if (dirty.length === 0) return;
    const now = new Date().toISOString();
    this.bidLocations.update(locs => applyBidsToLocations(locs, dirty, now));
    this.allMapLocations.update(locs => applyBidsToLocations(locs, dirty, now));

    // Surface any brand-new crop year to the panel / old-new navigation as well.
    for (const d of dirty) {
      if (!this.cropYears().includes(d.cropYear)) {
        this.cropYears.update(yrs => [...yrs, d.cropYear].sort((a, b) => a - b));
      }
    }
  }

  /** Records the distinct cells saved this session so "Done" can report the running total. */
  private _recordSaved(dirty: DirtyBid[]): void {
    for (const b of dirty) {
      if (!b.name) continue;
      this._editBidsSavedKeys.add(savedBidKey(b));
    }
  }

  /** Fired when a bid input loses focus — silently saves any changed cells. */
  onBidBlur(): void {
    if (this.editBidsReadOnly()) return; // view-only: never auto-save
    this._saveDirtyBids();
  }

  /** Footer "Done": flush any remaining edits, then close + refresh, and report the session total.
   *  (Most cells are already auto-saved on blur; this just sweeps up anything not yet flushed.) */
  doneEditBids(): void {
    const dirty = this._buildDirtyBids();
    if (dirty.length === 0) {
      this._announceSaved();
      this._finishEditBids();
      return;
    }

    // Track one bids-changed event per affected location so the Usage Dashboard can attribute edits
    // (Most Edited Location card + Top Edited Bid Locations). Done-only, to avoid per-blur event spam.
    const affectedLocations = new Set(dirty.map(b => b.name).filter((n): n is string => !!n));
    for (const locName of affectedLocations) {
      this.usageTracking.postClickEvent('interaction', 'bidsheet', 'bids-changed', locName);
    }

    this.editBidsSaving.set(true);
    this.apiService.bulkUpsertBidSheetBids(dirty)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.editBidsSaving.set(false);
          this._applyBidsToLocalCache(dirty); // keep panel/map correct even if the post-close refresh hiccups
          this._recordSaved(dirty);
          this._announceSaved();
          this._finishEditBids();
        },
        error: (err) => {
          this.editBidsSaving.set(false);
          if (isDevMode()) console.error('[BidSheet] save bids failed', err);
          this.toastService.error(err?.message ? `Failed to save bids: ${err.message}` : 'Failed to save bids');
        }
      });
  }

  /** Shows a success toast summarizing how many distinct bids were saved this session (no toast if none). */
  private _announceSaved(): void {
    const n = this._editBidsSavedKeys.size;
    if (n === 0) return;
    this.toastService.success(`Saved ${n} bid ${n !== 1 ? 'changes' : 'change'} successfully`, 4000);
  }

  private _finishEditBids(): void {
    this._closeEditBids();
    // 'refresh': a hiccup in this post-save reload is shown softly, never as a save failure.
    this._loadBidData(this.activeTradeUnits(), undefined, 'refresh');
  }

  /** Footer "Close": there is no discard anymore — everything auto-saves on blur/navigation.
   *  Does a final silent flush, then exits. On a save error the flush keeps the grid open (edit preserved). */
  closeEditBids(): void {
    this._saveDirtyBids(() => {
      this._closeEditBids();
      this.editBidsRows.set([]);
    });
  }

  private _closeEditBids(): void {
    // Close the edit grid but keep the session reference and panel state intact
    this.editBidsMode.set(false);
    this._refreshMapMarkers();
  }

  // ── Print dialog state ──
  showPrintDialog = signal(false);

  // ── Print preview scaling ──
  // The preview sheet is laid out at the printable page width (10.4in at 96dpi) plus its own
  // 20px padding each side, then ZOOMED to fill whatever width the pane has. On a big monitor the
  // sheet — type included — grows so it's easy to read; on a laptop it shrinks to fit. The layout
  // itself never changes, so what you see is still exactly what prints.
  readonly printPreviewSheetPx = Math.round(PRINT_GEOMETRY.PAGE_WIDTH_IN * PRINT_GEOMETRY.PX_PER_IN) + 40;
  private readonly printPreviewPane = viewChild<ElementRef<HTMLElement>>('printPreviewPane');
  private readonly printPreviewPaneWidth = signal(0);
  private readonly _printPreviewResize = effect(onCleanup => {
    const el = this.printPreviewPane()?.nativeElement;
    if (!el) { this.printPreviewPaneWidth.set(0); return; }
    // contentRect excludes the pane's padding, which is exactly the width the sheet may fill.
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      this.printPreviewPaneWidth.set(Math.round(width));
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });
  /** Zoom that fits the sheet to the pane with a little margin, bounded so it never becomes unreadably
   *  small or blown up: 1.1× is as large as a print preview should read on a monitor. */
  readonly printPreviewZoom = computed(() => {
    const paneWidth = this.printPreviewPaneWidth();
    if (paneWidth <= 0) return 1;
    return Math.round(Math.min(1.1, Math.max(0.5, (paneWidth * 0.9) / this.printPreviewSheetPx)) * 100) / 100;
  });
  printSelectedCrops = signal<Set<string>>(new Set());
  printSelectedMonths = signal<Set<number>>(new Set());
  readonly todayFormatted = computed(() => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
  printAddress = signal('');
  printPhone = signal('');
  printHighlightScoularLocations = signal<boolean>(true);
  /**
   * Which export layout to render. Same data either way — only the arrangement differs.
   *   'locationsDown'   — one Location column, then a coloured band per crop with its periods
   *                       beneath. Locations listed once; wide selections split into bands.
   *   'locationsAcross' — the transpose: crop/period rows down the side, locations across the top
   *                       in blocks of 4–8. Best for comparing many locations.
   * Persisted per trade unit alongside the rest of the print layout (see utils/print-layout.ts).
   */
  printLayoutStyle = signal<PrintLayoutStyle>(DEFAULT_PRINT_LAYOUT_STYLE);

  /**
   * Commodity CODE → the key the shared palette actually understands.
   *
   * The bid sheet groups by code (YC, SOR, YSB) but commodity-color.ts is keyed by crop NAME
   * (corn, sorghum, soybeans). Passing a code straight in misses every entry and falls through to
   * the hashed fallback palette — and YC, SOR and YSB all hash to the same bucket, so the whole
   * sheet printed in one colour. Category is the Commodities table's code→crop mapping.
   */
  private readonly cropCategoryByCode = computed(
    () => new Map(this.allCommodities().map(c => [c.code, c.category?.trim() || c.code])));

  cropPaletteKey(crop: string): string {
    return this.cropCategoryByCode().get(crop) ?? crop;
  }

  /** Solid per-crop hex from the shared palette — used for the header border/accent. */
  cropHeaderColor(crop: string): string {
    return commodityHex(this.cropPaletteKey(crop));
  }

  /**
   * Pastel version of a crop's colour, matching the commodity CHIPS used everywhere else in the app
   * (light tint + dark text) rather than the saturated fill this export used to have.
   *
   * Derived by blending the palette hex toward white instead of hard-coding a second set of pastels,
   * so it stays in step automatically if commodity-color.ts ever changes. Chips are roughly the
   * Tailwind 100-level of the same hue, which is about an 82% blend.
   */
  cropHeaderTint(crop: string, blend = 0.82): string {
    const hex = this.cropHeaderColor(crop).replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * blend);
    return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  /** Absolute, because the print popup is `about:blank` — a relative asset path 404s there. */
  readonly printLogoUrl = `${window.location.origin}/assets/images/scoular-logo-dark.webp`;

  /**
   * Every edit-grid row with its bids resolved for the selected print columns, in grid order.
   * The Highlight toggle is folded into `isScoular` here so the layout builder never has to know
   * about it. Locations with no bids are dropped by the builder, not here.
   */
  readonly printLocations = computed<PrintLocation[]>(() => {
    const columns = this.printCropGroups().flatMap(g => g.columns);
    const highlight = this.printHighlightScoularLocations();
    const scoularNames = this.scoularLocationNames();
    return this.editBidsRows().map(row => ({
      name: row.name,
      isScoular: highlight && scoularNames.has(row.name),
      values: Object.fromEntries(columns.map(col => [col.key, this.printCellValue(row, col)]))
    }));
  });

  /** The ONE layout model both the dialog preview and the printed document render. */
  readonly printLayoutModel = computed<PrintLayoutModel>(() => buildPrintLayout({
    style: this.printLayoutStyle(),
    groups: this.printCropGroups(),
    locations: this.printLocations(),
    cropColors: crop => ({ solid: this.cropHeaderColor(crop), tint: this.cropHeaderTint(crop) })
  }));

  /** Template hooks onto the shared renderers (the preview binds these with `[style]`). */
  readonly printCellStyle = cellStyleMap;
  readonly printColWidths = tableColWidthPcts;
  // Yearly export columns: a builder of rows the user adds (each = enable toggle + year + Old/New choice).
  // Year is an offset from the viewed year (rolls over). Header reads "Old Crop (2025)" / "New Crop (2025)"
  // or just "2025" when neither is picked. Persisted per trade unit.
  printYearlyRows = signal<PrintYearRow[]>([
    { id: 'yr-old', enabled: true, offset: -1, oldNew: 'old' },
    { id: 'yr-new', enabled: true, offset: 0, oldNew: 'new' }
  ]);
  static readonly MAX_PRINT_YEARLY_ROWS = 5;
  // Monthly columns have no separate config: each month picked in the Months list prints as "May (2026)"
  // for the viewed year. Year offsets are only used by the Yearly columns' year dropdown.
  static readonly PRINT_YEAR_OFFSETS: number[] = [-2, -1, 0, 1, 2];

  /** Stable id for a year row. Uses crypto.randomUUID where available (secure context), else a counter. */
  private _printRowSeq = 0;
  private _newRowId(): string {
    try { return crypto.randomUUID(); } catch { return `yr-${Date.now()}-${this._printRowSeq++}`; }
  }

  onPrintPhoneInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10);
    let formatted = raw;
    if (raw.length > 6) formatted = `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`;
    else if (raw.length > 3) formatted = `(${raw.slice(0, 3)}) ${raw.slice(3)}`;
    else if (raw.length > 0) formatted = `(${raw}`;
    this.printPhone.set(formatted);
    (event.target as HTMLInputElement).value = formatted;
  }

  /**
   * Columns grouped by crop for the print preview — each group is one table section.
   * The Yearly view uses printYearlyRows (per-row year + Old/New → "Old Crop (2025)" / "2025"); each
   * specific month picked in the Months list renders one column for the viewed year, headed "May (2026)".
   * cropYear on each column resolves the right bid in printCellValue.
   */
  readonly printCropGroups = computed(() => {
    const selectedCrops = this.printSelectedCrops();
    const selectedMonths = this.printSelectedMonths();
    const viewedYear = this.editBidsYear();
    const yearlyRows = this.printYearlyRows().filter(r => r.enabled);
    // Preserve crop + month order from the grid (editBidsMonths is the canonical, user-orderable order).
    const crops = this.editBidsCrops().filter(c => selectedCrops.has(c));
    const months = this.editBidsMonths().filter(m => selectedMonths.has(m));

    return crops.map<PrintCropGroup>(crop => {
      const columns: PrintColumn[] = [];
      for (const m of months) {
        if (m === 0) {
          // Yearly: one column per enabled row. Header = "Old Crop (2025)" / "New Crop (2025)" / "2025".
          for (const row of yearlyRows) {
            const resolved = viewedYear + row.offset;
            const label = row.oldNew === 'old' ? `Old Crop (${resolved})`
              : row.oldNew === 'new' ? `New Crop (${resolved})`
              : String(resolved);
            // compactLabel is for the side-by-side layout, where a column is only a few percent of
            // the page and "Old Crop (2026)" overflows into its neighbour. It ABBREVIATES the same
            // column the user configured — it never renames it — so old crop still reads as old
            // crop, not as some other word.
            const yy = String(resolved).slice(-2);
            const compactLabel = row.oldNew === 'old' ? `O/C ${yy}`
              : row.oldNew === 'new' ? `N/C ${yy}`
              : String(resolved);
            columns.push({ key: `${crop}#0#${row.id}`, crop, month: 0, year: resolved, label, compactLabel });
          }
        } else {
          // Monthly: one column per selected month for the viewed year, headed "May (2026)".
          columns.push({
            key: `${crop}#${m}`, crop, month: m, year: viewedYear,
            label: `${this.getMonthName(m)} (${viewedYear})`,
            compactLabel: `${this.getMonthName(m)} ${String(viewedYear).slice(-2)}`
          });
        }
      }
      return { crop, columns };
    });
  });

  /**
   * Resolve a printed cell's bid value. For the viewed (New Crop) year we read the live edit-grid
   * value so unsaved edits print; for any other year (Old Crop) we read the saved bid from the lookup.
   */
  printCellValue(row: EditBidsRow, col: { crop: string; month: number; year: number }): string {
    if (col.year === this.editBidsYear()) {
      return (row.bids[`${col.crop}#${col.month}`] ?? '').trim();
    }
    return this._getLatestBid(row.name, col.year, col.crop, col.month).trim();
  }

  printEditBids(): void {
    // Initialize period (crop/month) selection with whatever is currently visible on the edit grid.
    // The per-context year configs persist (loaded from preference / kept across opens).
    this.printSelectedCrops.set(new Set(this.editBidsCrops()));
    this.printSelectedMonths.set(new Set(this.editBidsMonths()));
    this.showPrintDialog.set(true);
  }

  /** True when the Yearly period (month 0) is among the selected print periods. */
  readonly printHasYearly = computed(() => this.printSelectedMonths().has(0));
  /** Candidate crop years for the Yearly year picker (viewed year ±2) — shown as concrete years, stored as offsets. */
  readonly printYearChoices = computed(() => {
    const y = this.editBidsYear();
    return BidSheetComponent.PRINT_YEAR_OFFSETS.map(offset => ({ offset, year: y + offset }));
  });

  // --- Yearly columns builder ---
  onPrintYearlyRowDrop(event: CdkDragDrop<PrintYearRow[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.printYearlyRows.update(rows => {
      const updated = [...rows];
      moveItemInArray(updated, event.previousIndex, event.currentIndex);
      return updated;
    });
    this._savePrintLayout();
  }

  addPrintYearlyRow(): void {
    this.printYearlyRows.update(rows => {
      if (rows.length >= BidSheetComponent.MAX_PRINT_YEARLY_ROWS) return rows;
      return [...rows, { id: this._newRowId(), enabled: true, offset: 0, oldNew: '' as const }];
    });
    this._savePrintLayout();
  }
  removePrintYearlyRow(id: string): void {
    this.printYearlyRows.update(rows => rows.length <= 1 ? rows : rows.filter(r => r.id !== id));
    this._savePrintLayout();
  }
  togglePrintYearlyRow(id: string): void {
    this.printYearlyRows.update(rows => rows.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
    this._savePrintLayout();
  }
  setPrintYearlyRowOffset(id: string, offset: number): void {
    const clamped = Math.max(-2, Math.min(2, offset));
    this.printYearlyRows.update(rows => rows.map(r => r.id === id ? { ...r, offset: clamped } : r));
    this._savePrintLayout();
  }
  setPrintYearlyRowOldNew(id: string, value: string): void {
    const oldNew: '' | 'old' | 'new' = value === 'old' || value === 'new' ? value : '';
    this.printYearlyRows.update(rows => rows.map(r => r.id === id ? { ...r, oldNew } : r));
    this._savePrintLayout();
  }

  /** Persists the print layout (Yearly columns + contact info + highlight) per-TU and globally (fire-and-forget). */
  private _savePrintLayout(): void {
    const layout = JSON.stringify({
      yearlyRows: this.printYearlyRows().map(({ enabled, offset, oldNew }) => ({ enabled, offset, oldNew })),
      address: this.printAddress(),
      phone: this.printPhone(),
      highlightScoular: this.printHighlightScoularLocations(),
      layoutStyle: this.printLayoutStyle()
    });
    const cropCode = this.selectedCrop() || null;
    const month = this.selectedMonth();
    const cropYear = this.selectedYear() || null;
    const key = this.activeTradeUnitKey();
    if (key) {
      this.apiService.setBidSheetPreference(key, cropCode, month, cropYear, undefined, undefined, undefined, layout)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save per-TU print layout', err); } });
    }
    this.apiService.setBidSheetPreference(BidSheetComponent.GLOBAL_PREF_KEY, cropCode, month, cropYear, undefined, undefined, undefined, layout)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save global print layout', err); } });
  }

  closePrintDialog(): void {
    this._savePrintLayout(); // persist contact info / any pending changes on close
    this.showPrintDialog.set(false);
  }

  togglePrintCrop(crop: string): void {
    this.printSelectedCrops.update(s => {
      const next = new Set(s);
      next.has(crop) ? next.delete(crop) : next.add(crop);
      return next;
    });
  }

  togglePrintMonth(month: number): void {
    this.printSelectedMonths.update(s => {
      const next = new Set(s);
      next.has(month) ? next.delete(month) : next.add(month);
      return next;
    });
  }

  getMonthName(month: number): string {
    if (month === 0) return 'Year';
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1] ?? '';
  }

  /** Prints the SAME model the preview shows — the popup document is rendered from it, not rebuilt. */
  confirmPrint(): void {
    const model = this.printLayoutModel();
    if (model.tables.length === 0) return;

    this._savePrintLayout(); // remember this layout for next time

    const html = renderPrintDocument(model, {
      address: this.printAddress(),
      phone: this.printPhone(),
      dateText: this.todayFormatted(),
      logoUrl: this.printLogoUrl
    });

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
    }
    this.showPrintDialog.set(false);
  }

  private _removeAddLocationPin(): void {
    if (this._addLocationPin && this._map) {
      this._map.removeLayer(this._addLocationPin);
      this._addLocationPin = null;
    }
  }

  private _resetAddForm(): void {
    this.newLocationName.set('');
    this.newLocationLat.set(null);
    this.newLocationLng.set(null);
    this.newLocationTu.set('');
    this.newLocationIsScoular.set(false);
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
    if (!alreadyOpen) {
      this.usageTracking.postClickEvent('interaction', 'bidsheet', 'location-selected', item.name);
    }

    // Opening a location does NOT change the trade-unit/group scope — stays in the current view
    // (All Producers or the selected group) so it can be compared against all other locations.

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
    const isSetting = this.selectedLocationName() !== name;
    if (isSetting) {
      this.selectedLocationName.set(name);
      this.usageTracking.postClickEvent('interaction', 'bidsheet', 'reference-set', name);
    } else {
      this.selectedLocationName.set('');
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
    if (this.editBidsReadOnly()) return; // read-only in All Producers — no deletes
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
        this.usageTracking.postClickEvent('interaction', 'bidsheet', 'location-deleted', name);
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
    if (this.editBidsReadOnly()) return; // read-only in All Producers — no deletes
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
    if (this.editBidsReadOnly()) return; // read-only in All Producers
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
      isScoularFacility: loc.isScoularFacility ?? false
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  toggleLocationScoularStatus(): void {
    if (this.editBidsReadOnly()) return; // read-only in All Producers
    const name = this.panelSelectedLocation();
    if (!name) return;
    const loc = this.allMapLocations().find(l => l.name === name);
    if (!loc) return;
    const newValue = !(loc.isScoularFacility ?? false);

    this.apiService.updateBidSheetLocation(loc.id, {
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      latitude: loc.latitude,
      longitude: loc.longitude,
      elevatorCode: loc.elevatorCode,
      tradeUnitCode: loc.tradeUnitCode,
      groupName: loc.groupName,
      isScoularFacility: newValue
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.allMapLocations.update(locs => locs.map(l =>
          l.id === loc.id ? { ...l, isScoularFacility: newValue } : l
        ));
        this.bidLocations.update(locs => locs.map(l =>
          l.id === loc.id ? { ...l, isScoularFacility: newValue } : l
        ));
        this.toastService.success(newValue ? `${name} marked as Scoular facility` : `${name} unmarked as Scoular facility`);
      },
      error: () => this.toastService.error('Failed to update Scoular status')
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

  /** Called when a map pin is clicked — toggles it as the comparison reference. Does NOT change the
   *  trade-unit/group scope, so the location is compared against all others in the current view
   *  (All Producers or the selected group). */
  private _selectMapLocation(loc: BidSheetLocation): void {
    // Toggle selected location for highlighted pin / comparison reference
    const alreadySelected = this.selectedLocationName() === loc.name;
    this.selectedLocationName.set(alreadySelected ? '' : loc.name);
    if (alreadySelected) {
      this._refreshMapMarkers();
      return;
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

  /** Switches the base map between street (OpenStreetMap) and the realistic aerial view
   *  (Esri imagery + labels). Markers live in markerPane above the tiles, so they stay put.
   *  Shows a brief loading overlay and keeps the previous base layer underneath until the new
   *  tiles finish loading, so the map doesn't flash/pop tiles mid-switch. */
  toggleMapView(): void {
    if (!this._map || !this._streetLayer || !this._satelliteLayer || this.mapSwitching()) return;

    const toSatellite = this.mapView() === 'street';
    const newLayer = toSatellite ? this._satelliteLayer : this._streetLayer;
    const oldLayer = toSatellite ? this._streetLayer : this._satelliteLayer;
    // The tile layer whose 'load' tells us the new base has painted (street layer is itself a tile
    // layer; for satellite it's the imagery layer inside the group).
    const watch = toSatellite ? this._satelliteImageryLayer : this._streetLayer;

    this.mapSwitching.set(true);
    this.mapView.set(toSatellite ? 'satellite' : 'street');
    newLayer.addTo(this._map); // add on top; old stays underneath so there's no blank gap

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { this._map?.removeLayer(oldLayer); } catch { /* already gone */ }
      this.mapSwitching.set(false);
    };

    // Hide the overlay once the new tiles have loaded; fall back after 2.5s in case 'load' doesn't
    // fire (e.g. fully cached tiles) so the spinner can never get stuck.
    watch?.once('load', finish);
    setTimeout(finish, 2500);
  }

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

      // Street view (default) — OpenStreetMap.
      this._streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      });

      // Satellite ("realistic") view — Esri World Imagery + transparent road/place label overlays
      // (hybrid), so reps can recognize a location and still read town/road names when zoomed in.
      // maxNativeZoom caps tile requests at the provider's real resolution; Leaflet up-scales beyond it.
      this._satelliteImageryLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics', maxZoom: 19, maxNativeZoom: 19
      });
      this._satelliteLayer = L.layerGroup([
        this._satelliteImageryLayer,
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19, maxNativeZoom: 19
        }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19, maxNativeZoom: 19
        })
      ]);

      // Default to street; toggleMapView() swaps to satellite.
      this._streetLayer.addTo(this._map);

      this._clusterGroup = L.markerClusterGroup({
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
      this._map.on('click', (e: Leaflet.LeafletMouseEvent) => this._onMapClick(e));

      this._refreshMapMarkers();
    } catch { /* map init failed — will retry on next navigation */ }
  }

  private _refreshMapMarkers(): void {
    if (!this._map || !this._clusterGroup || !this._L) return;
    const L = this._L;
    const cluster = this._clusterGroup;
    cluster.clearLayers();
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
    const refBid = parseBid(refName ? this._getLatestBid(refName, year, crop, month) : '');

    // Search query — only filter map pins, panel stays full
    const searchQ = this.searchQuery().toLowerCase();

    // Scoular pins switch presentation on ONE thing: whether a reference location is set.
    //   no reference  → whole pin green (fill), no ring
    //   reference set → status fill (blue/red/yellow) + green ring
    // Keyed on refName, NOT on crop: picking a crop alone doesn't produce a comparison, and testing
    // crop here is what previously made the ring appear with no reference selected.
    const comparingToRef = !!refName;
    const scoularNames = this.scoularLocationNames();

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

    // View parity: All Producers (with derived crop-year data) renders bids/status like a single TU.
    const hasIndividualTu = this.hasIndividualTu() || this.cropYears().length > 0;

    // A dot / label takes its bid's beating/matching/none colour vs the reference while a reference
    // AND crop are being compared; null = no comparison running.
    const compareStatus = (name: string): BidStatus | null => {
      if (!(hasIndividualTu && refName && crop)) return null;
      const bidVal = this._getLatestBid(name, year, crop, month);
      return bidVal ? computeItemStatus(bidVal, false, refBid) : 'none';
    };

    // Pass 1: decide which coordinate groups actually render a marker (apply the skip filters once)
    // and capture the per-group flags the draw pass needs.
    const renderGroups: { locs: BidSheetLocation[]; names: string[]; isActiveTu: boolean; isRef: boolean; isPanelOpen: boolean; }[] = [];
    for (const [, locs] of locsByPos) {
      // If searching, skip this pin group unless at least one location name matches
      if (searchQ && !locs.some(l => l.name.toLowerCase().includes(searchQ))) continue;
      const names = locs.map(l => l.name);
      // In All Producers (no TU filter) every location is "in scope"; with a TU, only its locations are.
      const isActiveTu = activeTuSet.size === 0 || locs.some(l => activeTuSet.has(l.tradeUnitCode ?? ''));
      const isRef = !!(hasIndividualTu && refName && names.includes(refName));
      const isPanelOpen = !!(panelOpenName && names.includes(panelOpenName));
      // When filters are active, only show locations that appear in the panel
      if (hasTu && !names.some(n => panelNames.has(n))) continue;
      // Skip locations with no bid for the selected crop/year/month
      if (crop && !names.some(n => this._getLatestBid(n, year, crop, month))) continue;
      renderGroups.push({ locs, names, isActiveTu, isRef, isPanelOpen });
    }

    // Spread out groups whose pins would overlap on screen so none get hidden behind another. The
    // offset is measured in screen pixels at the current zoom, so as you zoom in and the true
    // positions separate, the spread shrinks and each pin glides back toward its real spot.
    const displayPos = this._spreadOverlappingPins(
      renderGroups.map(g => [g.locs[0].latitude!, g.locs[0].longitude!] as [number, number]),
      zoom
    );

    // Pass 2: draw each group at its (possibly offset) display position.
    renderGroups.forEach((g, gi) => {
      const { locs, names, isActiveTu, isRef, isPanelOpen } = g;
      const [lat, lng] = displayPos[gi];
      const showBidValues = isActiveTu && hasIndividualTu && crop;

      // Panel-open location — render expanded with name + bid (uses status color if reference, otherwise gray)
      if (isPanelOpen) {
        const bidStr = crop ? this._getLatestBid(panelOpenName, year, crop, month) : '';
        // This pin represents panelOpenName specifically, so key it to that name rather than to
        // "any location at this coordinate".
        const panelIsScoular = scoularNames.has(panelOpenName);
        const status = hasIndividualTu && refName && bidStr ? computeItemStatus(bidStr, false, refBid) : null;
        const { bg: pinBg, border: pinBorder } = pinFill(isRef, status, panelIsScoular, EXPANDED_PIN_GREY);
        const expandedIcon = L.divIcon(hoverIcon(panelOpenName, bidStr, pinBg, pinBorder, scoularNames));
        const marker = L.marker([lat, lng], { icon: expandedIcon, zIndexOffset: 1000 });
        marker.on('click', () => this._selectMapLocation(locs[0]));
        cluster.addLayer(marker);
        return;
      }

      // Below the bid-pin zoom threshold: colored dot — but when searching, always show name labels.
      // Lowered from 8 → 6 so the bid-value pins appear sooner (esp. in All Producers, which opens at
      // the wider US overview). Zoom 5 = national overview keeps dots; 6+ shows the bid pins.
      if (zoom < 6 && !searchQ) {
        // Dot stands for the whole coordinate group, so it counts as ours if ANY location here is.
        const dotIsScoular = names.some(n => scoularNames.has(n));
        // Compute dot color from bid status (matches the pill colors used when zoomed in)
        const { bg: color, border } = pinFill(isRef, compareStatus(locs[0].name), dotIsScoular);
        const icon = L.divIcon(dotIcon(color, border, comparingToRef && dotIsScoular));
        const m = L.marker([lat, lng], { icon });
        m.on('click', () => this._selectMapLocation(locs[0]));
        const hoverBid2 = crop ? this._getLatestBid(locs[0].name, year, crop, month) : '';
        this._bindHoverExpand(m, icon, locs[0].name, hoverBid2, color, border);
        cluster.addLayer(m);
        return;
      }

      if (showBidValues) {
        // Active TU with crop selected — show bid values with status colors
        const bidItems = names
          .map(n => {
            const isNameRef = hasIndividualTu && n === refName;
            const bidVal = this._getLatestBid(n, year, crop, month);
            const nameIsScoular = scoularNames.has(n);
            if (!isNameRef && !bidVal) return null;
            const status = isNameRef ? 'reference' : computeItemStatus(bidVal, false, refBid);
            const { bg, border } = bidPillFill(isNameRef, status, nameIsScoular, comparingToRef);
            return { label: isNameRef ? bidVal || '--' : bidVal, bg, border, isScoular: nameIsScoular };
          })
          .filter((x): x is BidPillItem => x !== null);

        if (bidItems.length > 0) {
          const divIcon = L.divIcon(bidPillsIcon(bidItems, comparingToRef));
          const marker = L.marker([lat, lng], { icon: divIcon });
          marker.on('click', () => this._selectMapLocation(locs[0]));
          const hoverBid3 = crop ? this._getLatestBid(locs[0].name, year, crop, month) : '';
          this._bindHoverExpand(marker, divIcon, locs[0].name, hoverBid3, bidItems[0].bg, bidItems[0].border);
          cluster.addLayer(marker);
          return;
        }
      }

      // Default: name labels — match the pill color story used elsewhere
      // Keyed to locs[0] specifically, not "any name here": this bg also drives the hover icon,
      // which shows locs[0]. Per-line fill for mixed groups is handled inside stackedLabelHtml.
      const labelIsScoular = scoularNames.has(locs[0].name);
      const { bg, border } = pinFill(isRef, compareStatus(locs[0].name), labelIsScoular);
      const nameIcon = L.divIcon(nameLabelIcon(names, bg, border, comparingToRef, scoularNames));
      const marker = L.marker([lat, lng], { icon: nameIcon });
      marker.on('click', () => this._selectMapLocation(locs[0]));
      const hoverBid4 = crop ? this._getLatestBid(locs[0].name, year, crop, month) : '';
      this._bindHoverExpand(marker, nameIcon, locs[0].name, hoverBid4, bg, border);
      cluster.addLayer(marker);
    });
  }

  /** Spreads overlapping pins apart in screen space at the current zoom (see utils/pin-spread). */
  private _spreadOverlappingPins(points: [number, number][], zoom: number): [number, number][] {
    const L = this._L, map = this._map;
    if (!L || !map) return points;
    return spreadOverlappingPins(
      points,
      (lat, lng) => map.project(L.latLng(lat, lng), zoom),
      (x, y) => { const ll = map.unproject(L.point(x, y), zoom); return [ll.lat, ll.lng]; }
    );
  }

  /** Binds hover expand behavior to a marker — swaps icon on mouseover/mouseout.
   *  Tracks the currently-hovered marker and force-resets it when another marker is hovered,
   *  which prevents stuck labels when markers sit close together and setIcon() eats the mouseout. */
  private _bindHoverExpand(marker: Leaflet.Marker, originalIcon: Leaflet.DivIcon, name: string, bid: string, bg: string, border: string): void {
    const expanded = this._L!.divIcon(hoverIcon(name, bid, bg, border, this.scoularLocationNames()));
    marker.on('mouseover', () => {
      // Reset any other marker that's still stuck on its hover icon (and its raised z-index)
      if (this._hoveredMarker && this._hoveredMarker.marker !== marker) {
        try {
          this._hoveredMarker.marker.setIcon(this._hoveredMarker.resetIcon);
          this._hoveredMarker.marker.setZIndexOffset(0);
        } catch { /* marker may have been removed */ }
      }
      marker.setIcon(expanded);
      // Raise above neighbors so the expanded bid is never hidden behind an overlapping pin
      try { marker.setZIndexOffset(2000); } catch { /* ignore */ }
      this._hoveredMarker = { marker, resetIcon: originalIcon };
    });
    marker.on('mouseout', () => {
      marker.setIcon(originalIcon);
      try { marker.setZIndexOffset(0); } catch { /* ignore */ }
      if (this._hoveredMarker?.marker === marker) this._hoveredMarker = null;
    });
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
      this._streetLayer = null;
      this._satelliteLayer = null;
      this._satelliteImageryLayer = null;
      this._isMapInitialized = false;
    }
  }

}
