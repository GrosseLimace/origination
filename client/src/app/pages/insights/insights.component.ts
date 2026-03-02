import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, Ticket, Note } from '../../models';
import { CardComponent } from '../../components/ui/card/card.component';
import { BadgeComponent } from '../../components/ui/badge/badge.component';

type InsightCategory = 'UnconfirmedContracts' | 'SpotLoads' | 'UnshippedBushels' | 'OutstandingDrafts';
type InsightPriority = 'Urgent' | 'Warning' | 'Info';

interface Insight {
  customer: Customer;
  category: InsightCategory;
  priority: InsightPriority;
  message: string;
}

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [CommonModule, CardComponent, BadgeComponent],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div>
        <h2 class="text-2xl font-semibold text-gray-900 dark:text-white">Actionable Insights</h2>
        <p class="text-gray-500 dark:text-gray-400">
          @if (selectedTradeUnits.length > 0) {
            Prioritized recommendations for <span class="font-medium text-gray-700 dark:text-gray-300">{{ selectedTradeUnits.join(', ') }}</span>
          } @else {
            Prioritized recommendations for your territory
          }
        </p>
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

      <!-- Loading -->
      } @else if (isLoading) {
        <div class="flex min-h-[60vh] items-center justify-center">
          <div class="text-center">
            <div class="inline-block animate-spin rounded-full h-16 w-16 border-4 border-gray-300 dark:border-gray-600 border-t-green-600 dark:border-t-green-500 mb-4"></div>
            <p class="text-gray-500 dark:text-gray-400 font-medium text-lg">Loading insights data...</p>
          </div>
        </div>

      } @else {

        <!-- Insights by Category -->
        @for (category of categories; track category) {
          <app-card class="overflow-hidden">
              <div
                [class]="getCategoryHeaderClass(category)"
                class="p-4 cursor-pointer"
                (click)="toggleCategory(category)">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <!-- Category icon -->
                    @switch (category) {
                      @case ('UnconfirmedContracts') {
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="16" x2="8" y1="13" y2="13"/>
                          <line x1="16" x2="8" y1="17" y2="17"/>
                          <line x1="10" x2="8" y1="9" y2="9"/>
                        </svg>
                      }
                      @case ('SpotLoads') {
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                          <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/>
                          <rect width="13" height="9" x="9" y="11" rx="1"/>
                          <circle cx="12" cy="20" r="1"/>
                          <circle cx="20" cy="20" r="1"/>
                        </svg>
                      }
                      @case ('UnshippedBushels') {
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                          <circle cx="12" cy="12" r="10"/>
                          <polyline points="12 6 12 12 16 14"/>
                        </svg>
                      }
                      @case ('OutstandingDrafts') {
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                          <rect width="20" height="14" x="2" y="5" rx="2"/>
                          <line x1="2" x2="22" y1="10" y2="10"/>
                        </svg>
                      }
                    }
                    <div>
                      <h3 [class]="'font-semibold ' + getCategoryTitleClass(category)">{{ getCategoryTitle(category) }}</h3>
                      <p [class]="'text-sm ' + getCategorySubtitleClass(category)">
                        @if (category === 'OutstandingDrafts') {
                          Integration pending
                        } @else {
                          {{ getInsightsByCategory(category).length }} items
                        }
                      </p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    @if (category !== 'OutstandingDrafts') {
                      <app-badge [class]="getCategoryBadgeClass(category)">{{ getInsightsByCategory(category).length }}</app-badge>
                    }
                    @if (expandedCategories.has(category)) {
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                        <path d="m18 15-6-6-6 6"/>
                      </svg>
                    } @else {
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                        <path d="m6 9 6 6 6-6"/>
                      </svg>
                    }
                  </div>
                </div>
              </div>

              @if (expandedCategories.has(category)) {
                @if (category === 'OutstandingDrafts') {
                  <!-- Placeholder for Outstanding Drafts -->
                  <div class="p-8 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-3 text-blue-300 dark:text-blue-600">
                      <rect width="20" height="14" x="2" y="5" rx="2"/>
                      <line x1="2" x2="22" y1="10" y2="10"/>
                    </svg>
                    <p class="text-gray-500 dark:text-gray-400 font-medium">Draft data integration pending</p>
                    <p class="text-sm text-gray-400 dark:text-gray-500 mt-1">Connect the drafts data source to populate this section.</p>
                    <p class="text-xs text-gray-400 dark:text-gray-500 mt-2">Fields: Customer ID, Customer Name, Date of Draft, Draft ID, Amount</p>
                  </div>
                } @else if (getInsightsByCategory(category).length === 0) {
                  <div class="p-6 text-center text-sm text-gray-400 dark:text-gray-500">No items to report.</div>
                } @else {
                  <div class="divide-y divide-gray-200 dark:divide-gray-700">
                    @for (insight of getInsightsByCategory(category); track insight.customer.id + insight.message) {
                      <div
                        class="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                        (click)="selectCustomer(insight.customer)">
                        <div class="flex items-start justify-between">
                          <div class="flex items-start gap-3">
                            <div [class]="getPriorityBadgeClass(insight.priority) + ' p-1 rounded'">
                              @switch (insight.priority) {
                                @case ('Urgent') {
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="12" x2="12" y1="8" y2="12"/>
                                    <line x1="12" x2="12.01" y1="16" y2="16"/>
                                  </svg>
                                }
                                @case ('Warning') {
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                                    <line x1="12" x2="12" y1="9" y2="13"/>
                                    <line x1="12" x2="12.01" y1="17" y2="17"/>
                                  </svg>
                                }
                                @default {
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <path d="M12 16v-4"/>
                                    <path d="M12 8h.01"/>
                                  </svg>
                                }
                              }
                            </div>
                            <div>
                              <div class="font-medium text-gray-900 dark:text-white">
                                {{ insight.customer.name }}
                              </div>
                              <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                {{ insight.message }}
                              </p>
                              <div class="flex items-center gap-2 mt-2">
                                <app-badge variant="secondary">{{ insight.customer.farm }}</app-badge>
                                <span class="text-xs text-gray-400">{{ insight.customer.location }}</span>
                              </div>
                            </div>
                          </div>
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400 flex-shrink-0">
                            <path d="m9 18 6-6-6-6"/>
                          </svg>
                        </div>
                      </div>
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

  allInsights: Insight[] = [];
  expandedCategories = new Set<InsightCategory>();
  categories: InsightCategory[] = ['UnconfirmedContracts', 'SpotLoads', 'UnshippedBushels', 'OutstandingDrafts'];

  get selectedTradeUnits(): string[] {
    return this.appState.selectedTradeUnits();
  }

  ngOnInit(): void {
    if (this.selectedTradeUnits.length === 0) return;

    // Use AppStateService cache if already populated
    if (this.appState.customers().length > 0 && this.appState.tickets().length > 0) {
      this.customers = this.appState.customers();
      this.contracts = this.appState.contracts();
      this.tickets = this.appState.tickets();
      this.notes = this.appState.notes();
      this.generateInsights();
      return;
    }

    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadData(): void {
    const tradeUnits = this.selectedTradeUnits;
    this.isLoading = true;

    forkJoin({
      customers: this.apiService.getCustomers(tradeUnits),
      contracts: this.apiService.getContracts(tradeUnits),
      tickets: this.apiService.getTickets(tradeUnits),
      notes: this.apiService.getNotes()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.customers = data.customers;
        this.contracts = data.contracts;
        this.tickets = data.tickets;
        this.notes = data.notes;
        this.isLoading = false;
        this.generateInsights();
      },
      error: () => {
        this.isLoading = false;
        this.toastService.error('Failed to load insights data');
      }
    });
  }

  private generateInsights(): void {
    if (this.customers.length === 0) return;

    const insights: Insight[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Today's date as a string for matching against ticket.date (stored as string in ODS).
    // The ODS TicketBlDate format may vary — verify against live data and adjust if needed.
    const todayStr = today.toISOString().split('T')[0]; // "YYYY-MM-DD"

    for (const customer of this.customers) {
      const customerContracts = this.contracts.filter(c => c.customerId === customer.id);
      const customerNotes = this.notes.filter(n => n.customerId === customer.id);

      // --- 1. Unconfirmed Contracts ---
      // Contracts that have not been signed and are not yet fulfilled or cancelled.
      for (const contract of customerContracts) {
        if (!contract.signed && contract.status !== 'Fulfilled' && contract.status !== 'Cancelled') {
          const commodity = contract.commodityDescription || contract.commodityCode || 'Unknown commodity';
          insights.push({
            customer,
            category: 'UnconfirmedContracts',
            priority: 'Urgent',
            message: `Contract ${contract.contractNumber} (${commodity}) is awaiting confirmation.`
          });
        }
      }

      // --- 2. Spot Loads — Delivered Today, No Contact ---
      // A spot load is a ticket with no associated contract (ctrmContractNumber is blank).
      // Alert fires when such a ticket was delivered today and customer has no note from today.
      //
      // TODO: Verify ticket.date format against live ODS data. The TicketBlDate field is stored
      // as a string in ODS. The comparison below uses "YYYY-MM-DD" — adjust if the format differs.
      const customerTickets = this.tickets.filter(
        t => t.customerCode === customer.sourceCustomerId
      );

      const spotTicketsToday = customerTickets.filter(t => {
        const isSpot = !t.ctrmContractNumber || t.ctrmContractNumber.trim() === '';
        // Normalize ticket date string to compare — handles both "YYYY-MM-DD" and date-time strings
        const ticketDay = t.date ? t.date.split('T')[0] : '';
        return isSpot && ticketDay === todayStr;
      });

      if (spotTicketsToday.length > 0) {
        const hasContactToday = customerNotes.some(n => {
          const noteDay = new Date(n.createdAt);
          noteDay.setHours(0, 0, 0, 0);
          return noteDay.getTime() === today.getTime();
        });

        if (!hasContactToday) {
          for (const ticket of spotTicketsToday) {
            // netWeight is in pounds; approximate bushels at 60 lbs/bu as a general estimate.
            // TODO: Use commodity-specific conversion (corn ≈ 56, soybeans/wheat ≈ 60 lbs/bu).
            const approxBushels = ticket.netWeight ? Math.round(ticket.netWeight / 60) : null;
            const bushelsStr = approxBushels != null ? ` (~${approxBushels.toLocaleString()} bu)` : '';
            insights.push({
              customer,
              category: 'SpotLoads',
              priority: 'Urgent',
              message: `Spot load ticket ${ticket.ticketNumber}${bushelsStr} arrived today with no contact recorded.`
            });
          }
        }
      }

      // --- 3. Unshipped Bushels Past Delivery Date ---
      // Contracts where the delivery window has closed but status is still Active or Overdue,
      // indicating there are likely unshipped bushels remaining (open balance).
      //
      // TODO: Refine remaining bushels calculation. Ideally:
      //   remaining = contract.quantity - sum(ticket.appliedDockQuantity / LBS_PER_BU)
      //   for tickets where ticket.ctrmContractNumber === contract.sourceContractId.
      //   Requires commodity-specific lbs-per-bushel lookup. For now, the full contract
      //   quantity is shown as the at-risk amount.
      for (const contract of customerContracts) {
        const deliveryEnd = new Date(contract.deliveryEnd);
        const isPastDue = deliveryEnd < today;
        const isOpen = contract.status === 'Active' || contract.status === 'Overdue';

        if (isPastDue && isOpen) {
          const commodity = contract.commodityDescription || contract.commodityCode || 'Unknown commodity';
          const qty = contract.quantity?.toLocaleString() ?? '?';
          insights.push({
            customer,
            category: 'UnshippedBushels',
            priority: 'Warning',
            message: `Contract ${contract.contractNumber} (${commodity}, ${qty} bu) is past its delivery end date with an open balance.`
          });
        }
      }
    }

    // Sort by priority then category order
    const priorityOrder: Record<InsightPriority, number> = { 'Urgent': 0, 'Warning': 1, 'Info': 2 };
    const categoryOrder: Record<InsightCategory, number> = {
      'UnconfirmedContracts': 0,
      'SpotLoads': 1,
      'UnshippedBushels': 2,
      'OutstandingDrafts': 3
    };

    this.allInsights = insights.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return categoryOrder[a.category] - categoryOrder[b.category];
    });
  }

  toggleCategory(category: InsightCategory): void {
    if (this.expandedCategories.has(category)) {
      this.expandedCategories.delete(category);
    } else {
      this.expandedCategories.add(category);
    }
  }

  getInsightsByCategory(category: InsightCategory): Insight[] {
    return this.allInsights.filter(i => i.category === category);
  }

  selectCustomer(customer: Customer): void {
    this.router.navigate(['/'], { queryParams: { customerId: customer.id } });
  }

  getPriorityBadgeClass(priority: InsightPriority): string {
    switch (priority) {
      case 'Urgent': return 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400';
      case 'Warning': return 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'Info': return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400';
      default: return 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400';
    }
  }

  getCategoryHeaderClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800';
      case 'SpotLoads': return 'bg-orange-50 dark:bg-orange-900/20 border-b border-orange-100 dark:border-orange-800';
      case 'UnshippedBushels': return 'bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800';
      case 'OutstandingDrafts': return 'bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800';
      default: return 'bg-gray-50 dark:bg-gray-900/20 border-b border-gray-100 dark:border-gray-800';
    }
  }

  getCategoryIconClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'text-amber-600 dark:text-amber-400';
      case 'SpotLoads': return 'text-orange-600 dark:text-orange-400';
      case 'UnshippedBushels': return 'text-red-600 dark:text-red-400';
      case 'OutstandingDrafts': return 'text-blue-600 dark:text-blue-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  }

  getCategoryTitle(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'Unconfirmed Contracts';
      case 'SpotLoads': return 'Spot Loads — Delivered Today, No Contact';
      case 'UnshippedBushels': return 'Unshipped Bushels Past Delivery Date';
      case 'OutstandingDrafts': return 'Outstanding Drafts';
      default: return 'Other';
    }
  }

  getCategoryTitleClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'text-amber-900 dark:text-amber-100';
      case 'SpotLoads': return 'text-orange-900 dark:text-orange-100';
      case 'UnshippedBushels': return 'text-red-900 dark:text-red-100';
      case 'OutstandingDrafts': return 'text-blue-900 dark:text-blue-100';
      default: return 'text-gray-900 dark:text-gray-100';
    }
  }

  getCategorySubtitleClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'text-amber-600 dark:text-amber-400';
      case 'SpotLoads': return 'text-orange-600 dark:text-orange-400';
      case 'UnshippedBushels': return 'text-red-600 dark:text-red-400';
      case 'OutstandingDrafts': return 'text-blue-600 dark:text-blue-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  }

  getCategoryBadgeClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'SpotLoads': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
      case 'UnshippedBushels': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      case 'OutstandingDrafts': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300';
    }
  }
}
