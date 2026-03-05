import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

declare const L: any;

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
  imports: [CommonModule, FormsModule],
  template: `
    <div class="relative overflow-hidden isolate -mx-4 sm:-mx-6 lg:-mx-8 xl:-mx-10 2xl:-mx-12 h-[calc(100vh-6rem)] lg:h-[calc(100vh-7rem)]" style="min-height: 400px;">

        <!-- Full-screen map -->
        <div id="bid-locations-map" style="height: 100%; width: 100%;"></div>

        <!-- Floating filter bar (top-left) -->
        <div class="absolute top-2.5 left-4 z-[1000] flex items-center gap-2 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm p-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
          <select [(ngModel)]="selectedCrop" (change)="onMapCropChange()" class="px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors">
            @for (crop of crops; track crop) {
              <option [value]="crop">{{ crop }}</option>
            }
          </select>
          <select [(ngModel)]="selectedYear" (change)="onFilterChange()" class="px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors">
            <option value="2025">2025</option>
            <option value="2026">2026</option>
          </select>
          <select [(ngModel)]="selectedBasis" (change)="onFilterChange()" class="px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors">
            <option value="all">All Status</option>
            <option value="matching">Matching</option>
            <option value="beating">Beating</option>
            <option value="changed">Changed</option>
          </select>
          <div class="h-6 w-px bg-gray-300 dark:bg-gray-600"></div>
          <input
            type="text"
            [(ngModel)]="searchQuery"
            (input)="filterBids()"
            placeholder="Search locations..."
            class="w-48 px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
          />
        </div>

        <!-- Floating action buttons (bottom-left) -->
        <div class="absolute bottom-4 left-4 z-[1000] flex items-center gap-2">
          <button
            (click)="toggleAddLocationRow()"
            class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-lg transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14"/><path d="M12 5v14"/>
            </svg>
            Add Location
          </button>
          <button
            (click)="refreshBids()"
            [title]="'Last refreshed: ' + timeSinceRefresh"
            class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 rounded-lg shadow-lg transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M8 16H3v5"/>
            </svg>
            <span class="hidden sm:inline">{{ timeSinceRefresh }}</span>
          </button>
          <button
            (click)="togglePanel()"
            class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg shadow-lg transition-colors"
            [ngClass]="showPanel ? 'text-white bg-blue-600 hover:bg-blue-700' : 'text-white bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="21" y1="18" y2="18"/>
            </svg>
            Bids
          </button>
        </div>

        <!-- Map legend (bottom-right, shifts left when panel is open) -->
        <div class="absolute bottom-4 z-[1000] bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 px-4 py-3 transition-all duration-300"
             [style.right]="showPanel ? '452px' : '16px'">
          <div class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2.5">Key</div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <div class="w-4 h-4 rounded shrink-0" style="background:#2563eb; border:1.5px solid #1d4ed8;"></div>
              <span class="text-sm text-gray-700 dark:text-gray-300">Reference</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-4 h-4 rounded shrink-0" style="background:#9ca3af; border:1.5px solid #6b7280;"></div>
              <span class="text-sm text-gray-700 dark:text-gray-300">Scoular</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-4 h-4 rounded shrink-0" style="background:#eab308; border:1.5px solid #a16207;"></div>
              <span class="text-sm text-gray-700 dark:text-gray-300">Matching</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-4 h-4 rounded shrink-0" style="background:#dc2626; border:1.5px solid #991b1b;"></div>
              <span class="text-sm text-gray-700 dark:text-gray-300">Beating</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-4 h-4 rounded shrink-0" style="background:#22c55e; border:1.5px solid #15803d;"></div>
              <span class="text-sm text-gray-700 dark:text-gray-300">Changed</span>
            </div>
          </div>
        </div>

        <!-- Slide-in bids panel (right edge) -->
        <div class="absolute top-0 right-0 h-full w-[420px] z-[999] bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col"
             style="transition: transform 0.3s ease-in-out;"
             [style.transform]="showPanel ? 'translateX(0)' : 'translateX(100%)'">

          <!-- Panel Header -->
          <div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 min-h-[52px]">
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white truncate">
                @if (selectedLocation) {
                  {{ selectedLocation }}
                } @else {
                  Bids · {{ selectedCrop }} {{ selectedYear }}
                }
              </h3>
              @if (selectedLocation && referencedLocation === selectedLocation) {
                <span class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">ref</span>
              }
              @if (selectedLocation) {
                <button (click)="openEditLocation()" title="Edit location" class="shrink-0 p-1 rounded transition-colors text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              }
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              @if (selectedLocation) {
                <button
                  (click)="showAddBidForm = true"
                  [disabled]="showAddBidForm"
                  class="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 dark:text-green-300 hover:text-white hover:bg-green-600 border border-green-600 dark:border-green-500 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                  Bid
                </button>
                <button (click)="clearLocationSelection()" class="px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">All</button>
              }
              <button (click)="togglePanel()" class="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          </div>

          <!-- Panel Body -->
          <div class="flex-1 overflow-auto">

            <!-- No-reference warning -->
            @if (!selectedLocation && !referencedLocation) {
              <div class="flex items-start gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 mt-0.5 text-amber-500 dark:text-amber-400">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                  <path d="M12 9v4"/><path d="M12 17h.01"/>
                </svg>
                <div>
                  <p class="text-xs font-semibold text-amber-800 dark:text-amber-200">No reference location set for {{ selectedCrop }}</p>
                  <p class="text-xs text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">Click a row's edit icon and choose <strong>Set as Reference</strong> to enable status comparisons.</p>
                </div>
              </div>
            }

            <table class="w-full border-collapse text-sm">
              <thead class="sticky top-0 z-10">
                <tr class="bg-gray-50 dark:bg-gray-800">
                  @if (selectedLocation) {
                    <th class="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">Crop</th>
                    <th class="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">Year</th>
                    <th class="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">Date</th>
                    <th class="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">Bid</th>
                  } @else {
                    <th class="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">Location</th>
                    <th class="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">Bid</th>
                    <th class="px-3 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">Status</th>
                  }
                </tr>
              </thead>
              <tbody>
                <!-- Add New Bid inline row -->
                @if (selectedLocation && showAddBidForm) {
                  <tr class="border-b border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-900/10">
                    <td class="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{{ selectedCrop }}</td>
                    <td class="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{{ selectedYear }}</td>
                    <td class="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{{ formatDate(today) }}</td>
                    <td class="px-3 py-2">
                      <div class="flex items-center justify-end gap-1">
                        <input
                          type="text"
                          [(ngModel)]="newBidValue"
                          placeholder="-80H"
                          (keydown.enter)="confirmAddBid()"
                          (keydown.escape)="cancelAddBid()"
                          class="w-20 text-right font-mono text-xs text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-green-400 dark:border-green-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500"
                        />
                        <button (click)="confirmAddBid()" class="p-1 text-green-600 hover:text-white hover:bg-green-600 rounded transition-colors" title="Confirm">
                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                        </button>
                        <button (click)="cancelAddBid()" class="p-1 text-gray-400 hover:text-white hover:bg-gray-500 rounded transition-colors" title="Cancel">
                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                }

                @for (item of filteredBidItems; track item.location + item.crop + item.year + item.dateAdded) {
                  @if (selectedLocation) {
                    <tr class="border-b border-gray-200 dark:border-gray-700"
                        [ngClass]="{'bg-green-50/40 dark:bg-green-900/10': item.isNewest}">
                      <td class="px-3 py-2.5 text-xs text-gray-900 dark:text-white">{{ item.crop }}</td>
                      <td class="px-3 py-2.5 text-xs text-gray-900 dark:text-white">{{ item.year }}</td>
                      <td class="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                        {{ formatDate(item.dateAdded) }}
                        @if (item.isNewest) {
                          <span class="ml-1 inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">now</span>
                        }
                      </td>
                      <td class="px-3 py-2.5 text-xs font-mono text-right text-gray-900 dark:text-white">{{ item.bid }}</td>
                    </tr>
                  } @else {
                    <tr
                      (click)="selectLocationFromTable(item)"
                      class="group border-b border-gray-200 dark:border-gray-700 cursor-pointer transition-colors"
                      [ngClass]="referencedLocation === item.location
                        ? 'bg-blue-50 dark:bg-blue-900/10 hover:bg-blue-100/70 dark:hover:bg-blue-900/20'
                        : 'hover:bg-blue-50/60 dark:hover:bg-blue-900/10'"
                    >
                      <td class="px-3 py-2.5 text-xs text-gray-900 dark:text-white">
                        <div class="flex items-center gap-1">
                          {{ item.location }}
                          @if (referencedLocation === item.location) {
                            <span class="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">ref</span>
                          }
                        </div>
                      </td>
                      <td class="px-3 py-2.5 text-xs font-mono text-right text-gray-900 dark:text-white">{{ item.bid }}</td>
                      <td class="px-3 py-2.5 text-center">
                        @if (item.status !== 'reference' && item.status !== 'none') {
                          <span class="inline-flex px-1.5 py-0.5 text-xs font-medium rounded-full" [ngClass]="{
                            'bg-yellow-200 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400': item.status === 'matching',
                            'bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-400': item.status === 'beating',
                            'bg-green-200 text-green-800 dark:bg-green-900/40 dark:text-green-400': item.status === 'changed'
                          }">{{ item.status }}</span>
                        }
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </div>

        <!-- Change Reference Location Confirmation (full-screen overlay) -->
        @if (showReferenceConfirm) {
          <div class="absolute inset-0 z-[1100] bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-xs mx-4">
              <div class="px-5 pt-5 pb-4">
                <div class="flex items-start gap-3 mb-3">
                  <div class="shrink-0 w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="text-blue-600 dark:text-blue-400">
                      <path d="M8.243 7.34l-6.38 .925l-.113 .023a1 1 0 0 0 -.44 1.684l4.622 4.499l-1.09 6.355l-.013 .11a1 1 0 0 0 1.464 .944l5.706 -3l5.693 3l.1 .046a1 1 0 0 0 1.352 -1.1l-1.091 -6.355l4.624 -4.5l.078 -.085a1 1 0 0 0 -.633 -1.62l-6.38 -.926l-2.852 -5.78a1 1 0 0 0 -1.794 0l-2.853 5.78z"/>
                    </svg>
                  </div>
                  <div>
                    <h4 class="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                      {{ referencedLocation ? 'Change Reference Location?' : 'Set Reference Location?' }}
                    </h4>
                    <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                      @if (referencedLocation) {
                        Replace <span class="font-medium text-gray-700 dark:text-gray-300">{{ referencedLocation }}</span> with <span class="font-medium text-gray-700 dark:text-gray-300">{{ pendingReferenceLocation }}</span> as the reference? All statuses will update against its bid.
                      } @else {
                        Set <span class="font-medium text-gray-700 dark:text-gray-300">{{ pendingReferenceLocation }}</span> as the reference location? All other bids will be compared against it.
                      }
                    </p>
                  </div>
                </div>
              </div>
              <div class="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
                <button (click)="cancelReferenceChange()" class="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                <button (click)="confirmReferenceChange()" class="px-3 py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors">
                  {{ referencedLocation ? 'Change Reference' : 'Set as Reference' }}
                </button>
              </div>
            </div>
          </div>
        }

        <!-- Add Location Modal (full-screen overlay) -->
        @if (showAddLocationRow) {
          <div class="absolute inset-0 z-[1100] bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm mx-4">
              <!-- Modal Header -->
              <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 dark:text-green-400">
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <h4 class="text-base font-semibold text-gray-900 dark:text-white">Add Location</h4>
                </div>
                <button (click)="cancelAddLocation()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              <!-- Mode Toggle -->
              <div class="px-5 pt-4 pb-0">
                <div class="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs font-medium">
                  <button (click)="addLocationMode = 'new'; newLocationExistingName = ''" class="flex-1 py-2 transition-colors" [ngClass]="addLocationMode === 'new' ? 'bg-green-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'">New Location</button>
                  <button (click)="addLocationMode = 'existing'; newLocationName = ''" class="flex-1 py-2 transition-colors border-l border-gray-200 dark:border-gray-700" [ngClass]="addLocationMode === 'existing' ? 'bg-green-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'">Add Crop to Existing</button>
                </div>
              </div>
              <!-- Modal Body -->
              <div class="px-5 py-4 space-y-4">
                @if (addLocationMode === 'new') {
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Location Name</label>
                    <input type="text" [(ngModel)]="newLocationName" placeholder="e.g. Scoular Truman" class="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent placeholder-gray-400"/>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Street Address</label>
                    <input type="text" [(ngModel)]="newLocationAddress" placeholder="e.g. 123 Main St" class="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent placeholder-gray-400"/>
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">City</label>
                      <input type="text" [(ngModel)]="newLocationCity" placeholder="e.g. Truman" class="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent placeholder-gray-400"/>
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">State</label>
                      <input type="text" [(ngModel)]="newLocationState" placeholder="e.g. KS" maxlength="2" class="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent placeholder-gray-400"/>
                    </div>
                  </div>
                  <!-- Scoular Facility toggle -->
                  <div class="flex items-center gap-3">
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" [(ngModel)]="newLocationIsScoular" class="sr-only peer"/>
                      <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                    </label>
                    <span class="text-xs font-medium text-gray-700 dark:text-gray-300">Scoular Facility</span>
                  </div>
                } @else {
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label>
                    @if (getAvailableExistingLocations().length === 0) {
                      <p class="text-xs text-gray-400 dark:text-gray-500 italic py-1">All existing locations already have a bid for the selected crop and year.</p>
                    } @else {
                      <select [(ngModel)]="newLocationExistingName" class="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer">
                        <option value="">-- Select a location --</option>
                        @for (loc of getAvailableExistingLocations(); track loc) {
                          <option [value]="loc">{{ loc }}</option>
                        }
                      </select>
                    }
                  </div>
                }
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Crop</label>
                  <div class="w-full text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span class="font-medium text-gray-700 dark:text-gray-300">{{ selectedCrop }}</span>
                    <span class="text-xs text-gray-400 dark:text-gray-500 italic">set from map</span>
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Bid</label>
                  <input type="text" [(ngModel)]="newLocationBid" placeholder="-80H" class="w-full font-mono text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent placeholder-gray-400"/>
                </div>
              </div>
              <!-- Modal Footer -->
              <div class="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                <button (click)="cancelAddLocation()" class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                <button (click)="confirmAddLocation()" class="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors">
                  {{ addLocationMode === 'existing' ? 'Add Crop Bid' : 'Add Location' }}
                </button>
              </div>
            </div>
          </div>
        }

        <!-- Edit Location Modal (full-screen overlay) -->
        @if (showEditLocationModal) {
          <div class="absolute inset-0 z-[1100] bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm mx-4">
              @if (!showDeleteLocationConfirm) {
                <!-- Edit Header -->
                <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                  <div class="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-600 dark:text-gray-400">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    <h4 class="text-base font-semibold text-gray-900 dark:text-white">Edit Location</h4>
                  </div>
                  <button (click)="cancelEditLocation()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
                <!-- Edit Body -->
                <div class="px-5 py-4 space-y-4">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Location Name</label>
                    <input type="text" [(ngModel)]="editLocationName" class="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"/>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label>
                    <input type="text" [(ngModel)]="editLocationAddress" placeholder="Street address" class="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"/>
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">City</label>
                      <input type="text" [(ngModel)]="editLocationCity" class="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"/>
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">State</label>
                      <input type="text" [(ngModel)]="editLocationState" placeholder="e.g. KS" maxlength="2" class="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"/>
                    </div>
                  </div>
                  <div class="pt-1 flex items-center gap-2 border-t border-gray-100 dark:border-gray-800">
                    <button (click)="showDeleteLocationConfirm = true" class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      Delete
                    </button>
                    @if (referencedLocation !== editLocationOriginalName) {
                      <button (click)="setReferenceFromEdit()" class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8.243 7.34l-6.38 .925l-.113 .023a1 1 0 0 0 -.44 1.684l4.622 4.499l-1.09 6.355l-.013 .11a1 1 0 0 0 1.464 .944l5.706 -3l5.693 3l.1 .046a1 1 0 0 0 1.352 -1.1l-1.091 -6.355l4.624 -4.5l.078 -.085a1 1 0 0 0 -.633 -1.62l-6.38 -.926l-2.852 -5.78a1 1 0 0 0 -1.794 0l-2.853 5.78z"/></svg>
                        Set as Reference
                      </button>
                    } @else {
                      <span class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-500 dark:text-blue-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8.243 7.34l-6.38 .925l-.113 .023a1 1 0 0 0 -.44 1.684l4.622 4.499l-1.09 6.355l-.013 .11a1 1 0 0 0 1.464 .944l5.706 -3l5.693 3l.1 .046a1 1 0 0 0 1.352 -1.1l-1.091 -6.355l4.624 -4.5l.078 -.085a1 1 0 0 0 -.633 -1.62l-6.38 -.926l-2.852 -5.78a1 1 0 0 0 -1.794 0l-2.853 5.78z"/></svg>
                        Current Reference
                      </span>
                    }
                  </div>
                </div>
                <!-- Edit Footer -->
                <div class="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                  <button (click)="cancelEditLocation()" class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                  <button (click)="saveEditLocation()" class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">Save Changes</button>
                </div>
              } @else {
                <!-- Delete Confirmation -->
                <div class="px-5 pt-5 pb-4">
                  <div class="flex items-start gap-3 mb-4">
                    <div class="shrink-0 w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-600 dark:text-red-400"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </div>
                    <div>
                      <h4 class="text-sm font-semibold text-gray-900 dark:text-white mb-1">Delete Location?</h4>
                      <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                        Remove <span class="font-medium text-gray-700 dark:text-gray-300">{{ editLocationOriginalName }}</span> and all its bid history? This cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
                <div class="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
                  <button (click)="showDeleteLocationConfirm = false" class="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                  <button (click)="confirmDeleteLocation()" class="px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">Delete Location</button>
                </div>
              }
            </div>
          </div>
        }

    </div>
  `
})
export class BidSheetComponent implements OnInit, AfterViewInit, OnDestroy {
  selectedYear: string = new Date().getFullYear().toString();
  selectedCrop: string = 'Corn';
  searchQuery: string = '';
  selectedBasis: string = 'all';
  selectedLocation: string = '';
  selectedBidItem: any = null;
  referencedLocations: { [crop: string]: string } = { 'Corn': 'Scoular Truman' };

