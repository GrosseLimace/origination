import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
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
      <!-- Header with filters -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-semibold text-gray-900 dark:text-white">Bid Sheet</h2>
          <p class="text-gray-500 dark:text-gray-400">Grain bids by location and crop</p>
        </div>
        <div class="flex items-center gap-3">
          <!-- Crop Filter -->
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Crop:</label>
            <select [(ngModel)]="selectedCrop" (change)="filterBids()" class="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500">
              @for (crop of crops; track crop) {
                <option [value]="crop">{{ crop }}</option>
              }
            </select>
          </div>
          <!-- Year Filter -->
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Year:</label>
            <select [(ngModel)]="selectedYear" (change)="filterBids()" class="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="2025">2025</option>
              <option value="2026">2026</option>
            </select>
          </div>
          <!-- Search -->
          <div class="relative w-40">
            <input
              type="text"
              [(ngModel)]="searchQuery"
              (input)="filterBids()"
              placeholder="Search"
              class="w-full pl-9 pr-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
          </div>
        </div>
      </div>

      <!-- Key Legend -->
      <div class="flex items-center gap-4 text-sm bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
        <span class="font-medium text-gray-700 dark:text-gray-300">Key:</span>
        <div class="flex items-center gap-2">
          <div class="w-4 h-4 bg-yellow-200 dark:bg-yellow-900/40 border border-gray-300 dark:border-gray-600"></div>
          <span class="text-gray-700 dark:text-gray-300">Matching</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-4 h-4 bg-blue-200 dark:bg-blue-900/40 border border-gray-300 dark:border-gray-600"></div>
          <span class="text-gray-700 dark:text-gray-300">Beating</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-4 h-4 bg-green-200 dark:bg-green-900/40 border border-gray-300 dark:border-gray-600"></div>
          <span class="text-gray-700 dark:text-gray-300">Changed</span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <!-- Location Map -->
        <app-card>
          <app-card-content class="!p-0">
            <div id="bid-locations-map" style="height: 700px; width: 100%;"></div>
          </app-card-content>
        </app-card>

        <!-- Bids Table -->
        <app-card>
          <app-card-content class="!p-0">
            <div class="overflow-auto" style="height: 700px;">
              <table class="w-full border-collapse text-sm">
                <thead class="sticky top-0 z-10">
                  <tr class="bg-gray-50 dark:bg-gray-800">
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                      Location
                    </th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                      Crop
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
                        {{ item.location }}
                      </td>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        {{ item.crop }}
                      </td>
                      <td class="px-4 py-3 text-sm text-right font-mono text-gray-900 dark:text-white">
                        {{ item.bid }}
                      </td>
                      <td class="px-4 py-3 text-center">
                        @if (item.status !== 'none') {
                          <span class="inline-flex px-2 py-1 text-xs font-medium rounded-full" [ngClass]="{
                            'bg-yellow-200 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400': item.status === 'matching',
                            'bg-blue-200 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400': item.status === 'beating',
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

      <!-- Rail Offers Section -->
      <app-card>
        <app-card-header>
          <app-card-title>Rail Offers</app-card-title>
        </app-card-header>
        <app-card-content>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">Aug +97U</span>
              <span class="text-gray-900 dark:text-white font-mono">FH Sep +97U</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">Oct/Nov/Dec +95Z</span>
              <span class="text-gray-900 dark:text-white font-mono">-</span>
            </div>
          </div>
        </app-card-content>
      </app-card>
    </div>
  `
})
export class BidSheetComponent implements OnInit, AfterViewInit, OnDestroy {
  selectedYear: string = '2025';
  selectedCrop: string = 'Wheat';
  searchQuery: string = '';

  bidData: BidData[] = [];
  filteredBidItems: any[] = [];
  crops: string[] = ['Wheat', 'Corn', 'Milo', 'Beans', 'Canola'];

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
    setTimeout(() => this.initializeMap(), 100);
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

    try {
      // Center on Kansas
      this.map = L.map('bid-locations-map').setView([37.9, -98.8], 7);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.map);

      this.isMapInitialized = true;
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
        status === 'beating' ? '#60a5fa' :
        status === 'changed' ? '#34d399' : '#d1d5db';

      const borderColor =
        status === 'matching' ? '#f59e0b' :
        status === 'beating' ? '#2563eb' :
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
        });
      }

      if (saveBtn && input) {
        saveBtn.addEventListener('click', () => {
          const newBid = input.value;
          this.saveBid(locationName, newBid);
          this.map.closePopup();
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

  filterBids(): void {
    const year = parseInt(this.selectedYear);
    const query = this.searchQuery.toLowerCase();

    // Filter bid data by year first
    const yearFilteredData = this.bidData.filter(bd => bd.year === year);

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

    // Apply search filter
    if (query) {
      this.filteredBidItems = allItems.filter(item =>
        item.location.toLowerCase().includes(query) ||
        item.crop.toLowerCase().includes(query) ||
        item.bid.toLowerCase().includes(query)
      );
    } else {
      this.filteredBidItems = allItems;
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
