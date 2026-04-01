import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import type * as Leaflet from 'leaflet';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
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

@Component({
  selector: 'app-bid-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule, TradeUnitSelectorComponent],
  templateUrl: './bid-sheet.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:block;height:calc(100vh - 160px);' }
})
export class BidSheetComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);

  // --- Filters ---
  readonly hasIndividualTu = computed(() => this.appState.selectedTradeUnits().length > 0);
  selectedYear = signal<number>(new Date().getFullYear());
  selectedCrop = signal<string>('');
  searchQuery = signal<string>('');
  selectedBasis = signal<string>('all');

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
        bid: bid.bid,
        createdBy: bid.createdBy,
        createdAt: bid.createdAt,
        modifiedBy: bid.modifiedBy,
        modifiedAt: bid.modifiedAt
      }))
    );
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
    const years = this.cropYears();
    return years.length >= 2 && (years.length - 2 + this.yearOffset()) > 0;
  });
  canShiftYearsForward = computed(() => this.yearOffset() < 0);

  // --- Reference (per trade unit, persisted to DB) ---
  // Map of tradeUnitCode → { locationId, name }, loaded from API when TUs change.
  private referenceByTu = signal<Map<string, { locationId: number; name: string }>>(new Map());
  showReferenceConfirm = signal<boolean>(false);
  pendingReferenceName = signal<string>('');
  pendingReferenceLocId = signal<number>(0);

  // Reference location name for the currently active trade unit.
  readonly referenceLocationName = computed(() => {
    const tu = this.activeTradeUnit();
    return this.referenceByTu().get(tu)?.name ?? '';
  });

  readonly referenceLocationId = computed(() => {
    const tu = this.activeTradeUnit();
    return this.referenceByTu().get(tu)?.locationId ?? 0;
  });

  // --- Panel ---
  showPanel = signal<boolean>(false);
  filteredBidItems = signal<any[]>([]);
  selectedLocationName = signal<string>('');
  panelSelectedLocation = signal<string>('');
  showDeleteLocationConfirm = signal(false);
  editingLocationName = signal(false);
  editLocationNameValue = signal('');

  /** All crop/bid rows for the location selected in the panel */
  readonly panelLocationBids = computed(() => {
    const name = this.panelSelectedLocation();
    if (!name) return [];
    const oldYr = this.oldYear();
    const newYr = this.newYear();
    const entries = this.bidEntries().filter(e => e.name === name);
    const cropSet = [...new Set(entries.map(e => e.commodityCode).filter(Boolean))].sort();
    return cropSet.map(crop => ({
      crop: crop!,
      oldBid: this._getLatestBid(name, oldYr, crop!),
      newBid: this._getLatestBid(name, newYr, crop!)
    }));
  });

  // --- Edit Bids ---
  editBidsMode = signal(false);
  showAddCommoditySearch = signal(false);
  addCommodityQuery = signal('');
  editBidsYear = signal<number>(new Date().getFullYear());
  editBidsCrop = signal<string>('');
  editBidsRows = signal<EditBidsRow[]>([]);
  editBidsSaving = signal(false);
  editBidsGridLoading = signal(false);

  readonly editBidsCrops = computed(() => {
    const filter = this.editBidsCrop();
    return filter ? this.crops().filter(c => c === filter) : this.crops();
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
  private _addLocationPin: any = null;

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
  filteredCommodities(query: string): { code: string; name: string }[] {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    const seen = new Set<string>();
    const results: { code: string; name: string }[] = [];
    for (const c of this.allCommodities()) {
      const code = (c.code ?? '').trim();
      const cat = (c.category ?? '').trim().toUpperCase();
      const desc = (c.name ?? '').trim();
      if (!code || seen.has(code) || BidSheetComponent._excludedCommodityCategories.has(cat)) continue;
      if (code.toLowerCase().includes(q) || desc.toLowerCase().includes(q) || cat.toLowerCase().includes(q)) {
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
  private _refreshTimer: any = null;

  // --- Map ---
  private _map: any = null;
  private _clusterGroup: any = null;
  private _isMapInitialized = false;
  private _lastTuSet = '';

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

  constructor() {
    // Load all bid sheet locations for map display (once)
    this._loadAllMapLocations();

    // Load commodities on init (once)
    this.apiService.getCommodities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (commodities) => this.allCommodities.set(commodities),
      error: () => {}
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
      error: () => {}
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
      this._loadBidData(tus, () => {
        this._zoomToBidLocations();
        // If edit bids is open, rebuild the grid with new data
        if (this.editBidsMode()) {
          this._buildEditGrid(this.editBidsYear());
        }
      });
      this._loadReferences(tus);
      this.filterBids();
      this._refreshMapMarkers();
    } else {
      this.tradeUnitElevators.set([]);
      this.bidLocations.set([]);
      this.referenceByTu.set(new Map());
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

  private _loadReferences(tus: string[]): void {
    tus.forEach(tu => {
      this.apiService.getBidSheetReference(tu).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(ref => {
        const map = new Map(this.referenceByTu());
        if (ref?.locationId && ref?.name) {
          map.set(tu, { locationId: ref.locationId, name: ref.name });
        } else {
          map.delete(tu);
        }
        this.referenceByTu.set(map);
        this.filterBids();
        this._refreshMapMarkers();
      });
    });
  }

  private _zoomToBidLocations(): void {
    if (!this._map || !this._L) return;
    const locs = this.bidLocations().filter(l => l.latitude && l.longitude);
    if (locs.length === 0) return;

    // Prioritize: reference location → first location
    const refName = this.referenceLocationName();
    const refLoc = refName ? locs.find(l => l.name === refName) : null;
    const panelOpen = this.showPanel();
    const rightPad = panelOpen ? 440 : 50;

    if (refLoc) {
      this._map.setView([refLoc.latitude!, refLoc.longitude!], 10, { animate: true });
      if (panelOpen) setTimeout(() => this._map?.panBy([-(rightPad / 2), 0]), 300);
    } else if (locs.length === 1) {
      this._map.setView([locs[0].latitude!, locs[0].longitude!], 10, { animate: true });
      if (panelOpen) setTimeout(() => this._map?.panBy([-(rightPad / 2), 0]), 300);
    } else {
      const bounds = this._L.latLngBounds(locs.map(l => [l.latitude!, l.longitude!] as [number, number]));
      this._map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [rightPad, 50], maxZoom: 12 });
    }
  }

  private _loadBidData(tradeUnitCodes: string[], onLoaded?: () => void): void {
    if (tradeUnitCodes.length === 0) return;
    this.isLoading.set(true);

    forkJoin(
      tradeUnitCodes.map(tu => forkJoin({
        locations: this.apiService.getBidSheetLocations(tu),
        cropYears: this.apiService.getBidCropYears(tu),
        bidCommodities: this.apiService.getBidCommodities(tu)
      }))
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (results) => {
        const allLocations = results.flatMap(r => r.locations);
        let cropYears = [...new Set(results.flatMap(r => r.cropYears))].sort((a, b) => a - b);
        const bidCommodities = [...new Set(results.flatMap(r => r.bidCommodities))].sort();

        this.bidLocations.set(allLocations);
        this.crops.set(bidCommodities);

        if (!this.selectedCrop() || (bidCommodities.length > 0 && !bidCommodities.includes(this.selectedCrop()))) {
          this.selectedCrop.set(bidCommodities.length > 0 ? bidCommodities[0] : '');
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
        this.toastService.error('Failed to load bid data');
      }
    });
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
  }

  shiftYearsBack(): void {
    if (this.canShiftYearsBack()) {
      this.yearOffset.update(o => o - 1);
      const yr = this.newYear();
      if (yr) this.selectedYear.set(yr);
      this.onFilterChange();
    }
  }

  shiftYearsForward(): void {
    if (this.canShiftYearsForward()) {
      this.yearOffset.update(o => o + 1);
      const yr = this.newYear();
      if (yr) this.selectedYear.set(yr);
      this.onFilterChange();
    }
  }

  /** Search input only filters map pins — panel stays full */
  onSearchInput(): void {
    this._refreshMapMarkers();
  }

  filterBids(): void {
    const hasTu = this.activeTradeUnits().length > 0;
    const hasIndividualTu = this.appState.selectedTradeUnits().length > 0;
    const basis = this.selectedBasis();

    let items: any[] = [];

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
      const oldYr = this.oldYear();
      const newYr = this.newYear();

      // Compute reference bids per year for status comparison
      const refName = this.referenceLocationName();
      let oldRefBid: number | null = NaN;
      let newRefBid: number | null = NaN;
      if (hasIndividualTu && refName) {
        oldRefBid = this._parseBid(this._getLatestBid(refName, oldYr, crop));
        newRefBid = this._parseBid(this._getLatestBid(refName, newYr, crop));
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
        const oldBid = this._getLatestBid(name, oldYr, crop);
        const newBid = this._getLatestBid(name, newYr, crop);
        const entryWithCoords = this.bidEntries().find(e => e.name === name);
        const oldEntry = this._getLatestEntry(name, oldYr, crop);
        const newEntry = this._getLatestEntry(name, newYr, crop);
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
          oldStatus: isRef ? 'reference' : (hasIndividualTu ? this._computeItemStatus(oldBid, false, oldRefBid, oldEntry?.modifiedAt) : 'none'),
          newStatus: isRef ? 'reference' : (hasIndividualTu ? this._computeItemStatus(newBid, false, newRefBid, newEntry?.modifiedAt) : 'none'),
          status: isRef ? 'reference' : (hasIndividualTu ? this._computeItemStatus(newBid, false, newRefBid, newEntry?.modifiedAt) : 'none')
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

  private _getLatestBid(name: string, year: number | null, commodityCode: string): string {
    if (!year || !commodityCode) return '';
    const matching = this.bidEntries().filter(
      e => e.name === name && e.commodityCode === commodityCode && e.cropYear === year
    );
    if (matching.length === 0) return '';
    // Sort by modifiedAt first (updated bids), then createdAt as fallback
    return matching.sort((a, b) => {
      const aTime = new Date(a.modifiedAt || a.createdAt).getTime();
      const bTime = new Date(b.modifiedAt || b.createdAt).getTime();
      return bTime - aTime;
    })[0].bid;
  }

  private _getLatestEntry(name: string, year: number | null, commodityCode: string): BidSheetEntry | null {
    if (!year || !commodityCode) return null;
    const matching = this.bidEntries().filter(
      e => e.name === name && e.commodityCode === commodityCode && e.cropYear === year
    );
    if (matching.length === 0) return null;
    return matching.sort((a, b) => new Date(b.modifiedAt || b.createdAt).getTime() - new Date(a.modifiedAt || a.createdAt).getTime())[0];
  }

  private _parseBid(bid: string): number | null {
    const n = parseFloat(bid);
    return isNaN(n) ? null : n;
  }

  private _computeItemStatus(newBidStr: string, isRef: boolean, refBid: number | null, modifiedAt?: string | Date | null): string {
    if (isRef) return 'reference';
    // Changed in last 24 hours takes priority over beating/matching
    if (modifiedAt) {
      const modified = new Date(modifiedAt);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (modified > oneDayAgo) return 'changed';
    }
    const newNum = this._parseBid(newBidStr);
    if (refBid !== null && newNum !== null) {
      if (newNum > refBid) return 'beating';
      if (newNum === refBid) return 'matching';
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
    const bids = crops.flatMap(crop => {
      const code = crop.commodityCode.trim();
      return [
        { commodityCode: code, commodityName: code, commodityCategory: code, cropYear: crop.oldYear, bid: crop.oldBid.trim() },
        { commodityCode: code, commodityName: code, commodityCategory: code, cropYear: crop.newYear, bid: crop.newBid.trim() }
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
    this.editBidsYear.set(year);
    this.editBidsCrop.set('');
    this._buildEditGrid(year);
    this.editBidsMode.set(true);

    // Focus the first crop input for the selected location
    if (focusLocation) {
      setTimeout(() => {
        const rowIdx = this.editBidsRows().findIndex(r => r.name === focusLocation);
        const firstCrop = this.editBidsCrops()[0];
        if (rowIdx >= 0 && firstCrop) {
          const el = document.getElementById(`bid-${rowIdx}-${firstCrop}`);
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
    const entries = this.bidEntries().filter(e => e.cropYear === year);
    const crops = this.crops();
    const rows: EditBidsRow[] = [];
    const addedNames = new Set<string>();

    // Add locations that have bid entries
    const uniqueNames = [...new Set(this.bidEntries().map(e => e.name))];
    for (const name of uniqueNames) {
      addedNames.add(name);
      const rep = this.bidEntries().find(e => e.name === name);
      const bids: Record<string, string> = {};
      for (const crop of crops) {
        const latest = entries
          .filter(e => e.name === name && e.commodityCode === crop)
          .sort((a, b) => new Date(b.modifiedAt || b.createdAt).getTime() - new Date(a.modifiedAt || a.createdAt).getTime())[0];
        bids[crop] = latest?.bid ?? '';
      }
      rows.push({ name, type: 'entry', elevatorCode: rep?.elevatorCode, tradeUnitCode: rep?.tradeUnitCode, latitude: rep?.latitude, longitude: rep?.longitude, bids, originalBids: { ...bids } });
    }

    // Also include locations with no bids yet (e.g. just added from Edit Bids)
    for (const loc of this.bidLocations()) {
      if (addedNames.has(loc.name)) continue;
      addedNames.add(loc.name);
      const bids: Record<string, string> = {};
      for (const crop of crops) { bids[crop] = ''; }
      rows.push({ name: loc.name, type: 'entry', elevatorCode: loc.elevatorCode, tradeUnitCode: loc.tradeUnitCode, latitude: loc.latitude, longitude: loc.longitude, bids, originalBids: { ...bids } });
    }

    this.editBidsRows.set(rows);
  }

  applyEditBidsTuFilter(): void {
    const tus = this.activeTradeUnits();
    if (tus.length === 0) return;
    this.editBidsGridLoading.set(true);
    this._loadReferences(tus);
    const start = Date.now();
    this._loadBidData(tus, () => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 1000 - elapsed);
      setTimeout(() => {
        this._buildEditGrid(this.editBidsYear());
        this.editBidsGridLoading.set(false);
        this.filterBids();
        this._refreshMapMarkers();
      }, remaining);
    });
  }

  onEditBidsYearChange(year: number): void {
    this.editBidsYear.set(year);
    this.editBidsGridLoading.set(true);
    setTimeout(() => {
      this._buildEditGrid(year);
      this.editBidsGridLoading.set(false);
    }, 400);
  }

  updateBid(rowIndex: number, crop: string, value: string): void {
    this.editBidsRows.update(rows => {
      const updated = [...rows];
      updated[rowIndex] = { ...updated[rowIndex], bids: { ...updated[rowIndex].bids, [crop]: value } };
      return updated;
    });
  }

  saveEditBids(): void {
    const year = this.editBidsYear();
    const tu = this.activeTradeUnit();
    const commodityLookup = new Map(this.allCommodities().map(c => [c.code, c]));
    const toCreate: Array<{ name?: string; elevatorCode?: string; tradeUnitCode?: string; groupName?: string; latitude?: number; longitude?: number; commodityCode: string; commodityName?: string; commodityCategory?: string; cropYear: number; bid: string }> = [];

    for (const row of this.editBidsRows()) {
      for (const crop of this.crops()) {
        const current = (row.bids[crop] ?? '').trim();
        const original = (row.originalBids[crop] ?? '').trim();
        if (current !== original && current) {
          const commodity = commodityLookup.get(crop);
          toCreate.push({
            name: row.name,
            latitude: row.latitude,
            longitude: row.longitude,
            elevatorCode: row.elevatorCode,
            tradeUnitCode: row.tradeUnitCode || tu,
            groupName: this._getGroupNameForTu(row.tradeUnitCode || tu) || undefined,
            commodityCode: crop,
            commodityName: commodity?.name,
            commodityCategory: commodity?.category ?? undefined,
            cropYear: year,
            bid: current
          });
        }
      }
    }

    if (toCreate.length === 0) { this._closeEditBids(); return; }

    this.editBidsSaving.set(true);
    this.apiService.bulkUpsertBidSheetBids(toCreate)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.editBidsSaving.set(false);
          this._closeEditBids();
          this.toastService.success(`Saved ${toCreate.length} bid update${toCreate.length !== 1 ? 's' : ''}`);
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
    this.editBidsMode.set(false);
    this.panelSelectedLocation.set('');
    this.selectedLocationName.set('');
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
  // Reference
  // =========================================================================

  pendingClearReference = signal(false);

  setReferenceLocation(locationId: number, name: string): void {
    if (this.referenceLocationName() === name) {
      // Already the reference — confirm clearing it
      this.pendingClearReference.set(true);
      this.pendingReferenceName.set(name);
      this.showReferenceConfirm.set(true);
    } else {
      this.pendingClearReference.set(false);
      this.pendingReferenceLocId.set(locationId);
      this.pendingReferenceName.set(name);
      this.showReferenceConfirm.set(true);
    }
  }

  confirmReferenceChange(): void {
    const tu = this.activeTradeUnit();
    if (!tu) return;

    if (this.pendingClearReference()) {
      // Clear reference
      const map = new Map(this.referenceByTu());
      map.delete(tu);
      this.referenceByTu.set(map);
      this._resetReferenceConfirm();
      this.filterBids();
      this._refreshMapMarkers();

      // Persist to DB
      const clearedName = this.pendingReferenceName();
      this.apiService.clearBidSheetReference(tu).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.toastService.success(`${clearedName} removed as reference`),
        error: () => this.toastService.error('Failed to clear reference')
      });
    } else {
      // Set reference
      const locId = this.pendingReferenceLocId();
      const name = this.pendingReferenceName();
      if (!locId || !name) return;

      const map = new Map(this.referenceByTu());
      map.set(tu, { locationId: locId, name });
      this.referenceByTu.set(map);
      this._resetReferenceConfirm();
      this.filterBids();
      this._refreshMapMarkers();

      // Persist to DB
      this.apiService.setBidSheetReference(tu, locId, name).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.toastService.success(`${name} set as reference`),
        error: () => this.toastService.error('Failed to save reference')
      });
    }
  }

  cancelReferenceChange(): void {
    this._resetReferenceConfirm();
  }

  private _resetReferenceConfirm(): void {
    this.pendingReferenceLocId.set(0);
    this.pendingReferenceName.set('');
    this.pendingClearReference.set(false);
    this.showReferenceConfirm.set(false);
  }

  // =========================================================================
  // Panel helpers
  // =========================================================================

  selectItemFromTable(item: any): void {
    const alreadySelected = this.selectedLocationName() === item.name;
    this.panelSelectedLocation.set(alreadySelected ? '' : item.name);
    this.selectedLocationName.set(alreadySelected ? '' : item.name);
    this.showPanel.set(true);

    // Auto-select the location's TU if no individual TU is selected (enables reference + status features)
    if (!alreadySelected && !this.hasIndividualTu() && item.latitude != null) {
      const loc = this.allMapLocations().find(l => l.name === item.name);
      if (loc?.tradeUnitCode) {
        this.appState.setTradeUnits([loc.tradeUnitCode]);
      }
    }

    this._refreshMapMarkers();
  }

  panelGoBack(): void {
    this.panelSelectedLocation.set('');
    this.selectedLocationName.set('');
    this.showDeleteLocationConfirm.set(false);
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

  panelSetReference(): void {
    const name = this.panelSelectedLocation();
    if (!name) return;
    const loc = this.allMapLocations().find(l => l.name === name);
    if (loc) {
      this.setReferenceLocation(loc.id, loc.name);
    }
  }

  selectPanelItem(item: any): void {
    if (item.type === 'entry') {
      this.selectItemFromTable(item);
    }
    // Pan map to the selected location, offset left if panel is open
    if (this._map && item.latitude != null && item.longitude != null) {
      this._map.flyTo([item.latitude, item.longitude], Math.max(this._map.getZoom(), 11));
      if (this.showPanel()) {
        setTimeout(() => this._map?.panBy([-200, 0]), 300);
      }
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

    // Set the group and trade unit in app state — this triggers _onTradeUnitsChanged via the effect
    if (groupName) {
      this.appState.setSelectedGroupNames([groupName]);
    }
    if (tu) {
      this.appState.setTradeUnits([tu]);
    }

    // Zoom to location, offset left to account for panel opening
    if (this._map && loc.latitude && loc.longitude) {
      this._map.flyTo([loc.latitude, loc.longitude], Math.max(this._map.getZoom(), 11));
      setTimeout(() => this._map?.panBy([-200, 0]), 300);
    }

    this.panelSelectedLocation.set(loc.name);
    this.showPanel.set(true);
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
    this._loadAllMapLocations();
    const tus = this.activeTradeUnits();
    if (tus.length > 0) {
      this._loadBidData(tus, () => this.isRefreshing.set(false));
      this._loadReferences(tus);
    } else {
      // No TU — just wait a beat so the spinner is visible
      setTimeout(() => this.isRefreshing.set(false), 600);
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
    this._refreshTimer = setInterval(() => this._updateTimeSinceRefresh(), 1000);
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

    const mapElement = document.getElementById('bid-locations-map');
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
        maxClusterRadius: 40,
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

      // Re-render markers when zoom changes (dot vs label at different zoom levels)
      this._map.on('zoomend', () => this._refreshMapMarkers());

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

    const locKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const activeTuSet = new Set(activeTus);
    const crop = this.selectedCrop();
    const year = this.selectedYear();
    const oldYr = this.oldYear();
    const newYr = this.newYear();

    // Reference bid for status comparison (when TU is active)
    const refName = this.referenceLocationName();
    const refBid = this._parseBid(refName ? this._getLatestBid(refName, newYr, crop) : '');

    const statusColors: Record<string, { bg: string; border: string }> = {
      reference: { bg: '#2563eb', border: '#1d4ed8' },
      beating:   { bg: '#dc2626', border: '#991b1b' },
      matching:  { bg: '#eab308', border: '#a16207' },
      changed:   { bg: '#22c55e', border: '#15803d' },
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

    // Build set of location names visible in the panel (respects crop/TU/search filters)
    const panelNames = new Set(this.filteredBidItems().map((i: any) => i.name as string));

    for (const [, locs] of locsByPos) {
      // If searching, skip this pin group unless at least one location name matches
      if (searchQ && !locs.some(l => l.name.toLowerCase().includes(searchQ))) continue;
      const lat = locs[0].latitude!;
      const lng = locs[0].longitude!;
      const names = locs.map(l => l.name);
      const isActiveTu = locs.some(l => activeTuSet.has(l.tradeUnitCode ?? ''));
      const hasIndividualTu = this.appState.selectedTradeUnits().length > 0;
      const showBidValues = isActiveTu && hasIndividualTu && crop;
      const isRef = hasIndividualTu && refName && names.includes(refName);

      // When filters are active, only show locations that appear in the panel
      if (hasTu && !names.some(n => panelNames.has(n))) continue;
      const isSelected = selectedName && names.includes(selectedName);

      // Selected location — enlarged pin: name on top, crop + bid underneath, keeps status color
      if (isSelected) {
        const selName = selectedName;
        const bidStr = crop ? this._getLatestBid(selName, newYr, crop) : '';
        const selEntry = crop ? this._getLatestEntry(selName, newYr, crop) : null;
        const isSelRef = selName === refName;
        const status = hasIndividualTu ? this._computeItemStatus(bidStr, isSelRef, refBid, selEntry?.modifiedAt) : 'none';
        const { bg: selBg, border: selBorder } = statusColors[status] ?? statusColors['none'];
        const nameHtml = `<div style="font-size:11px;font-weight:700;color:#fff;white-space:nowrap;line-height:1.2;">${this._esc(selName)}</div>`;
        const cropLabel = crop || '';
        const bidLabel = bidStr || '--';
        const subHtml = cropLabel
          ? `<div style="font-size:10px;font-weight:500;color:rgba(255,255,255,0.85);white-space:nowrap;line-height:1.2;margin-top:2px;">${this._esc(cropLabel)} · ${this._esc(bidLabel)}</div>`
          : '';
        const textLen = Math.max(selName.length, cropLabel.length + bidLabel.length + 3);
        const w = Math.max(100, textLen * 7 + 24);
        const h = cropLabel ? 54 : 40;
        const selIcon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="position:relative;text-align:center;display:flex;flex-direction:column;align-items:center;">
            <div style="background:${selBg};border:2.5px solid ${selBorder};border-radius:8px;padding:6px 10px;box-shadow:0 4px 12px rgba(0,0,0,0.35);cursor:pointer;">${nameHtml}${subHtml}</div>
            <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid ${selBg};margin:-1px auto 0;"></div>
          </div>`,
          iconSize: [w, h],
          iconAnchor: [w / 2, h]
        });
        const m = L.marker([lat, lng], { icon: selIcon, zIndexOffset: 1000 });
        m.on('click', () => this._selectMapLocation(locs[0]));
        this._clusterGroup.addLayer(m);
        continue;
      }

      // Below zoom threshold: colored dot — but when searching, always show name labels
      if (zoom < 8 && !searchQ) {
        const color = isRef ? '#2563eb' : (isActiveTu && hasIndividualTu) ? '#00875F' : '#9ca3af';
        const border = isRef ? '#1d4ed8' : (isActiveTu && hasIndividualTu) ? '#006B4C' : '#6b7280';
        const dotIcon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="width:14px;height:14px;background:${color};border:2px solid ${border};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7]
        });
        const m = L.marker([lat, lng], { icon: dotIcon });
        m.on('click', () => this._selectMapLocation(locs[0]));
        this._clusterGroup.addLayer(m);
        continue;
      }

      if (showBidValues) {
        // Active TU with crop selected — show bid values with status colors
        const bidItems = names
          .map(n => {
            const isNameRef = hasIndividualTu && n === refName;
            if (isNameRef) {
              const matched = this.bidEntries()
                .filter(e => e.name === n && e.commodityCode === crop && e.cropYear === year)
                .sort((a, b) => new Date(b.modifiedAt || b.createdAt).getTime() - new Date(a.modifiedAt || a.createdAt).getTime())[0];
              const { bg, border } = statusColors['reference'];
              return { name: n, label: matched?.bid ?? '--', bg, border };
            }
            const matched = this.bidEntries()
              .filter(e => e.name === n && e.commodityCode === crop && e.cropYear === year)
              .sort((a, b) => new Date(b.modifiedAt || b.createdAt).getTime() - new Date(a.modifiedAt || a.createdAt).getTime())[0];
            if (!matched) return null;
            const newBidStr = matched.bid ?? '';
            const status = this._computeItemStatus(newBidStr, false, refBid, matched.modifiedAt);
            const { bg, border } = statusColors[status] ?? statusColors['none'];
            return { name: n, label: matched.bid, bg, border };
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
          this._clusterGroup.addLayer(marker);
          continue;
        }
      }

      // Default: name labels (blue for reference, green for active TU, gray otherwise)
      const bg = isRef ? '#2563eb' : (isActiveTu && hasIndividualTu) ? '#00875F' : '#9ca3af';
      const border = isRef ? '#1d4ed8' : (isActiveTu && hasIndividualTu) ? '#006B4C' : '#6b7280';
      const maxWidth = Math.max(80, ...names.map(n => n.length * 6 + 20));
      const nameIcon = L.divIcon({
        className: 'custom-marker',
        html: this._buildStackedLabel(names, bg, border),
        iconSize: [maxWidth, names.length * 26 + 8],
        iconAnchor: [maxWidth / 2, names.length * 26 + 8]
      });
      const marker = L.marker([lat, lng], { icon: nameIcon });
      marker.on('click', () => this._selectMapLocation(locs[0]));
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

  // Template helpers
  getPendingReferenceName(): string {
    return this.pendingReferenceName();
  }

  getReferenceName(): string {
    return this.referenceLocationName();
  }
}
