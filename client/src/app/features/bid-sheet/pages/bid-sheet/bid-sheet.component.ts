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
import { BidSheetEntry, BidReference, Elevator } from '@models';
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

  // --- Add competitor modal ---
  showAddLocationRow = signal<boolean>(false);
  newLocationName = signal<string>('');
  newLocationAddress = signal<string>('');
  newLocationCity = signal<string>('');
  newLocationState = signal<string>('');
  newLocationBid = signal<string>('');
  newLocationCommodity = signal<string>('');
  newLocationYear = signal<number>(new Date().getFullYear());
  newLocationLat = signal<number | null>(null);
  newLocationLng = signal<number | null>(null);

  // --- Refresh timer ---
  lastRefreshed = signal<Date>(new Date());
  timeSinceRefresh = signal<string>('Just now');
  private _refreshTimer: any = null;

  // --- Map ---
  private _map: any = null;
  private _clusterGroup: any = null;
  private _isMapInitialized = false;

  // Geocode cache removed — coordinates now come from API (dbo.ElevatorCoordinates)

  // --- Active trade unit ---
  private activeTradeUnit = computed(() => {
    const units = this.appState.selectedTradeUnits();
    return units.length > 0 ? units[0] : '';
  });

  constructor() {
    // Load ALL elevators on init (once)
    this._loadAllElevators();

    // React to trade unit changes
    effect(() => {
      const tu = this.activeTradeUnit();
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
        // Don't geocode all 500+ at once — geocode only when trade unit is selected
        this._refreshMapMarkers();
      },
      error: () => this.toastService.error('Failed to load elevators')
    });
  }

  private _onTradeUnitChanged(tradeUnitCode: string): void {
    // Filter elevators to trade unit
    if (tradeUnitCode) {
      const tuElevators = this.allElevators().filter(e => (e.elevatorLocationCode ?? '').trim() === tradeUnitCode);
      this.tradeUnitElevators.set(tuElevators);
      this._loadBidData(tradeUnitCode);
      this._refreshMapMarkers();
    } else {
      this.tradeUnitElevators.set([]);
      this.bidEntries.set([]);
      this.cropYears.set([]);
      this.crops.set([]);
      this.referenceElevatorCode.set('');
      this.filterBids();
      this._refreshMapMarkers();
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
    const getLatestBid = (entries: BidSheetEntry[], name: string, year: number | null): string => {
      if (!year) return '';
      const matching = entries.filter(e => e.name === name && e.commodityCode === crop && e.cropYear === year);
      if (matching.length === 0) return '';
      matching.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return matching[0].bid;
    };

    let items: any[] = [];

    // Add trade unit elevators
    for (const elev of this.tradeUnitElevators()) {
      const code = (elev.elevatorCode ?? '').trim();
      if (!code) continue;
      const name = ((elev.elevatorShortName ?? '') || (elev.elevatorName ?? '')).trim() || code;
      const isRef = code === refCode;
      const isScoular = elev.ourFacility === 'Y';

      items.push({
        type: 'elevator',
        elevatorCode: code,
        name,
        isScoular,
        isRef,
        oldBid: '',   // elevators don't have bids in BidSheetEntries
        newBid: '',
        status: isRef ? 'reference' : 'none'
      });
    }

    // Add competitor entries (unique names)
    const entries = this.bidEntries().filter(e => e.commodityCode === crop);
    const uniqueNames = [...new Set(entries.map(e => e.name))];
    for (const name of uniqueNames) {
      const oldBid = getLatestBid(this.bidEntries(), name, oldYr);
      const newBid = getLatestBid(this.bidEntries(), name, newYr);

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

  toggleAddLocationRow(): void {
    this.showAddLocationRow.set(!this.showAddLocationRow());
    this.newLocationCommodity.set(this.selectedCrop());
    this.newLocationYear.set(this.selectedYear());
  }

  confirmAddLocation(): void {
    const name = this.newLocationName().trim();
    const bid = this.newLocationBid().trim();
    const tu = this.activeTradeUnit();
    if (!name || !bid || !tu) return;

    this.apiService.createBidSheetEntry({
      name,
      address: this.newLocationAddress().trim() || undefined,
      city: this.newLocationCity().trim() || undefined,
      state: this.newLocationState().trim() || undefined,
      latitude: this.newLocationLat() ?? undefined,
      longitude: this.newLocationLng() ?? undefined,
      tradeUnitCode: tu,
      commodityCode: this.newLocationCommodity() || this.selectedCrop(),
      cropYear: this.newLocationYear() || this.selectedYear(),
      bid
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (entry) => {
        this.bidEntries.update(arr => [entry, ...arr]);
        if (!this.crops().includes(entry.commodityCode)) {
          this.crops.update(arr => [...arr, entry.commodityCode].sort());
        }
        this._resetAddForm();
        this.filterBids();
        this._refreshMapMarkers();
      },
      error: () => this.toastService.error('Failed to add entry')
    });
  }

  cancelAddLocation(): void { this._resetAddForm(); }

  private _resetAddForm(): void {
    this.showAddLocationRow.set(false);
    this.newLocationName.set('');
    this.newLocationAddress.set('');
    this.newLocationCity.set('');
    this.newLocationState.set('');
    this.newLocationBid.set('');
    this.newLocationLat.set(null);
    this.newLocationLng.set(null);
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

      // Right-click to add competitor
      this._map.on('contextmenu', (e: any) => {
        this.newLocationLat.set(e.latlng.lat);
        this.newLocationLng.set(e.latlng.lng);
        this.newLocationCommodity.set(this.selectedCrop());
        this.newLocationYear.set(this.selectedYear());
        this.showAddLocationRow.set(true);
      });

      this._refreshMapMarkers();
    } catch { /* map init failed */ }
  }

  private _refreshMapMarkers(): void {
    if (!this._map || !this._clusterGroup) return;
    this._clusterGroup.clearLayers();

    const tu = this.activeTradeUnit();
    const refCode = this.referenceElevatorCode();
    const hasTu = !!tu;

    // Show ALL elevators on map
    for (const elev of this.allElevators()) {
      const code = (elev.elevatorCode ?? '').trim();
      if (!code) continue;
      if (!elev.latitude || !elev.longitude) continue;

      const isRef = hasTu && code === refCode;
      const isTuElevator = hasTu && (elev.elevatorLocationCode ?? '').trim() === tu;
      const isScoular = (elev.ourFacility ?? '') === 'Y';
      const name = ((elev.elevatorShortName ?? '') || (elev.elevatorName ?? '')).trim() || code;

      // Color logic
      let markerColor: string, borderColor: string;
      if (!hasTu) {
        // No trade unit — all gray
        markerColor = '#9ca3af'; borderColor = '#6b7280';
      } else if (isRef) {
        markerColor = '#2563eb'; borderColor = '#1d4ed8';
      } else if (isTuElevator && isScoular) {
        markerColor = '#00588E'; borderColor = '#004671';
      } else if (isTuElevator) {
        markerColor = '#9ca3af'; borderColor = '#6b7280';
      } else {
        // Not in selected trade unit — faded
        markerColor = '#d1d5db'; borderColor = '#9ca3af';
      }

      const markerWidth = Math.max(60, name.length * 6 + 16);
      const divIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="position:relative;width:${markerWidth}px;text-align:center;">
          <div style="background:${markerColor};border:2px solid ${borderColor};border-radius:6px;padding:4px 3px;font-size:9px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);line-height:1.1;overflow:hidden;text-overflow:ellipsis;">${this._esc(name)}</div>
          <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${markerColor};margin:-1px auto 0;"></div>
        </div>`,
        iconSize: [markerWidth, 36],
        iconAnchor: [markerWidth / 2, 36],
        popupAnchor: [0, -36]
      });

      const marker = L.marker([elev.latitude!, elev.longitude!], { icon: divIcon });
      marker.on('click', () => {
        if (hasTu && isTuElevator) {
          this.showPanel.set(true);
        }
      });
      this._clusterGroup.addLayer(marker);
    }

    // Show competitor entries on map (from BidSheetEntries with lat/lng)
    if (hasTu) {
      const crop = this.selectedCrop();
      const year = this.selectedYear();
      const competitorEntries = this.bidEntries().filter(e =>
        e.commodityCode === crop && e.cropYear === year && e.latitude && e.longitude
      );

      // Latest per name
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

        const marker = L.marker([entry.latitude!, entry.longitude!], { icon: divIcon });
        this._clusterGroup.addLayer(marker);
      }
    }
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
