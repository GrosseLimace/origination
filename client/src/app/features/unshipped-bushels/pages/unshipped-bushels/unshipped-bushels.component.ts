import { Component, DestroyRef, inject, signal, computed, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '@core/services/app-state.service';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { Contract, Customer } from '@models';
import { CardComponent } from '@shared/components/card/card.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';

export interface CustomerContractGroup {
  customer: Customer | null;
  customerCode: string;
  customerName: string;
  totalOpenBushels: number;
  contracts: Contract[];
  expanded: boolean;
}

@Component({
  selector: 'app-unshipped-bushels',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, BadgeComponent],
  templateUrl: './unshipped-bushels.component.html'
})
export class UnshippedBushelsComponent implements OnInit {
  private readonly appState = inject(AppStateService);
  private readonly apiService = inject(ApiService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  loading = signal(false);
  private _groups = signal<CustomerContractGroup[]>([]);

  // Search filter signals
  searchCustomer = signal('');
  searchCommodity = signal('');
  searchContract = signal('');

  // Computed: apply all search filters
  filteredGroups = computed(() => {
    const groups = this._groups();
    const custFilter = this.searchCustomer().trim().toLowerCase();
    const commFilter = this.searchCommodity().trim().toLowerCase();
    const contractFilter = this.searchContract().trim().toLowerCase();

    return groups.filter(g => {
      // Customer ID / Name filter
      if (custFilter) {
        const nameMatch = g.customerName.toLowerCase().includes(custFilter);
        const codeMatch = g.customerCode.toLowerCase().includes(custFilter);
        if (!nameMatch && !codeMatch) return false;
      }

      // Commodity filter — group visible if any contract matches
      if (commFilter) {
        const hasMatch = g.contracts.some(c =>
          (c.commodityDescription?.toLowerCase().includes(commFilter)) ||
          (c.commodityCode?.toLowerCase().includes(commFilter))
        );
        if (!hasMatch) return false;
      }

      // Contract# filter — group visible if any contract matches
      if (contractFilter) {
        const hasMatch = g.contracts.some(c =>
          (c.contractNumber?.toLowerCase().includes(contractFilter)) ||
          (c.sourceContractId?.toLowerCase().includes(contractFilter))
        );
        if (!hasMatch) return false;
      }

      return true;
    });
  });

  // Computed: filtered contracts per group (applying commodity and contract# filters to rows)
  getFilteredContracts(group: CustomerContractGroup): Contract[] {
    const commFilter = this.searchCommodity().trim().toLowerCase();
    const contractFilter = this.searchContract().trim().toLowerCase();
    const commAliases: Record<string, string[]> = {
      'milo': ['milo', 'sorghum', 'sor'], 'sorghum': ['milo', 'sorghum', 'sor'],
      'beans': ['beans', 'soybeans', 'soy'], 'soybeans': ['soybeans', 'beans', 'soy'],
    };
    const commTerms = commFilter ? (commAliases[commFilter] ?? [commFilter]) : [];
    return group.contracts.filter(c => {
      if (commFilter) {
        const desc = c.commodityDescription?.toLowerCase() ?? '';
        const code = c.commodityCode?.toLowerCase() ?? '';
        if (!commTerms.some(t => desc.includes(t) || code.includes(t))) return false;
      }
      if (contractFilter) {
        const match = (c.contractNumber?.toLowerCase().includes(contractFilter)) ||
                      (c.sourceContractId?.toLowerCase().includes(contractFilter));
        if (!match) return false;
      }
      return true;
    });
  }

  // Summary totals
  totalBushels = computed(() => this.filteredGroups().reduce((sum, g) => sum + g.totalOpenBushels, 0));
  totalCustomers = computed(() => this.filteredGroups().length);
  totalContracts = computed(() => this.filteredGroups().reduce((sum, g) => sum + g.contracts.length, 0));

  ngOnInit(): void {
    this._buildGroups();
  }

  private _buildGroups(): void {
    const cachedContracts = this.appState.contracts();
    const customers = this.appState.customers();

    if (cachedContracts.length > 0) {
      this._processContracts(cachedContracts, customers);
      return;
    }

    // Fall back to API if cache is empty
    this.loading.set(true);
    const tradeUnits = this.appState.selectedTradeUnits();
    this.apiService.getContracts(tradeUnits.length ? tradeUnits : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (contracts) => {
          this.appState.setContracts(contracts);
          this._processContracts(contracts, this.appState.customers());
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Failed to load contracts');
          this.loading.set(false);
        }
      });
  }

  private _processContracts(contracts: Contract[], customers: Customer[]): void {
    // Filter to contracts with open balance
    const unshipped = contracts.filter(c => (c.openBalanceQuantity ?? 0) > 0);

    // Build a map of ctrmCustomerId → Customer
    const customerMap = new Map<string, Customer>();
    customers.forEach(c => {
      if (c.sourceCustomerId) customerMap.set(c.sourceCustomerId, c);
    });

    // Group by ctrmCustomerId
    const groupMap = new Map<string, CustomerContractGroup>();
    unshipped.forEach(contract => {
      const key = contract.ctrmCustomerId ?? `unknown_${contract.customerId}`;
      if (!groupMap.has(key)) {
        const customer = contract.ctrmCustomerId ? customerMap.get(contract.ctrmCustomerId) ?? null : null;
        groupMap.set(key, {
          customer,
          customerCode: key,
          customerName: customer?.name ?? contract.ctrmCustomerId ?? 'Unknown',
          totalOpenBushels: 0,
          contracts: [],
          expanded: false
        });
      }
      const group = groupMap.get(key)!;
      group.contracts.push(contract);
      group.totalOpenBushels += contract.openBalanceQuantity ?? 0;
    });

    // Sort by totalOpenBushels descending
    const sorted = Array.from(groupMap.values())
      .sort((a, b) => b.totalOpenBushels - a.totalOpenBushels);

    // Sort contracts within each group by deliveryEnd ascending
    sorted.forEach(g => {
      g.contracts.sort((a, b) => {
        const aDate = a.deliveryEnd ? new Date(a.deliveryEnd).getTime() : 0;
        const bDate = b.deliveryEnd ? new Date(b.deliveryEnd).getTime() : 0;
        return aDate - bDate;
      });
    });

    this._groups.set(sorted);
  }

  toggleExpand(group: CustomerContractGroup): void {
    group.expanded = !group.expanded;
    // Trigger signal update
    this._groups.update(groups => [...groups]);
  }

  expandAll(): void {
    this._groups.update(groups => groups.map(g => ({ ...g, expanded: true })));
  }

  collapseAll(): void {
    this._groups.update(groups => groups.map(g => ({ ...g, expanded: false })));
  }

  navigateToCustomer(group: CustomerContractGroup): void {
    if (group.customer) {
      this.router.navigate(['/'], { queryParams: { customerId: group.customer.id } });
    }
  }

  formatBushels(value: number): string {
    return value.toLocaleString('en-US');
  }

  formatDate(date: Date | string | undefined): string {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  clearFilters(): void {
    this.searchCustomer.set('');
    this.searchCommodity.set('');
    this.searchContract.set('');
  }

  get hasFilters(): boolean {
    return !!(this.searchCustomer() || this.searchCommodity() || this.searchContract());
  }
}
