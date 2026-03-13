import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import * as L from 'leaflet';
import { environment } from '../../../../../environments/environment';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';

interface BidEntry {
  bid: string;
  dateAdded: Date;
  status: 'matching' | 'beating' | 'changed' | 'none';
}

interface BidData {
  crop: string;
  year: number;
  locations: { [key: string]: BidEntry[] }; // newest first
}

interface LocationCoords {
  lat: number;
  lng: number;
  name: string;
  isScoular: boolean;
}

@Component({
  selector: 'app-bid-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule, TradeUnitSelectorComponent],
  templateUrl: './bid-sheet.component.html'
})
export class BidSheetComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  selectedYear = signal<string>(new Date().getFullYear().toString());
  selectedCrop = signal<string>('Corn');
  searchQuery = signal<string>('');
  selectedBasis = signal<string>('all');
  selectedLocation = signal<string>('');
  selectedBidItem = signal<any>(null);
  referencedLocations = signal<{ [crop: string]: string }>({ 'Corn': 'Scoular Truman' });

  get referencedLocation(): string {
    return this.referencedLocations()[this.selectedCrop()] || '';
  }

  set referencedLocation(value: string) {
    const updated = { ...this.referencedLocations() };
    if (value) {
      updated[this.selectedCrop()] = value;
    } else {
      delete updated[this.selectedCrop()];
    }
    this.referencedLocations.set(updated);
  }
  showReferenceConfirm = signal<boolean>(false);
  pendingReferenceLocation = signal<string>('');

  // Add location modal
  showAddLocationRow = signal<boolean>(false);
  addLocationMode = signal<'new' | 'existing'>('new');
  newLocationName = signal<string>('');
  newLocationAddress = signal<string>('');
  newLocationCity = signal<string>('');
  newLocationState = signal<string>('');
  newLocationCrop = signal<string>('Corn');
  newLocationBid = signal<string>('');
  newLocationExistingName = signal<string>('');
  isGeocodingLocation = signal<boolean>(false);

  // Edit location modal
  showEditLocationModal = signal<boolean>(false);
  showDeleteLocationConfirm = signal<boolean>(false);
  editLocationOriginalName = signal<string>('');
  editLocationName = signal<string>('');
  editLocationAddress = signal<string>('');
  editLocationCity = signal<string>('');
  editLocationState = signal<string>('');
  locationDetails = signal<{ [name: string]: { address: string, city: string, state: string } }>({});

  // Add bid form (shown when location is selected)
  showAddBidForm = signal<boolean>(false);
  newBidValue = signal<string>('');
  today = signal<Date>(new Date());

  showPanel = signal<boolean>(false);
  newLocationIsScoular = signal<boolean>(false);

  lastRefreshed = signal<Date>(new Date());
  timeSinceRefresh = signal<string>('Just now');
  private _refreshTimer: any = null;

  bidData = signal<BidData[]>([]);
  filteredBidItems = signal<any[]>([]);
  crops = signal<string[]>(['Wheat', 'Corn', 'Milo', 'Beans', 'Canola']);

  private _map: any = null;
  private _markers: any[] = [];
  private _markersByLocation: { [key: string]: any } = {};
  private _isMapInitialized = false;

  locationCoordinates = signal<LocationCoords[]>([
    { lat: 37.4850, lng: -99.7750, name: 'Scoular Truman',        isScoular: true  },
    { lat: 37.5500, lng: -99.4000, name: 'Scoular Cullison',      isScoular: true  },
    { lat: 37.7000, lng: -100.8500, name: 'Kansas West (Inka)',   isScoular: false },
    { lat: 38.6500, lng: -98.2000, name: 'Kansas East (Belmont)', isScoular: false },
    { lat: 38.5500, lng: -97.6500, name: 'Skyland C-ham Area',    isScoular: false },
    { lat: 37.8000, lng: -98.4000, name: 'Turon Mill & Elev',     isScoular: false },
    { lat: 37.6500, lng: -99.3000, name: 'FCE Best Bid',          isScoular: false },
    { lat: 37.7500, lng: -99.5000, name: 'GPC Best Bid',          isScoular: false },
    { lat: 37.0150, lng: -98.4850, name: 'OK Coop Kiowa',         isScoular: false }
  ]);

  constructor() {
    this._loadBidData();
    this.filterBids();
    this._startRefreshTimer();
    setTimeout(() => this._initializeMap(), 500);
    this.destroyRef.onDestroy(() => {
      this._destroyMap();
      if (this._refreshTimer) {
        clearInterval(this._refreshTimer);
      }
    });
  }

  refreshBids(): void {
    this._startRefreshTimer();
  }

  togglePanel(): void {
    this.showPanel.set(!this.showPanel());
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private _startRefreshTimer(): void {
    this.lastRefreshed.set(new Date());
    this.timeSinceRefresh.set('Just now');
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
    }
    this._refreshTimer = setInterval(() => this._updateTimeSinceRefresh(), 1000);
  }

  private _updateTimeSinceRefresh(): void {
    const seconds = Math.floor((new Date().getTime() - this.lastRefreshed().getTime()) / 1000);
    if (seconds < 60) {
      this.timeSinceRefresh.set('A few seconds ago');
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      this.timeSinceRefresh.set(`${minutes}m ago`);
    } else {
      const hours = Math.floor(seconds / 3600);
      this.timeSinceRefresh.set(`${hours}h ago`);
    }
  }

  private _initializeMap(): void {
    if (this._isMapInitialized) return;

    const mapElement = document.getElementById('bid-locations-map');
    if (!mapElement) return;

    try {
      this._map = L.map('bid-locations-map').setView([37.9, -98.8], 7);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this._map);

      this._isMapInitialized = true;

      setTimeout(() => {
        if (this._map) {
          this._map.invalidateSize();
        }
      }, 100);

      this._addMarkers();
      this._panToReference();
    } catch (error) {
      // map init failed silently
    }
  }

  private _panToReference(): void {
    if (!this._map || !this.referencedLocation) return;
    const coords = this.locationCoordinates().find(l => l.name === this.referencedLocation);
    if (coords) {
      this._map.setView([coords.lat, coords.lng], 7, { animate: true });
    }
  }

  private _escapeHtml(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  private _addMarkers(): void {
    if (!this._map) return;

    this._clearMarkers();

    const year = parseInt(this.selectedYear());
    const cropData = this.bidData().find(bd => bd.crop === this.selectedCrop() && bd.year === year);
    if (!cropData) return;

    const refEntries = this.referencedLocation ? cropData.locations[this.referencedLocation] : null;
    const refBid = refEntries && refEntries.length > 0 ? refEntries[0].bid : '';

    for (const location of this.locationCoordinates()) {
      const entries = cropData.locations[location.name];
      const newest = entries && entries.length > 0 ? entries[0] : null;
      const bid = newest?.bid || '';
      if (!bid) continue;

      const status: string = bid
        ? (this.referencedLocation
          ? (location.name === this.referencedLocation ? 'reference' : this._getComputedStatus(bid, refBid))
          : newest!.status)
        : 'none';

      // Hide filtered-out markers (always keep reference visible); hide no-bid markers when filter is active
      const isReference = location.name === this.referencedLocation;
      if (this.selectedBasis() !== 'all' && (!bid || (!isReference && status !== this.selectedBasis()))) continue;

      const isScoular = location.isScoular;
      const markerColor =
        status === 'reference' ? '#2563eb' :
        (isScoular && status !== 'reference') ? '#9ca3af' :
        status === 'matching' ? '#eab308' :
        status === 'beating' ? '#dc2626' :
        status === 'changed' ? '#22c55e' : '#d1d5db';

      const borderColor =
        status === 'reference' ? '#1d4ed8' :
        (isScoular && status !== 'reference') ? '#6b7280' :
        status === 'matching' ? '#a16207' :
        status === 'beating' ? '#991b1b' :
        status === 'changed' ? '#15803d' : '#6b7280';

      const textColor = status === 'none' ? '#6b7280' : '#ffffff';
      const shadowStyle = `box-shadow: 0 2px 6px rgba(0,0,0,0.4);`;

      const divIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="position: relative; width: 58px; text-align: center;">
          <div style="
            background-color: ${markerColor};
            border: 2px solid ${borderColor};
            border-radius: 6px;
            padding: 5px 4px;
            font-size: 11px;
            font-weight: 700;
            color: ${textColor};
            white-space: nowrap;
            ${shadowStyle}
            line-height: 1.1;
          ">${this._escapeHtml(bid) || '--'}</div>
          <div style="
            width: 0;
            height: 0;
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-top: 10px solid ${markerColor};
            margin: -1px auto 0;
          "></div>
        </div>`,
        iconSize: [58, 42],
        iconAnchor: [29, 42],
        popupAnchor: [0, -42]
      });

      const marker = L.marker([location.lat, location.lng], { icon: divIcon })
        .addTo(this._map);

      marker.on('click', () => {
        this.selectedLocation.set(location.name);
        this.showAddBidForm.set(false);
        this.showPanel.set(true);
        this.filterBids();
        this._openInfoPopup(marker, location.name, bid, status);
      });

      this._markers.push(marker);
      this._markersByLocation[location.name] = { marker, bid, status };
    }
  }

  private _openInfoPopup(marker: any, locationName: string, currentBid: string, status: string = 'none'): void {
    const bidColor =
      status === 'reference' ? '#1d4ed8' :
      status === 'matching'  ? '#a16207' :
      status === 'beating'   ? '#991b1b' :
      status === 'changed'   ? '#15803d' : '#6b7280';
    const bidBg =
      status === 'reference' ? '#eff6ff' :
      status === 'matching'  ? '#fefce8' :
      status === 'beating'   ? '#fef2f2' :
      status === 'changed'   ? '#f0fdf4' : '#f8fafc';
    const bidBorder =
      status === 'reference' ? '#bfdbfe' :
      status === 'matching'  ? '#fef08a' :
      status === 'beating'   ? '#fecaca' :
      status === 'changed'   ? '#bbf7d0' : '#e2e8f0';

    const escapedLocation = this._escapeHtml(locationName);
    const escapedCrop = this._escapeHtml(this.selectedCrop());
    const escapedYear = this._escapeHtml(this.selectedYear());
    const escapedBid = this._escapeHtml(currentBid);
    const escapedStatus = this._escapeHtml(status.charAt(0).toUpperCase() + status.slice(1));

    const popupContent = `
      <div style="min-width: 210px; font-family: system-ui, -apple-system, sans-serif;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 10px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <span style="font-size: 13px; font-weight: 600; color: #111; line-height: 1.3;">${escapedLocation}</span>
        </div>
        <div style="display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;">
          <span style="display: inline-flex; align-items: center; padding: 2px 8px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 9999px; font-size: 11px; font-weight: 500; color: #15803d;">${escapedCrop}</span>
          <span style="display: inline-flex; align-items: center; padding: 2px 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 9999px; font-size: 11px; font-weight: 500; color: #475569;">${escapedYear}</span>
          ${status !== 'none' ? `<span style="display: inline-flex; align-items: center; padding: 2px 8px; background: ${bidBg}; border: 1px solid ${bidBorder}; border-radius: 9999px; font-size: 11px; font-weight: 600; color: ${bidColor};">${escapedStatus}</span>` : ''}
        </div>
        <div style="background: ${bidBg}; border: 1px solid ${bidBorder}; border-radius: 8px; padding: 12px 14px;">
          <div style="font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Current Bid</div>
          <div style="font-size: 26px; font-family: 'Courier New', monospace; font-weight: 800; color: ${bidColor}; letter-spacing: -0.5px; line-height: 1;">${escapedBid}</div>
        </div>
      </div>
    `;

    L.popup({ maxWidth: 250 })
      .setLatLng(marker.getLatLng())
      .setContent(popupContent)
      .openOn(this._map);
  }

  private _clearMarkers(): void {
    for (const marker of this._markers) {
      marker.remove();
    }
    this._markers = [];
    this._markersByLocation = {};
  }

  private _destroyMap(): void {
    if (this._map) {
      this._map.remove();
      this._map = null;
      this._markers = [];
      this._isMapInitialized = false;
    }
  }

  isDarkMode(): boolean {
    return document.documentElement.classList.contains('dark');
  }

  clearLocationSelection(): void {
    this.selectedLocation.set('');
    this.selectedBidItem.set(null);
    this.showAddBidForm.set(false);
    this.newBidValue.set('');
    this.filterBids();
  }

  selectLocationFromTable(item: any): void {
    this.selectedLocation.set(item.location);
    this.selectedBidItem.set(item);
    this.showAddBidForm.set(false);
    this.filterBids();

    if (this._isMapInitialized && this._map) {
      const coords = this.locationCoordinates().find(l => l.name === item.location);
      const markerData = this._markersByLocation[item.location];
      if (coords) {
        this._map.setView([coords.lat, coords.lng], this._map.getZoom(), { animate: true });
      }
      if (markerData) {
        this._openInfoPopup(markerData.marker, item.location, markerData.bid, markerData.status);
      }
    }
  }

  onFilterChange(): void {
    this.selectedLocation.set('');
    this.selectedBidItem.set(null);
    this.showAddBidForm.set(false);
    this.newBidValue.set('');
    if (this._map) this._map.closePopup();
    this.filterBids();
  }

  onMapCropChange(): void {
    this.onFilterChange();
  }

  confirmAddBid(): void {
    const bid = this.newBidValue().trim();
    if (!bid || !this.selectedLocation()) return;

    const year = parseInt(this.selectedYear());
    const allBidData = this.bidData();
    const cropData = allBidData.find(bd => bd.crop === this.selectedCrop() && bd.year === year);
    if (!cropData) return;

    if (!cropData.locations[this.selectedLocation()]) {
      cropData.locations[this.selectedLocation()] = [];
    }

    // Prepend new entry so it appears first (newest)
    cropData.locations[this.selectedLocation()].unshift({
      bid,
      dateAdded: new Date(),
      status: 'none'
    });

    this.showAddBidForm.set(false);
    this.newBidValue.set('');
    this.filterBids();
    if (this._isMapInitialized) this._addMarkers();
  }

  cancelAddBid(): void {
    this.showAddBidForm.set(false);
    this.newBidValue.set('');
  }

  toggleReferenceLocation(locationName: string): void {
    if (this.referencedLocation === locationName) {
      // Removing the current reference — no confirmation needed
      this.referencedLocation = '';
      this.filterBids();
      if (this._isMapInitialized) this._addMarkers();
    } else {
      // Setting or changing — require confirmation
      this.pendingReferenceLocation.set(locationName);
      this.showReferenceConfirm.set(true);
    }
  }

  confirmReferenceChange(): void {
    this.referencedLocation = this.pendingReferenceLocation();
    this.pendingReferenceLocation.set('');
    this.showReferenceConfirm.set(false);
    this.filterBids();
    if (this._isMapInitialized) { this._addMarkers(); this._panToReference(); }
  }

  cancelReferenceChange(): void {
    this.pendingReferenceLocation.set('');
    this.showReferenceConfirm.set(false);
  }

  private _parseBasisValue(bid: string): number {
    const match = bid.match(/^[+-]?\d+/);
    return match ? parseInt(match[0]) : 0;
  }

  private _getComputedStatus(bid: string, refBid: string): 'matching' | 'beating' | 'changed' | 'none' {
    if (!refBid || !bid) return 'none';
    const bidVal = this._parseBasisValue(bid);
    const refVal = this._parseBasisValue(refBid);
    if (bidVal === refVal) return 'matching';
    if (bidVal > refVal) return 'beating';
    return 'changed';
  }


  toggleAddLocationRow(): void {
    this.showAddLocationRow.set(!this.showAddLocationRow());
    this.addLocationMode.set('new');
    this.newLocationName.set('');
    this.newLocationAddress.set('');
    this.newLocationCity.set('');
    this.newLocationState.set('');
    this.newLocationCrop.set(this.selectedCrop());
    this.newLocationBid.set('');
    this.newLocationExistingName.set('');
  }

  getAvailableExistingLocations(): string[] {
    const year = parseInt(this.selectedYear());
    return this.locationCoordinates()
      .map(l => l.name)
      .filter(name => {
        const cropData = this.bidData().find(bd => bd.crop === this.newLocationCrop() && bd.year === year);
        if (!cropData) return true;
        const entries = cropData.locations[name];
        return !entries || entries.length === 0;
      });
  }

  confirmAddLocation(): void {
    const bid = this.newLocationBid().trim();
    const year = parseInt(this.selectedYear());

    if (this.addLocationMode() === 'existing') {
      const name = this.newLocationExistingName();
      if (!name || !bid) return;
      const allBidData = this.bidData();
      const cropData = allBidData.find(bd => bd.crop === this.newLocationCrop() && bd.year === year);
      if (!cropData) return;
      if (!cropData.locations[name]) cropData.locations[name] = [];
      cropData.locations[name].unshift({ bid, dateAdded: new Date(), status: 'none' });
      this._resetAddLocationForm();
      this.filterBids();
      return;
    }

    const name = this.newLocationName().trim();
    if (!name) return;

    // Add to all crop/year entries; set the chosen crop's initial bid entry
    for (const data of this.bidData()) {
      if (data.locations[name] === undefined) {
        const initialBid = (data.crop === this.newLocationCrop() && data.year === year) ? bid : '';
        data.locations[name] = initialBid ? [{ bid: initialBid, dateAdded: new Date(), status: 'none' }] : [];
      }
    }

    // Geocode address via backend API (proxied Nominatim) to place pin on map
    const addressParts = [this.newLocationAddress().trim(), this.newLocationCity().trim(), this.newLocationState().trim()].filter(p => p);
    if (addressParts.length > 0 && !this.locationCoordinates().find(lc => lc.name === name)) {
      this.isGeocodingLocation.set(true);
      const query = addressParts.join(', ');
      firstValueFrom(
        this.http.get<Array<{ lat: number; lng: number }>>(`${environment.apiBaseUrl}/geocode/search`, { params: { q: query, limit: '1' } })
      ).then((results) => {
          setTimeout(() => {
            if (results && results.length > 0) {
              this.locationCoordinates.update(coords => [...coords, { lat: results[0].lat, lng: results[0].lng, name, isScoular: this.newLocationIsScoular() }]);
            }
            this.isGeocodingLocation.set(false);
            this.filterBids();
          }, 0);
        })
        .catch(() => {
          setTimeout(() => { this.isGeocodingLocation.set(false); }, 0);
        });
    }

    this.locationDetails.update(details => ({
      ...details,
      [name]: {
        address: this.newLocationAddress().trim(),
        city: this.newLocationCity().trim(),
        state: this.newLocationState().trim()
      }
    }));

    this._resetAddLocationForm();
    this.filterBids();
  }

  cancelAddLocation(): void {
    this._resetAddLocationForm();
  }

  private _resetAddLocationForm(): void {
    this.showAddLocationRow.set(false);
    this.addLocationMode.set('new');
    this.newLocationName.set('');
    this.newLocationAddress.set('');
    this.newLocationCity.set('');
    this.newLocationState.set('');
    this.newLocationCrop.set(this.selectedCrop());
    this.newLocationBid.set('');
    this.newLocationExistingName.set('');
    this.newLocationIsScoular.set(false);
  }

  openEditLocation(): void {
    const details = this.locationDetails()[this.selectedLocation()] || { address: '', city: '', state: '' };
    this.editLocationOriginalName.set(this.selectedLocation());
    this.editLocationName.set(this.selectedLocation());
    this.editLocationAddress.set(details.address);
    this.editLocationCity.set(details.city);
    this.editLocationState.set(details.state);
    this.showDeleteLocationConfirm.set(false);
    this.showEditLocationModal.set(true);
  }

  cancelEditLocation(): void {
    this.showEditLocationModal.set(false);
    this.showDeleteLocationConfirm.set(false);
  }

  saveEditLocation(): void {
    const newName = this.editLocationName().trim();
    if (!newName) return;
    const oldName = this.editLocationOriginalName();

    if (newName !== oldName) {
      for (const data of this.bidData()) {
        if (data.locations[oldName] !== undefined) {
          data.locations[newName] = data.locations[oldName];
          delete data.locations[oldName];
        }
      }
      this.locationCoordinates.update(coords => coords.map(l => l.name === oldName ? { ...l, name: newName } : l));
      const updatedRefs = { ...this.referencedLocations() };
      for (const crop of this.crops()) {
        if (updatedRefs[crop] === oldName) updatedRefs[crop] = newName;
      }
      this.referencedLocations.set(updatedRefs);
      this.selectedLocation.set(newName);
    }

    this.locationDetails.update(details => {
      const updated = { ...details };
      updated[newName] = {
        address: this.editLocationAddress().trim(),
        city: this.editLocationCity().trim(),
        state: this.editLocationState().trim()
      };
      if (newName !== oldName) delete updated[oldName];
      return updated;
    });

    this.showEditLocationModal.set(false);
    this.showDeleteLocationConfirm.set(false);
    this.filterBids();
    if (this._isMapInitialized) this._addMarkers();
  }

  setReferenceFromEdit(): void {
    this.showEditLocationModal.set(false);
    this.showDeleteLocationConfirm.set(false);
    this.pendingReferenceLocation.set(this.editLocationOriginalName());
    this.showReferenceConfirm.set(true);
  }

  confirmDeleteLocation(): void {
    const name = this.editLocationOriginalName();
    for (const data of this.bidData()) {
      delete data.locations[name];
    }
    this.locationCoordinates.update(coords => coords.filter(l => l.name !== name));
    this.locationDetails.update(details => {
      const updated = { ...details };
      delete updated[name];
      return updated;
    });
    const updatedRefs = { ...this.referencedLocations() };
    for (const crop of this.crops()) {
      if (updatedRefs[crop] === name) delete updatedRefs[crop];
    }
    this.referencedLocations.set(updatedRefs);
    this.selectedLocation.set('');
    this.selectedBidItem.set(null);
    this.showEditLocationModal.set(false);
    this.showDeleteLocationConfirm.set(false);
    this.filterBids();
  }

  filterBids(): void {
    const year = parseInt(this.selectedYear());
    const query = this.searchQuery().toLowerCase();
    const cropData = this.bidData().find(bd => bd.crop === this.selectedCrop() && bd.year === year);

    // Selected location: show bid history filtered by crop + year
    if (this.selectedLocation()) {
      const entries = cropData?.locations[this.selectedLocation()] ?? [];
      this.filteredBidItems.set(entries.map((entry, idx) => ({
        location: this.selectedLocation(),
        crop: this.selectedCrop(),
        year,
        bid: entry.bid,
        dateAdded: entry.dateAdded,
        status: entry.status,
        isNewest: idx === 0
      })));

      if (this._isMapInitialized) this._addMarkers();
      return;
    }

    // All-locations view: one row per location showing the newest bid
    if (!cropData) {
      this.filteredBidItems.set([]);
      if (this._isMapInitialized) this._addMarkers();
      return;
    }

    // Resolve reference bid for dynamic status computation
    const refEntries = this.referencedLocation ? cropData.locations[this.referencedLocation] : null;
    const refBid = refEntries && refEntries.length > 0 ? refEntries[0].bid : '';

    let items: any[] = [];
    for (const [location, entries] of Object.entries(cropData.locations)) {
      if (entries.length === 0) continue;
      const newest = entries[0];
      if (!newest.bid) continue;
      const status = this.referencedLocation
        ? (location === this.referencedLocation ? 'reference' : this._getComputedStatus(newest.bid, refBid))
        : newest.status;
      items.push({
        location,
        crop: cropData.crop,
        year: cropData.year,
        bid: newest.bid,
        dateAdded: newest.dateAdded,
        status
      });
    }

    // Status filter — always keep reference row
    if (this.selectedBasis() !== 'all') {
      items = items.filter(item => item.status === 'reference' || item.status === this.selectedBasis());
    }

    // Search filter
    if (query) {
      items = items.filter(item =>
        item.status === 'reference' ||
        item.location.toLowerCase().includes(query) ||
        item.crop.toLowerCase().includes(query) ||
        item.bid.toLowerCase().includes(query)
      );
    }

    // Reference row always first
    items.sort((a, b) => (a.status === 'reference' ? -1 : b.status === 'reference' ? 1 : 0));

    this.filteredBidItems.set(items);

    if (this._isMapInitialized) this._addMarkers();
  }

  private _loadBidData(): void {
    const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
    this.bidData.set([
      {
        crop: 'Wheat', year: 2025,
        locations: {
          'Scoular Truman':        [{ bid: '-80H', dateAdded: d(2025, 3, 10), status: 'none' }, { bid: '-83H', dateAdded: d(2025, 1, 15), status: 'none' }],
          'Scoular Cullison':      [{ bid: '-80H', dateAdded: d(2025, 3, 10), status: 'none' }],
          'Kansas West (Inka)':    [{ bid: '-80H', dateAdded: d(2025, 3, 10), status: 'matching' }, { bid: '-82H', dateAdded: d(2025, 2, 1), status: 'none' }],
          'Kansas East (Belmont)': [{ bid: '-85H', dateAdded: d(2025, 3, 10), status: 'none' }],
          'Skyland C-ham Area':    [{ bid: '-90H', dateAdded: d(2025, 3, 10), status: 'none' }],
          'Turon Mill & Elev':     [{ bid: '-85H', dateAdded: d(2025, 3, 10), status: 'matching' }],
          'FCE Best Bid':          [{ bid: '-80H', dateAdded: d(2025, 3, 10), status: 'matching' }],
          'GPC Best Bid':          [{ bid: '-75H', dateAdded: d(2025, 3, 10), status: 'none' }],
          'OK Coop Kiowa':         [{ bid: '-85H', dateAdded: d(2025, 3, 10), status: 'none' }]
        }
      },
      {
        crop: 'Wheat', year: 2026,
        locations: {
          'Scoular Truman':        [{ bid: '-55N', dateAdded: d(2025, 6, 1), status: 'none' }],
          'Scoular Cullison':      [{ bid: '-60N', dateAdded: d(2025, 6, 1), status: 'none' }],
          'Kansas West (Inka)':    [{ bid: '-60N', dateAdded: d(2025, 6, 1), status: 'none' }],
          'Kansas East (Belmont)': [{ bid: '-65N', dateAdded: d(2025, 6, 1), status: 'none' }],
          'Skyland C-ham Area':    [{ bid: '-70N', dateAdded: d(2025, 6, 1), status: 'none' }],
          'Turon Mill & Elev':     [{ bid: '-55N', dateAdded: d(2025, 6, 1), status: 'none' }],
          'FCE Best Bid':          [{ bid: '-65N', dateAdded: d(2025, 6, 1), status: 'none' }],
          'GPC Best Bid':          [{ bid: '-55N', dateAdded: d(2025, 6, 1), status: 'none' }],
          'OK Coop Kiowa':         [{ bid: '-60N', dateAdded: d(2025, 6, 1), status: 'none' }]
        }
      },
      {
        crop: 'Corn', year: 2025,
        locations: {
          'Scoular Truman':        [{ bid: '-45H', dateAdded: d(2025, 3, 10), status: 'none' }, { bid: '-47H', dateAdded: d(2025, 2, 5), status: 'none' }, { bid: '-50H', dateAdded: d(2025, 1, 15), status: 'none' }],
          'Scoular Cullison':      [{ bid: '-40H', dateAdded: d(2025, 3, 10), status: 'none' }, { bid: '-43H', dateAdded: d(2025, 2, 1), status: 'none' }],
          'Kansas West (Inka)':    [{ bid: '-38H', dateAdded: d(2025, 3, 10), status: 'none' }, { bid: '-42H', dateAdded: d(2025, 2, 8), status: 'none' }],
          'Kansas East (Belmont)': [{ bid: '-45H', dateAdded: d(2025, 3, 10), status: 'none' }],
          'Skyland C-ham Area':    [{ bid: '-52H', dateAdded: d(2025, 3, 10), status: 'none' }, { bid: '-50H', dateAdded: d(2025, 2, 12), status: 'none' }],
          'Turon Mill & Elev':     [{ bid: '-35H', dateAdded: d(2025, 3, 10), status: 'none' }, { bid: '-40H', dateAdded: d(2025, 1, 28), status: 'none' }],
          'FCE Best Bid':          [{ bid: '-55H', dateAdded: d(2025, 3, 10), status: 'none' }],
          'GPC Best Bid':          [{ bid: '-45H', dateAdded: d(2025, 3, 10), status: 'none' }, { bid: '-48H', dateAdded: d(2025, 2, 20), status: 'none' }],
          'OK Coop Kiowa':         [{ bid: '-50H', dateAdded: d(2025, 3, 10), status: 'none' }]
        }
      },
      {
        crop: 'Corn', year: 2026,
        locations: {
          'Scoular Truman':        [{ bid: '-30Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'Scoular Cullison':      [{ bid: '-35Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'Kansas West (Inka)':    [{ bid: '-30Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'Kansas East (Belmont)': [{ bid: '-35Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'Skyland C-ham Area':    [{ bid: '-35N', dateAdded: d(2025, 7, 1), status: 'none' }],
          'Turon Mill & Elev':     [{ bid: '-28Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'FCE Best Bid':          [{ bid: '-33Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'GPC Best Bid':          [{ bid: '-30Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'OK Coop Kiowa':         [{ bid: '-40Z', dateAdded: d(2025, 7, 1), status: 'none' }]
        }
      },
      {
        crop: 'Milo', year: 2025,
        locations: {
          'Scoular Truman':        [{ bid: '-105H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'Scoular Cullison':      [{ bid: '-110H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'Kansas West (Inka)':    [{ bid: '-105H', dateAdded: d(2025, 3, 5), status: 'matching' }],
          'Kansas East (Belmont)': [{ bid: '-105H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'Skyland C-ham Area':    [{ bid: '-105H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'Turon Mill & Elev':     [{ bid: '-110H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'FCE Best Bid':          [{ bid: '-110H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'GPC Best Bid':          [{ bid: '-105H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'OK Coop Kiowa':         [{ bid: '-105H', dateAdded: d(2025, 3, 5), status: 'matching' }]
        }
      },
      {
        crop: 'Milo', year: 2026,
        locations: {
          'Scoular Truman':        [],
          'Scoular Cullison':      [],
          'Kansas West (Inka)':    [{ bid: '-95Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'Kansas East (Belmont)': [{ bid: '-95Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'Skyland C-ham Area':    [{ bid: '-90Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'Turon Mill & Elev':     [],
          'FCE Best Bid':          [],
          'GPC Best Bid':          [{ bid: '-100Z', dateAdded: d(2025, 7, 1), status: 'none' }],
          'OK Coop Kiowa':         [{ bid: '-100Z', dateAdded: d(2025, 7, 1), status: 'none' }]
        }
      },
      {
        crop: 'Beans', year: 2025,
        locations: {
          'Scoular Truman':        [{ bid: '-110H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'Scoular Cullison':      [{ bid: '-110H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'Kansas West (Inka)':    [{ bid: '-110H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'Kansas East (Belmont)': [{ bid: '-110H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'Skyland C-ham Area':    [{ bid: '-115H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'Turon Mill & Elev':     [{ bid: '-110F', dateAdded: d(2025, 3, 5), status: 'none' }],
          'FCE Best Bid':          [{ bid: '-110H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'GPC Best Bid':          [{ bid: '-100H', dateAdded: d(2025, 3, 5), status: 'none' }],
          'OK Coop Kiowa':         [{ bid: '-105H', dateAdded: d(2025, 3, 5), status: 'none' }]
        }
      },
      {
        crop: 'Beans', year: 2026,
        locations: {
          'Scoular Truman':        [],
          'Scoular Cullison':      [],
          'Kansas West (Inka)':    [{ bid: '-95X', dateAdded: d(2025, 7, 1), status: 'none' }],
          'Kansas East (Belmont)': [{ bid: '-95X', dateAdded: d(2025, 7, 1), status: 'none' }],
          'Skyland C-ham Area':    [],
          'Turon Mill & Elev':     [{ bid: '-95X', dateAdded: d(2025, 7, 1), status: 'none' }],
          'FCE Best Bid':          [{ bid: '-95X', dateAdded: d(2025, 7, 1), status: 'none' }],
          'GPC Best Bid':          [{ bid: '-80X', dateAdded: d(2025, 7, 1), status: 'none' }],
          'OK Coop Kiowa':         [{ bid: '-90X', dateAdded: d(2025, 7, 1), status: 'none' }]
        }
      },
      {
        crop: 'Canola', year: 2025,
        locations: {
          'Scoular Truman': [], 'Scoular Cullison': [], 'Kansas West (Inka)': [],
          'Kansas East (Belmont)': [], 'Skyland C-ham Area': [], 'Turon Mill & Elev': [],
          'FCE Best Bid': [], 'GPC Best Bid': [], 'OK Coop Kiowa': []
        }
      },
      {
        crop: 'Canola', year: 2026,
        locations: {
          'Scoular Truman': [], 'Kansas West (Inka)': [], 'Kansas East (Belmont)': [],
          'Skyland C-ham Area': [], 'Turon Mill & Elev': [], 'FCE Best Bid': [],
          'GPC Best Bid': [], 'OK Coop Kiowa': [],
          'Scoular Cullison': [{ bid: '$9.30', dateAdded: d(2025, 4, 15), status: 'none' }]
        }
      }
    ]);
  }
}
