import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal, computed, effect, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { Customer, Contract, Ticket, Note } from '@models';
import { CardComponent } from '@shared/components/card/card.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';

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
  quantity?: number; // Bushels/quantity — used to sum per-customer totals in the row header
}

interface CustomerGroup {
  customer: Customer;
  items: Insight[];
}

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, BadgeComponent, TradeUnitSelectorComponent],
  templateUrl: './insights.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InsightsComponent {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Read directly from appState — DataPreloadService populates these on TU change
  readonly customers = this.appState.customers;
  readonly contracts = this.appState.contracts;
  readonly tickets = this.appState.tickets;
  readonly notes = this.appState.notes;
  readonly isLoading = computed(() => this.appState.dataLoading());
  isBackgroundRefreshing = signal(false);
  loadedAt = signal<Date | null>(null);

  allInsights = signal<Insight[]>([]);
  expandedCategories = signal(new Set<InsightCategory>());
  expandedCustomers = signal(new Set<string>());
  categorySearch = signal<{ [key: string]: string }>({});
  globalSearch = signal('');
  categories: InsightCategory[] = ['UnconfirmedContracts', 'SpotLoads', 'UnshippedBushels'];

  // Memoized customer groups per category — recomputes only when allInsights, globalSearch, or categorySearch change
  readonly customerGroupsByCategory = computed(() => {
    const insights = this.allInsights();
    const global = this.globalSearch().toLowerCase().trim();
    const searches = this.categorySearch();
    const result: Record<InsightCategory, CustomerGroup[]> = {
      UnconfirmedContracts: [],
      SpotLoads: [],
      UnshippedBushels: [],
    };

    // Group all insights by category and customer in a single pass
    const grouped = new Map<string, Map<number, CustomerGroup>>();
    for (const category of this.categories) {
      grouped.set(category, new Map());
    }
    for (const insight of insights) {
      const catMap = grouped.get(insight.category)!;
      if (!catMap.has(insight.customer.id)) {
        catMap.set(insight.customer.id, { customer: insight.customer, items: [] });
      }
      catMap.get(insight.customer.id)!.items.push(insight);
    }

    for (const category of this.categories) {
      let groups = Array.from(grouped.get(category)!.values());
      if (global) {
        groups = groups.filter(g =>
          g.customer.name.toLowerCase().includes(global) ||
          (g.customer.sourceCustomerId || '').toLowerCase().includes(global)
        );
      }
      const search = (searches[category] || '').toLowerCase().trim();
      if (search) {
        groups = groups.filter(g =>
          g.customer.name.toLowerCase().includes(search) ||
          (g.customer.sourceCustomerId || '').toLowerCase().includes(search) ||
          g.items.some(item =>
            item.tags?.some(tag => tag.label.toLowerCase().includes(search)) ||
            item.searchTerms?.some(term => term.toLowerCase().includes(search))
          )
        );
      }
      result[category] = groups;
    }
    return result;
  });

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
    // Re-generate insights whenever the preloaded data in appState changes
    effect(() => {
      this.appState.customers();
      this.appState.contracts();
      this.appState.tickets();
      this.appState.notes();
      untracked(() => this._generateInsights());
    });
  }

  refresh(): void {
    const tradeUnits = this.selectedTradeUnits;
    if (tradeUnits.length === 0) return;
    this.appState.setDataLoading(true);
    forkJoin({
      customers: this.apiService.getCustomers(tradeUnits).pipe(catchError(() => of([] as Customer[]))),
      contracts: this.apiService.getContracts(tradeUnits).pipe(catchError(() => of([] as Contract[]))),
      tickets: this.apiService.getTickets(tradeUnits).pipe(catchError(() => of([] as Ticket[]))),
      notes: this.apiService.getNotes().pipe(catchError(() => of([] as Note[])))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.appState.setCustomers(data.customers);
        this.appState.setContracts(data.contracts);
        this.appState.setTickets(data.tickets);
        this.appState.setNotes(data.notes);
        this.loadedAt.set(new Date());
        this.appState.setDataLoading(false);
      },
      error: () => {
        this.appState.setDataLoading(false);
        this.toastService.error('Failed to refresh insights data');
      }
    });
  }

  private _generateInsights(): void {
    if (this.customers().length === 0) return;

    const insights: Insight[] = [];
    // todayStr: today's date in UTC as "YYYY-MM-DD".
    // ticket.date (TicketBlDate) is a "YYYY-MM-DD" string from ODS — direct string comparison is safe.
    // note.createdAt is stored as GETUTCDATE() — compare using UTC date to avoid timezone drift
    // for users in Central/Mountain time where midnight UTC != local midnight.
    const now = new Date();
    const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const today = new Date(todayStr); // UTC midnight — used for date arithmetic (daysOverdue etc.)

    // Pre-index contracts and tickets by customer ID for O(1) lookup instead of O(n) per customer
    const contractsByCustomer = new Map<string, Contract[]>();
    for (const c of this.contracts()) {
      if (!c.ctrmCustomerId) continue;
      const arr = contractsByCustomer.get(c.ctrmCustomerId);
      if (arr) { arr.push(c); } else { contractsByCustomer.set(c.ctrmCustomerId, [c]); }
    }
    const ticketsByCustomer = new Map<string, Ticket[]>();
    for (const t of this.tickets()) {
      if (!t.customerCode) continue;
      const arr = ticketsByCustomer.get(t.customerCode);
      if (arr) { arr.push(t); } else { ticketsByCustomer.set(t.customerCode, [t]); }
    }

    // Pre-index today's notes by customerId for O(1) "contacted today" lookup instead of O(n) per customer
    const contactedTodaySet = new Set<number>();
    for (const n of this.notes()) {
      try {
        const d = new Date(n.createdAt);
        const noteUtcDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        if (noteUtcDate === todayStr) contactedTodaySet.add(n.customerId);
      } catch { /* skip malformed dates */ }
    }

    for (const customer of this.customers()) {
      const customerContracts = contractsByCustomer.get(customer.sourceCustomerId!) || [];
      const customerTickets = ticketsByCustomer.get(customer.sourceCustomerId!) || [];

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
            quantity: contract.quantity ?? 0,
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
      // Unapplied tickets delivered today with no customer contact.
      // isApplied = first char of ctrmContractNumber is 'P' or 'S' (contract prefix type) — server-computed.
      // ticket.date maps to TicketBlDate in ODS, stored as "YYYY-MM-DD" string — direct comparison is safe.
      const todayTickets = customerTickets.filter(t =>
        t.date === todayStr && !t.isApplied
      );

      if (todayTickets.length > 0) {
        if (!contactedTodaySet.has(customer.id)) {
          // One insight per ticket so the user can see and select individual tickets.
          for (const ticket of todayTickets) {
            const bu = ticket.unloadQuantity ? Math.round(ticket.unloadQuantity) : null;
            insights.push({
              customer,
              category: 'SpotLoads',
              priority: 'Urgent',
              message: `Ticket #${ticket.ticketNumber}${ticket.productCode ? ' — ' + ticket.productCode : ''}${bu ? ', ' + bu.toLocaleString() + ' bu' : ''}`,
              quantity: bu ?? 0,
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
            quantity: contract.openBalanceQuantity ?? contract.quantity ?? 0,
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
    return this.customerGroupsByCategory()[category];
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
      case 'SpotLoads':         return 'Search by customer, code, or ticket #...';
      case 'UnshippedBushels':  return 'Search by customer ID, name, commodity, or contract #...';
      default:                  return 'Search by customer, contract, or commodity...';
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

  /** Returns a compact summary string shown next to the customer name in the accordion row. */
  getCategoryCustomerSummary(group: CustomerGroup, category: InsightCategory): string {
    const count = group.items.length;
    switch (category) {
      case 'UnconfirmedContracts':
        return `${count} contract${count !== 1 ? 's' : ''}`;
      case 'SpotLoads':
        return `${count} load${count !== 1 ? 's' : ''}`;
      case 'UnshippedBushels': {
        const totalBu = group.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
        return totalBu > 0
          ? `${Math.round(totalBu).toLocaleString()} bu`
          : `${count} contract${count !== 1 ? 's' : ''}`;
      }
      default: return '';
    }
  }

  /** Template helper: update a single category search entry without computed property syntax */
  setCategorySearch(category: InsightCategory, value: string): void {
    this.categorySearch.update(s => ({ ...s, [category]: value }));
  }
}
