import { Component, DestroyRef, effect, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import * as L from 'leaflet';
import 'leaflet.markercluster';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { BidSheetEntry, BidReference, Elevator, Commodity } from '@models';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';

@Component({
  selector: 'app-bid-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule, TradeUnitSelectorComponent],
  templateUrl: './bid-sheet.component.html'
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
  bidEntries = signal<BidSheetEntry[]>([]);
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
  newLocationCrops = signal<{ commodityCode: string; bid: string; searchQuery: string; showDropdown: boolean }[]>([]);
  private _addLocationPin: any = null;

  filteredCommodities(query: string): Commodity[] {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    return this.allCommodities()
      .filter(c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.category ?? '').toLowerCase().includes(q))
      .slice(0, 20);
  }

  selectCommodity(index: number, commodity: Commodity): void {
    this.newLocationCrops.update(rows => rows.map((r, i) =>
      i === index ? { ...r, commodityCode: commodity.code, searchQuery: `${commodity.code} (${commodity.name})`, showDropdown: false } : r
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
  private _lastTu = '';

  // Geocode cache removed — coordinates now come from API (dbo.ElevatorCoordinates)

  // --- Active trade unit ---
  readonly activeTradeUnit = computed(() => {
    const units = this.appState.selectedTradeUnits();
    return units.length > 0 ? units[0] : '';
  });

  constructor() {
    // Load ALL elevators and commodities on init (once)
    this._loadAllElevators();
    this.apiService.getCommodities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (commodities) => this.allCommodities.set(commodities),
      error: () => {}
    });

    // React to trade unit changes — skip if same TU (prevents re-zoom on nav back)
    effect(() => {
      const tu = this.activeTradeUnit();
      if (tu === this._lastTu) return;
      this._lastTu = tu;
      this._onTradeUnitChanged(tu);
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
        // If a TU is already selected (navigated from another page), load its data
        const tu = this.activeTradeUnit();
        if (tu) this._onTradeUnitChanged(tu);
      },
      error: () => this.toastService.error('Failed to load elevators')
    });
  }

  private _onTradeUnitChanged(tradeUnitCode: string): void {
    // Filter elevators to trade unit
    if (tradeUnitCode) {
      const tuElevators = this.allElevators().filter(e => (e.tradeUnitCode ?? '').trim() === tradeUnitCode);
      this.tradeUnitElevators.set(tuElevators);
      this._loadBidData(tradeUnitCode);
      this._zoomToTradeUnit(tuElevators);
      this.filterBids();  // Show elevators immediately while bid data loads
      this._refreshMapMarkers();
    } else {
      this.tradeUnitElevators.set([]);
      this.bidEntries.set([]);
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

  private _loadBidData(tradeUnitCode: string): void {
    this.isLoading.set(true);

    forkJoin({
      entries: this.apiService.getBidSheetEntries(tradeUnitCode),
      cropYears: this.apiService.getBidCropYears(tradeUnitCode),
      bidCommodities: this.apiService.getBidCommodities(tradeUnitCode)
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ entries, cropYears, bidCommodities }) => {
        this.bidEntries.set(entries);
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

        // Load reference
        this._loadReference(tradeUnitCode);
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

  private _loadReference(tradeUnitCode: string): void {
    const crop = this.selectedCrop();
    if (!crop) { this.referenceElevatorCode.set(''); return; }

    this.apiService.getBidReference(tradeUnitCode, crop)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ref) => {
          this.referenceElevatorCode.set(ref?.elevatorCode?.trim() ?? '');
          this.filterBids();
          this._refreshMapMarkers();
        },
        error: () => this.referenceElevatorCode.set('')
      });
  }

  // =========================================================================
  // Filter & Display (Panel)
  // =========================================================================

  onFilterChange(): void {
    if (this._map) this._map.closePopup();
    const tu = this.activeTradeUnit();
    if (tu) this._loadReference(tu);
    this.filterBids();
    this._refreshMapMarkers();
  }

  onMapCropChange(): void {
    this.onFilterChange();
  }

  filterBids(): void {
    const tu = this.activeTradeUnit();
    if (!tu) { this.filteredBidItems.set([]); return; }

    const crop = this.selectedCrop();
    const oldYr = this.oldYear();
    const newYr = this.newYear();
    const refCode = this.referenceElevatorCode();
    const query = this.searchQuery().toLowerCase();

    // Get latest bid per location name for old and new years
    const getLatestBid = (entries: BidSheetEntry[], name: string, year: number | null, commodityCode: string): string => {
      if (!year || !commodityCode) return '';
      const matching = entries.filter(e => e.name === name && e.commodityCode === commodityCode && e.cropYear === year);
      if (matching.length === 0) return '';
      matching.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return matching[0].bid;
    };

    let items: any[] = [];

    // Always add trade unit elevators (regardless of crop selection)
    for (const elev of this.tradeUnitElevators()) {
      const code = (elev.elevatorCode ?? '').trim();
      if (!code) continue;
      const name = ((elev.elevatorName ?? '') || (elev.elevatorShortName ?? '')).trim() || code;
      const isRef = code === refCode;
      const isScoular = (elev.ourFacility ?? '').trim() === 'Y';

      items.push({
        type: 'elevator',
        elevatorCode: code,
        name,
        isScoular,
        isRef,
        oldBid: '',
        newBid: '',
        status: isRef ? 'reference' : 'none'
      });
    }

    // Add competitor entries (unique names) — filter by crop if one is selected
    const entries = crop
      ? this.bidEntries().filter(e => e.commodityCode === crop)
      : this.bidEntries();
    const uniqueNames = [...new Set(entries.map(e => e.name))];
    for (const name of uniqueNames) {
      const oldBid = getLatestBid(this.bidEntries(), name, oldYr, crop);
      const newBid = getLatestBid(this.bidEntries(), name, newYr, crop);

      items.push({
        type: 'entry',
        name,
        isScoular: false,
        isRef: false,
        oldBid,
        newBid,
        status: 'none'
      });
    }

    // Search filter
    if (query) {
      items = items.filter(item =>
        item.isRef || item.name.toLowerCase().includes(query)
      );
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

    // Open the form
    this.newLocationCrops.set([{ commodityCode: '', bid: '', searchQuery: '', showDropdown: false }]);
    this.showAddLocationForm.set(true);
  }

  canSaveLocation = computed(() => {
    const name = this.newLocationName().trim();
    const tu = this.activeTradeUnit();
    const crops = this.newLocationCrops().filter(c => c.commodityCode.trim() && c.bid.trim());
    return !!name && !!tu && crops.length > 0 && this.newLocationLat() !== null;
  });

  clearCropSelection(index: number): void {
    this.newLocationCrops.update(rows => rows.map((r, i) =>
      i === index ? { ...r, commodityCode: '', searchQuery: '', showDropdown: false } : r
    ));
  }

  addCropRow(): void {
    this.newLocationCrops.update(rows => [...rows, { commodityCode: '', bid: '', searchQuery: '', showDropdown: false }]);
  }

  removeCropRow(index: number): void {
    this.newLocationCrops.update(rows => rows.filter((_, i) => i !== index));
  }

  updateCropBid(index: number, value: string): void {
    this.newLocationCrops.update(rows => rows.map((r, i) => i === index ? { ...r, bid: value } : r));
  }

  confirmAddLocation(): void {
    const name = this.newLocationName().trim();
    const tu = this.activeTradeUnit();
    const lat = this.newLocationLat();
    const lng = this.newLocationLng();
    const commodityLookup = new Map(this.allCommodities().map(c => [c.code, c]));
    const crops = this.newLocationCrops().filter(c => c.commodityCode.trim() && c.bid.trim());

    if (!name) { this.toastService.error('Enter a location name'); return; }
    if (!tu) { this.toastService.error('Select a trade unit'); return; }
    if (crops.length === 0) { this.toastService.error('Add at least one crop with a bid'); return; }

    const year = this.selectedYear();
    let completed = 0;

    for (const crop of crops) {
      const commodity = commodityLookup.get(crop.commodityCode.trim());
      this.apiService.createBidSheetEntry({
        name,
        address: this.newLocationAddress().trim() || undefined,
        city: this.newLocationCity().trim() || undefined,
        state: this.newLocationState().trim() || undefined,
        latitude: lat ?? undefined,
        longitude: lng ?? undefined,
        tradeUnitCode: tu,
        commodityCode: crop.commodityCode.trim(),
        commodityName: commodity?.name,
        commodityCategory: commodity?.category ?? undefined,
        cropYear: year,
        bid: crop.bid.trim()
      }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (entry) => {
          this.bidEntries.update(arr => [entry, ...arr]);
          if (!this.crops().includes(entry.commodityCode)) {
            this.crops.update(arr => [...arr, entry.commodityCode].sort());
          }
          completed++;
          if (completed === crops.length) {
            this.toastService.success(`Added ${name} with ${crops.length} crop(s)`);
            this.exitAddLocationMode();
            this.filterBids();
          }
        },
        error: () => this.toastService.error('Failed to add entry')
      });
    }
  }

  cancelAddLocation(): void { this.exitAddLocationMode(); }

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

    this.apiService.setBidReference(this.activeTradeUnit(), this.selectedCrop(), code)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.referenceElevatorCode.set(code);
          this.pendingReferenceCode.set('');
          this.showReferenceConfirm.set(false);
          this.filterBids();
          this._refreshMapMarkers();
        },
        error: () => this.toastService.error('Failed to set reference')
      });
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

  togglePanel(): void { this.showPanel.set(!this.showPanel()); }

  refreshBids(): void {
    this._loadAllElevators();
    const tu = this.activeTradeUnit();
    if (tu) this._loadBidData(tu);
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

    const tu = this.activeTradeUnit();
    const refCode = this.referenceElevatorCode();
    const hasTu = !!tu;
    const zoom = this._map.getZoom();

    // Group elevators by location (round to ~100m precision)
    const locKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const elevsByLoc = new Map<string, Elevator[]>();

    for (const elev of this.allElevators()) {
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

      // Check if any in this group belong to the selected TU
      const tuGroup = hasTu ? group.filter(e => (e.tradeUnitCode ?? '').trim() === tu) : [];
      const hasTuElev = tuGroup.length > 0;

      if (!hasTu) {
        // No TU selected — always green dot, cluster handles grouping
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

      // TU is selected but no TU elevators at this location
      if (!hasTuElev) {
        const count = group.length;
        const dotIcon = L.divIcon({
          className: 'custom-marker',
          html: zoom < 8
            ? `<div style="width:20px;height:20px;background:#9ca3af;border:2px solid #6b7280;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${count}</div>`
            : this._buildStackedLabel(this._getGroupedNames(group), '#9ca3af', '#6b7280'),
          iconSize: zoom < 8 ? [20, 20] : [Math.max(80, ...this._getGroupedNames(group).map(n => n.length * 6 + 20)), this._getGroupedNames(group).length * 22 + 8],
          iconAnchor: zoom < 8 ? [10, 10] : [Math.max(80, ...this._getGroupedNames(group).map(n => n.length * 6 + 20)) / 2, this._getGroupedNames(group).length * 22 + 8]
        });
        this._clusterGroup.addLayer(L.marker([lat, lng], { icon: dotIcon }));
        continue;
      }

      // TU elevators at this location — stacked label marker
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

    // Show competitor entries on map
    if (hasTu) {
      const crop = this.selectedCrop();
      const year = this.selectedYear();
      const competitorEntries = this.bidEntries().filter(e =>
        e.commodityCode === crop && e.cropYear === year && e.latitude && e.longitude
      );

      const latestByName = new Map<string, BidSheetEntry>();
      for (const entry of competitorEntries) {
        const existing = latestByName.get(entry.name);
        if (!existing || new Date(entry.createdAt) > new Date(existing.createdAt)) {
          latestByName.set(entry.name, entry);
        }
      }

      for (const [, entry] of latestByName) {
        const divIcon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="position:relative;width:58px;text-align:center;">
            <div style="background:#d1d5db;border:2px solid #6b7280;border-radius:6px;padding:4px 3px;font-size:10px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);line-height:1.1;">${this._esc(entry.bid)}</div>
            <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #d1d5db;margin:-1px auto 0;"></div>
          </div>`,
          iconSize: [58, 36],
          iconAnchor: [29, 36],
          popupAnchor: [0, -36]
        });
        this._clusterGroup.addLayer(L.marker([entry.latitude!, entry.longitude!], { icon: divIcon }));
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
