import { Component, Input, Output, EventEmitter, AfterViewInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Customer } from '../../../models';

declare var L: any;

@Component({
  selector: 'app-customer-map',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden">
      <div id="customer-map" class="w-full h-full"></div>

      @if (loading()) {
        <div class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
        </div>
      }
    </div>
  `
})
export class CustomerMapComponent implements AfterViewInit, OnDestroy {
  @Input() customers: Customer[] = [];
  @Input() selectedCustomer: Customer | null = null;
  @Input() height = '400px';
  @Output() customerClick = new EventEmitter<Customer>();

  private map: any;
  private markers: any[] = [];
  loading = signal(true);

  ngAfterViewInit() {
    this.initMap();
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
    }
  }

  private async initMap() {
    // Load Leaflet dynamically
    if (typeof L === 'undefined') {
      await this.loadLeaflet();
    }

    // Initialize map centered on Kansas (grain belt)
    this.map = L.map('customer-map').setView([38.5, -98.0], 6);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    this.loading.set(false);
    this.addMarkers();
  }

  private async loadLeaflet(): Promise<void> {
    return new Promise((resolve) => {
      // Check if already loaded
      if (typeof L !== 'undefined') {
        resolve();
        return;
      }

      // Load CSS
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      // Load JS
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve();
      document.head.appendChild(script);
    });
  }

  private addMarkers() {
    // Clear existing markers
    this.markers.forEach(m => m.remove());
    this.markers = [];

    // Add markers for customers with coordinates
    this.customers.forEach(customer => {
      if (customer.coordinates) {
        const isSelected = this.selectedCustomer?.id === customer.id;

        const icon = L.divIcon({
          className: 'custom-marker',
          html: `
            <div class="w-8 h-8 rounded-full ${isSelected ? 'bg-green-600 ring-4 ring-green-300' : 'bg-green-500'} flex items-center justify-center text-white text-xs font-bold shadow-lg cursor-pointer transform hover:scale-110 transition-transform">
              ${customer.name.charAt(0)}
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });

        const marker = L.marker(
          [customer.coordinates.latitude, customer.coordinates.longitude],
          { icon }
        ).addTo(this.map);

        // Add popup
        marker.bindPopup(`
          <div class="p-2">
            <h3 class="font-bold">${customer.name}</h3>
            <p class="text-sm text-gray-600">${customer.farm}</p>
            <p class="text-sm text-gray-600">${customer.location}</p>
            <p class="text-sm mt-1">${customer.totalAcres.toLocaleString()} acres</p>
          </div>
        `);

        marker.on('click', () => {
          this.customerClick.emit(customer);
        });

        this.markers.push(marker);
      }
    });

    // Fit bounds if we have markers
    if (this.markers.length > 0) {
      const group = L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds().pad(0.1));
    }
  }

  // Call this when customers or selectedCustomer changes
  ngOnChanges() {
    if (this.map) {
      this.addMarkers();

      // Center on selected customer
      if (this.selectedCustomer?.coordinates) {
        this.map.setView(
          [this.selectedCustomer.coordinates.latitude, this.selectedCustomer.coordinates.longitude],
          10
        );
      }
    }
  }
}
