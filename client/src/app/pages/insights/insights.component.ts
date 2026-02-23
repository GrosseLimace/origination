import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AppStateService } from '../../services/app-state.service';
import { ToastService } from '../../services/toast.service';
import { Customer, Contract, Note } from '../../models';
import { CardComponent } from '../../components/ui/card/card.component';
import { BadgeComponent } from '../../components/ui/badge/badge.component';

type InsightCategory = 'Compliance' | 'CustomerContact' | 'BusinessOpportunity';
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
      <div class="flex items-center justify-between">
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
        @if (!isLoading && selectedTradeUnits.length > 0) {
          <div class="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-2">
            <span class="text-xl text-gray-900 dark:text-white">{{ allInsights.length }}</span>
            <span class="text-base text-gray-600 dark:text-gray-300 ml-1">total actions</span>
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

      <!-- Loading -->
      } @else if (isLoading) {
        <div class="flex min-h-[60vh] items-center justify-center">
          <div class="text-center">
            <div class="inline-block animate-spin rounded-full h-16 w-16 border-4 border-gray-300 dark:border-gray-600 border-t-green-600 dark:border-t-green-500 mb-4"></div>
            <p class="text-gray-500 dark:text-gray-400 font-medium text-lg">Loading insights data...</p>
          </div>
        </div>

      } @else {

        <!-- Summary Stats -->
        <div class="grid grid-cols-3 gap-4">
          <app-card class="!p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-600 dark:text-amber-400">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div>
                <div class="text-2xl font-bold text-amber-600 dark:text-amber-400">{{ complianceCount }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">Compliance</div>
              </div>
            </div>
          </app-card>
          <app-card class="!p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-purple-600 dark:text-purple-400">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <div>
                <div class="text-2xl font-bold text-purple-600 dark:text-purple-400">{{ customerContactCount }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">Customer Contact</div>
              </div>
            </div>
          </app-card>
          <app-card class="!p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-600 dark:text-blue-400">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                  <polyline points="17 6 23 6 23 12"/>
                </svg>
              </div>
              <div>
                <div class="text-2xl font-bold text-blue-600 dark:text-blue-400">{{ businessOpportunityCount }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">Business Opportunity</div>
              </div>
            </div>
          </app-card>
        </div>

        <!-- Insights by Category -->
        @for (category of categories; track category) {
          @if (getInsightsByCategory(category).length > 0) {
            <app-card class="overflow-hidden">
              <div
                [class]="getCategoryHeaderClass(category)"
                class="p-4 cursor-pointer"
                (click)="toggleCategory(category)">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <ng-container [ngSwitch]="category">
                      <svg *ngSwitchCase="'Compliance'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <svg *ngSwitchCase="'CustomerContact'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                      <svg *ngSwitchCase="'BusinessOpportunity'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [class]="getCategoryIconClass(category)">
                        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                        <polyline points="17 6 23 6 23 12"/>
                      </svg>
                    </ng-container>
                    <div>
                      <h3 [class]="'font-semibold ' + getCategoryTitleClass(category)">{{ getCategoryTitle(category) }}</h3>
                      <p [class]="'text-sm ' + getCategorySubtitleClass(category)">{{ getInsightsByCategory(category).length }} items</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <app-badge [class]="getCategoryBadgeClass(category)">{{ getInsightsByCategory(category).length }}</app-badge>
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
            </app-card>
          }
        }

        @if (allInsights.length === 0) {
          <app-card class="p-12 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 text-green-500">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <h3 class="text-gray-900 dark:text-white mb-2">All Caught Up!</h3>
            <p class="text-gray-500 dark:text-gray-400">No actionable insights for the selected trade unit at this time.</p>
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
  notes: Note[] = [];
  isLoading = false;

  allInsights: Insight[] = [];
  expandedCategories = new Set<InsightCategory>();
  categories: InsightCategory[] = ['Compliance', 'CustomerContact', 'BusinessOpportunity'];

  get selectedTradeUnits(): string[] {
    return this.appState.selectedTradeUnits();
  }

  get complianceCount(): number {
    return this.allInsights.filter(i => i.category === 'Compliance').length;
  }

  get customerContactCount(): number {
    return this.allInsights.filter(i => i.category === 'CustomerContact').length;
  }

  get businessOpportunityCount(): number {
    return this.allInsights.filter(i => i.category === 'BusinessOpportunity').length;
  }

  ngOnInit(): void {
    if (this.selectedTradeUnits.length === 0) return;

    // Use AppStateService cache if already populated (avoids redundant API calls)
    if (this.appState.customers().length > 0) {
      this.customers = this.appState.customers();
      this.contracts = this.appState.contracts();
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
      notes: this.apiService.getNotes()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.customers = data.customers;
        this.contracts = data.contracts;
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

    for (const customer of this.customers) {
      const customerContracts = this.contracts.filter(c => c.customerId === customer.id);
      const customerNotes = this.notes.filter(n => n.customerId === customer.id);

      // Compliance - Unsigned contracts
      for (const contract of customerContracts.filter(c => !c.signed && c.status !== 'Fulfilled')) {
        insights.push({
          customer,
          category: 'Compliance',
          priority: 'Urgent',
          message: `Contract ${contract.contractNumber} awaiting signature.`
        });
      }

      // Customer Contact - No contact in 60+ days
      const lastNote = customerNotes.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

      if (!lastNote) {
        insights.push({
          customer,
          category: 'CustomerContact',
          priority: 'Urgent',
          message: 'No contact history recorded. Schedule initial outreach.'
        });
      } else {
        const daysSinceContact = Math.floor((Date.now() - new Date(lastNote.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceContact >= 60) {
          insights.push({
            customer,
            category: 'CustomerContact',
            priority: 'Warning',
            message: `Last contact was ${daysSinceContact} days ago. Consider reaching out.`
          });
        }
      }

      // Business Opportunity - No active contracts
      const activeContracts = customerContracts.filter(c => c.status === 'Active' || c.status === 'Pending');
      if (activeContracts.length === 0) {
        insights.push({
          customer,
          category: 'BusinessOpportunity',
          priority: 'Info',
          message: `${customer.name} currently has no active contracts.`
        });
      }
    }

    // Sort by priority then category
    const priorityOrder: Record<InsightPriority, number> = { 'Urgent': 0, 'Warning': 1, 'Info': 2 };
    const categoryOrder: Record<InsightCategory, number> = { 'Compliance': 0, 'CustomerContact': 1, 'BusinessOpportunity': 2 };

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
      case 'Compliance': return 'bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800';
      case 'CustomerContact': return 'bg-purple-50 dark:bg-purple-900/20 border-b border-purple-100 dark:border-purple-800';
      case 'BusinessOpportunity': return 'bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800';
      default: return 'bg-gray-50 dark:bg-gray-900/20 border-b border-gray-100 dark:border-gray-800';
    }
  }

  getCategoryIconClass(category: InsightCategory): string {
    switch (category) {
      case 'Compliance': return 'text-amber-600 dark:text-amber-400';
      case 'CustomerContact': return 'text-purple-600 dark:text-purple-400';
      case 'BusinessOpportunity': return 'text-blue-600 dark:text-blue-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  }

  getCategoryTitle(category: InsightCategory): string {
    switch (category) {
      case 'Compliance': return 'Compliance';
      case 'CustomerContact': return 'Customer Contact';
      case 'BusinessOpportunity': return 'Business Opportunity';
      default: return 'Other';
    }
  }

  getCategoryTitleClass(category: InsightCategory): string {
    switch (category) {
      case 'Compliance': return 'text-amber-900 dark:text-amber-100';
      case 'CustomerContact': return 'text-purple-900 dark:text-purple-100';
      case 'BusinessOpportunity': return 'text-blue-900 dark:text-blue-100';
      default: return 'text-gray-900 dark:text-gray-100';
    }
  }

  getCategorySubtitleClass(category: InsightCategory): string {
    switch (category) {
      case 'Compliance': return 'text-amber-600 dark:text-amber-400';
      case 'CustomerContact': return 'text-purple-600 dark:text-purple-400';
      case 'BusinessOpportunity': return 'text-blue-600 dark:text-blue-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  }

  getCategoryBadgeClass(category: InsightCategory): string {
    switch (category) {
      case 'Compliance': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'CustomerContact': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';
      case 'BusinessOpportunity': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300';
    }
  }
}
