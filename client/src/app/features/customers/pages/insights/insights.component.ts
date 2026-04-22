import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal, computed, effect, untracked } from '@angular/core';
import { toObservable, toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { debounceTime, filter, pairwise, take } from 'rxjs/operators';
import { AppStateService } from '@core/services/app-state.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Contract, Ticket } from '@models';
import { expandCommodityAliases } from '@shared/utils/commodity-aliases';
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
  ticketNumber?: string;
  productCode?: string;
  searchTerms?: string[];
  quantity?: number;
  sortDate?: string; // yyyy-MM-dd, used to sort SpotLoads newest-first
}

interface CustomerGroup {
  customer: Customer;
  items: Insight[];
  summary: string; // Pre-computed summary text (e.g. "3 contracts", "1,500 bu")
}

// ── Static category metadata ────────────────────────────────────────────────
const CATEGORY_META: Record<InsightCategory, {
  title: string;
  headerClass: string;
  iconClass: string;
  titleClass: string;
  subtitleClass: string;
  badgeClass: string;
  countClass: string;
  searchPlaceholder: string;
}> = {
  UnconfirmedContracts: {
    title: 'Unconfirmed Contracts',
    headerClass: 'bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800',
    iconClass: 'text-scoular-yellow dark:text-scoular-yellow',
    titleClass: 'text-amber-900 dark:text-amber-100',
    subtitleClass: 'text-scoular-yellow dark:text-scoular-yellow',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    countClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    searchPlaceholder: 'Search by customer, contract, or commodity...',
  },
  SpotLoads: {
    title: 'Spot Loads — Delivered, No Contract (Last 30 Days)',
    headerClass: 'bg-scoular-yellow/5 dark:bg-scoular-yellow/20 border-b border-scoular-yellow/20 dark:border-scoular-yellow',
    iconClass: 'text-scoular-yellow dark:text-scoular-yellow',
    titleClass: 'text-scoular-yellow dark:text-white',
    subtitleClass: 'text-scoular-yellow dark:text-scoular-yellow',
    badgeClass: 'bg-scoular-yellow/10 text-scoular-yellow dark:bg-scoular-yellow/20 dark:text-scoular-yellow',
    countClass: 'bg-scoular-yellow/10 text-scoular-yellow dark:bg-scoular-yellow/20 dark:text-scoular-yellow',
    searchPlaceholder: 'Search by customer, code, or ticket #...',
  },
  UnshippedBushels: {
    title: 'Unshipped Bushels Past Delivery Date',
    headerClass: 'bg-scoular-red/5 dark:bg-scoular-red/20 border-b border-scoular-red/20 dark:border-scoular-red-accessible',
    iconClass: 'text-scoular-red-accessible dark:text-scoular-red',
    titleClass: 'text-scoular-red-accessible dark:text-red-100',
    subtitleClass: 'text-scoular-red-accessible dark:text-scoular-red',
    badgeClass: 'bg-scoular-red/10 text-scoular-red-accessible dark:bg-scoular-red/20 dark:text-scoular-red',
    countClass: 'bg-scoular-red/10 text-scoular-red-accessible dark:bg-scoular-red/20 dark:text-scoular-red',
    searchPlaceholder: 'Search by customer ID, name, commodity, or contract #...',
  },
};

/**
 * Looks up lbs-per-bushel from the ODS commodity conversion map (ctrm.vw_GNP024).
 * Returns null if conversions are unavailable or the commodity is not in the view.
 * No hardcoded fallback — callers must handle missing data explicitly.
 */
function getLbsPerBushel(productCode: string | undefined | null, conversionMap?: Map<string, number>): number | null {
  const code = (productCode || '').trim().toUpperCase();
  if (!code || !conversionMap) return null;
  const lbs = conversionMap.get(code);
  return lbs && lbs > 0 ? lbs : null;
}

