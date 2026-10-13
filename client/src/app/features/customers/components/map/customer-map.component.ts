import { Component, DestroyRef, inject, input, output, effect, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Customer } from '@models';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { AppStateService } from '@core/services/app-state.service';
import { resolveCustomerAddress } from '@shared/utils/address';
import { environment } from '@env/environment';
import * as L from 'leaflet';

// Fix Leaflet default marker icon paths when bundled via npm
const iconDefault = L.icon({
  iconUrl: 'assets/leaflet/marker-icon.png',
  iconRetinaUrl: 'assets/leaflet/marker-icon-2x.png',
  shadowUrl: 'assets/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = iconDefault;

interface StateInfo {
  lat: number;
  lng: number;
  zoom: number;
  displayName: string;
}

@Component({
  selector: 'app-customer-map',
  standalone: true,
  imports: [CommonModule, BadgeComponent],
  templateUrl: './customer-map.component.html'
})
export class CustomerMapComponent {
  private readonly appState = inject(AppStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);

  public customers = input<Customer[]>([]);
  public focusedState = input<string | null>(null);
  public centerLat = input<number | null>(null);
  public centerLng = input<number | null>(null);
  public zoomLevel = input<number | null>(null);
  public close = output<void>();
  public selectCustomer = output<Customer>();

  isGeocoding = false;

  private _map: L.Map | null = null;
  private _markers: L.Marker[] = [];
  private _isMapInitialized = false;

  // Use shared cache from AppStateService so geocoded coords persist across navigation
  private get _geocodeCache(): Map<string, { lat: number; lng: number }> {
    return this.appState.mapGeocodeCache;
  }

  /** Maps state abbreviations to their full names for Nominatim geocoding requests. */
  private readonly _stateAbbrevToFull: { [abbr: string]: string } = {
    'al': 'Alabama', 'ak': 'Alaska', 'az': 'Arizona', 'ar': 'Arkansas', 'ca': 'California',
    'co': 'Colorado', 'ct': 'Connecticut', 'de': 'Delaware', 'fl': 'Florida', 'ga': 'Georgia',
    'hi': 'Hawaii', 'id': 'Idaho', 'il': 'Illinois', 'in': 'Indiana', 'ia': 'Iowa',
    'ks': 'Kansas', 'ky': 'Kentucky', 'la': 'Louisiana', 'me': 'Maine', 'md': 'Maryland',
    'ma': 'Massachusetts', 'mi': 'Michigan', 'mn': 'Minnesota', 'ms': 'Mississippi',
    'mo': 'Missouri', 'mt': 'Montana', 'ne': 'Nebraska', 'nv': 'Nevada', 'nh': 'New Hampshire',
    'nj': 'New Jersey', 'nm': 'New Mexico', 'ny': 'New York', 'nc': 'North Carolina',
    'nd': 'North Dakota', 'oh': 'Ohio', 'ok': 'Oklahoma', 'or': 'Oregon', 'pa': 'Pennsylvania',
    'ri': 'Rhode Island', 'sc': 'South Carolina', 'sd': 'South Dakota', 'tn': 'Tennessee',
    'tx': 'Texas', 'ut': 'Utah', 'vt': 'Vermont', 'va': 'Virginia', 'wa': 'Washington',
    'wv': 'West Virginia', 'wi': 'Wisconsin', 'wy': 'Wyoming', 'dc': 'District of Columbia'
  };

  /** Expands a state abbreviation to its full name; returns value unchanged if already full. */
  private _expandState(state: string): string {
    const lower = state.toLowerCase().trim();
    return this._stateAbbrevToFull[lower] ?? state;
  }

  private _stateInfo: { [key: string]: StateInfo } = {
    // Midwest / core grain belt
    'ia': { lat: 41.8780, lng: -93.0977, zoom: 7, displayName: 'Iowa' },
    'iowa': { lat: 41.8780, lng: -93.0977, zoom: 7, displayName: 'Iowa' },
    'il': { lat: 40.6331, lng: -89.3985, zoom: 7, displayName: 'Illinois' },
    'illinois': { lat: 40.6331, lng: -89.3985, zoom: 7, displayName: 'Illinois' },
    'ne': { lat: 41.4925, lng: -99.9018, zoom: 7, displayName: 'Nebraska' },
    'nebraska': { lat: 41.4925, lng: -99.9018, zoom: 7, displayName: 'Nebraska' },
    'mn': { lat: 46.7296, lng: -94.6859, zoom: 6, displayName: 'Minnesota' },
    'minnesota': { lat: 46.7296, lng: -94.6859, zoom: 6, displayName: 'Minnesota' },
    'wi': { lat: 43.7844, lng: -88.7879, zoom: 7, displayName: 'Wisconsin' },
    'wisconsin': { lat: 43.7844, lng: -88.7879, zoom: 7, displayName: 'Wisconsin' },
    'mo': { lat: 37.9643, lng: -91.8318, zoom: 7, displayName: 'Missouri' },
    'missouri': { lat: 37.9643, lng: -91.8318, zoom: 7, displayName: 'Missouri' },
    'ks': { lat: 39.0119, lng: -98.4842, zoom: 7, displayName: 'Kansas' },
    'kansas': { lat: 39.0119, lng: -98.4842, zoom: 7, displayName: 'Kansas' },
    'sd': { lat: 43.9695, lng: -99.9018, zoom: 7, displayName: 'South Dakota' },
    'south dakota': { lat: 43.9695, lng: -99.9018, zoom: 7, displayName: 'South Dakota' },
    'nd': { lat: 47.5515, lng: -101.0020, zoom: 7, displayName: 'North Dakota' },
    'north dakota': { lat: 47.5515, lng: -101.0020, zoom: 7, displayName: 'North Dakota' },
    'in': { lat: 40.2672, lng: -86.1349, zoom: 7, displayName: 'Indiana' },
    'indiana': { lat: 40.2672, lng: -86.1349, zoom: 7, displayName: 'Indiana' },
    'oh': { lat: 40.4173, lng: -82.9071, zoom: 7, displayName: 'Ohio' },
    'ohio': { lat: 40.4173, lng: -82.9071, zoom: 7, displayName: 'Ohio' },
    'mi': { lat: 44.3148, lng: -85.6024, zoom: 7, displayName: 'Michigan' },
    'michigan': { lat: 44.3148, lng: -85.6024, zoom: 7, displayName: 'Michigan' },
    // South / Plains
    'tx': { lat: 31.9686, lng: -99.9018, zoom: 6, displayName: 'Texas' },
    'texas': { lat: 31.9686, lng: -99.9018, zoom: 6, displayName: 'Texas' },
    'ok': { lat: 35.0078, lng: -97.0929, zoom: 7, displayName: 'Oklahoma' },
    'oklahoma': { lat: 35.0078, lng: -97.0929, zoom: 7, displayName: 'Oklahoma' },
    'co': { lat: 39.5501, lng: -105.7821, zoom: 7, displayName: 'Colorado' },
    'colorado': { lat: 39.5501, lng: -105.7821, zoom: 7, displayName: 'Colorado' },
    'ky': { lat: 37.8393, lng: -84.2700, zoom: 7, displayName: 'Kentucky' },
    'kentucky': { lat: 37.8393, lng: -84.2700, zoom: 7, displayName: 'Kentucky' },
    'tn': { lat: 35.5175, lng: -86.5804, zoom: 7, displayName: 'Tennessee' },
    'tennessee': { lat: 35.5175, lng: -86.5804, zoom: 7, displayName: 'Tennessee' },
    'ar': { lat: 34.7465, lng: -92.2896, zoom: 7, displayName: 'Arkansas' },
    'arkansas': { lat: 34.7465, lng: -92.2896, zoom: 7, displayName: 'Arkansas' },
    'la': { lat: 30.9843, lng: -91.9623, zoom: 7, displayName: 'Louisiana' },
    'louisiana': { lat: 30.9843, lng: -91.9623, zoom: 7, displayName: 'Louisiana' },
    'ms': { lat: 32.3547, lng: -89.3985, zoom: 7, displayName: 'Mississippi' },
    'mississippi': { lat: 32.3547, lng: -89.3985, zoom: 7, displayName: 'Mississippi' },
    'al': { lat: 32.3182, lng: -86.9023, zoom: 7, displayName: 'Alabama' },
    'alabama': { lat: 32.3182, lng: -86.9023, zoom: 7, displayName: 'Alabama' },
    'ga': { lat: 32.1656, lng: -82.9001, zoom: 7, displayName: 'Georgia' },
    'georgia': { lat: 32.1656, lng: -82.9001, zoom: 7, displayName: 'Georgia' },
    'fl': { lat: 27.7663, lng: -81.6868, zoom: 6, displayName: 'Florida' },
    'florida': { lat: 27.7663, lng: -81.6868, zoom: 6, displayName: 'Florida' },
    'sc': { lat: 33.8361, lng: -81.1637, zoom: 7, displayName: 'South Carolina' },
    'south carolina': { lat: 33.8361, lng: -81.1637, zoom: 7, displayName: 'South Carolina' },
    'nc': { lat: 35.7596, lng: -79.0193, zoom: 7, displayName: 'North Carolina' },
    'north carolina': { lat: 35.7596, lng: -79.0193, zoom: 7, displayName: 'North Carolina' },
    'va': { lat: 37.4316, lng: -78.6569, zoom: 7, displayName: 'Virginia' },
    'virginia': { lat: 37.4316, lng: -78.6569, zoom: 7, displayName: 'Virginia' },
    'wv': { lat: 38.5976, lng: -80.4549, zoom: 7, displayName: 'West Virginia' },
    'west virginia': { lat: 38.5976, lng: -80.4549, zoom: 7, displayName: 'West Virginia' },
    'mt': { lat: 46.8797, lng: -110.3626, zoom: 6, displayName: 'Montana' },
    'montana': { lat: 46.8797, lng: -110.3626, zoom: 6, displayName: 'Montana' },
    'wy': { lat: 43.0760, lng: -107.2903, zoom: 6, displayName: 'Wyoming' },
    'wyoming': { lat: 43.0760, lng: -107.2903, zoom: 6, displayName: 'Wyoming' },
    'id': { lat: 44.0682, lng: -114.7420, zoom: 6, displayName: 'Idaho' },
    'idaho': { lat: 44.0682, lng: -114.7420, zoom: 6, displayName: 'Idaho' },
    'or': { lat: 43.8041, lng: -120.5542, zoom: 6, displayName: 'Oregon' },
    'oregon': { lat: 43.8041, lng: -120.5542, zoom: 6, displayName: 'Oregon' },
    'wa': { lat: 47.7511, lng: -120.7401, zoom: 6, displayName: 'Washington' },
    'washington': { lat: 47.7511, lng: -120.7401, zoom: 6, displayName: 'Washington' },
    'ca': { lat: 36.7783, lng: -119.4179, zoom: 6, displayName: 'California' },
    'california': { lat: 36.7783, lng: -119.4179, zoom: 6, displayName: 'California' },
    'nv': { lat: 38.8026, lng: -116.4194, zoom: 6, displayName: 'Nevada' },
    'nevada': { lat: 38.8026, lng: -116.4194, zoom: 6, displayName: 'Nevada' },
    'az': { lat: 34.0489, lng: -111.0937, zoom: 6, displayName: 'Arizona' },
    'arizona': { lat: 34.0489, lng: -111.0937, zoom: 6, displayName: 'Arizona' },
    'nm': { lat: 34.5199, lng: -105.8701, zoom: 6, displayName: 'New Mexico' },
    'new mexico': { lat: 34.5199, lng: -105.8701, zoom: 6, displayName: 'New Mexico' },
    'ut': { lat: 39.3210, lng: -111.0937, zoom: 6, displayName: 'Utah' },
    'utah': { lat: 39.3210, lng: -111.0937, zoom: 6, displayName: 'Utah' },
    'pa': { lat: 41.2033, lng: -77.1945, zoom: 7, displayName: 'Pennsylvania' },
    'pennsylvania': { lat: 41.2033, lng: -77.1945, zoom: 7, displayName: 'Pennsylvania' },
    'ny': { lat: 42.1657, lng: -74.9481, zoom: 7, displayName: 'New York' },
    'new york': { lat: 42.1657, lng: -74.9481, zoom: 7, displayName: 'New York' },
    'md': { lat: 39.0458, lng: -76.6413, zoom: 8, displayName: 'Maryland' },
    'maryland': { lat: 39.0458, lng: -76.6413, zoom: 8, displayName: 'Maryland' },
  };

  constructor() {
    afterNextRender(() => this._initializeMap());
    this.destroyRef.onDestroy(() => this._destroyMap());

    // Only refresh when actual customer IDs or focusedState change.
    // The parent may pass a new array reference each CD cycle, so compare IDs.
    let prevCustomerIds = new Set<number>();
    let prevFocusedState: string | null = null;

    effect(() => {
      const customers = this.customers();
      const focusedState = this.focusedState();

      if (!this._isMapInitialized) {
        prevCustomerIds = new Set(customers.map(c => c.id));
        prevFocusedState = focusedState;
        return;
      }

      const focusedChanged = focusedState !== prevFocusedState;
      const customersChanged = this._customerIdsChangedFromSet(prevCustomerIds, customers);

      if (focusedChanged || customersChanged) {
        this._refreshMap();
      }

      prevCustomerIds = new Set(customers.map(c => c.id));
      prevFocusedState = focusedState;
    });
  }

  private _customerIdsChangedFromSet(prevIds: Set<number>, curr: Customer[]): boolean {
    if (prevIds.size !== curr.length) return true;
    return curr.some(x => !prevIds.has(x.id));
  }

  getDisplayName(state: string): string {
    const info = this._stateInfo[state.toLowerCase()];
    if (info) return info.displayName;
    return state.charAt(0).toUpperCase() + state.slice(1);
  }

  closeMap(): void {
    this.close.emit();
  }

  private _initializeMap(): void {
    if (this._isMapInitialized) return;

    try {
      let centerLat = this.centerLat() ?? 41.8780;
      let centerLng = this.centerLng() ?? -93.0977;
      let zoom = this.zoomLevel() ?? 5;

      if (this.focusedState()) {
        const stateLower = this.focusedState()!.toLowerCase();
        const info = this._stateInfo[stateLower];
        if (info) {
          centerLat = info.lat;
          centerLng = info.lng;
          zoom = info.zoom;
        }
      }

      this._map = L.map('customer-map').setView([centerLat, centerLng], zoom);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(this._map);

      this._isMapInitialized = true;
      this._addMarkers();
    } catch (error) {
      // map init failed silently
    }
  }

  private _refreshMap(): void {
    if (!this._isMapInitialized || !this._map) return;

    try {
      this._clearMarkers();
      this._addMarkers();

      if (this.focusedState()) {
        const stateLower = this.focusedState()!.toLowerCase();
        const info = this._stateInfo[stateLower];
        if (info) {
          this._map.setView([info.lat, info.lng], info.zoom);
        }
      } else if (this.customers().length > 1) {
        this._fitBounds();
      }
    } catch (error) {
      // map refresh failed silently
    }
  }

  private _addMarkers(): void {
    if (!this._map) return;
    this._initializeMarkersWithGeocoding();
  }

  /**
   * Builds a geocode cache key from resolved address parts.
   * Includes street when available for street-level precision; falls back to city+state+zip.
   */
  private _geocodeCacheKey(addr: { street: string; city: string; state: string; zip: string }): string {
    const parts = [addr.street, addr.city, addr.state, addr.zip]
      .map(p => p.toLowerCase().trim())
      .filter(Boolean);
    return parts.join(',');
  }

  private async _initializeMarkersWithGeocoding(): Promise<void> {
    const markerMap = new Map<number, L.Marker>(); // customerId → leaflet marker
    const customerCoords = new Map<number, { lat: number; lng: number }>(); // tracks latest coords per customer

    // ── Phase 1: Collect initial coords (cached or state-based fallback) ──
    for (const customer of this.customers()) {
      if (!this._map) return;
      const addr = resolveCustomerAddress(customer);
      const cacheKey = this._geocodeCacheKey(addr);
      const coords = this._geocodeCache.has(cacheKey)
        ? this._geocodeCache.get(cacheKey)!
        : this._getCoordinatesForCustomer(customer);
      customerCoords.set(customer.id, coords);
    }

    // Apply jitter so same-location pins don't stack on top of each other
    const jittered = this._computeJitteredCoords(customerCoords);

    for (const customer of this.customers()) {
      if (!this._map) return;
      const marker = this._buildMarker(customer, jittered.get(customer.id)!);
      markerMap.set(customer.id, marker);
      this._markers.push(marker);
    }

    // Fit bounds right away so the map is usable immediately
    if (this.customers().length > 1 && !this.focusedState() && this._map) {
      this._fitBounds();
    }

    // ── Phase 2: Geocode unique addresses in the background, update markers ──
    const addressGroups = new Map<string, { addr: { street: string; city: string; state: string; zip: string }; customerIds: number[] }>();
    for (const customer of this.customers()) {
      const addr = resolveCustomerAddress(customer);
      if (!addr.city && !addr.state && !addr.zip) continue;
      const key = this._geocodeCacheKey(addr);
      if (!addressGroups.has(key)) addressGroups.set(key, { addr, customerIds: [] });
      addressGroups.get(key)!.customerIds.push(customer.id);
    }

    // Only geocode locations not already resolved in cache
    const toGeocode = [...addressGroups.entries()].filter(([key]) => !this._geocodeCache.has(key));

    if (toGeocode.length === 0) return;

    this.isGeocoding = true;

    // Batch geocode all uncached addresses in a single server request.
    // The server processes them sequentially (1/sec Nominatim rate limit) and returns once done.
    try {
      // Expand state abbreviations (e.g. "SC" → "South Carolina") so Nominatim
      // can match them — its structured API uses full state names.
      const requests = toGeocode.map(([key, { addr }]) => ({
        key,
        street: addr.street || undefined,
        city: addr.city,
        state: this._expandState(addr.state),
        zip: addr.zip
      }));

      const results = await firstValueFrom(
        this.http.post<Array<{ key: string; lat: number | null; lng: number | null }>>(
          `${environment.apiBaseUrl}/geocode/batch`, requests
        )
      );

      if (results && this._map) {
        for (const result of results) {
          if (result.lat != null && result.lng != null) {
            const coords = { lat: result.lat, lng: result.lng };
            this.appState.setGeocodeCache(result.key, coords);
            const group = addressGroups.get(result.key);
            if (group) {
              for (const customerId of group.customerIds) {
                customerCoords.set(customerId, coords);
              }
            }
          }
        }

        // Re-apply jitter with the final geocoded positions and move markers
        if (this._map) {
          const updatedJittered = this._computeJitteredCoords(customerCoords);
          for (const [customerId, coords] of updatedJittered) {
            const marker = markerMap.get(customerId);
            if (marker) marker.setLatLng([coords.lat, coords.lng]);
          }
        }
      }
    } catch {
      // API unavailable — markers remain at approximate positions
    }

    this.isGeocoding = false;
  }

  /**
   * When two or more customers resolve to the same coordinates (e.g. same PO Box area),
   * spread them evenly around a small circle so each pin is individually visible.
   * Customers with unique coordinates are returned unchanged.
   */
  private _computeJitteredCoords(
    customerCoords: Map<number, { lat: number; lng: number }>
  ): Map<number, { lat: number; lng: number }> {
    // Group customer IDs by their coordinates, rounded to 6 decimal places (~0.1 m).
    // Exact geocoder duplicates (same PO Box → same lat/lng) will round to the same key.
    const positionGroups = new Map<string, number[]>();
    for (const [customerId, coords] of customerCoords) {
      const posKey = `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`;
      if (!positionGroups.has(posKey)) positionGroups.set(posKey, []);
      positionGroups.get(posKey)!.push(customerId);
    }

    const result = new Map(customerCoords);
    const JITTER_RADIUS = 0.0008; // ~89 metres — enough to visually separate pins

    for (const customerIds of positionGroups.values()) {
      if (customerIds.length <= 1) continue;
      for (let i = 0; i < customerIds.length; i++) {
        const base = customerCoords.get(customerIds[i])!;
        const angle = (2 * Math.PI * i) / customerIds.length;
        result.set(customerIds[i], {
          lat: base.lat + JITTER_RADIUS * Math.sin(angle),
          lng: base.lng + JITTER_RADIUS * Math.cos(angle)
        });
      }
    }

    return result;
  }

  private _escapeHtml(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  private _buildMarker(customer: Customer, coords: { lat: number; lng: number }): L.Marker {
    const addr = resolveCustomerAddress(customer);
    const locationParts = this._escapeHtml([addr.city, addr.state].filter(Boolean).join(', '));
    const contactLine = this._escapeHtml(customer.phone
      ? customer.phone
      : (customer.email || ''));
    const escapedName = this._escapeHtml(customer.name);
    const escapedSourceId = this._escapeHtml(customer.scoularId ?? '');

    const popupContent = `
      <div style="min-width: 180px; font-family: inherit; padding: 2px 0;">
        <div style="font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 2px; line-height: 1.3;">
          ${escapedName}
        </div>
        ${customer.scoularId ? `<div style="font-size: 11px; color: #9ca3af; margin-bottom: 6px; font-family: monospace;">${escapedSourceId}</div>` : ''}
        ${locationParts ? `
        <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 4px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <span style="font-size: 12px; color: #6b7280;">${locationParts}</span>
        </div>` : ''}
        ${contactLine ? `
        <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 4px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            ${customer.phone
              ? `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.13 12 19.79 19.79 0 0 1 1.06 3.4 2 2 0 0 1 3 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16z"/>`
              : `<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m2 7 8.97 5.7a1.94 1.94 0 0 0 2.06 0L22 7"/>`
            }
          </svg>
          <span style="font-size: 12px; color: #6b7280;">${contactLine}</span>
        </div>` : ''}
        <div style="border-top: 1px solid #f3f4f6; margin-top: 8px; padding-top: 8px;">
          <a href="#" class="view-customer-link" data-customer-id="${customer.id}"
             style="font-size: 12px; color: #16a34a; font-weight: 500; text-decoration: none; display: flex; align-items: center; gap: 4px;">
            View Customer
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </a>
        </div>
      </div>
    `;

    const marker = L.marker([coords.lat, coords.lng])
      .addTo(this._map!) // callers return early once the map is gone
      .bindPopup(popupContent, { closeButton: false, offset: [0, -5] });

    // Track close timer so hover into popup can cancel it
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleClose = () => {
      closeTimer = setTimeout(() => marker.closePopup(), 250);
    };

    const cancelClose = () => {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    };

    // Open on hover
    marker.on('mouseover', () => { cancelClose(); marker.openPopup(); });
    marker.on('mouseout', scheduleClose);

    marker.on('popupopen', () => {
      // Wire up "View Customer →" link
      const link = document.querySelector(`.view-customer-link[data-customer-id="${customer.id}"]`);
      if (link) {
        link.addEventListener('click', (e: Event) => {
          e.preventDefault();
          this.selectCustomer.emit(customer);
        });
      }

      // Keep popup open while mouse is inside it
      const popupEl = marker.getPopup()?.getElement();
      if (popupEl) {
        popupEl.addEventListener('mouseenter', cancelClose);
        popupEl.addEventListener('mouseleave', scheduleClose);
      }
    });

    return marker;
  }

  private _getCoordinatesForCustomer(customer: Customer): { lat: number; lng: number } {
    const addr = resolveCustomerAddress(customer);
    const stateStr = addr.state.toLowerCase().trim();

    // Try the state as-is first, then try the expanded full name (handles both "sc" and "south carolina")
    const info = this._stateInfo[stateStr]
      ?? this._stateInfo[this._expandState(stateStr).toLowerCase()];

    if (info) {
      const hash = this._hashCode(customer.id);
      const latOffset = ((hash % 1000) / 1000 - 0.5) * 1.5;
      const lngOffset = (((hash >> 10) % 1000) / 1000 - 0.5) * 1.5;
      return {
        lat: info.lat + latOffset,
        lng: info.lng + lngOffset
      };
    }

    // True fallback: geographic center of the contiguous US
    const hash = this._hashCode(customer.id);
    return {
      lat: 39.8283 + ((hash % 1000) / 1000 - 0.5) * 3,
      lng: -98.5795 + (((hash >> 10) % 1000) / 1000 - 0.5) * 3
    };
  }

  private _hashCode(value: string | number): number {
    const str = value.toString();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private _clearMarkers(): void {
    for (const marker of this._markers) {
      marker.remove();
    }
    this._markers = [];
  }

  private _fitBounds(): void {
    if (!this._map || this._markers.length === 0) return;

    const group = L.featureGroup(this._markers);
    this._map.fitBounds(group.getBounds().pad(0.1));
  }

  private _destroyMap(): void {
    if (this._map) {
      this._map.remove();
      this._map = null;
      this._markers = [];
      this._isMapInitialized = false;
    }
  }
}
