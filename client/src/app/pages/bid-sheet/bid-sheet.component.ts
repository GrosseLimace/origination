import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent } from '../../components/ui/card/card.component';

declare const L: any;

interface BidData {
  crop: string;
  year: number;
  locations: { [key: string]: string };
  status: { [key: string]: 'matching' | 'beating' | 'changed' | 'none' };
}

interface LocationCoords {
  lat: number;
  lng: number;
  name: string;
}

@Component({
  selector: 'app-bid-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent],
  template: `
    <div class="space-y-4">
      <!-- Header -->
      <div>
        <h2 class="text-2xl font-semibold text-gray-900 dark:text-white">Bid Sheet</h2>
        <p class="text-gray-500 dark:text-gray-400">Grain bids by location and crop</p>
      </div>

      <!-- Top Section: Market Values and Rail Offers -->
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        <!-- Market Values Table -->
        <app-card class="min-w-0">
          <app-card-header class="!p-0 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center justify-between h-[72px] px-6">
              <div class="flex items-center gap-4">
                <select [(ngModel)]="selectedMarketCrop" class="px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-base text-gray-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors">
                  @for (crop of crops; track crop) {
                    <option [value]="crop">{{ crop }}</option>
                  }
                </select>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Market Values</h3>
              </div>
              <div class="flex items-center gap-2">
                <button
                  (click)="addDeliveryPeriod()"
                  class="px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 hover:text-white hover:bg-green-700 dark:hover:bg-green-600 border border-green-700 dark:border-green-600 rounded transition-colors"
                >
                  Add Row
                </button>
                <button
                  (click)="addLocation()"
                  class="px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 hover:text-white hover:bg-green-700 dark:hover:bg-green-600 border border-green-700 dark:border-green-600 rounded transition-colors"
                >
                  Add Column
                </button>
              </div>
            </div>
          </app-card-header>
          <app-card-content class="!p-0">
            <div #marketValuesScroll class="overflow-x-auto overflow-y-auto px-6 pb-6 pt-6" style="max-height: 280px;">
              <table class="w-full text-sm" style="margin: 0; border-spacing: 0;">
                <thead>
                  <tr class="border-b border-gray-200 dark:border-gray-700">
                    <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-32" style="line-height: 1.5;">
                      Period
                    </th>
                    @for (location of marketLocations; track $index; let idx = $index) {
                      <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider group">
                        <div class="flex items-center justify-center gap-1">
                          <input
                            type="text"
                            [(ngModel)]="marketLocations[idx]"
                            (blur)="updateLocationName(idx, $event)"
                            class="text-center bg-transparent border-0 hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-green-500 rounded px-2 py-1"
                          />
                          <button
                            (click)="removeLocation(idx)"
                            class="opacity-0 group-hover:opacity-100 transition-all duration-200 text-red-600 dark:text-red-400 hover:text-white hover:bg-red-600 dark:hover:bg-red-500 rounded p-1 hover:scale-110"
                            title="Delete location"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M3 6h18"/>
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                              <line x1="10" x2="10" y1="11" y2="17"/>
                              <line x1="14" x2="14" y1="11" y2="17"/>
                            </svg>
                          </button>
                        </div>
                      </th>
                    }
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                  @for (period of deliveryPeriods; track $index; let idx = $index) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 group">
                      <td class="px-3 py-3 text-sm font-medium text-gray-900 dark:text-white w-32" style="vertical-align: top;">
                        <div class="flex items-center gap-2">
                          <input
                            type="text"
                            [(ngModel)]="deliveryPeriods[idx]"
                            (blur)="updatePeriodName(idx, $event)"
                            class="bg-transparent border-0 hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-green-500 rounded px-2 py-1"
                          />
                          <button
                            (click)="removeDeliveryPeriod(idx)"
                            class="opacity-0 group-hover:opacity-100 transition-all duration-200 text-red-600 dark:text-red-400 hover:text-white hover:bg-red-600 dark:hover:bg-red-500 rounded p-1 hover:scale-110"
                            title="Delete period"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M3 6h18"/>
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                              <line x1="10" x2="10" y1="11" y2="17"/>
                              <line x1="14" x2="14" y1="11" y2="17"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                      @for (location of marketLocations; track location) {
                        <td class="px-4 py-3 text-center">
                          <input
                            type="text"
                            [value]="getMarketValue(period, location)"
                            (blur)="updateMarketValue(period, location, $event)"
                            class="w-full px-2 py-1 text-sm text-center text-gray-900 dark:text-white bg-transparent border-0 hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-green-500 rounded"
                          />
                        </td>
                      }
                      <td class="px-4 py-3"></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-card-content>
        </app-card>

        <!-- Right Column: Rail Offers and Key -->
        <div class="space-y-4 min-w-0">
          <!-- Rail Offers -->
          <app-card>
            <app-card-header class="!p-0 border-b border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between h-[72px] px-6">
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Rail Offers</h3>
                <div class="flex items-center gap-2">
                  <button
                    (click)="addRailOffer()"
                    class="px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 hover:text-white hover:bg-green-700 dark:hover:bg-green-600 border border-green-700 dark:border-green-600 rounded transition-colors"
                  >
                    Add Row
                  </button>
                </div>
              </div>
            </app-card-header>
            <app-card-content class="!p-0">
              <div class="overflow-x-auto overflow-y-auto px-6 pb-6 pt-6" style="max-height: 280px;">
                <table class="w-full text-sm" style="margin: 0; border-spacing: 0;">
                <thead>
                  <tr class="border-b border-gray-200 dark:border-gray-700">
                    <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider" style="line-height: 1.5;">
                      Offer
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                  @for (offer of railOffers; track $index) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 group">
                      <td class="px-3 py-3 text-sm" style="vertical-align: top; line-height: 1.5;">
                        <div class="flex items-center gap-2">
                          <input
                            type="text"
                            [(ngModel)]="railOffers[$index]"
                            placeholder="Enter rail offer"
                            class="flex-1 text-sm text-gray-900 dark:text-white bg-transparent border-0 hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-green-500 rounded px-2 py-1"
                          />
                          <button
                            (click)="removeRailOffer($index)"
                            class="opacity-0 group-hover:opacity-100 transition-all duration-200 text-red-600 dark:text-red-400 hover:text-white hover:bg-red-600 dark:hover:bg-red-500 rounded p-1 hover:scale-110"
                            title="Delete offer"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M3 6h18"/>
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                              <line x1="10" x2="10" y1="11" y2="17"/>
                              <line x1="14" x2="14" y1="11" y2="17"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
              </div>
            </app-card-content>
          </app-card>

        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <!-- Location Map -->
        <app-card>
          <app-card-content class="!p-0">
            <div style="position: relative; height: 700px; width: 100%;">
              <div id="bid-locations-map" style="height: 100%; width: 100%;"></div>

              <!-- Filters Overlay -->
              <div class="absolute top-2.5 left-16 z-[1000] flex items-center gap-3 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm p-2.5 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
                <!-- Crop Filter -->
                <select [(ngModel)]="selectedCrop" (change)="filterBids()" class="px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors">
                  @for (crop of crops; track crop) {
                    <option [value]="crop">{{ crop }}</option>
                  }
                </select>

                <!-- Year Filter -->
                <select [(ngModel)]="selectedYear" (change)="filterBids()" class="px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors">
                  <option value="2025">2025</option>
                  <option value="2026">2026</option>
                </select>

                <!-- Basis Filter -->
                <select [(ngModel)]="selectedBasis" (change)="filterBids()" class="px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors">
                  <option value="all">All Basis</option>
                  <option value="positive">Positive</option>
                  <option value="negative">Negative</option>
                </select>

                <!-- Divider -->
                <div class="h-8 w-px bg-gray-300 dark:bg-gray-600"></div>

                <!-- Search -->
                <div class="relative w-80">
                  <input
                    type="text"
                    [(ngModel)]="searchQuery"
                    (input)="filterBids()"
                    placeholder="Search locations, crops, or bids..."
                    class="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
                  />
                </div>
              </div>
            </div>
          </app-card-content>
        </app-card>

        <!-- Bids Table -->
        <app-card>
          <app-card-content class="!p-0">
            <div class="overflow-auto" style="height: 700px;">
              <!-- Selected Location Header -->
              @if (selectedLocation) {
                <div class="sticky top-0 z-20 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800 px-4 py-3">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 dark:text-green-400">
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                        <circle cx="12" cy="10" r="3"/>
                      </svg>
                      <span class="text-sm font-medium text-green-900 dark:text-green-100">{{ selectedLocation }}</span>
                    </div>
                    <button (click)="clearLocationSelection()" class="text-xs text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100 font-medium hover:underline">
                      Show All
                    </button>
                  </div>
                </div>
              }
              <table class="w-full border-collapse text-sm">
                <thead class="sticky z-10" [class.top-0]="!selectedLocation" [class.top-[52px]]="selectedLocation">
                  <tr class="bg-gray-50 dark:bg-gray-800">
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                      @if (selectedLocation) { Crop } @else { Location }
                    </th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                      @if (selectedLocation) { Year } @else { Crop }
                    </th>
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                      Bid
                    </th>
                    <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of filteredBidItems; track item.location + item.crop + item.year) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors border-b border-gray-200 dark:border-gray-700">
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        @if (selectedLocation) { {{ item.crop }} } @else { {{ item.location }} }
                      </td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        @if (selectedLocation) { {{ item.year }} } @else { {{ item.crop }} }
                      </td>
                      <td class="px-4 py-3 text-sm text-right font-mono text-gray-900 dark:text-white">
                        {{ item.bid }}
                      </td>
                      <td class="px-4 py-3 text-center">
                        @if (item.status !== 'none') {
                          <span class="inline-flex px-2 py-1 text-xs font-medium rounded-full" [ngClass]="{
                            'bg-yellow-200 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400': item.status === 'matching',
                            'bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-400': item.status === 'beating',
                            'bg-green-200 text-green-800 dark:bg-green-900/40 dark:text-green-400': item.status === 'changed'
                          }">
                            {{ item.status }}
                          </span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-card-content>
        </app-card>
      </div>
    </div>
  `
})
export class BidSheetComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('marketValuesScroll') marketValuesScroll?: ElementRef;

  selectedYear: string = '2025';
  selectedCrop: string = 'Wheat';
  searchQuery: string = '';
  selectedBasis: string = 'all';
  selectedLocation: string = '';
  selectedMarketCrop: string = 'Corn';

  bidData: BidData[] = [];
  filteredBidItems: any[] = [];
  crops: string[] = ['Wheat', 'Corn', 'Milo', 'Beans', 'Canola'];

  marketLocations: string[] = ['Lyons', 'Great Bend', 'Russell', 'Dodge City', 'Garden City'];
  deliveryPeriods: string[] = ['Aug/Sept', 'Oct-March'];

  railOffers: string[] = [
    'Aug +97U',
    'FH Sep +97U',
    'Oct/Nov/Dec +95Z'
  ];

  marketValues: { [crop: string]: { [period: string]: { [location: string]: string } } } = {
    'Corn': {
      'Aug/Sept': { 'Lyons': '+65U/+85U', 'Great Bend': '+70U/+90U', 'Russell': '+55U/+75U', 'Dodge City': '+105U/+125U', 'Garden City': '+115U/+130U' },
      'Oct-March': { 'Lyons': '+45R/+60R', 'Great Bend': '+45R/+60R', 'Russell': '+35R/+50R', 'Dodge City': '+75R/+85R', 'Garden City': '+85R/+100R' }
    },
    'Wheat': {
      'Aug/Sept': { 'Lyons': '', 'Great Bend': '', 'Russell': '', 'Dodge City': '', 'Garden City': '' },
      'Oct-March': { 'Lyons': '', 'Great Bend': '', 'Russell': '', 'Dodge City': '', 'Garden City': '' }
    },
    'Milo': {
      'Aug/Sept': { 'Lyons': '', 'Great Bend': '', 'Russell': '', 'Dodge City': '', 'Garden City': '' },
      'Oct-March': { 'Lyons': '', 'Great Bend': '', 'Russell': '', 'Dodge City': '', 'Garden City': '' }
    },
    'Beans': {
      'Aug/Sept': { 'Lyons': '', 'Great Bend': '', 'Russell': '', 'Dodge City': '', 'Garden City': '' },
      'Oct-March': { 'Lyons': '', 'Great Bend': '', 'Russell': '', 'Dodge City': '', 'Garden City': '' }
    },
    'Canola': {
      'Aug/Sept': { 'Lyons': '', 'Great Bend': '', 'Russell': '', 'Dodge City': '', 'Garden City': '' },
      'Oct-March': { 'Lyons': '', 'Great Bend': '', 'Russell': '', 'Dodge City': '', 'Garden City': '' }
    }
  };

  private map: any = null;
  private markers: any[] = [];
  private isMapInitialized = false;

  locationCoordinates: LocationCoords[] = [
    { lat: 37.4850, lng: -99.7750, name: 'Scoular Truman' },
    { lat: 37.5500, lng: -99.4000, name: 'Scoular Cullison' },
    { lat: 37.7000, lng: -100.8500, name: 'Kansas West (Inka)' },
    { lat: 38.6500, lng: -98.2000, name: 'Kansas East (Belmont)' },
    { lat: 38.5500, lng: -97.6500, name: 'Skyland C-ham Area' },
    { lat: 37.8000, lng: -98.4000, name: 'Turon Mill & Elev' },
    { lat: 37.6500, lng: -99.3000, name: 'FCE Best Bid' },
    { lat: 37.7500, lng: -99.5000, name: 'GPC Best Bid' },
    { lat: 37.0150, lng: -98.4850, name: 'OK Coop Kiowa' }
  ];

  ngOnInit(): void {
    this.loadBidData();
    this.filterBids();
    this.loadLeafletStyles();
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.initializeMap(), 500);
  }

  ngOnDestroy(): void {
    this.destroyMap();
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

    const mapElement = document.getElementById('bid-locations-map');
    if (!mapElement) {
      console.error('Map container not found');
      return;
    }

    try {
      // Center on Kansas
      this.map = L.map('bid-locations-map').setView([37.9, -98.8], 7);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.map);

      this.isMapInitialized = true;

      // Force map to recalculate size
      setTimeout(() => {
        if (this.map) {
          this.map.invalidateSize();
        }
      }, 100);

      this.addMarkers();
    } catch (error) {
      console.error('Error initializing map:', error);
    }
  }

  private addMarkers(): void {
    if (!this.map) return;

    this.clearMarkers();

    const year = parseInt(this.selectedYear);

    // Find the bid data for the selected crop and year
    const cropData = this.bidData.find(bd => bd.crop === this.selectedCrop && bd.year === year);
    if (!cropData) return;

    for (const location of this.locationCoordinates) {
      const bid = cropData.locations[location.name];
      const status = cropData.status[location.name];

      // Skip locations without bids
      if (!bid) continue;

      // Determine marker color based on status
      const markerColor =
        status === 'matching' ? '#fde047' :
        status === 'beating' ? '#fca5a5' :
        status === 'changed' ? '#34d399' : '#d1d5db';

      const borderColor =
        status === 'matching' ? '#f59e0b' :
        status === 'beating' ? '#dc2626' :
        status === 'changed' ? '#059669' : '#6b7280';

      const textColor = status === 'none' ? '#6b7280' : '#000000';

      // Create custom pin-shaped icon with bid value
      const divIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="position: relative; width: 50px; height: 60px;">
          <div style="
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            background-color: ${markerColor};
            border: 3px solid ${borderColor};
            border-radius: 50% 50% 50% 0;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: bold;
            color: ${textColor};
            box-shadow: 0 2px 6px rgba(0,0,0,0.4);
            transform: translateX(-50%) rotate(-45deg);
          ">
            <span style="transform: rotate(45deg); display: block;">${bid}</span>
          </div>
        </div>`,
        iconSize: [50, 60],
        iconAnchor: [25, 60],
        popupAnchor: [0, -60]
      });

      // Create popup with editable form
      const marker = L.marker([location.lat, location.lng], { icon: divIcon })
        .addTo(this.map);

      marker.on('click', () => {
        this.selectedLocation = location.name;
        this.filterBids();
        this.openEditPopup(marker, location.name, bid, status);
      });

      this.markers.push(marker);
    }
  }

  private openEditPopup(marker: any, locationName: string, currentBid: string, status: string): void {
    const popupContent = `
      <div style="min-width: 200px;">
        <div style="margin-bottom: 12px;">
          <strong style="font-size: 14px;">${locationName}</strong>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">
            ${this.selectedCrop} - ${this.selectedYear}
          </div>
        </div>
        <div style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px;">
            Basis
          </label>
          <input
            id="bid-input-${locationName.replace(/\s+/g, '-')}"
            type="text"
            value="${currentBid}"
            style="
              width: 100%;
              padding: 6px 8px;
              border: 1px solid #d1d5db;
              border-radius: 4px;
              font-size: 13px;
              font-family: monospace;
            "
          />
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button
            id="cancel-btn-${locationName.replace(/\s+/g, '-')}"
            style="
              padding: 6px 12px;
              background-color: #f3f4f6;
              border: 1px solid #d1d5db;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              font-weight: 500;
            "
          >
            Cancel
          </button>
          <button
            id="save-btn-${locationName.replace(/\s+/g, '-')}"
            style="
              padding: 6px 12px;
              background-color: #10b981;
              color: white;
              border: none;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              font-weight: 500;
            "
          >
            Save
          </button>
        </div>
      </div>
    `;

    const popup = L.popup()
      .setLatLng(marker.getLatLng())
      .setContent(popupContent)
      .openOn(this.map);

    // Wait for popup to be added to DOM
    setTimeout(() => {
      const inputId = `bid-input-${locationName.replace(/\s+/g, '-')}`;
      const cancelBtnId = `cancel-btn-${locationName.replace(/\s+/g, '-')}`;
      const saveBtnId = `save-btn-${locationName.replace(/\s+/g, '-')}`;

      const input = document.getElementById(inputId) as HTMLInputElement;
      const cancelBtn = document.getElementById(cancelBtnId);
      const saveBtn = document.getElementById(saveBtnId);

      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          this.map.closePopup();
          this.clearLocationSelection();
        });
      }

      if (saveBtn && input) {
        saveBtn.addEventListener('click', () => {
          const newBid = input.value;
          this.saveBid(locationName, newBid);
          this.map.closePopup();
          this.clearLocationSelection();
        });
      }
    }, 100);
  }

  private saveBid(locationName: string, newBid: string): void {
    const year = parseInt(this.selectedYear);
    const cropData = this.bidData.find(bd => bd.crop === this.selectedCrop && bd.year === year);

    if (cropData) {
      cropData.locations[locationName] = newBid;
      // Refresh markers and table
      this.addMarkers();
      this.filterBids();
    }
  }

  private clearMarkers(): void {
    for (const marker of this.markers) {
      marker.remove();
    }
    this.markers = [];
  }

  private destroyMap(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.markers = [];
      this.isMapInitialized = false;
    }
  }

  isDarkMode(): boolean {
    return document.documentElement.classList.contains('dark');
  }

  clearLocationSelection(): void {
    this.selectedLocation = '';
    this.filterBids();
  }

  getMarketValue(period: string, location: string): string {
    if (this.marketValues[this.selectedMarketCrop] &&
        this.marketValues[this.selectedMarketCrop][period]) {
      return this.marketValues[this.selectedMarketCrop][period][location] || '';
    }
    return '';
  }

  updateMarketValue(period: string, location: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value;

    if (!this.marketValues[this.selectedMarketCrop]) {
      this.marketValues[this.selectedMarketCrop] = {};
    }
    if (!this.marketValues[this.selectedMarketCrop][period]) {
      this.marketValues[this.selectedMarketCrop][period] = {};
    }
    this.marketValues[this.selectedMarketCrop][period][location] = value;
  }

  addDeliveryPeriod(): void {
    // Create a unique period name
    let newPeriod = 'New Period';
    let counter = 1;
    while (this.deliveryPeriods.includes(newPeriod)) {
      newPeriod = `New Period ${counter}`;
      counter++;
    }

    this.deliveryPeriods.push(newPeriod);
    // Initialize values for all crops and locations for this new period
    for (const crop of this.crops) {
      if (!this.marketValues[crop]) {
        this.marketValues[crop] = {};
      }
      this.marketValues[crop][newPeriod] = {};
      for (const location of this.marketLocations) {
        this.marketValues[crop][newPeriod][location] = '';
      }
    }
  }

  removeDeliveryPeriod(index: number): void {
    const period = this.deliveryPeriods[index];
    if (confirm(`Remove delivery period "${period}"?`)) {
      this.deliveryPeriods.splice(index, 1);
      // Remove from market values for all crops
      for (const crop of this.crops) {
        if (this.marketValues[crop] && this.marketValues[crop][period]) {
          delete this.marketValues[crop][period];
        }
      }
    }
  }

  updatePeriodName(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const newName = input.value.trim();
    const oldName = this.deliveryPeriods[index];

    if (newName && newName !== oldName) {
      this.deliveryPeriods[index] = newName;
      // Update market values for all crops
      for (const crop of this.crops) {
        if (this.marketValues[crop] && this.marketValues[crop][oldName]) {
          this.marketValues[crop][newName] = this.marketValues[crop][oldName];
          delete this.marketValues[crop][oldName];
        }
      }
    }
  }

  addLocation(): void {
    // Create a unique location name
    let newLocation = 'New Location';
    let counter = 1;
    while (this.marketLocations.includes(newLocation)) {
      newLocation = `New Location ${counter}`;
      counter++;
    }

    this.marketLocations.push(newLocation);
    // Initialize values for all crops and periods for this new location
    for (const crop of this.crops) {
      if (!this.marketValues[crop]) {
        this.marketValues[crop] = {};
      }
      for (const period of this.deliveryPeriods) {
        if (!this.marketValues[crop][period]) {
          this.marketValues[crop][period] = {};
        }
        this.marketValues[crop][period][newLocation] = '';
      }
    }

    // Scroll to show the new column
    setTimeout(() => {
      if (this.marketValuesScroll) {
        const element = this.marketValuesScroll.nativeElement;
        element.scrollTo({
          left: element.scrollWidth,
          behavior: 'smooth'
        });
      }
    }, 100);
  }

  removeLocation(index: number): void {
    const location = this.marketLocations[index];
    if (confirm(`Remove location "${location}"?`)) {
      this.marketLocations.splice(index, 1);
      // Remove from market values for all crops and periods
      for (const crop of this.crops) {
        if (this.marketValues[crop]) {
          for (const period of this.deliveryPeriods) {
            if (this.marketValues[crop][period] && this.marketValues[crop][period][location]) {
              delete this.marketValues[crop][period][location];
            }
          }
        }
      }
    }
  }

  updateLocationName(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const newName = input.value.trim();
    const oldName = this.marketLocations[index];

    if (newName && newName !== oldName) {
      this.marketLocations[index] = newName;
      // Update market values for all crops and periods
      for (const crop of this.crops) {
        if (this.marketValues[crop]) {
          for (const period of this.deliveryPeriods) {
            if (this.marketValues[crop][period] && this.marketValues[crop][period][oldName]) {
              this.marketValues[crop][period][newName] = this.marketValues[crop][period][oldName];
              delete this.marketValues[crop][period][oldName];
            }
          }
        }
      }
    }
  }

  addRailOffer(): void {
    this.railOffers.push('');
  }

  removeRailOffer(index: number): void {
    this.railOffers.splice(index, 1);
  }

  filterBids(): void {
    const year = parseInt(this.selectedYear);
    const query = this.searchQuery.toLowerCase();

    // Filter bid data by year (or all years if location is selected)
    const yearFilteredData = this.selectedLocation
      ? this.bidData  // Show all years when location is selected
      : this.bidData.filter(bd => bd.year === year);

    // Flatten the data into individual bid items
    const allItems: any[] = [];
    for (const data of yearFilteredData) {
      for (const location of Object.keys(data.locations)) {
        const bid = data.locations[location];
        if (bid) {
          allItems.push({
            location,
            crop: data.crop,
            year: data.year,
            bid,
            status: data.status[location]
          });
        }
      }
    }

    // Apply location filter if a location is selected
    let locationFilteredItems = allItems;
    if (this.selectedLocation) {
      locationFilteredItems = allItems.filter(item => item.location === this.selectedLocation);
    }

    // Apply basis filter
    let basisFilteredItems = locationFilteredItems;
    if (this.selectedBasis !== 'all') {
      basisFilteredItems = locationFilteredItems.filter(item => {
        const bidValue = item.bid;
        // Check if bid starts with + or - (or contains them for basis values)
        if (this.selectedBasis === 'positive') {
          return bidValue.includes('+') || (!bidValue.includes('-') && !bidValue.includes('+') && parseFloat(bidValue.replace(/[^\d.-]/g, '')) > 0);
        } else if (this.selectedBasis === 'negative') {
          return bidValue.includes('-') || parseFloat(bidValue.replace(/[^\d.-]/g, '')) < 0;
        }
        return true;
      });
    }

    // Apply search filter
    if (query) {
      this.filteredBidItems = basisFilteredItems.filter(item =>
        item.location.toLowerCase().includes(query) ||
        item.crop.toLowerCase().includes(query) ||
        item.bid.toLowerCase().includes(query)
      );
    } else {
      this.filteredBidItems = basisFilteredItems;
    }

    // Update markers to show current year's bids
    if (this.isMapInitialized) {
      this.addMarkers();
    }
  }

  private loadBidData(): void {
    this.bidData = [
      {
        crop: 'Wheat',
        year: 2025,
        locations: {
          'Scoular Truman': '-80H',
          'Scoular Cullison': '-80H',
          'Kansas West (Inka)': '-80H',
          'Kansas East (Belmont)': '-85H',
          'Skyland C-ham Area': '-90H',
          'Turon Mill & Elev': '-85H',
          'FCE Best Bid': '-80H',
          'GPC Best Bid': '-75H',
          'OK Coop Kiowa': '-85H'
        },
        status: {
          'Scoular Truman': 'none',
          'Scoular Cullison': 'none',
          'Kansas West (Inka)': 'matching',
          'Kansas East (Belmont)': 'none',
          'Skyland C-ham Area': 'none',
          'Turon Mill & Elev': 'matching',
          'FCE Best Bid': 'matching',
          'GPC Best Bid': 'none',
          'OK Coop Kiowa': 'none'
        }
      },
      {
        crop: 'Wheat',
        year: 2026,
        locations: {
          'Scoular Truman': '-55N',
          'Scoular Cullison': '-60N',
          'Kansas West (Inka)': '-60N',
          'Kansas East (Belmont)': '-65N',
          'Skyland C-ham Area': '-70N',
          'Turon Mill & Elev': '-55N',
          'FCE Best Bid': '-65N',
          'GPC Best Bid': '-55N',
          'OK Coop Kiowa': '-60N'
        },
        status: {
          'Scoular Truman': 'none',
          'Scoular Cullison': 'none',
          'Kansas West (Inka)': 'none',
          'Kansas East (Belmont)': 'none',
          'Skyland C-ham Area': 'none',
          'Turon Mill & Elev': 'none',
          'FCE Best Bid': 'none',
          'GPC Best Bid': 'none',
          'OK Coop Kiowa': 'none'
        }
      },
      {
        crop: 'Corn',
        year: 2025,
        locations: {
          'Scoular Truman': '-40H',
          'Scoular Cullison': '-40H',
          'Kansas West (Inka)': '-45H',
          'Kansas East (Belmont)': '-45H',
          'Skyland C-ham Area': '-50H',
          'Turon Mill & Elev': '-45H',
          'FCE Best Bid': '-45H',
          'GPC Best Bid': '-45H',
          'OK Coop Kiowa': '-50H'
        },
        status: {
          'Scoular Truman': 'none',
          'Scoular Cullison': 'none',
          'Kansas West (Inka)': 'none',
          'Kansas East (Belmont)': 'none',
          'Skyland C-ham Area': 'none',
          'Turon Mill & Elev': 'none',
          'FCE Best Bid': 'none',
          'GPC Best Bid': 'none',
          'OK Coop Kiowa': 'none'
        }
      },
      {
        crop: 'Corn',
        year: 2026,
        locations: {
          'Scoular Truman': '-30Z',
          'Scoular Cullison': '-35Z',
          'Kansas West (Inka)': '-30Z',
          'Kansas East (Belmont)': '-35Z',
          'Skyland C-ham Area': '-35N',
          'Turon Mill & Elev': '-28Z',
          'FCE Best Bid': '-33Z',
          'GPC Best Bid': '-30Z',
          'OK Coop Kiowa': '-40Z'
        },
        status: {
          'Scoular Truman': 'none',
          'Scoular Cullison': 'none',
          'Kansas West (Inka)': 'none',
          'Kansas East (Belmont)': 'none',
          'Skyland C-ham Area': 'none',
          'Turon Mill & Elev': 'none',
          'FCE Best Bid': 'none',
          'GPC Best Bid': 'none',
          'OK Coop Kiowa': 'none'
        }
      },
      {
        crop: 'Milo',
        year: 2025,
        locations: {
          'Scoular Truman': '-105H',
          'Scoular Cullison': '-110H',
          'Kansas West (Inka)': '-105H',
          'Kansas East (Belmont)': '-105H',
          'Skyland C-ham Area': '-105H',
          'Turon Mill & Elev': '-110H',
          'FCE Best Bid': '-110H',
          'GPC Best Bid': '-105H',
          'OK Coop Kiowa': '-105H'
        },
        status: {
          'Scoular Truman': 'none',
          'Scoular Cullison': 'none',
          'Kansas West (Inka)': 'matching',
          'Kansas East (Belmont)': 'none',
          'Skyland C-ham Area': 'none',
          'Turon Mill & Elev': 'none',
          'FCE Best Bid': 'none',
          'GPC Best Bid': 'none',
          'OK Coop Kiowa': 'matching'
        }
      },
      {
        crop: 'Milo',
        year: 2026,
        locations: {
          'Scoular Truman': '',
          'Scoular Cullison': '',
          'Kansas West (Inka)': '-95Z',
          'Kansas East (Belmont)': '-95Z',
          'Skyland C-ham Area': '-90Z',
          'Turon Mill & Elev': '',
          'FCE Best Bid': '',
          'GPC Best Bid': '-100Z',
          'OK Coop Kiowa': '-100Z'
        },
        status: {
          'Scoular Truman': 'none',
          'Scoular Cullison': 'none',
          'Kansas West (Inka)': 'none',
          'Kansas East (Belmont)': 'none',
          'Skyland C-ham Area': 'none',
          'Turon Mill & Elev': 'none',
          'FCE Best Bid': 'none',
          'GPC Best Bid': 'none',
          'OK Coop Kiowa': 'none'
        }
      },
      {
        crop: 'Beans',
        year: 2025,
        locations: {
          'Scoular Truman': '-110H',
          'Scoular Cullison': '-110H',
          'Kansas West (Inka)': '-110H',
          'Kansas East (Belmont)': '-110H',
          'Skyland C-ham Area': '-115H',
          'Turon Mill & Elev': '-110F',
          'FCE Best Bid': '-110H',
          'GPC Best Bid': '-100H',
          'OK Coop Kiowa': '-105H'
        },
        status: {
          'Scoular Truman': 'none',
          'Scoular Cullison': 'none',
          'Kansas West (Inka)': 'none',
          'Kansas East (Belmont)': 'none',
          'Skyland C-ham Area': 'none',
          'Turon Mill & Elev': 'none',
          'FCE Best Bid': 'none',
          'GPC Best Bid': 'none',
          'OK Coop Kiowa': 'none'
        }
      },
      {
        crop: 'Beans',
        year: 2026,
        locations: {
          'Scoular Truman': '',
          'Scoular Cullison': '',
          'Kansas West (Inka)': '-95X',
          'Kansas East (Belmont)': '-95X',
          'Skyland C-ham Area': '',
          'Turon Mill & Elev': '-95X',
          'FCE Best Bid': '-95X',
          'GPC Best Bid': '-80X',
          'OK Coop Kiowa': '-90X'
        },
        status: {
          'Scoular Truman': 'none',
          'Scoular Cullison': 'none',
          'Kansas West (Inka)': 'none',
          'Kansas East (Belmont)': 'none',
          'Skyland C-ham Area': 'none',
          'Turon Mill & Elev': 'none',
          'FCE Best Bid': 'none',
          'GPC Best Bid': 'none',
          'OK Coop Kiowa': 'none'
        }
      },
      {
        crop: 'Canola',
        year: 2025,
        locations: {
          'Scoular Truman': '',
          'Scoular Cullison': '',
          'Kansas West (Inka)': '',
          'Kansas East (Belmont)': '',
          'Skyland C-ham Area': '',
          'Turon Mill & Elev': '',
          'FCE Best Bid': '',
          'GPC Best Bid': '',
          'OK Coop Kiowa': ''
        },
        status: {
          'Scoular Truman': 'none',
          'Scoular Cullison': 'none',
          'Kansas West (Inka)': 'none',
          'Kansas East (Belmont)': 'none',
          'Skyland C-ham Area': 'none',
          'Turon Mill & Elev': 'none',
          'FCE Best Bid': 'none',
          'GPC Best Bid': 'none',
          'OK Coop Kiowa': 'none'
        }
      },
      {
        crop: 'Canola',
        year: 2026,
        locations: {
          'Scoular Truman': '',
          'Scoular Cullison': '$9.30',
          'Kansas West (Inka)': '',
          'Kansas East (Belmont)': '',
          'Skyland C-ham Area': '',
          'Turon Mill & Elev': '',
          'FCE Best Bid': '',
          'GPC Best Bid': '',
          'OK Coop Kiowa': ''
        },
        status: {
          'Scoular Truman': 'none',
          'Scoular Cullison': 'none',
          'Kansas West (Inka)': 'none',
          'Kansas East (Belmont)': 'none',
          'Skyland C-ham Area': 'none',
          'Turon Mill & Elev': 'none',
          'FCE Best Bid': 'none',
          'GPC Best Bid': 'none',
          'OK Coop Kiowa': 'none'
        }
      }
    ];
  }
}
