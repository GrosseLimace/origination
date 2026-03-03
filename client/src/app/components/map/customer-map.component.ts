import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges, AfterViewInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Customer } from '../../models';
import { BadgeComponent } from '../ui/badge/badge.component';
import { AppStateService } from '../../services/app-state.service';
import { environment } from '../../../environments/environment';
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
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800 relative" style="z-index: 0;">
      <!-- Header -->
      <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600">
            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
            <line x1="9" x2="9" y1="3" y2="18"/>
            <line x1="15" x2="15" y1="6" y2="21"/>
          </svg>
          <h3 class="font-semibold text-gray-900 dark:text-white">Customer Locations</h3>
          <app-badge variant="secondary">{{ customers.length }} locations</app-badge>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            (click)="closeMap()"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Map Container -->
      <div class="relative">
        <div id="customer-map" style="height: 400px; width: 100%;"></div>
        @if (isGeocoding) {
          <div class="absolute inset-0 backdrop-blur-sm bg-white/40 dark:bg-gray-900/40 flex items-center justify-center" style="z-index: 1001;">
            <div class="flex items-center gap-2.5 bg-white dark:bg-gray-800 rounded-lg px-4 py-2.5 shadow-lg border border-gray-200 dark:border-gray-700">
              <svg class="animate-spin h-4 w-4 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Refining locations...</span>
            </div>
          </div>
        }
      </div>

      <!-- Legend -->
      <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div class="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 flex-wrap">
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full bg-green-500"></div>
            <span>Customer Location</span>
          </div>
          @if (focusedState) {
            <span class="text-gray-300 dark:text-gray-600">|</span>
            <span class="text-green-600 dark:text-green-400">Focused on: {{ getDisplayName(focusedState) }}</span>
          }
        </div>
      </div>
    </div>
  `
})
export class CustomerMapComponent implements OnInit, OnDestroy, OnChanges, AfterViewInit {
  private appState = inject(AppStateService);

  @Input() customers: Customer[] = [];
  @Input() focusedState: string | null = null;
  @Input() centerLat: number | null = null;
  @Input() centerLng: number | null = null;
  @Input() zoomLevel: number | null = null;
  @Output() close = new EventEmitter<void>();
  @Output() selectCustomer = new EventEmitter<Customer>();

  isGeocoding = false;

  private map: any = null;
  private markers: any[] = [];
  private isMapInitialized = false;

  // Use shared cache from AppStateService so geocoded coords persist across navigation
  private get geocodeCache(): Map<string, { lat: number; lng: number }> {
    return this.appState.mapGeocodeCache;
  }

  private stateInfo: { [key: string]: StateInfo } = {
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
    'tx': { lat: 31.9686, lng: -99.9018, zoom: 6, displayName: 'Texas' },
    'texas': { lat: 31.9686, lng: -99.9018, zoom: 6, displayName: 'Texas' },
    'ok': { lat: 35.0078, lng: -97.0929, zoom: 7, displayName: 'Oklahoma' },
    'oklahoma': { lat: 35.0078, lng: -97.0929, zoom: 7, displayName: 'Oklahoma' },
    'co': { lat: 39.5501, lng: -105.7821, zoom: 7, displayName: 'Colorado' },
    'colorado': { lat: 39.5501, lng: -105.7821, zoom: 7, displayName: 'Colorado' }
  };

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    setTimeout(() => this.initializeMap(), 100);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.isMapInitialized && (changes['customers'] || changes['focusedState'])) {
      this.refreshMap();
    }
  }

  ngOnDestroy(): void {
    this.destroyMap();
  }

  getDisplayName(state: string): string {
    const info = this.stateInfo[state.toLowerCase()];
    if (info) return info.displayName;
    return state.charAt(0).toUpperCase() + state.slice(1);
  }

  closeMap(): void {
    this.close.emit();
  }

  private initializeMap(): void {
    if (this.isMapInitialized) return;

    try {
      let centerLat = this.centerLat ?? 41.8780;
      let centerLng = this.centerLng ?? -93.0977;
      let zoom = this.zoomLevel ?? 5;

      if (this.focusedState) {
        const stateLower = this.focusedState.toLowerCase();
        const info = this.stateInfo[stateLower];
        if (info) {
          centerLat = info.lat;
          centerLng = info.lng;
          zoom = info.zoom;
        }
      }

      this.map = L.map('customer-map').setView([centerLat, centerLng], zoom);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(this.map);

      this.isMapInitialized = true;
      this.addMarkers();
    } catch (error) {
      // map init failed silently
    }
  }

  private refreshMap(): void {
    if (!this.isMapInitialized || !this.map) return;

    try {
      this.clearMarkers();
      this.addMarkers();

      if (this.focusedState) {
        const stateLower = this.focusedState.toLowerCase();
        const info = this.stateInfo[stateLower];
        if (info) {
          this.map.setView([info.lat, info.lng], info.zoom);
        }
      } else if (this.customers.length > 1) {
        this.fitBounds();
      }
    } catch (error) {
      // map refresh failed silently
    }
  }

  private addMarkers(): void {
    if (!this.map) return;
    this.initializeMarkersWithGeocoding();
  }

  /**
   * Resolves the best address for a customer using Extended fields with Merchandising fallback.
   */
  private resolveAddress(customer: Customer): { street: string; city: string; state: string; zip: string; county: string } {
    const street = customer.extendedAddressLine1
      || customer.extendedAddressLine2
      || customer.extendedAddressLine3
      || customer.extendedAddressLine4
      || customer.addressLine1
      || '';
    const city = customer.extendedCity || customer.location || '';
    const state = customer.extendedStateProvince || customer.stateProvince || '';
    const zip = customer.extendedPostalCode || customer.postalCode || '';
    const county = customer.extendedCountry || '';
    return { street, city, state, zip, county };
  }

  /**
   * Builds a geocode cache key from resolved address parts.
   * Uses city+state+zip (no street) — city-level precision is sufficient for map pins
   * and dramatically reduces unique geocoding calls.
   */
  private geocodeCacheKey(addr: { city: string; state: string; zip: string }): string {
    const parts = [addr.city, addr.state, addr.zip]
      .map(p => p.toLowerCase().trim())
      .filter(Boolean);
    return parts.join(',');
  }

  private async initializeMarkersWithGeocoding(): Promise<void> {
    // ── Phase 1: Place all markers INSTANTLY using cached or fallback coords ──
    const markerMap = new Map<number, any>(); // customerId → leaflet marker

    for (const customer of this.customers) {
      if (!this.map) return;

      const addr = this.resolveAddress(customer);
      const cacheKey = this.geocodeCacheKey(addr);
      const coords = this.geocodeCache.has(cacheKey)
        ? this.geocodeCache.get(cacheKey)!
        : this.getCoordinatesForCustomer(customer);

      const marker = this.buildMarker(customer, coords);
      markerMap.set(customer.id, marker);
      this.markers.push(marker);
    }

    // Fit bounds right away so the map is usable immediately
    if (this.customers.length > 1 && !this.focusedState && this.map) {
      this.fitBounds();
    }

    // ── Phase 2: Geocode unique addresses in the background, update markers ──
    const addressGroups = new Map<string, { addr: { street: string; city: string; state: string; zip: string }; customerIds: number[] }>();
    for (const customer of this.customers) {
      const addr = this.resolveAddress(customer);
      if (!addr.city && !addr.state && !addr.zip) continue;
      const key = this.geocodeCacheKey(addr);
      if (!addressGroups.has(key)) addressGroups.set(key, { addr, customerIds: [] });
      addressGroups.get(key)!.customerIds.push(customer.id);
    }

    // Only geocode locations not already resolved in cache
    const toGeocode = [...addressGroups.entries()].filter(([key]) => !this.geocodeCache.has(key));

    if (toGeocode.length === 0) return;

    this.isGeocoding = true;

    // Geocode one at a time via API proxy (server enforces 1 req/sec rate limit)
    for (const [cacheKey, { addr, customerIds }] of toGeocode) {
      if (!this.map) break;

      try {
        const response = await fetch(`${environment.apiBaseUrl}/geocode/single`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: cacheKey, city: addr.city, state: addr.state, zip: addr.zip })
        });

        if (response.ok) {
          const result: { key: string; lat: number | null; lng: number | null } = await response.json();
          if (result.lat != null && result.lng != null) {
            const coords = { lat: result.lat, lng: result.lng };
            this.appState.setGeocodeCache(cacheKey, coords);
            for (const customerId of customerIds) {
              const marker = markerMap.get(customerId);
              if (marker && this.map) {
                marker.setLatLng([coords.lat, coords.lng]);
              }
            }
          }
        }
      } catch {
        // API unavailable — skip this address
      }
    }

    this.isGeocoding = false;
  }

  private buildMarker(customer: Customer, coords: { lat: number; lng: number }): any {
    const addr = this.resolveAddress(customer);
    const locationParts = [addr.city, addr.state].filter(Boolean).join(', ');
    const contactLine = customer.phone
      ? customer.phone
      : (customer.email || '');

    const popupContent = `
      <div style="min-width: 180px; font-family: inherit; padding: 2px 0;">
        <div style="font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 2px; line-height: 1.3;">
          ${customer.name}
        </div>
        ${customer.sourceCustomerId ? `<div style="font-size: 11px; color: #9ca3af; margin-bottom: 6px; font-family: monospace;">${customer.sourceCustomerId}</div>` : ''}
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
      .addTo(this.map)
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
        (link as HTMLElement).onclick = (e: Event) => {
          e.preventDefault();
          this.selectCustomer.emit(customer);
        };
      }

      // Keep popup open while mouse is inside it
      const popupEl = marker.getPopup()?.getElement();
      if (popupEl) {
        popupEl.addEventListener('mouseenter', cancelClose);
        popupEl.addEventListener('mouseleave', scheduleClose);
      }
    });

    (marker as any).customerId = customer.id;
    return marker;
  }

  private getCoordinatesForCustomer(customer: Customer): { lat: number; lng: number } {
    const addr = this.resolveAddress(customer);
    const stateStr = addr.state.toLowerCase().trim();

    // Match on state field only (not city) to avoid false matches like "Burlington" → "in" (Indiana)
    if (stateStr) {
      const info = this.stateInfo[stateStr];
      if (info) {
        const hash = this.hashCode(customer.id);
        const latOffset = ((hash % 1000) / 1000 - 0.5) * 1.5;
        const lngOffset = (((hash >> 10) % 1000) / 1000 - 0.5) * 1.5;

        return {
          lat: info.lat + latOffset,
          lng: info.lng + lngOffset
        };
      }
    }

    // Default: Iowa with offset
    const hash = this.hashCode(customer.id);
    return {
      lat: 41.8780 + ((hash % 1000) / 1000 - 0.5) * 3,
      lng: -93.0977 + (((hash >> 10) % 1000) / 1000 - 0.5) * 3
    };
  }

  private hashCode(value: string | number): number {
    const str = value.toString();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private clearMarkers(): void {
    for (const marker of this.markers) {
      marker.remove();
    }
    this.markers = [];
  }

  private fitBounds(): void {
    if (!this.map || this.markers.length === 0) return;

    const group = L.featureGroup(this.markers);
    this.map.fitBounds(group.getBounds().pad(0.1));
  }

  private destroyMap(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.markers = [];
      this.isMapInitialized = false;
    }
  }
}
