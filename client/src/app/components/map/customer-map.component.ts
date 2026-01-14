import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Customer } from '../../models';
import { BadgeComponent } from '../ui/badge/badge.component';

declare const L: any;

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

      <!-- Map Container -->
      <div id="customer-map" style="height: 400px; width: 100%;"></div>

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
          <span class="text-gray-300 dark:text-gray-600">|</span>
          <span>Click a marker to see customer details</span>
        </div>
      </div>
    </div>
  `
})
export class CustomerMapComponent implements OnInit, OnDestroy, OnChanges, AfterViewInit {
  @Input() customers: Customer[] = [];
  @Input() focusedState: string | null = null;
  @Input() centerLat: number | null = null;
  @Input() centerLng: number | null = null;
  @Input() zoomLevel: number | null = null;
  @Output() close = new EventEmitter<void>();
  @Output() selectCustomer = new EventEmitter<Customer>();

  private map: any = null;
  private markers: any[] = [];
  private isMapInitialized = false;

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

  ngOnInit(): void {
    // Load Leaflet CSS if not already loaded
    this.loadLeafletStyles();
  }

  ngAfterViewInit(): void {
    // Small delay to ensure DOM is ready
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

  private loadLeafletStyles(): void {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => this.initializeMap();
      document.head.appendChild(script);
    }
  }

  private initializeMap(): void {
    if (this.isMapInitialized || typeof L === 'undefined') return;

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
      console.error('Error initializing map:', error);
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
      console.error('Error refreshing map:', error);
    }
  }

  private addMarkers(): void {
    if (!this.map) return;

    for (const customer of this.customers) {
      const coords = this.getCoordinatesForCustomer(customer);
      const popupContent = `
        <div style="min-width: 150px;">
          <strong>${customer.name}</strong><br/>
          <span style="color: #666;">${customer.farm}</span><br/>
          <span style="font-size: 12px;">${customer.location}</span><br/>
          <span style="font-size: 12px; color: #22c55e;">${customer.totalAcres.toLocaleString()} acres</span><br/>
          <a href="#" class="view-customer-link" data-customer-id="${customer.id}"
             style="color: #16a34a; text-decoration: underline; font-weight: 500; cursor: pointer;">
            View Customer →
          </a>
        </div>
      `;

      const marker = L.marker([coords.lat, coords.lng])
        .addTo(this.map)
        .bindPopup(popupContent);

      marker.on('popupopen', () => {
        const link = document.querySelector(`.view-customer-link[data-customer-id="${customer.id}"]`);
        if (link) {
          (link as HTMLElement).onclick = (e: Event) => {
            e.preventDefault();
            this.selectCustomer.emit(customer);
          };
        }
      });

      (marker as any).customerId = customer.id;
      this.markers.push(marker);
    }

    if (this.customers.length > 1 && !this.focusedState) {
      this.fitBounds();
    }
  }

  private getCoordinatesForCustomer(customer: Customer): { lat: number; lng: number } {
    const location = customer.location.toLowerCase();

    for (const [key, info] of Object.entries(this.stateInfo)) {
      if (location.includes(key)) {
        // Create deterministic offset based on customer ID
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

  private hashCode(str: string): number {
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