  get referencedLocation(): string {
    return this.referencedLocations[this.selectedCrop] || '';
  }

  set referencedLocation(value: string) {
    if (value) {
      this.referencedLocations[this.selectedCrop] = value;
    } else {
      delete this.referencedLocations[this.selectedCrop];
    }
  }
  showReferenceConfirm = false;
  pendingReferenceLocation = '';

  // Add location modal
  showAddLocationRow = false;
  addLocationMode: 'new' | 'existing' = 'new';
  newLocationName = '';
  newLocationAddress = '';
  newLocationCity = '';
  newLocationState = '';
  newLocationCrop = 'Corn';
  newLocationBid = '';
  newLocationExistingName = '';
  isGeocodingLocation = false;

  // Edit location modal
  showEditLocationModal = false;
  showDeleteLocationConfirm = false;
  editLocationOriginalName = '';
  editLocationName = '';
  editLocationAddress = '';
  editLocationCity = '';
  editLocationState = '';
  locationDetails: { [name: string]: { address: string, city: string, state: string } } = {};

  // Add bid form (shown when location is selected)
  showAddBidForm = false;
  newBidValue = '';
  today: Date = new Date();

  showPanel = false;
  newLocationIsScoular = false;

  lastRefreshed: Date = new Date();
  timeSinceRefresh: string = 'Just now';
  private refreshTimer: any = null;

