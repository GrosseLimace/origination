import { Component, input, output, effect, signal, DestroyRef, inject, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Customer } from '@models';

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
  templateUrl: './customer-map.component.html'
})
export class CustomerMapComponent {
  public customers = input<Customer[]>([]);
  public selectedCustomer = input<Customer | null>(null);
  public height = input('400px');
  public customerClick = output<Customer>();

  private _map: any;
  private _markers: any[] = [];
  private _destroyed = false;
  loading = signal(true);

  private destroyRef = inject(DestroyRef);

  constructor() {
    // Initialize map after first render
    afterNextRender(() => this._initMap());

    // React to input changes once map is initialized
    effect(() => {
      const _customers = this.customers();
      const _selectedCustomer = this.selectedCustomer();

      if (this._map) {
        this._addMarkers();

        // Center on selected customer if one is selected
        if (_selectedCustomer?.coordinates) {
          this._map.setView(
            [_selectedCustomer.coordinates.lat, _selectedCustomer.coordinates.lng],
            10
          );
        }
      }
    });

    this.destroyRef.onDestroy(() => {
      this._destroyed = true;
      // Clean up map instance to prevent memory leaks
      if (this._map) {
        this._map.remove();
      }
    });
  }

  /**
   * Initializes the Leaflet map after loading the library.
   */
  private async _initMap() {
    // Load Leaflet dynamically from CDN if not already present
    if (typeof L === 'undefined') {
      await this._loadLeaflet();
    }

    if (this._destroyed) return;

    // Initialize map centered on the US grain belt (Kansas)
    this._map = L.map('customer-map').setView([41.5, -93.0], 5);

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this._map);

    this.loading.set(false);
    this._addMarkers();
  }

  /**
   * Dynamically loads Leaflet CSS and JavaScript from CDN.
   * Returns a promise that resolves when loading is complete.
   */
  private async _loadLeaflet(): Promise<void> {
    return new Promise((resolve) => {
      // Check if already loaded
      if (typeof L !== 'undefined') {
        resolve();
        return;
      }

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
  }

  /**
   * Creates map markers for all customers with coordinates.
   * Highlights the selected customer with a different style.
   */
  private _addMarkers() {
    // Clear existing markers before adding new ones
    this._markers.forEach(m => m.remove());
    this._markers = [];

    // Add markers for customers with coordinates
    this.customers().forEach(customer => {
      if (customer.coordinates) {
        const isSelected = this.selectedCustomer()?.id === customer.id;

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
        ).addTo(this._map);

        // Add popup with customer details
        marker.bindPopup(`
          <div class="p-2">
            <h3 class="font-bold">${customer.name}</h3>
            <p class="text-sm text-gray-600">${customer.farm}</p>
            <p class="text-sm text-gray-600">${customer.location}</p>
            <p class="text-sm mt-1">${customer.totalAcres.toLocaleString()} acres</p>
          </div>
        `);

        // Emit click event when marker is clicked
        marker.on('click', () => {
          this.customerClick.emit(customer);
        });

        this._markers.push(marker);
      }
    });

    // Fit map bounds to show all markers with padding
    if (this._markers.length > 0) {
      const group = L.featureGroup(this._markers);
      this._map.fitBounds(group.getBounds().pad(0.1));
    }
  }
}
