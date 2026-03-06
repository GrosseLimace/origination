import { Component, Input, Output, EventEmitter, AfterViewInit, OnDestroy, OnChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Customer } from '../../../models';

// Declare Leaflet as external global (loaded dynamically from CDN)
declare var L: any;

/**
 * CustomerMapComponent displays an interactive map with customer locations.
 * Uses Leaflet.js for map rendering with OpenStreetMap tiles.
 * Supports marker selection and click events for customer navigation.
 */
@Component({
  selector: 'app-customer-map',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden">
      <!-- Map container - Leaflet will render here -->
      <div id="customer-map" class="w-full h-full"></div>

      <!-- Loading spinner shown while Leaflet initializes -->
      @if (loading()) {
        <div class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
        </div>
      }
    </div>
  `
})
export class CustomerMapComponent implements AfterViewInit, OnDestroy, OnChanges {
  @Input() customers: Customer[] = [];
  @Input() selectedCustomer: Customer | null = null;
  @Input() height = '400px';
  @Output() customerClick = new EventEmitter<Customer>();

  private map: any;
  private markers: any[] = [];
  private destroyed = false;
  loading = signal(true);

  // Static promise ensures Leaflet is loaded only once across all instances
  private static leafletLoadPromise: Promise<void> | null = null;

  ngAfterViewInit() {
    this.initMap();
  }

  ngOnDestroy() {
    this.destroyed = true;
    // Clean up map instance to prevent memory leaks
    if (this.map) {
      this.map.remove();
    }
  }

  /**
   * Responds to input changes to update markers and map view.
   */
  ngOnChanges() {
    if (this.map) {
      this.addMarkers();

      // Center on selected customer if one is selected
      if (this.selectedCustomer?.coordinates) {
        this.map.setView(
          [this.selectedCustomer.coordinates.lat, this.selectedCustomer.coordinates.lng],
          10
        );
      }
    }
  }

  /**
   * Initializes the Leaflet map after loading the library.
   */
  private async initMap() {
    // Load Leaflet dynamically from CDN if not already present
    if (typeof L === 'undefined') {
      await this.loadLeaflet();
    }

    // Guard: component may have been destroyed while awaiting Leaflet load
    if (this.destroyed) return;

    // Initialize map centered on the US grain belt (Kansas)
    this.map = L.map('customer-map').setView([41.5, -93.0], 5);

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.loading.set(false);
    this.addMarkers();
  }

  /**
   * Dynamically loads Leaflet CSS and JavaScript from CDN.
   * Uses a static promise so concurrent instances share a single load attempt.
   */
  private loadLeaflet(): Promise<void> {
    if (typeof L !== 'undefined') return Promise.resolve();
    if (CustomerMapComponent.leafletLoadPromise) return CustomerMapComponent.leafletLoadPromise;

    CustomerMapComponent.leafletLoadPromise = new Promise((resolve) => {
      // Load Leaflet CSS
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      // Load Leaflet JavaScript
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve();
      document.head.appendChild(script);
    });

    return CustomerMapComponent.leafletLoadPromise;
  }

  /**
   * Creates map markers for all customers with coordinates.
   * Highlights the selected customer with a different style.
   */
  private addMarkers() {
    // Clear existing markers before adding new ones
    this.markers.forEach(m => m.remove());
    this.markers = [];

    // Add markers for customers with coordinates
    this.customers.forEach(customer => {
      if (customer.coordinates) {
        const isSelected = this.selectedCustomer?.id === customer.id;

        // Create custom div icon with customer initial
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

        // Create marker at customer coordinates
        const marker = L.marker(
          [customer.coordinates.lat, customer.coordinates.lng],
          { icon }
        ).addTo(this.map);

        // Add popup with customer details
        marker.bindPopup(`
          <div class="p-2">
            <h3 class="font-bold">${this.escapeHtml(customer.name)}</h3>
            <p class="text-sm text-gray-600">${this.escapeHtml(customer.farm ?? '')}</p>
            <p class="text-sm text-gray-600">${this.escapeHtml(customer.location ?? '')}</p>
            <p class="text-sm mt-1">${customer.totalAcres.toLocaleString()} acres</p>
          </div>
        `);

        // Emit click event when marker is clicked
        marker.on('click', () => {
          this.customerClick.emit(customer);
        });

        this.markers.push(marker);
      }
    });

    // Fit map bounds to show all markers with padding
    if (this.markers.length > 0) {
      const group = L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds().pad(0.1));
    }
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
