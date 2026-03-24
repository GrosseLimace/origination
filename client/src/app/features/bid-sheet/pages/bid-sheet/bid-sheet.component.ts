import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import * as L from 'leaflet';
import 'leaflet.markercluster';
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
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BidSheetComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);

  // --- Filters ---
  selectedYear = signal<number>(new Date().getFullYear());
  selectedCrop = signal<string>('');
  searchQuery = signal<string>('');
  selectedBasis = signal<string>('all');

  // --- Data ---
  allElevators = signal<Elevator[]>([]);           // ALL elevators from ODS (loaded once)
  tradeUnitElevators = signal<Elevator[]>([]);     // Filtered to selected trade unit
  bidLocations = signal<BidSheetLocation[]>([]);
  /** Flattened view of bidLocations — each location×bid becomes one BidSheetEntry row. */
  readonly bidEntries = computed<BidSheetEntry[]>(() =>
    this.bidLocations().flatMap(loc =>
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
    )
  );
  cropYears = signal<number[]>([]);
  crops = signal<string[]>([]);
  isLoading = signal<boolean>(false);

  // --- Old/New year logic (data-driven) ---
  oldYear = computed(() => {
    const years = this.cropYears();
    return years.length >= 2 ? years[years.length - 2] : null;
  });
  newYear = computed(() => {
    const years = this.cropYears();
    return years.length >= 1 ? years[years.length - 1] : null;
  });

  // --- Reference ---
  referenceElevatorCode = signal<string>('');
  showReferenceConfirm = signal<boolean>(false);
  pendingReferenceCode = signal<string>('');

  get referenceElevator(): Elevator | null {
    const code = this.referenceElevatorCode();
    return code ? this.allElevators().find(e => (e.elevatorCode ?? '').trim() === code.trim()) ?? null : null;
  }

  // --- Panel ---
  showPanel = signal<boolean>(false);
  filteredBidItems = signal<any[]>([]);

  // --- Edit Bids ---
  editBidsMode = signal(false);
  editBidsYear = signal<number>(new Date().getFullYear());
  editBidsCrop = signal<string>('');
  editBidsRows = signal<EditBidsRow[]>([]);
  editBidsSaving = signal(false);

  readonly editBidsCrops = computed(() => {
    const filter = this.editBidsCrop();
    return filter ? this.crops().filter(c => c === filter) : this.crops();
  });

  // --- Commodities lookup ---
  allCommodities = signal<Commodity[]>([]);

  // --- Add competitor modal ---
  addLocationMode = signal<boolean>(false);       // map is in "pick location" mode
  showAddLocationForm = signal<boolean>(false);    // form popup is open
  newLocationName = signal<string>('');
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

  // TUs available for selection when adding a location — mirrors activeTradeUnits()
  readonly addLocationTus = computed(() => this.activeTradeUnits());

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
      const cat = (c.category ?? '').trim().toUpperCase();
      if (!cat || seen.has(cat) || BidSheetComponent._excludedCommodityCategories.has(cat)) continue;
      if (cat.toLowerCase().includes(q)) {
        seen.add(cat);
        results.push({ code: cat, name: cat });
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
    // Load ALL elevators and commodities on init (once)
    this._loadAllElevators();
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
    setTimeout(() => this._initializeMap(), 500);

    this.destroyRef.onDestroy(() => {
      this._destroyMap();
      if (this._refreshTimer) clearInterval(this._refreshTimer);
    });
  }

  // =========================================================================
  // Data Loading
  // =========================================================================

  private _loadAllElevators(): void {
    this.apiService.getElevators().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (elevators) => {
        this.allElevators.set(elevators);
        this._refreshMapMarkers();
        // If TUs are already selected (navigated from another page), apply them now
        const tus = this.activeTradeUnits();
        if (tus.length > 0) this._onTradeUnitsChanged(tus);
      },
      error: () => this.toastService.error('Failed to load elevators')
    });
  }

  private _onTradeUnitsChanged(tus: string[]): void {
    if (tus.length > 0) {
      // Filter all elevators to any of the active TU codes
      const tuSet = new Set(tus);
      const tuElevators = this.allElevators().filter(e => tuSet.has((e.tradeUnitCode ?? '').trim()));
      this.tradeUnitElevators.set(tuElevators);
      // Load bid data for all active TUs
      this._loadBidData(tus);
      this._zoomToTradeUnit(tuElevators);
      this.filterBids();
      this._refreshMapMarkers();
    } else {
      this.tradeUnitElevators.set([]);
      this.bidLocations.set([]);
      this.cropYears.set([]);
      this.crops.set([]);
      this.referenceElevatorCode.set('');
      this.filterBids();
      this._refreshMapMarkers();
      // Reset map to US overview
      if (this._map) this._map.setView([38.5, -98.0], 5);
    }
  }

  private _zoomToTradeUnit(elevators: Elevator[]): void {
    if (!this._map || elevators.length === 0) return;
    const withCoords = elevators.filter(e => e.latitude && e.longitude);
    if (withCoords.length === 0) return;

    if (withCoords.length === 1) {
      this._map.setView([withCoords[0].latitude!, withCoords[0].longitude!], 10);
    } else {
      const bounds = L.latLngBounds(withCoords.map(e => [e.latitude!, e.longitude!] as L.LatLngTuple));
      this._map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    }
  }

  private _loadBidData(tradeUnitCodes: string[]): void {
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
        if (!cropYears.includes(this.selectedYear())) {
          this.selectedYear.set(cropYears.includes(currentYear) ? currentYear : cropYears[cropYears.length - 1]);
        }

        this.isLoading.set(false);
        this.filterBids();
        this._refreshMapMarkers();
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

  filterBids(): void {
    if (this.activeTradeUnits().length === 0) { this.filteredBidItems.set([]); return; }

    const crop = this.selectedCrop();
    const oldYr = this.oldYear();
    const newYr = this.newYear();
    const refCode = this.referenceElevatorCode();
    const query = this.searchQuery().toLowerCase();
    const basis = this.selectedBasis();

    // Get the reference elevator's bid for the new year (used for status comparison)
    const refElev = this.referenceElevator;
    const refName = refElev
      ? (((refElev.elevatorName ?? '') || (refElev.elevatorShortName ?? '')).trim() || (refElev.elevatorCode ?? '').trim())
      : '';
    const refBid = this._parseBid(refName ? this._getLatestBid(refName, newYr, crop) : '');

    let items: any[] = [];

    // Add trade unit elevators owned by Scoular (OurFacility = 'Y') only
    for (const elev of this.tradeUnitElevators()) {
      const code = (elev.elevatorCode ?? '').trim();
      if (!code) continue;
      if ((elev.ourFacility ?? '').trim() !== 'Y') continue;
      const name = ((elev.elevatorName ?? '') || (elev.elevatorShortName ?? '')).trim() || code;
      const isRef = code === refCode;
      const oldBid = this._getLatestBid(name, oldYr, crop);
      const newBid = this._getLatestBid(name, newYr, crop);

      items.push({
        type: 'elevator',
        elevatorCode: code,
        name,
        isScoular: true,
        isRef,
        latitude: elev.latitude ?? null,
        longitude: elev.longitude ?? null,
        oldBid,
        newBid,
        status: this._computeItemStatus(newBid, oldBid, isRef, refBid)
      });
    }

    // Add competitor entries (unique names) — filter by crop if one is selected
    const entries = crop
      ? this.bidEntries().filter(e => e.commodityCode === crop)
      : this.bidEntries();
    const uniqueNames = [...new Set(entries.map(e => e.name))];
    for (const name of uniqueNames) {
      const oldBid = this._getLatestBid(name, oldYr, crop);
      const newBid = this._getLatestBid(name, newYr, crop);
      const entryWithCoords = this.bidEntries().find(e => e.name === name);

      items.push({
        type: 'entry',
        name,
        isScoular: false,
        isRef: false,
        latitude: entryWithCoords?.latitude ?? null,
        longitude: entryWithCoords?.longitude ?? null,
        oldBid,
        newBid,
        status: this._computeItemStatus(newBid, oldBid, false, refBid)
      });
    }

    // Search filter
    if (query) {
      items = items.filter(item =>
        item.isRef || item.name.toLowerCase().includes(query)
      );
    }

    // Status (basis) filter — always keep the reference item
    if (basis !== 'all') {
      items = items.filter(item => item.status === 'reference' || item.status === basis);
    }

    // Sort: reference first, then Scoular elevators, then competitors
    items.sort((a, b) => {
      if (a.isRef) return -1;
      if (b.isRef) return 1;
      if (a.type === 'elevator' && b.type !== 'elevator') return -1;
      if (a.type !== 'elevator' && b.type === 'elevator') return 1;
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
    return matching.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].bid;
  }

  private _parseBid(bid: string): number | null {
    const n = parseFloat(bid);
    return isNaN(n) ? null : n;
  }

  private _computeItemStatus(newBidStr: string, oldBidStr: string, isRef: boolean, refBid: number | null): string {
    if (isRef) return 'reference';
    const newNum = this._parseBid(newBidStr);
    if (refBid !== null && newNum !== null) {
      if (newNum > refBid) return 'beating';
      if (newNum === refBid) return 'matching';
    }
    if (newBidStr && oldBidStr && newBidStr !== oldBidStr) return 'changed';
    return 'none';
  }

  // =========================================================================
  // Competitor Entry CRUD
  // =========================================================================

  enterAddLocationMode(): void {
    if (!this.activeTradeUnit()) {
      this.toastService.error('Select a trade unit first');
      return;
    }
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
  }

  private _onMapRightClick(e: any): void {
    if (!this.addLocationMode()) return;

    // Remove previous pin
    this._removeAddLocationPin();

    // Place pin
    const { lat, lng } = e.latlng;
    this.newLocationLat.set(lat);
    this.newLocationLng.set(lng);

    const pinIcon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="width:28px;height:28px;background:#EF4623;border:3px solid #DF3410;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    this._addLocationPin = L.marker([lat, lng], { icon: pinIcon }).addTo(this._map);

    // Auto-select TU if only one is active
    const tus = this.activeTradeUnits();
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
    const crops = this.newLocationCrops().filter(c => c.commodityCode.trim() && c.oldBid.trim() && c.newBid.trim());
    return !!name && !!tu && crops.length > 0 && this.newLocationLat() !== null;
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
    const crops = this.newLocationCrops().filter(c => c.commodityCode.trim() && c.oldBid.trim() && c.newBid.trim());

    if (!name) { this.toastService.error('Enter a location name'); return; }
    if (!tu) { this.toastService.error('Select a trade unit'); return; }
    if (crops.length === 0) { this.toastService.error('Add at least one crop with both bids'); return; }

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
        this.bidLocations.update(locs => [saved, ...locs]);
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
        this.toastService.success(`Added ${name} with ${crops.length} crop(s)`);
        this.exitAddLocationMode();
        this.filterBids();
      },
      error: () => this.toastService.error('Failed to add location')
    });
  }

  cancelAddLocation(): void { this.exitAddLocationMode(); }

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
    this.editBidsYear.set(year);
    this.editBidsCrop.set('');
    this._buildEditGrid(year);
    this.editBidsMode.set(true);
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

    for (const elev of this.tradeUnitElevators()) {
      if ((elev.ourFacility ?? '').trim() !== 'Y') continue;
      const name = ((elev.elevatorName ?? '') || (elev.elevatorShortName ?? '')).trim() || (elev.elevatorCode ?? '').trim();
      if (!name) continue;
      const bids: Record<string, string> = {};
      for (const crop of crops) {
        const latest = entries
          .filter(e => e.name === name && e.commodityCode === crop)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        bids[crop] = latest?.bid ?? '';
      }
      rows.push({ name, type: 'elevator', elevatorCode: (elev.elevatorCode ?? '').trim(), tradeUnitCode: (elev.tradeUnitCode ?? '').trim(), latitude: elev.latitude, longitude: elev.longitude, bids, originalBids: { ...bids } });
    }

    const elevNames = new Set(rows.map(r => r.name));
    const customNames = [...new Set(this.bidEntries().map(e => e.name))].filter(n => !elevNames.has(n));
    for (const name of customNames) {
      const rep = this.bidEntries().find(e => e.name === name);
      const bids: Record<string, string> = {};
      for (const crop of crops) {
        const latest = entries
          .filter(e => e.name === name && e.commodityCode === crop)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        bids[crop] = latest?.bid ?? '';
      }
      rows.push({ name, type: 'entry', tradeUnitCode: rep?.tradeUnitCode, latitude: rep?.latitude, longitude: rep?.longitude, bids, originalBids: { ...bids } });
    }

    this.editBidsRows.set(rows);
  }

  onEditBidsYearChange(year: number): void {
    this.editBidsYear.set(year);
    this._buildEditGrid(year);
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

    if (toCreate.length === 0) { this.editBidsMode.set(false); return; }

    this.editBidsSaving.set(true);
    this.apiService.bulkUpsertBidSheetBids(toCreate)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.editBidsSaving.set(false);
          this.editBidsMode.set(false);
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
    this.editBidsMode.set(false);
    this.editBidsRows.set([]);
  }

  private _removeAddLocationPin(): void {
    if (this._addLocationPin && this._map) {
      this._map.removeLayer(this._addLocationPin);
      this._addLocationPin = null;
    }
  }

  private _resetAddForm(): void {
    this.newLocationName.set('');
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

  toggleReferenceLocation(elevatorCode: string): void {
    if (this.referenceElevatorCode() === elevatorCode) {
      this.referenceElevatorCode.set('');
      this.filterBids();
      this._refreshMapMarkers();
    } else {
      this.pendingReferenceCode.set(elevatorCode);
      this.showReferenceConfirm.set(true);
    }
  }

  confirmReferenceChange(): void {
    const code = this.pendingReferenceCode();
    if (!code) return;
    // Reference selection is session-only (BidReferences table removed)
    this.referenceElevatorCode.set(code);
    this.pendingReferenceCode.set('');
    this.showReferenceConfirm.set(false);
    this.filterBids();
    this._refreshMapMarkers();
  }

  cancelReferenceChange(): void {
    this.pendingReferenceCode.set('');
    this.showReferenceConfirm.set(false);
  }

  // =========================================================================
  // Panel helpers
  // =========================================================================

  selectItemFromTable(item: any): void {
    // Could expand to show detail view later
    this.showPanel.set(true);
  }

  selectPanelItem(item: any): void {
    if (item.type === 'elevator') {
      this.toggleReferenceLocation(item.elevatorCode);
    } else {
      this.selectItemFromTable(item);
    }
    // Pan map to the selected location
    if (this._map && item.latitude != null && item.longitude != null) {
      this._map.flyTo([item.latitude, item.longitude], Math.max(this._map.getZoom(), 11));
    }
  }

  togglePanel(): void { this.showPanel.set(!this.showPanel()); }

  refreshBids(): void {
    this._loadAllElevators();
    const tus = this.activeTradeUnits();
    if (tus.length > 0) this._loadBidData(tus);
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

  private _initializeMap(): void {
    if (this._isMapInitialized) return;
    const mapElement = document.getElementById('bid-locations-map');
    if (!mapElement) return;

    try {
      this._map = L.map('bid-locations-map').setView([38.5, -98.0], 6);
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
      setTimeout(() => { if (this._map) this._map.invalidateSize(); }, 100);

      // Re-render markers when zoom changes (dot vs label at different zoom levels)
      this._map.on('zoomend', () => this._refreshMapMarkers());

      // Right-click to place pin in add-location mode
      this._map.on('contextmenu', (e: any) => this._onMapRightClick(e));

      this._refreshMapMarkers();
    } catch { /* map init failed */ }
  }

  private _refreshMapMarkers(): void {
    if (!this._map || !this._clusterGroup) return;
    this._clusterGroup.clearLayers();

    const refCode = this.referenceElevatorCode();
    const activeTus = this.activeTradeUnits();
    const hasTu = activeTus.length > 0;
    const zoom = this._map.getZoom();

    // Only render Scoular-owned elevators in the selected group/TUs; fall back to all Scoular when nothing selected
    const scoularOnly = (e: Elevator) => (e.ourFacility ?? '').trim() === 'Y';
    const elevsToRender = hasTu
      ? this.tradeUnitElevators().filter(scoularOnly)
      : this.allElevators().filter(scoularOnly);

    // Group elevators by location (round to ~100m precision)
    const locKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const elevsByLoc = new Map<string, Elevator[]>();

    for (const elev of elevsToRender) {
      if (!elev.elevatorCode?.trim() || !elev.latitude || !elev.longitude) continue;
      const key = locKey(elev.latitude, elev.longitude);
      const arr = elevsByLoc.get(key) || [];
      arr.push(elev);
      elevsByLoc.set(key, arr);
    }

    for (const [, group] of elevsByLoc) {
      const first = group[0];
      const lat = first.latitude!;
      const lng = first.longitude!;

      if (!hasTu) {
        // No TU/group selected — show all elevators as green dots
        const count = group.length;
        const dotIcon = L.divIcon({
          className: 'custom-marker',
          html: zoom < 8
            ? `<div style="width:20px;height:20px;background:#00875F;border:2px solid #006B4C;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${count}</div>`
            : this._buildStackedLabel(this._getGroupedNames(group), '#00875F', '#006B4C'),
          iconSize: zoom < 8 ? [20, 20] : [Math.max(80, ...this._getGroupedNames(group).map(n => n.length * 6 + 20)), this._getGroupedNames(group).length * 22 + 8],
          iconAnchor: zoom < 8 ? [10, 10] : [Math.max(80, ...this._getGroupedNames(group).map(n => n.length * 6 + 20)) / 2, this._getGroupedNames(group).length * 22 + 8]
        });
        this._clusterGroup.addLayer(L.marker([lat, lng], { icon: dotIcon }));
        continue;
      }

      // All elevators in this group are from the selected TU(s) — render as labeled markers
      const tuGroup = group;
      const names = this._getGroupedNames(tuGroup);
      const linesHtml = names.map(n => {
        const elev = tuGroup.find(e => ((e.elevatorName ?? '') || (e.elevatorShortName ?? '')).trim().startsWith(n.split('\n')[0]));
        const code = (elev?.elevatorCode ?? '').trim();
        const isRef = !!refCode && code === refCode;
        const isScoular = (elev?.ourFacility ?? '').trim() === 'Y';
        let bg: string, border: string;
        if (isRef) { bg = '#2563eb'; border = '#1d4ed8'; }
        else if (isScoular) { bg = '#00875F'; border = '#006B4C'; }
        else { bg = '#9ca3af'; border = '#6b7280'; }
        return `<div style="background:${bg};border:2px solid ${border};border-radius:4px;padding:3px 6px;font-size:9px;font-weight:700;color:#fff;white-space:nowrap;line-height:1.1;overflow:hidden;text-overflow:ellipsis;">${this._esc(n)}</div>`;
      }).join('');
      const maxWidth = Math.max(80, ...names.map(n => n.length * 6 + 20));
      const height = names.length * 22 + 8;
      const primaryElev = tuGroup[0];
      const primaryColor = (!!refCode && primaryElev.elevatorCode?.trim() === refCode) ? '#2563eb'
        : (primaryElev.ourFacility ?? '').trim() === 'Y' ? '#00875F' : '#9ca3af';

      const divIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;">
          ${linesHtml}
          <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${primaryColor};margin:-1px auto 0;"></div>
        </div>`,
        iconSize: [maxWidth, height],
        iconAnchor: [maxWidth / 2, height]
      });
      const marker = L.marker([lat, lng], { icon: divIcon });
      marker.on('click', () => this.showPanel.set(true));
      this._clusterGroup.addLayer(marker);
    }

    // Show competitor entries on map — all entries with coordinates, one pin per location name
    if (hasTu) {
      const crop = this.selectedCrop();
      const year = this.selectedYear();

      // Deduplicate by name using any entry that has coordinates
      const repByName = new Map<string, BidSheetEntry>();
      for (const entry of this.bidEntries()) {
        if (!entry.latitude || !entry.longitude) continue;
        const existing = repByName.get(entry.name);
        if (!existing || new Date(entry.createdAt) > new Date(existing.createdAt)) {
          repByName.set(entry.name, entry);
        }
      }

      // Compute reference bid once for status comparison
      const oldYr = this.oldYear();
      const newYr = this.newYear();
      const refElev = this.referenceElevator;
      const refName = refElev
        ? (((refElev.elevatorName ?? '') || (refElev.elevatorShortName ?? '')).trim() || (refElev.elevatorCode ?? '').trim())
        : '';
      const refBid = this._parseBid(refName ? this._getLatestBid(refName, newYr, crop) : '');

      const statusColors: Record<string, { bg: string; border: string }> = {
        beating: { bg: '#dc2626', border: '#991b1b' },
        matching: { bg: '#eab308', border: '#a16207' },
        changed:  { bg: '#22c55e', border: '#15803d' },
        none:     { bg: '#d1d5db', border: '#6b7280' }
      };

      for (const [name, rep] of repByName) {
        // Use the bid for the currently selected crop/year as the label, else fall back to location name
        const matched = crop
          ? this.bidEntries()
              .filter(e => e.name === name && e.commodityCode === crop && e.cropYear === year)
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
          : null;
        const label = matched ? matched.bid : name.slice(0, 10);

        // Color pin based on status relative to reference
        const newBidStr = matched?.bid ?? '';
        const oldBidStr = this._getLatestBid(name, oldYr, crop);
        const status = this._computeItemStatus(newBidStr, oldBidStr, false, refBid);
        const { bg, border } = statusColors[status] ?? statusColors['none'];

        const divIcon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="position:relative;width:58px;text-align:center;">
            <div style="background:${bg};border:2px solid ${border};border-radius:6px;padding:4px 3px;font-size:10px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);line-height:1.1;">${this._esc(label)}</div>
            <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${bg};margin:-1px auto 0;"></div>
          </div>`,
          iconSize: [58, 36],
          iconAnchor: [29, 36],
          popupAnchor: [0, -36]
        });
        this._clusterGroup.addLayer(L.marker([rep.latitude!, rep.longitude!], { icon: divIcon }));
      }
    }
  }

  private _buildStackedLabel(names: string[], bg: string, border: string): string {
    const linesHtml = names.map(n =>
      `<div style="background:${bg};border:2px solid ${border};border-radius:4px;padding:3px 6px;font-size:9px;font-weight:700;color:#fff;white-space:nowrap;line-height:1.1;overflow:hidden;text-overflow:ellipsis;">${this._esc(n)}</div>`
    ).join('');
    const maxWidth = Math.max(80, ...names.map(n => n.length * 6 + 20));
    return `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;">
      ${linesHtml}
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${bg};margin:-1px auto 0;"></div>
    </div>`;
  }

  /** Get unique display names for a group of elevators at the same location */
  private _getGroupedNames(elevators: Elevator[]): string[] {
    const names = elevators.map(e =>
      ((e.elevatorName ?? '') || (e.elevatorShortName ?? '')).trim() || (e.elevatorCode ?? '').trim()
    );
    return [...new Set(names)];
  }

  private _esc(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  private _destroyMap(): void {
    if (this._map) {
      this._map.remove();
      this._map = null;
      this._clusterGroup = null;
      this._isMapInitialized = false;
    }
  }

  // Template helpers
  getPendingReferenceName(): string {
    const code = this.pendingReferenceCode();
    const elev = this.allElevators().find(e => (e.elevatorCode ?? '').trim() === code);
    return elev ? ((elev.elevatorShortName ?? '') || (elev.elevatorName ?? '')).trim() : '';
  }

  getReferenceName(): string {
    return this.referenceElevator ? ((this.referenceElevator.elevatorShortName ?? '') || (this.referenceElevator.elevatorName ?? '')).trim() : '';
  }
}
