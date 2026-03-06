import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AppStateService, InsightsCacheEntry } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, Ticket, Note } from '../../models';
import { CardComponent } from '../../components/ui/card/card.component';
import { BadgeComponent } from '../../components/ui/badge/badge.component';

type InsightCategory = 'UnconfirmedContracts' | 'SpotLoads' | 'UnshippedBushels';
type InsightPriority = 'Urgent' | 'Warning' | 'Info';
type InsightTagStyle = 'default' | 'commodity' | 'quantity' | 'warning' | 'alert';

interface InsightTag {
  label: string;
  style: InsightTagStyle;
}

interface Insight {
  customer: Customer;
  category: InsightCategory;
  priority: InsightPriority;
  message: string;
  tags?: InsightTag[];
  contractId?: number;
  searchTerms?: string[]; // Extra searchable values not shown in chips (e.g. individual ticket numbers)
}

interface CustomerGroup {
  customer: Customer;
  items: Insight[];
}

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, BadgeComponent],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-lg font-semibold text-gray-900 dark:text-white">Actionable Insights</p>
          <p class="text-gray-500 dark:text-gray-400">
            @if (selectedTradeUnits.length > 0) {
              Prioritized recommendations for <span class="font-medium text-gray-700 dark:text-gray-300">{{ selectedTradeUnits.join(', ') }}</span>
            } @else {
              Prioritized recommendations for your territory
            }
          </p>
        </div>
        @if (loadedAt && !isLoading) {
          <div class="flex items-center gap-2 flex-shrink-0">
            @if (isBackgroundRefreshing) {
              <span class="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <svg class="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.961 3 8.12l3-2.829z"></path>
                </svg>
                Checking...
              </span>
            }
            <button
              type="button"
              (click)="refresh()"
              [disabled]="isBackgroundRefreshing"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg class="w-3.5 h-3.5" [class.animate-spin]="isBackgroundRefreshing" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              Updated {{ loadedAt | date:'h:mm a' }}
            </button>
          </div>
        }
      </div>

      <!-- No trade unit selected -->
      @if (selectedTradeUnits.length === 0) {
        <div class="flex items-center justify-center py-20">
          <div class="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 text-gray-400 dark:text-gray-500">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            <p class="text-gray-500 dark:text-gray-400 font-medium text-lg mb-2">No Trade Unit Selected</p>
            <p class="text-gray-400 dark:text-gray-500 text-sm">Please select a trade unit from the Customers page to view insights</p>
          </div>
        </div>

      <!-- Loading skeletons -->
      } @else if (isLoading) {
        @for (skeletonCategory of skeletonCategories; track skeletonCategory.color) {
          <app-card class="overflow-hidden">
            <!-- Skeleton header -->
            <div [class]="skeletonCategory.headerClass" class="p-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <!-- Icon placeholder -->
                  <div class="w-6 h-6 rounded animate-pulse" [class]="skeletonCategory.pulseClass"></div>
                  <div>
                    <div class="h-4 w-40 rounded animate-pulse mb-1.5" [class]="skeletonCategory.pulseClass"></div>
                    <div class="h-3 w-24 rounded animate-pulse" [class]="skeletonCategory.pulseSubClass"></div>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <!-- Spinning loader in place of badge -->
                  <div class="w-6 h-6 rounded-full border-2 animate-spin" [class]="skeletonCategory.spinnerClass"></div>
                  <div class="w-4 h-4 rounded animate-pulse" [class]="skeletonCategory.pulseClass"></div>
                </div>
              </div>
            </div>
          </app-card>
        }

      } @else {

        <!-- Global customer search -->
        <div class="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            type="text"
            [(ngModel)]="globalSearch"
            placeholder="Filter all categories by customer..."
            class="flex-1 py-0.5 text-sm bg-transparent focus:outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
          />
          @if (globalSearch) {
            <button (click)="globalSearch = ''" class="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          }
        </div>

        <!-- Category cards -->
        @for (category of categories; track category) {
          <app-card class="overflow-hidden">

            <!-- Category header (click to expand/collapse) -->
            <div [class]="getCategoryHeaderClass(category)" class="p-4 cursor-pointer select-none" (click)="toggleCategory(category)">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <!-- Icon -->
                  @switch (category) {
                    @case ('UnconfirmedContracts') {
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" x2="8" y1="13" y2="13"/>
                        <line x1="16" x2="8" y1="17" y2="17"/>
                        <line x1="10" x2="8" y1="9" y2="9"/>
                      </svg>
                    }
                    @case ('SpotLoads') {
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                        <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/>
                        <rect width="13" height="9" x="9" y="11" rx="1"/>
                        <circle cx="12" cy="20" r="1"/>
                        <circle cx="20" cy="20" r="1"/>
                      </svg>
                    }
                    @case ('UnshippedBushels') {
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                      </svg>
                    }
                  }
                  <div>
                    <p [class]="'text-sm font-semibold ' + getCategoryTitleClass(category)">{{ getCategoryTitle(category) }}</p>
                    <p [class]="'text-sm ' + getCategorySubtitleClass(category)">
                      {{ getCustomerGroups(category).length }} customer{{ getCustomerGroups(category).length !== 1 ? 's' : '' }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <app-badge [class]="getCategoryBadgeClass(category)">{{ getCustomerGroups(category).length }}</app-badge>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                    @if (expandedCategories.has(category)) {
                      <path d="m18 15-6-6-6 6"/>
                    } @else {
                      <path d="m6 9 6 6 6-6"/>
                    }
                  </svg>
                </div>
              </div>
            </div>

            <!-- Expanded content -->
            @if (expandedCategories.has(category)) {

              <!-- Search bar -->
              <div class="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
                <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                </svg>
                <input
                  type="text"
                  [(ngModel)]="categorySearch[category]"
                  [placeholder]="getCategorySearchPlaceholder(category)"
                  class="flex-1 py-1 text-sm bg-transparent focus:outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                  (click)="$event.stopPropagation()"
                />
                @if (categorySearch[category]) {
                  <button (click)="categorySearch[category] = ''; $event.stopPropagation()" class="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                }
              </div>

              <!-- Customer list -->
              @if (getCustomerGroups(category).length === 0) {
                <div class="p-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  {{ categorySearch[category] ? 'No customers match your search.' : 'No items to report.' }}
                </div>
              } @else {
                <div class="divide-y divide-gray-200 dark:divide-gray-700">
                  @for (group of getCustomerGroups(category); track group.customer.id) {

                    <!-- Customer row -->
                    <div
                      class="px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors select-none"
                      (click)="toggleCustomerGroup(category, group.customer.id)">
                      <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                          <span class="font-semibold text-sm text-gray-900 dark:text-white leading-tight">{{ group.customer.name }}</span>
                          @if (group.customer.sourceCustomerId) {
                            <span class="text-xs text-gray-400 dark:text-gray-500 font-mono">{{ group.customer.sourceCustomerId }}</span>
                          }
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                          <span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold" [class]="getCategoryCountClass(category)">
                            {{ group.items.length }}
                          </span>
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400 dark:text-gray-500 transition-transform" [class.rotate-90]="isCustomerExpanded(category, group.customer.id)">
                            <path d="m9 18 6-6-6-6"/>
                          </svg>
                        </div>
                      </div>
                    </div>

                    <!-- Expanded: individual items -->
                    @if (isCustomerExpanded(category, group.customer.id)) {
                      @for (insight of group.items; track insight.message) {
                        <div
                          class="pl-6 pr-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/30 cursor-pointer transition-colors"
                          (click)="selectInsight(insight); $event.stopPropagation()">
                          <div class="flex items-center gap-2.5">
                            <div class="flex-shrink-0 w-1 self-stretch min-h-[1.5rem] rounded-full" [class]="getPriorityBarClass(insight.priority)"></div>
                            <div class="min-w-0 flex-1">
                              @if (insight.tags && insight.tags.length > 0) {
                                <div class="flex flex-wrap gap-1.5">
                                  @for (tag of insight.tags; track tag.label) {
                                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" [class]="getTagClass(tag.style)">
                                      {{ tag.label }}
                                    </span>
                                  }
                                </div>
                              } @else {
                                <p class="text-sm text-gray-600 dark:text-gray-400">{{ insight.message }}</p>
                              }
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-300 dark:text-gray-600 flex-shrink-0">
                              <path d="m9 18 6-6-6-6"/>
                            </svg>
                          </div>
                        </div>
                      }
                    }

                  }
                </div>
              }
            }

          </app-card>
        }

      }
    </div>
  `
})
export class InsightsComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private appState = inject(AppStateService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  customers: Customer[] = [];
  contracts: Contract[] = [];
  tickets: Ticket[] = [];
  notes: Note[] = [];
  isLoading = false;
  isBackgroundRefreshing = false;
  loadedAt: Date | null = null;

  allInsights: Insight[] = [];
  expandedCategories = new Set<InsightCategory>();
  expandedCustomers = new Set<string>();
  categorySearch: { [key: string]: string } = {};
  globalSearch = '';
  categories: InsightCategory[] = ['UnconfirmedContracts', 'SpotLoads', 'UnshippedBushels'];

  skeletonCategories = [
    {
      color: 'amber',
      headerClass: 'bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800',
      pulseClass: 'bg-amber-200 dark:bg-amber-800',
      pulseSubClass: 'bg-amber-100 dark:bg-amber-900',
      spinnerClass: 'border-amber-200 dark:border-amber-800 border-t-amber-500 dark:border-t-amber-400',
    },
    {
      color: 'orange',
      headerClass: 'bg-orange-50 dark:bg-orange-900/20 border-b border-orange-100 dark:border-orange-800',
      pulseClass: 'bg-orange-200 dark:bg-orange-800',
      pulseSubClass: 'bg-orange-100 dark:bg-orange-900',
      spinnerClass: 'border-orange-200 dark:border-orange-800 border-t-orange-500 dark:border-t-orange-400',
    },
    {
      color: 'red',
      headerClass: 'bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800',
      pulseClass: 'bg-red-200 dark:bg-red-800',
      pulseSubClass: 'bg-red-100 dark:bg-red-900',
      spinnerClass: 'border-red-200 dark:border-red-800 border-t-red-500 dark:border-t-red-400',
    },
  ];

  get selectedTradeUnits(): string[] {
    return this.appState.selectedTradeUnits();
  }

  ngOnInit(): void {
    if (this.selectedTradeUnits.length === 0) return;
    const tradeUnitsKey = [...this.selectedTradeUnits].sort().join(',');
    const cached = this.appState.insightsCache();
    if (cached && cached.tradeUnitsKey === tradeUnitsKey) {
      // Cache hit — display immediately, then silently check for updates in the background
      this.customers = cached.customers;
      this.contracts = cached.contracts;
      this.tickets = cached.tickets;
      this.notes = cached.notes;
      this.loadedAt = cached.loadedAt;
      this.generateInsights();
      this.loadData(true);
    } else {
      // Cache miss or different trade unit — full load with skeleton spinner
      this.loadData(false);
    }
  }

  refresh(): void {
    this.loadData(false);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadData(isBackgroundRefresh = false): void {
    const tradeUnits = this.selectedTradeUnits;
    const tradeUnitsKey = [...tradeUnits].sort().join(',');

    if (isBackgroundRefresh) {
      this.isBackgroundRefreshing = true;
    } else {
      this.isLoading = true;
    }

    forkJoin({
      customers: this.apiService.getCustomers(tradeUnits),
      contracts: this.apiService.getContracts(tradeUnits),
      tickets: this.apiService.getTickets(tradeUnits),
      notes: this.apiService.getNotes()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        const loadedAt = new Date();
        const cached = this.appState.insightsCache();
        const hasChanges = !cached ||
          cached.customers.length !== data.customers.length ||
          cached.contracts.length !== data.contracts.length ||
          cached.tickets.length !== data.tickets.length ||
          cached.notes.length !== data.notes.length;

        this.appState.setInsightsCache({ tradeUnitsKey, ...data, loadedAt });

        if (!isBackgroundRefresh || hasChanges) {
          this.customers = data.customers;
          this.contracts = data.contracts;
          this.tickets = data.tickets;
          this.notes = data.notes;
          this.loadedAt = loadedAt;
          this.generateInsights();
        }

        this.isLoading = false;
        this.isBackgroundRefreshing = false;
      },
      error: () => {
        this.isLoading = false;
        this.isBackgroundRefreshing = false;
        if (isBackgroundRefresh) {
          this.toastService.show('Could not refresh insights — showing cached data', 'warning');
        } else {
          this.toastService.error('Failed to load insights data');
        }
      }
    });
  }

  private generateInsights(): void {
    if (this.customers.length === 0) return;

    const insights: Insight[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // todayStr used for comparing ticket dates (stored as strings in ODS) and note dates.
    // ticket.date maps to TicketBlDate in ODS, stored as "YYYY-MM-DD" string — direct comparison is safe.
    const todayStr = today.toLocaleDateString('en-CA'); // YYYY-MM-DD

    for (const customer of this.customers) {
      const customerContracts = this.contracts.filter(c => c.ctrmCustomerId === customer.sourceCustomerId);
      const customerTickets = this.tickets.filter(t => t.customerCode === customer.sourceCustomerId);

      // --- 1. Unconfirmed Contracts ---
      // Contracts where CustomerConfirmStatus is not 'Confirmed', excluding Fulfilled/Cancelled.
      // Uses case-insensitive match on 'confirmed' — verify against live ODS data during Dev testing
      // to confirm the exact string values returned for confirmed vs unconfirmed contracts.
      for (const contract of customerContracts) {
        const confirmStatus = (contract.customerConfirmStatus || '').trim();
        const isConfirmed = confirmStatus.toLowerCase() === 'confirmed';
        if (!isConfirmed && contract.status !== 'Fulfilled' && contract.status !== 'Cancelled') {
          const desc = contract.commodityDescription?.trim();
          const code = contract.commodityCode?.trim();
          const commodity = desc && code ? `${desc} (${code})` : desc || code || 'Unknown commodity';
          const qty = contract.quantity ? Math.round(contract.quantity).toLocaleString() : '?';
          const statusLabel = confirmStatus || 'No status';
          insights.push({
            customer,
            category: 'UnconfirmedContracts',
            priority: 'Urgent',
            message: `Contract ${contract.contractNumber} (${commodity}, ${qty} bu) — ${statusLabel}.`,
            contractId: contract.id,
            tags: [
              { label: contract.sourceContractId || contract.contractNumber, style: 'default' },
              { label: commodity, style: 'commodity' },
              { label: `${qty} bu`, style: 'quantity' },
              { label: statusLabel, style: 'warning' },
            ]
          });
        }
      }

      // --- 2. Spot Loads — Delivered Today, No Contact ---
      // Unload tickets (grain received, not yet settled) delivered today with no customer contact.
      // TicketStatusDescription = "Unload" identifies unsettled inbound deliveries.
      // ticket.date maps to TicketBlDate in ODS, stored as "YYYY-MM-DD" string — direct comparison is safe.
      const todayTickets = customerTickets.filter(t =>
        t.date === todayStr && t.ticketStatusDescription === 'Unload'
      );

      if (todayTickets.length > 0) {
        const contactedToday = this.notes.some(n => {
          try {
            return n.customerId === customer.id &&
                   new Date(n.createdAt).toLocaleDateString('en-CA') === todayStr;
          } catch {
            return false;
          }
        });

        if (!contactedToday) {
          // One insight per ticket so the user can see and select individual tickets.
          for (const ticket of todayTickets) {
            const bu = ticket.unloadQuantity ? Math.round(ticket.unloadQuantity) : null;
            insights.push({
              customer,
              category: 'SpotLoads',
              priority: 'Urgent',
              message: `Ticket #${ticket.ticketNumber}${ticket.productCode ? ' — ' + ticket.productCode : ''}${bu ? ', ' + bu.toLocaleString() + ' bu' : ''}`,
              tags: [
                { label: `#${ticket.ticketNumber}`, style: 'default' },
                ...(ticket.productCode ? [{ label: ticket.productCode, style: 'commodity' as InsightTagStyle }] : []),
                ...(bu ? [{ label: `${bu.toLocaleString()} bu`, style: 'quantity' as InsightTagStyle }] : []),
                { label: 'Unload', style: 'warning' },
              ],
              searchTerms: [ticket.ticketNumber, ticket.productCode].filter(Boolean) as string[]
            });
          }
        }
      }

      // --- 3. Unshipped Bushels Past Delivery Date ---
      // Contracts past their delivery end date that are still Active or Overdue.
      // Currently shows full contract quantity as unshipped — a future enhancement would subtract
      // applied ticket quantities (AppliedNetQuantity) to show true remaining bushels.
      for (const contract of customerContracts) {
        const deliveryEnd = new Date(contract.deliveryEnd);
        const isPastDue = deliveryEnd < today;
        const isOpen = contract.status === 'Active' || contract.status === 'Overdue';

        if (isPastDue && isOpen) {
          const desc = contract.commodityDescription?.trim();
          const code = contract.commodityCode?.trim();
          const commodity = desc && code ? `${desc} (${code})` : desc || code || 'Unknown commodity';
          const qty = contract.quantity ? Math.round(contract.quantity).toLocaleString() : '?';
          const daysOverdue = Math.floor((today.getTime() - deliveryEnd.getTime()) / (1000 * 60 * 60 * 24));
          insights.push({
            customer,
            category: 'UnshippedBushels',
            priority: 'Warning',
            message: `Contract ${contract.contractNumber} (${commodity}, ${qty} bu) is past its delivery end date.`,
            contractId: contract.id,
            tags: [
              { label: contract.sourceContractId || contract.contractNumber, style: 'default' },
              { label: commodity, style: 'commodity' },
              { label: `${qty} bu`, style: 'quantity' },
              { label: `${daysOverdue}d overdue`, style: 'alert' },
            ]
          });
        }
      }
    }

    // Sort by priority
    const priorityOrder: Record<InsightPriority, number> = { 'Urgent': 0, 'Warning': 1, 'Info': 2 };
    this.allInsights = insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Reset all search/expand state when insights are regenerated
    this.expandedCustomers.clear();
    this.categorySearch = {};
    this.globalSearch = '';
  }

  // ── Category accordion ──────────────────────────────────────────────────────

  toggleCategory(category: InsightCategory): void {
    if (this.expandedCategories.has(category)) {
      this.expandedCategories.delete(category);
      this.expandedCustomers.forEach(key => {
        if (key.startsWith(category + ':')) this.expandedCustomers.delete(key);
      });
      delete this.categorySearch[category];
    } else {
      this.expandedCategories.add(category);
    }
  }

  getInsightsByCategory(category: InsightCategory): Insight[] {
    return this.allInsights.filter(i => i.category === category);
  }

  getCustomerGroups(category: InsightCategory): CustomerGroup[] {
    const categoryInsights = this.getInsightsByCategory(category);
    const search = (this.categorySearch[category] || '').toLowerCase().trim();

    const grouped = new Map<number, CustomerGroup>();
    for (const insight of categoryInsights) {
      if (!grouped.has(insight.customer.id)) {
        grouped.set(insight.customer.id, { customer: insight.customer, items: [] });
      }
      grouped.get(insight.customer.id)!.items.push(insight);
    }

    let result = Array.from(grouped.values());

    // Global search filters by customer name/code across all categories
    const global = this.globalSearch.toLowerCase().trim();
    if (global) {
      result = result.filter(g =>
        g.customer.name.toLowerCase().includes(global) ||
        (g.customer.sourceCustomerId || '').toLowerCase().includes(global)
      );
    }

    // Category search filters by customer, tags (contract #, commodity, code), or searchTerms (ticket #)
    if (search) {
      result = result.filter(g =>
        g.customer.name.toLowerCase().includes(search) ||
        (g.customer.sourceCustomerId || '').toLowerCase().includes(search) ||
        g.items.some(item =>
          item.tags?.some(tag => tag.label.toLowerCase().includes(search)) ||
          item.searchTerms?.some(term => term.toLowerCase().includes(search))
        )
      );
    }
    return result;
  }

  // ── Customer accordion ──────────────────────────────────────────────────────

  toggleCustomerGroup(category: InsightCategory, customerId: number): void {
    const key = `${category}:${customerId}`;
    if (this.expandedCustomers.has(key)) {
      this.expandedCustomers.delete(key);
    } else {
      this.expandedCustomers.add(key);
    }
  }

  isCustomerExpanded(category: InsightCategory, customerId: number): boolean {
    return this.expandedCustomers.has(`${category}:${customerId}`);
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  selectInsight(insight: Insight): void {
    const params: Record<string, string | number> = { customerId: insight.customer.id };
    if (insight.contractId) params['contractId'] = insight.contractId;
    this.router.navigate(['/'], { queryParams: params });
  }

  // ── Style helpers ───────────────────────────────────────────────────────────

  getPriorityBarClass(priority: InsightPriority): string {
    switch (priority) {
      case 'Urgent': return 'bg-red-400 dark:bg-red-500';
      case 'Warning': return 'bg-amber-400 dark:bg-amber-500';
      default:        return 'bg-gray-300 dark:bg-gray-600';
    }
  }

  getTagClass(style: InsightTagStyle): string {
    switch (style) {
      case 'commodity': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
      case 'quantity':  return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
      case 'warning':   return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
      case 'alert':     return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
      default:          return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
    }
  }

  getCategoryCountClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'SpotLoads':            return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
      case 'UnshippedBushels':     return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      default:                     return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
    }
  }

  getCategoryHeaderClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800';
      case 'SpotLoads':            return 'bg-orange-50 dark:bg-orange-900/20 border-b border-orange-100 dark:border-orange-800';
      case 'UnshippedBushels':     return 'bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800';
      default:                     return 'bg-gray-50 dark:bg-gray-900/20 border-b border-gray-100 dark:border-gray-800';
    }
  }

  getCategoryIconClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'text-amber-600 dark:text-amber-400';
      case 'SpotLoads':            return 'text-orange-600 dark:text-orange-400';
      case 'UnshippedBushels':     return 'text-red-600 dark:text-red-400';
      default:                     return 'text-gray-600 dark:text-gray-400';
    }
  }

  getCategoryTitle(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'Unconfirmed Contracts';
      case 'SpotLoads':            return 'Spot Loads — Delivered Today, No Contact';
      case 'UnshippedBushels':     return 'Unshipped Bushels Past Delivery Date';
      default:                     return 'Other';
    }
  }

  getCategoryTitleClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'text-amber-900 dark:text-amber-100';
      case 'SpotLoads':            return 'text-orange-900 dark:text-orange-100';
      case 'UnshippedBushels':     return 'text-red-900 dark:text-red-100';
      default:                     return 'text-gray-900 dark:text-gray-100';
    }
  }

  getCategorySubtitleClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'text-amber-600 dark:text-amber-400';
      case 'SpotLoads':            return 'text-orange-600 dark:text-orange-400';
      case 'UnshippedBushels':     return 'text-red-600 dark:text-red-400';
      default:                     return 'text-gray-600 dark:text-gray-400';
    }
  }

  getCategorySearchPlaceholder(category: InsightCategory): string {
    switch (category) {
      case 'SpotLoads': return 'Search by customer, code, or ticket #...';
      default:          return 'Search by customer, contract, or commodity...';
    }
  }

  getCategoryBadgeClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'SpotLoads':            return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
      case 'UnshippedBushels':     return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      default:                     return 'bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300';
    }
  }
}
