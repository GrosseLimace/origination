import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AppStateService, InsightsCacheEntry } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { Customer, Contract, Ticket, Note } from '@models';
import { CardComponent } from '@shared/components/card/card.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';

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
  templateUrl: './insights.component.html'
})
export class InsightsComponent {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  customers = signal<Customer[]>([]);
  contracts = signal<Contract[]>([]);
  tickets = signal<Ticket[]>([]);
  notes = signal<Note[]>([]);
  isLoading = signal(false);
  isBackgroundRefreshing = signal(false);
  loadedAt = signal<Date | null>(null);

  allInsights = signal<Insight[]>([]);
  expandedCategories = signal(new Set<InsightCategory>());
  expandedCustomers = signal(new Set<string>());
  categorySearch = signal<{ [key: string]: string }>({});
  globalSearch = signal('');
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
      headerClass: 'bg-scoular-yellow/5 dark:bg-scoular-yellow/20 border-b border-scoular-yellow/20 dark:border-scoular-yellow',
      pulseClass: 'bg-scoular-yellow/20 dark:bg-scoular-yellow',
      pulseSubClass: 'bg-scoular-yellow/10 dark:bg-orange-900',
      spinnerClass: 'border-orange-200 dark:border-scoular-yellow border-t-orange-500 dark:border-t-orange-400',
    },
    {
      color: 'red',
      headerClass: 'bg-scoular-red/5 dark:bg-scoular-red/20 border-b border-scoular-red/20 dark:border-scoular-red-accessible',
      pulseClass: 'bg-scoular-red/20 dark:bg-red-800',
      pulseSubClass: 'bg-scoular-red/10 dark:bg-red-900',
      spinnerClass: 'border-red-200 dark:border-scoular-red-accessible border-t-red-500 dark:border-t-red-400',
    },
  ];

  get selectedTradeUnits(): string[] {
    return this.appState.selectedTradeUnits();
  }

  constructor() {
    if (this.selectedTradeUnits.length === 0) return;
    const tradeUnitsKey = [...this.selectedTradeUnits].sort().join(',');
    const cached = this.appState.insightsCache();
    if (cached && cached.tradeUnitsKey === tradeUnitsKey) {
      // Cache hit — display immediately, then silently check for updates in the background
      this.customers.set(cached.customers);
      this.contracts.set(cached.contracts);
      this.tickets.set(cached.tickets);
      this.notes.set(cached.notes);
      this.loadedAt.set(cached.loadedAt);
      this._generateInsights();
      this._loadData(true);
    } else {
      // Cache miss or different trade unit — full load with skeleton spinner
      this._loadData(false);
    }
  }

  refresh(): void {
    this._loadData(false);
  }

  private _loadData(isBackgroundRefresh = false): void {
    const tradeUnits = this.selectedTradeUnits;
    const tradeUnitsKey = [...tradeUnits].sort().join(',');

    if (isBackgroundRefresh) {
      this.isBackgroundRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }

    forkJoin({
      customers: this.apiService.getCustomers(tradeUnits),
      contracts: this.apiService.getContracts(tradeUnits),
      tickets: this.apiService.getTickets(tradeUnits),
      notes: this.apiService.getNotes()
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
          this.customers.set(data.customers);
          this.contracts.set(data.contracts);
          this.tickets.set(data.tickets);
          this.notes.set(data.notes);
          this.loadedAt.set(loadedAt);
          this._generateInsights();
        }

        this.isLoading.set(false);
        this.isBackgroundRefreshing.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.isBackgroundRefreshing.set(false);
        if (!isBackgroundRefresh) {
          this.toastService.error('Failed to load insights data');
        }
      }
    });
  }

  private _generateInsights(): void {
    if (this.customers().length === 0) return;

    const insights: Insight[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // todayStr used for comparing ticket dates (stored as strings in ODS) and note dates.
    // ticket.date maps to TicketBlDate in ODS, stored as "YYYY-MM-DD" string — direct comparison is safe.
    const todayStr = today.toLocaleDateString('en-CA'); // YYYY-MM-DD

    for (const customer of this.customers()) {
      const customerContracts = this.contracts().filter(c => c.ctrmCustomerId === customer.sourceCustomerId);
      const customerTickets = this.tickets().filter(t => t.customerCode === customer.sourceCustomerId);

      // --- 1. Unconfirmed Contracts ---
      // Contracts where CustomerConfirmStatus is not 'Confirmed', excluding Fulfilled/Cancelled.
      // TODO: Verify exact ODS values for CustomerConfirmStatus against live data.
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
        const contactedToday = this.notes().some(n => {
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
      //
      // TODO: Refine remaining bushels calculation using ticket appliedDockQuantity vs contract quantity.
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
    this.allInsights.set(insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]));

    // Reset all search/expand state when insights are regenerated
    this.expandedCustomers.set(new Set());
    this.categorySearch.set({});
    this.globalSearch.set('');
  }

  // ── Category accordion ──────────────────────────────────────────────────────

  toggleCategory(category: InsightCategory): void {
    const expanded = new Set(this.expandedCategories());
    if (expanded.has(category)) {
      expanded.delete(category);
      const customers = new Set(this.expandedCustomers());
      customers.forEach(key => {
        if (key.startsWith(category + ':')) customers.delete(key);
      });
      this.expandedCustomers.set(customers);
      this.categorySearch.update(s => { const copy = { ...s }; delete copy[category]; return copy; });
    } else {
      expanded.add(category);
    }
    this.expandedCategories.set(expanded);
  }

  getInsightsByCategory(category: InsightCategory): Insight[] {
    return this.allInsights().filter(i => i.category === category);
  }

  getCustomerGroups(category: InsightCategory): CustomerGroup[] {
    const categoryInsights = this.getInsightsByCategory(category);
    const search = (this.categorySearch()[category] || '').toLowerCase().trim();

    const grouped = new Map<number, CustomerGroup>();
    for (const insight of categoryInsights) {
      if (!grouped.has(insight.customer.id)) {
        grouped.set(insight.customer.id, { customer: insight.customer, items: [] });
      }
      grouped.get(insight.customer.id)!.items.push(insight);
    }

    let result = Array.from(grouped.values());

    // Global search filters by customer name/code across all categories
    const global = this.globalSearch().toLowerCase().trim();
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
    const customers = new Set(this.expandedCustomers());
    if (customers.has(key)) {
      customers.delete(key);
    } else {
      customers.add(key);
    }
    this.expandedCustomers.set(customers);
  }

  isCustomerExpanded(category: InsightCategory, customerId: number): boolean {
    return this.expandedCustomers().has(`${category}:${customerId}`);
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
      case 'Urgent': return 'bg-scoular-red dark:bg-scoular-red';
      case 'Warning': return 'bg-amber-400 dark:bg-amber-500';
      default:        return 'bg-gray-300 dark:bg-gray-600';
    }
  }

  getTagClass(style: InsightTagStyle): string {
    switch (style) {
      case 'commodity': return 'bg-scoular-green/10 dark:bg-scoular-green/20 text-scoular-green-accessible dark:text-scoular-green';
      case 'quantity':  return 'bg-scoular-blue/10 dark:bg-scoular-blue/20 text-scoular-blue-medium dark:text-scoular-blue';
      case 'warning':   return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-scoular-yellow';
      case 'alert':     return 'bg-scoular-red/10 dark:bg-scoular-red/20 text-scoular-red-accessible dark:text-scoular-red';
      default:          return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
    }
  }

  getCategoryCountClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'SpotLoads':            return 'bg-scoular-yellow/10 text-scoular-yellow dark:bg-scoular-yellow/20 dark:text-scoular-yellow';
      case 'UnshippedBushels':     return 'bg-scoular-red/10 text-scoular-red-accessible dark:bg-scoular-red/20 dark:text-scoular-red';
      default:                     return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
    }
  }

  getCategoryHeaderClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800';
      case 'SpotLoads':            return 'bg-scoular-yellow/5 dark:bg-scoular-yellow/20 border-b border-scoular-yellow/20 dark:border-scoular-yellow';
      case 'UnshippedBushels':     return 'bg-scoular-red/5 dark:bg-scoular-red/20 border-b border-scoular-red/20 dark:border-scoular-red-accessible';
      default:                     return 'bg-gray-50 dark:bg-gray-900/20 border-b border-gray-100 dark:border-gray-800';
    }
  }

  getCategoryIconClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'text-scoular-yellow dark:text-scoular-yellow';
      case 'SpotLoads':            return 'text-scoular-yellow dark:text-scoular-yellow';
      case 'UnshippedBushels':     return 'text-scoular-red-accessible dark:text-scoular-red';
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
      case 'SpotLoads':            return 'text-scoular-yellow dark:text-white';
      case 'UnshippedBushels':     return 'text-scoular-red-accessible dark:text-red-100';
      default:                     return 'text-gray-900 dark:text-gray-100';
    }
  }

  getCategorySubtitleClass(category: InsightCategory): string {
    switch (category) {
      case 'UnconfirmedContracts': return 'text-scoular-yellow dark:text-scoular-yellow';
      case 'SpotLoads':            return 'text-scoular-yellow dark:text-scoular-yellow';
      case 'UnshippedBushels':     return 'text-scoular-red-accessible dark:text-scoular-red';
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
      case 'SpotLoads':            return 'bg-scoular-yellow/10 text-scoular-yellow dark:bg-scoular-yellow/20 dark:text-scoular-yellow';
      case 'UnshippedBushels':     return 'bg-scoular-red/10 text-scoular-red-accessible dark:bg-scoular-red/20 dark:text-scoular-red';
      default:                     return 'bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300';
    }
  }

  /** Template helper: update a single category search entry without computed property syntax */
  setCategorySearch(category: InsightCategory, value: string): void {
    this.categorySearch.update(s => ({ ...s, [category]: value }));
  }
}