  bidData: BidData[] = [];
  filteredBidItems: any[] = [];
  crops: string[] = ['Wheat', 'Corn', 'Milo', 'Beans', 'Canola'];

  private map: any = null;
  private markers: any[] = [];
  private markersByLocation: { [key: string]: any } = {};
  private isMapInitialized = false;

  locationCoordinates: LocationCoords[] = [
    { lat: 37.4850, lng: -99.7750, name: 'Scoular Truman',        isScoular: true  },
    { lat: 37.5500, lng: -99.4000, name: 'Scoular Cullison',      isScoular: true  },
    { lat: 37.7000, lng: -100.8500, name: 'Kansas West (Inka)',   isScoular: false },
    { lat: 38.6500, lng: -98.2000, name: 'Kansas East (Belmont)', isScoular: false },
    { lat: 38.5500, lng: -97.6500, name: 'Skyland C-ham Area',    isScoular: false },
    { lat: 37.8000, lng: -98.4000, name: 'Turon Mill & Elev',     isScoular: false },
    { lat: 37.6500, lng: -99.3000, name: 'FCE Best Bid',          isScoular: false },
    { lat: 37.7500, lng: -99.5000, name: 'GPC Best Bid',          isScoular: false },
    { lat: 37.0150, lng: -98.4850, name: 'OK Coop Kiowa',         isScoular: false }
  ];