/** Pre-compute summary text for a customer group */
function computeSummary(items: Insight[], category: InsightCategory): string {
  const count = items.length;
  switch (category) {
    case 'UnconfirmedContracts':
      return `${count} contract${count !== 1 ? 's' : ''}`;
    case 'SpotLoads':
      return `${count} load${count !== 1 ? 's' : ''}`;
    case 'UnshippedBushels': {
      const total = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
      return total > 0
        ? `${Math.round(total).toLocaleString()} remaining`
        : `${count} contract${count !== 1 ? 's' : ''}`;
    }
    default: return '';
  }
}

// Commodity aliases now centralized in @shared/utils/commodity-aliases.ts
function expandSearchTermWithAliases(term: string): string[] {
  return expandCommodityAliases(term);
}

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, BadgeComponent, TradeUnitSelectorComponent],
  templateUrl: './insights.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InsightsComponent {
  private readonly appState = inject(AppStateService);
  private readonly dataPreloadService = inject(DataPreloadService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly usageTracking = inject(UsageTrackingService);

  // Read directly from appState — DataPreloadService populates these on TU change
  readonly customers = this.appState.customers;
  readonly contracts = this.appState.contracts;
  readonly tickets = this.appState.tickets;
  readonly todaysTickets = this.appState.todaysTickets;
  readonly commodities = this.appState.commodities;
  readonly isLoading = computed(() => this.appState.dataLoading());
  // Only Unshipped Bushels depends on the full ticket set — other categories can render
  // as soon as core data is ready.
  readonly isTicketsLoading = computed(() => this.appState.ticketsLoading());
  isCategoryLoading(category: InsightCategory): boolean {
    return category === 'UnshippedBushels' && this.isTicketsLoading();
  }
  isBackgroundRefreshing = signal(false);
  private readonly _dataLoading$ = toObservable(this.appState.dataLoading);
  loadedAt = signal<Date | null>(null);

  expandedCategories = signal(new Set<InsightCategory>());
  expandedCustomers = signal(new Set<string>());
  categories: InsightCategory[] = ['UnconfirmedContracts', 'SpotLoads', 'UnshippedBushels'];

  // Expose static metadata to the template
  readonly categoryMeta = CATEGORY_META;

  // ── Debounced search signals ──────────────────────────────────────────────
  // Raw signals bound to inputs; debounced signals used by the computed filter.
  // This prevents customerGroupsByCategory from recomputing on every keystroke.
  readonly globalSearchRaw = signal('');
  readonly categorySearchRaw = signal<{ [key: string]: string }>({});

  readonly globalSearch = toSignal(
    toObservable(this.globalSearchRaw).pipe(debounceTime(250)),
    { initialValue: '' }
  );
  readonly categorySearch = toSignal(
    toObservable(this.categorySearchRaw).pipe(debounceTime(250)),
    { initialValue: {} as { [key: string]: string } }
  );

  // ── Derived state (computed signals) ──────────────────────────────────────

  // Generates all insights from source data. Evaluates exactly once per
  // change-detection cycle (lazy, glitch-free).
  readonly allInsights = computed(() => {
    const customers = this.customers();
    if (customers.length === 0) return [] as Insight[];
    const contracts = this.contracts().filter(c => !c.closedDate);
    const todaysTickets = this.todaysTickets();
    // Skip the O(n) customer loop if neither contracts nor today's tickets have arrived yet.
    if (contracts.length === 0 && todaysTickets.length === 0) return [] as Insight[];

    const insights: Insight[] = [];
    const now = new Date();
    const today = new Date(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`);

    // Build conversion map from ODS data
    const rawConversions = this.appState.commodityConversions();
    const conversionMap = rawConversions.length > 0
      ? new Map(rawConversions.map(c => [c.commodityCode.trim().toUpperCase(), c.lbsPerUnit]))
      : undefined;

    // Pre-index contracts by customer for O(1) lookup
    const contractsByCustomer = new Map<string, Contract[]>();
    for (const c of contracts) {
      if (!c.ctrmCustomerId) continue;
      const arr = contractsByCustomer.get(c.ctrmCustomerId);
      if (arr) { arr.push(c); } else { contractsByCustomer.set(c.ctrmCustomerId, [c]); }
    }

    // Pre-index applied ticket pounds by contract (ctrmContractNumber = sourceContractId).
    // Used by the Unshipped Bushels check to skip contracts whose tickets already cover
    // the contract quantity — mirrors the Contracts Table delivery math, so both screens
    // agree on whether a contract is fulfilled.
    const allTickets = this.tickets();
    const appliedLbsByContract = new Map<string, number>();
    for (const t of allTickets) {
      if (!t.isApplied) continue;
      const key = t.ctrmContractNumber?.trim();
      if (!key) continue;
      appliedLbsByContract.set(key, (appliedLbsByContract.get(key) ?? 0) + (t.appliedDockQuantity ?? 0));
    }
    // Pre-index recent tickets (last 30 days) by customer for O(1) spot-load lookup
    const recentTicketsByCustomer = new Map<string, Ticket[]>();
    for (const t of todaysTickets) {
      if (!t.customerCode) continue;
      const arr = recentTicketsByCustomer.get(t.customerCode);
      if (arr) { arr.push(t); } else { recentTicketsByCustomer.set(t.customerCode, [t]); }
    }
    // Commodity code → name map for search (e.g. "YC" → "Yellow Corn")
    const commodityNameByCode = new Map<string, string>();
    for (const c of this.commodities()) {
      if (c.code) commodityNameByCode.set(c.code.trim().toUpperCase(), c.name);
    }

    for (const customer of customers) {
      const customerContracts = contractsByCustomer.get(customer.sourceCustomerId!) || [];
      const customerRecentTickets = recentTicketsByCustomer.get(customer.sourceCustomerId!) || [];

      // --- 1. Unconfirmed Contracts ---
      for (const contract of customerContracts) {
        const confirmStatus = (contract.customerConfirmStatus || '').trim();
        const isConfirmed = confirmStatus.toLowerCase() === 'confirmed';
        if (!isConfirmed && contract.status !== 'Fulfilled' && contract.status !== 'Cancelled') {
          const desc = contract.commodityDescription?.trim();
          const code = contract.commodityCode?.trim();
          const commodity = desc && code ? `${desc} (${code})` : desc || code || 'Unknown commodity';
          const rawQty = contract.quantity || contract.openBalanceQuantity || 0;
          const unitLabel = contract.unit || 'bu';
          const qtyTag = rawQty ? `${Math.round(rawQty).toLocaleString()} ${unitLabel}` : null;
          const statusLabel = confirmStatus || 'No status';
          insights.push({
            customer,
            category: 'UnconfirmedContracts',
            priority: 'Urgent',
            message: `Contract ${contract.contractNumber} (${commodity}${qtyTag ? ', ' + qtyTag : ''}) — ${statusLabel}.`,
            contractId: contract.id,
            quantity: rawQty,
            tags: [
              { label: contract.sourceContractId || contract.contractNumber, style: 'default' },
              { label: commodity, style: 'commodity' },
              ...(qtyTag ? [{ label: qtyTag, style: 'quantity' as const }] : []),
              { label: statusLabel, style: 'warning' },
            ],
            searchTerms: [contract.sourceContractId, contract.contractNumber, desc, code].filter(Boolean) as string[]
          });
        }
      }

      // --- 2. Spot Loads — Unapplied Tickets (Last 30 Days) ---
      // A spot load is a ticket with no contract assigned (prefix U/L or null). This matches
      // the grain-industry meaning and the Unapplied Tickets tab, so clicking a spot load
      // always takes the user to a ticket they can actually see. We intentionally do NOT
      // flag applied-but-uncovered tickets (e.g. ticket applied to a now-closed contract)
      // — those are completed deliveries, not spot loads.
      for (const ticket of customerRecentTickets) {
        if (!ticket.date) continue;
        if (ticket.isApplied) continue;
        {
          const lbs = ticket.appliedDockQuantity || ticket.unloadQuantity || 0;
          const lbsPerBu = getLbsPerBushel(ticket.productCode, conversionMap);
          const bu = lbs && lbsPerBu ? Math.round(lbs / lbsPerBu) : null;
          // Parse the ticket date string as a LOCAL date to match Angular's date pipe
          // behavior on the customer Unapplied Tickets tab. Passing "2026-03-23" to
          // `new Date()` yields UTC midnight which toLocaleDateString then renders in
          // local time — drifting to the previous day for users west of UTC.
          const dateStr = typeof ticket.date === 'string' ? ticket.date.split('T')[0] : '';
          const [yr, mo, dy] = dateStr.split('-').map(Number);
          const dateLabel = (yr && mo && dy)
            ? new Date(yr, mo - 1, dy).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '';
          insights.push({
            customer,
            category: 'SpotLoads',
            priority: 'Urgent',
            message: `Ticket #${ticket.ticketNumber}${ticket.productCode ? ' — ' + ticket.productCode : ''}${bu ? ', ' + bu.toLocaleString() + ' bu' : ''}`,
            ticketNumber: ticket.ticketNumber,
            productCode: ticket.productCode,
            sortDate: ticket.date,
            quantity: bu ?? 0,
            tags: [
              { label: `#${ticket.ticketNumber}`, style: 'default' },
              ...(ticket.productCode ? [{ label: ticket.productCode, style: 'commodity' as InsightTagStyle }] : []),
              ...(bu ? [{ label: `${bu.toLocaleString()} bu`, style: 'quantity' as InsightTagStyle }] : []),
              { label: dateLabel, style: 'default' },
              { label: 'Spot', style: 'warning' },
            ],
            searchTerms: [
              ticket.ticketNumber,
              ticket.productCode,
              ticket.productCode ? commodityNameByCode.get(ticket.productCode.trim().toUpperCase()) : undefined,
            ].filter(Boolean) as string[]
          });
        }
      }

      // --- 3. Unshipped Bushels Past Delivery Date ---
      for (const contract of customerContracts) {
        const deliveryEnd = new Date(contract.deliveryEnd);
        const isPastDue = deliveryEnd < today;
        const isOpen = contract.status === 'Active' || contract.status === 'Overdue';
        // Match the Contracts Table display rule: if CTRM's balance rounds to 0 in the
        // contract's unit (same rounding Contracts Table uses — whole for bu/lb, 2-dec
        // for tons), it's a residue and Contract Detail would show Filled. Don't flag.
        const openBal = contract.openBalanceQuantity ?? 0;
        const unitL = (contract.unit || '').toLowerCase().trim();
        const isTonsU = unitL === 'st' || unitL.includes('ton');
        const roundedOpen = isTonsU ? Math.round(openBal * 100) / 100 : Math.round(openBal);
        const hasRemainingQty = roundedOpen > 0;

        // Compute the ticket-based remaining using the same math as Contracts Table —
        // converts applied pounds back to the contract's unit, rounds the same way
        // (whole for bu/lb/cwt, 2-decimal for tons). This is the authoritative remaining
        // number when we have tickets + commodity conversion; used both to skip fulfilled
        // contracts AND as the displayed quantity below so Insights agrees with the
        // Contract Detail page's "Remaining Quantity" to the bushel.
        let ticketRemaining: number | null = null;
        const contractKey = contract.sourceContractId?.trim();
        const lbsPerBu = getLbsPerBushel(contract.commodityCode, conversionMap);
        if (contractKey && lbsPerBu && lbsPerBu > 0) {
          const appliedLbs = appliedLbsByContract.get(contractKey) ?? 0;
          const unitLower = (contract.unit || '').toLowerCase().trim();
          const isTons = unitLower === 'st' || unitLower.includes('ton');
          let deliveredInUnits: number;
          if (isTons) deliveredInUnits = appliedLbs / 2000;
          else if (unitLower.includes('pound') || unitLower.includes('lb')) deliveredInUnits = appliedLbs;
          else if (unitLower === 'cwt' || unitLower.includes('hundredweight')) deliveredInUnits = appliedLbs / 100;
          else deliveredInUnits = appliedLbs / lbsPerBu;
          const remainingInUnits = Math.max(0, (contract.quantity || 0) - deliveredInUnits);
          ticketRemaining = isTons
            ? Math.round(remainingInUnits * 100) / 100
            : Math.round(remainingInUnits);
        }
        // Tickets say it's already delivered — skip (matches Contract Detail "Filled").
        if (ticketRemaining !== null && ticketRemaining <= 0) continue;

        if (isPastDue && isOpen && hasRemainingQty) {
          const desc = contract.commodityDescription?.trim();
          const code = contract.commodityCode?.trim();
          const commodity = desc && code ? `${desc} (${code})` : desc || code || 'Unknown commodity';
          // Prefer the ticket-computed remaining (matches Contract Detail exactly);
          // fall back to CTRM's OpenBalanceQuantity only when we can't compute.
          const rawQty = ticketRemaining !== null && ticketRemaining > 0
            ? ticketRemaining
            : (contract.openBalanceQuantity || contract.quantity || 0);
          const unitLabel = contract.unit || 'bu';
          const qtyTag = rawQty ? `${Math.round(rawQty).toLocaleString()} ${unitLabel}` : null;
          const daysOverdue = Math.floor((today.getTime() - deliveryEnd.getTime()) / (1000 * 60 * 60 * 24));
          insights.push({
            customer,
            category: 'UnshippedBushels',
            priority: 'Warning',
            message: `Contract ${contract.contractNumber} (${commodity}${qtyTag ? ', ' + qtyTag : ''}) is past its delivery end date.`,
            contractId: contract.id,
            quantity: rawQty,
            tags: [
              { label: contract.sourceContractId || contract.contractNumber, style: 'default' },
              { label: commodity, style: 'commodity' },
              ...(qtyTag ? [{ label: qtyTag, style: 'quantity' as const }] : []),
              { label: `${daysOverdue}d overdue`, style: 'alert' },
            ],
            searchTerms: [contract.sourceContractId, contract.contractNumber, desc, code].filter(Boolean) as string[]
          });
        }
      }
    }

    const priorityOrder: Record<InsightPriority, number> = { 'Urgent': 0, 'Warning': 1, 'Info': 2 };
    return insights.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      // Within SpotLoads, sort newest ticket first
      if (a.category === 'SpotLoads' && b.category === 'SpotLoads' && a.sortDate && b.sortDate) {
        return b.sortDate.localeCompare(a.sortDate);
      }
      return 0;
    });
  });

  // Memoized customer groups per category with pre-computed summaries.
  // Uses debounced search signals so typing doesn't trigger per-keystroke recomputation.
  readonly customerGroupsByCategory = computed(() => {
    const insights = this.allInsights();
    const global = (this.globalSearch() ?? '').toLowerCase().trim();
    const searches = this.categorySearch() ?? {};
    const result: Record<InsightCategory, CustomerGroup[]> = {
      UnconfirmedContracts: [],
      SpotLoads: [],
      UnshippedBushels: [],
    };

    // Group all insights by category and customer in a single pass
    const grouped = new Map<string, Map<number, { customer: Customer; items: Insight[] }>>();
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
      // Build groups with pre-computed summaries
      let groups: CustomerGroup[] = Array.from(grouped.get(category)!.values()).map(g => ({
        customer: g.customer,
        items: g.items,
        summary: computeSummary(g.items, category),
      }));

      if (global) {
        const globalTerms = expandSearchTermWithAliases(global);
        groups = groups.reduce<CustomerGroup[]>((acc, g) => {
          const nameLower = g.customer.name.toLowerCase();
          const idLower = (g.customer.sourceCustomerId || '').toLowerCase();
          if (globalTerms.some(t => nameLower.includes(t) || idLower.includes(t))) {
            acc.push(g);
            return acc;
          }
          const matchingItems = g.items.filter(item =>
            item.searchTerms?.some(term => {
              const t = term.toLowerCase();
              return globalTerms.some(gt => t.includes(gt));
            }) ||
            item.tags?.some(tag => {
              const label = tag.label.toLowerCase();
              return globalTerms.some(gt => label.includes(gt));
            })
          );
          if (matchingItems.length > 0) {
            acc.push({ customer: g.customer, items: matchingItems, summary: computeSummary(matchingItems, category) });
          }
          return acc;
        }, []);
      }
      const search = (searches[category] || '').toLowerCase().trim();
      if (search) {
        const searchTerms = expandSearchTermWithAliases(search);
        groups = groups.reduce<CustomerGroup[]>((acc, g) => {
          // Customer-level match: show all items
          const nameLower = g.customer.name.toLowerCase();
          const idLower = (g.customer.sourceCustomerId || '').toLowerCase();
          if (searchTerms.some(t => nameLower.includes(t) || idLower.includes(t))) {
            acc.push(g);
            return acc;
          }
          // Item-level match: filter to only matching items
          const matchingItems = g.items.filter(item =>
            item.searchTerms?.some(term => {
              const t = term.toLowerCase();
              return searchTerms.some(st => t.includes(st));
            }) ||
            item.tags?.some(tag => {
              const label = tag.label.toLowerCase();
              return searchTerms.some(st => label.includes(st));
            })
          );
          if (matchingItems.length > 0) {
            acc.push({ customer: g.customer, items: matchingItems, summary: computeSummary(matchingItems, category) });
          }
          return acc;
        }, []);
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
    // Reset expanded/search state only when trade units change — not when secondary
    // data like tickets arrives after the initial render. Without this split, the
    // single effect tracking allInsights() fired 3 times per load (customers,
    // contracts, tickets) and collapsed any category the user had already opened.
    effect(() => {
      this.appState.selectedTradeUnits(); // track TU changes
      untracked(() => {
        this.expandedCustomers.set(new Set());
        this.expandedCategories.set(new Set());
        this.categorySearchRaw.set({});
        this.globalSearchRaw.set('');
      });
    });

    // Update "Updated at X:XX" timestamp whenever insights data changes.
    effect(() => {
      this.allInsights(); // track data changes
      untracked(() => {
        if (this.customers().length > 0) {
          this.loadedAt.set(new Date());
        }
      });
    });
  }

  refresh(): void {
    if (this.selectedTradeUnits.length === 0) return;
    this.isBackgroundRefreshing.set(true);
    this.dataPreloadService.forceReload();
    // Clear spinner once dataLoading transitions true → false (core data arrived).
    // pairwise() ignores the pre-existing false value before the reload starts.
    this._dataLoading$.pipe(
      pairwise(),
      filter(([prev, curr]) => prev === true && curr === false),
      take(1),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.isBackgroundRefreshing.set(false));
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
      this.categorySearchRaw.update(s => { const copy = { ...s }; delete copy[category]; return copy; });
    } else {
      expanded.add(category);
    }
    this.expandedCategories.set(expanded);
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
    const subFeatureMap: Record<string, string> = {
      UnconfirmedContracts: 'unconfirmed-contracts',
      SpotLoads: 'spot-loads',
      UnshippedBushels: 'unshipped-bushels'
    };
    this.usageTracking.postClickEvent('interaction', 'insights', subFeatureMap[insight.category], insight.customer.id.toString());
    this.usageTracking.trackProfileOpened(insight.customer.id.toString());
    const params: Record<string, string | number> = { customerId: insight.customer.id };
    if (insight.contractId) params['contractId'] = insight.contractId;
    if (insight.category === 'SpotLoads') {
      params['tab'] = 'tickets';
      if (insight.productCode) params['ticketCrop'] = insight.productCode;
    }
    this.router.navigate(['/'], { queryParams: params });
  }

  // ── Style helpers (dynamic per-insight, kept as methods) ──────────────────

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

  /** Template helper: update a single category search entry */
  setCategorySearch(category: InsightCategory, value: string): void {
    this.categorySearchRaw.update(s => ({ ...s, [category]: value }));
  }
}