  ngOnInit(): void {
    this.loadBidData();
    this.filterBids();
    this.loadLeafletStyles();
    this.startRefreshTimer();
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.initializeMap(), 500);
  }

  ngOnDestroy(): void {
    this.destroyMap();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }

  refreshBids(): void {
    this.startRefreshTimer();
  }

  togglePanel(): void {
    this.showPanel = !this.showPanel;
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private startRefreshTimer(): void {
    this.lastRefreshed = new Date();
    this.timeSinceRefresh = 'Just now';
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.refreshTimer = setInterval(() => this.updateTimeSinceRefresh(), 1000);
  }

  private updateTimeSinceRefresh(): void {
    const seconds = Math.floor((new Date().getTime() - this.lastRefreshed.getTime()) / 1000);
    if (seconds < 60) {
      this.timeSinceRefresh = 'A few seconds ago';
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      this.timeSinceRefresh = `${minutes}m ago`;
    } else {
      const hours = Math.floor(seconds / 3600);
      this.timeSinceRefresh = `${hours}h ago`;
    }
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
    if (!mapElement) return;

    try {
      this.map = L.map('bid-locations-map').setView([37.9, -98.8], 7);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.map);

      this.isMapInitialized = true;

      setTimeout(() => {
        if (this.map) {
          this.map.invalidateSize();
        }
      }, 100);

      this.addMarkers();
      this.panToReference();
    } catch (error) {
      // map init failed silently
    }
  }

  private panToReference(): void {
    if (!this.map || !this.referencedLocation) return;
    const coords = this.locationCoordinates.find(l => l.name === this.referencedLocation);
    if (coords) {
      this.map.setView([coords.lat, coords.lng], 7, { animate: true });
    }
  }

  private addMarkers(): void {
    if (!this.map) return;

    this.clearMarkers();

    const year = parseInt(this.selectedYear);
    const cropData = this.bidData.find(bd => bd.crop === this.selectedCrop && bd.year === year);
    if (!cropData) return;

    const refEntries = this.referencedLocation ? cropData.locations[this.referencedLocation] : null;
    const refBid = refEntries && refEntries.length > 0 ? refEntries[0].bid : '';

    for (const location of this.locationCoordinates) {
      const entries = cropData.locations[location.name];
      const newest = entries && entries.length > 0 ? entries[0] : null;
      const bid = newest?.bid || '';
      if (!bid) continue;

      const status: string = bid
        ? (this.referencedLocation
          ? (location.name === this.referencedLocation ? 'reference' : this.getComputedStatus(bid, refBid))
          : newest!.status)
        : 'none';

      // Hide filtered-out markers (always keep reference visible); hide no-bid markers when filter is active
      const isReference = location.name === this.referencedLocation;
      if (this.selectedBasis !== 'all' && (!bid || (!isReference && status !== this.selectedBasis))) continue;

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
          ">${bid || '--'}</div>
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
        .addTo(this.map);

      marker.on('click', () => {
        this.selectedLocation = location.name;
        this.showAddBidForm = false;
        this.showPanel = true;
        this.filterBids();
        this.openInfoPopup(marker, location.name, bid, status);
      });

      this.markers.push(marker);
      this.markersByLocation[location.name] = { marker, bid, status };
    }
  }

  private openInfoPopup(marker: any, locationName: string, currentBid: string, status: string = 'none'): void {
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

    const popupContent = `
      <div style="min-width: 210px; font-family: system-ui, -apple-system, sans-serif;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 10px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <span style="font-size: 13px; font-weight: 600; color: #111; line-height: 1.3;">${locationName}</span>
        </div>
        <div style="display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;">
          <span style="display: inline-flex; align-items: center; padding: 2px 8px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 9999px; font-size: 11px; font-weight: 500; color: #15803d;">${this.selectedCrop}</span>
          <span style="display: inline-flex; align-items: center; padding: 2px 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 9999px; font-size: 11px; font-weight: 500; color: #475569;">${this.selectedYear}</span>
          ${status !== 'none' ? `<span style="display: inline-flex; align-items: center; padding: 2px 8px; background: ${bidBg}; border: 1px solid ${bidBorder}; border-radius: 9999px; font-size: 11px; font-weight: 600; color: ${bidColor};">${status.charAt(0).toUpperCase() + status.slice(1)}</span>` : ''}
        </div>
        <div style="background: ${bidBg}; border: 1px solid ${bidBorder}; border-radius: 8px; padding: 12px 14px;">
          <div style="font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Current Bid</div>
          <div style="font-size: 26px; font-family: 'Courier New', monospace; font-weight: 800; color: ${bidColor}; letter-spacing: -0.5px; line-height: 1;">${currentBid}</div>
        </div>
      </div>
    `;

    L.popup({ maxWidth: 250 })
      .setLatLng(marker.getLatLng())
      .setContent(popupContent)
      .openOn(this.map);
  }

  private clearMarkers(): void {
    for (const marker of this.markers) {
      marker.remove();
    }
    this.markers = [];
    this.markersByLocation = {};
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
    this.selectedBidItem = null;
    this.showAddBidForm = false;
    this.newBidValue = '';
    this.filterBids();
  }

  selectLocationFromTable(item: any): void {
    this.selectedLocation = item.location;
    this.selectedBidItem = item;
    this.showAddBidForm = false;
    this.filterBids();

    if (this.isMapInitialized && this.map) {
      const coords = this.locationCoordinates.find(l => l.name === item.location);
      const markerData = this.markersByLocation[item.location];
      if (coords) {
        this.map.setView([coords.lat, coords.lng], this.map.getZoom(), { animate: true });
      }
      if (markerData) {
        this.openInfoPopup(markerData.marker, item.location, markerData.bid, markerData.status);
      }
    }
  }

  onFilterChange(): void {
    this.selectedLocation = '';
    this.selectedBidItem = null;
    this.showAddBidForm = false;
    this.newBidValue = '';
    if (this.map) this.map.closePopup();
    this.filterBids();
  }

  onMapCropChange(): void {
    this.onFilterChange();
  }

  confirmAddBid(): void {
    const bid = this.newBidValue.trim();
    if (!bid || !this.selectedLocation) return;

    const year = parseInt(this.selectedYear);
    const cropData = this.bidData.find(bd => bd.crop === this.selectedCrop && bd.year === year);
    if (!cropData) return;

    if (!cropData.locations[this.selectedLocation]) {
      cropData.locations[this.selectedLocation] = [];
    }

    // Prepend new entry so it appears first (newest)
    cropData.locations[this.selectedLocation].unshift({
      bid,
      dateAdded: new Date(),
      status: 'none'
    });

    this.showAddBidForm = false;
    this.newBidValue = '';
    this.filterBids();
    if (this.isMapInitialized) this.addMarkers();
  }

  cancelAddBid(): void {
    this.showAddBidForm = false;
    this.newBidValue = '';
  }

  toggleReferenceLocation(locationName: string): void {
    if (this.referencedLocation === locationName) {
      // Removing the current reference — no confirmation needed
      this.referencedLocation = '';
      this.filterBids();
      if (this.isMapInitialized) this.addMarkers();
    } else {
      // Setting or changing — require confirmation
      this.pendingReferenceLocation = locationName;
      this.showReferenceConfirm = true;
    }
  }

  confirmReferenceChange(): void {
    this.referencedLocation = this.pendingReferenceLocation;
    this.pendingReferenceLocation = '';
    this.showReferenceConfirm = false;
    this.filterBids();
    if (this.isMapInitialized) { this.addMarkers(); this.panToReference(); }
  }

  cancelReferenceChange(): void {
    this.pendingReferenceLocation = '';
    this.showReferenceConfirm = false;
  }

  private parseBasisValue(bid: string): number {
    const match = bid.match(/^[+-]?\d+/);
    return match ? parseInt(match[0]) : 0;
  }

  private getComputedStatus(bid: string, refBid: string): 'matching' | 'beating' | 'changed' | 'none' {
    if (!refBid || !bid) return 'none';
    const bidVal = this.parseBasisValue(bid);
    const refVal = this.parseBasisValue(refBid);
    if (bidVal === refVal) return 'matching';
    if (bidVal > refVal) return 'beating';
    return 'changed';
  }


  toggleAddLocationRow(): void {
    this.showAddLocationRow = !this.showAddLocationRow;
    this.addLocationMode = 'new';
    this.newLocationName = '';
    this.newLocationAddress = '';
    this.newLocationCity = '';
    this.newLocationState = '';
    this.newLocationCrop = this.selectedCrop;
    this.newLocationBid = '';
    this.newLocationExistingName = '';
  }

  getAvailableExistingLocations(): string[] {
    const year = parseInt(this.selectedYear);
    return this.locationCoordinates
      .map(l => l.name)
      .filter(name => {
        const cropData = this.bidData.find(bd => bd.crop === this.newLocationCrop && bd.year === year);
        if (!cropData) return true;
        const entries = cropData.locations[name];
        return !entries || entries.length === 0;
      });
  }

  confirmAddLocation(): void {
    const bid = this.newLocationBid.trim();
    const year = parseInt(this.selectedYear);

    if (this.addLocationMode === 'existing') {
      const name = this.newLocationExistingName;
      if (!name || !bid) return;
      const cropData = this.bidData.find(bd => bd.crop === this.newLocationCrop && bd.year === year);
      if (!cropData) return;
      if (!cropData.locations[name]) cropData.locations[name] = [];
      cropData.locations[name].unshift({ bid, dateAdded: new Date(), status: 'none' });
      this.resetAddLocationForm();
      this.filterBids();
      return;
    }

    const name = this.newLocationName.trim();
    if (!name) return;

    // Add to all crop/year entries; set the chosen crop's initial bid entry
    for (const data of this.bidData) {
      if (data.locations[name] === undefined) {
        const initialBid = (data.crop === this.newLocationCrop && data.year === year) ? bid : '';
        data.locations[name] = initialBid ? [{ bid: initialBid, dateAdded: new Date(), status: 'none' }] : [];
      }
    }

    // Geocode address via Nominatim to place pin on map
    const addressParts = [this.newLocationAddress.trim(), this.newLocationCity.trim(), this.newLocationState.trim()].filter(p => p);
    if (addressParts.length > 0 && !this.locationCoordinates.find(lc => lc.name === name)) {
      this.isGeocodingLocation = true;
      const query = encodeURIComponent(addressParts.join(', '));
      fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`)
        .then(r => r.json())
        .then((results: any[]) => {
          setTimeout(() => {
            if (results.length > 0) {
              this.locationCoordinates.push({ lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon), name, isScoular: this.newLocationIsScoular });
            }
            this.isGeocodingLocation = false;
            this.filterBids();
          }, 0);
        })
        .catch(() => {
          setTimeout(() => { this.isGeocodingLocation = false; }, 0);
        });
    }

    this.locationDetails[name] = {
      address: this.newLocationAddress.trim(),
      city: this.newLocationCity.trim(),
      state: this.newLocationState.trim()
    };

    this.resetAddLocationForm();
    this.filterBids();
  }

  cancelAddLocation(): void {
    this.resetAddLocationForm();
  }

  private resetAddLocationForm(): void {
    this.showAddLocationRow = false;
    this.addLocationMode = 'new';
    this.newLocationName = '';
    this.newLocationAddress = '';
    this.newLocationCity = '';
    this.newLocationState = '';
    this.newLocationCrop = this.selectedCrop;
    this.newLocationBid = '';
    this.newLocationExistingName = '';
    this.newLocationIsScoular = false;
  }

  openEditLocation(): void {
    const details = this.locationDetails[this.selectedLocation] || { address: '', city: '', state: '' };
    this.editLocationOriginalName = this.selectedLocation;
    this.editLocationName = this.selectedLocation;
    this.editLocationAddress = details.address;
    this.editLocationCity = details.city;
    this.editLocationState = details.state;
    this.showDeleteLocationConfirm = false;
    this.showEditLocationModal = true;
  }

  cancelEditLocation(): void {
    this.showEditLocationModal = false;
    this.showDeleteLocationConfirm = false;
  }

  saveEditLocation(): void {
    const newName = this.editLocationName.trim();
    if (!newName) return;
    const oldName = this.editLocationOriginalName;

    if (newName !== oldName) {
      for (const data of this.bidData) {
        if (data.locations[oldName] !== undefined) {
          data.locations[newName] = data.locations[oldName];
          delete data.locations[oldName];
        }
      }
      const coords = this.locationCoordinates.find(l => l.name === oldName);
      if (coords) coords.name = newName;
      for (const crop of this.crops) {
        if (this.referencedLocations[crop] === oldName) this.referencedLocations[crop] = newName;
      }
      this.selectedLocation = newName;
    }

    this.locationDetails[newName] = {
      address: this.editLocationAddress.trim(),
      city: this.editLocationCity.trim(),
      state: this.editLocationState.trim()
    };
    if (newName !== oldName) delete this.locationDetails[oldName];

    this.showEditLocationModal = false;
    this.showDeleteLocationConfirm = false;
    this.filterBids();
    if (this.isMapInitialized) this.addMarkers();
  }

  setReferenceFromEdit(): void {
    this.showEditLocationModal = false;
    this.showDeleteLocationConfirm = false;
    this.pendingReferenceLocation = this.editLocationOriginalName;
    this.showReferenceConfirm = true;
  }

  confirmDeleteLocation(): void {
    const name = this.editLocationOriginalName;
    for (const data of this.bidData) {
      delete data.locations[name];
    }
    const idx = this.locationCoordinates.findIndex(l => l.name === name);
    if (idx !== -1) this.locationCoordinates.splice(idx, 1);
    delete this.locationDetails[name];
    for (const crop of this.crops) {
      if (this.referencedLocations[crop] === name) delete this.referencedLocations[crop];
    }
    this.selectedLocation = '';
    this.selectedBidItem = null;
    this.showEditLocationModal = false;
    this.showDeleteLocationConfirm = false;
    this.filterBids();
  }

  filterBids(): void {
    const year = parseInt(this.selectedYear);
    const query = this.searchQuery.toLowerCase();
    const cropData = this.bidData.find(bd => bd.crop === this.selectedCrop && bd.year === year);

    // Selected location: show bid history filtered by crop + year
    if (this.selectedLocation) {
      const entries = cropData?.locations[this.selectedLocation] ?? [];
      this.filteredBidItems = entries.map((entry, idx) => ({
        location: this.selectedLocation,
        crop: this.selectedCrop,
        year,
        bid: entry.bid,
        dateAdded: entry.dateAdded,
        status: entry.status,
        isNewest: idx === 0
      }));

      if (this.isMapInitialized) this.addMarkers();
      return;
    }

    // All-locations view: one row per location showing the newest bid
    if (!cropData) {
      this.filteredBidItems = [];
      if (this.isMapInitialized) this.addMarkers();
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
        ? (location === this.referencedLocation ? 'reference' : this.getComputedStatus(newest.bid, refBid))
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
    if (this.selectedBasis !== 'all') {
      items = items.filter(item => item.status === 'reference' || item.status === this.selectedBasis);
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

    this.filteredBidItems = items;

    if (this.isMapInitialized) this.addMarkers();
  }

  private loadBidData(): void {
    const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
    this.bidData = [
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
    ];
  }
}
