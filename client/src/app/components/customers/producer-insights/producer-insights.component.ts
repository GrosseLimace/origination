import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain } from '../../../models';

@Component({
  selector: 'app-producer-insights',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  template: `
    <div class="rounded-xl overflow-hidden" [style]="gradientStyle">
      <div class="p-6 pb-8">
        <!-- Header Row -->
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-white">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
              <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
            </svg>
            <h3 class="text-xl font-semibold text-white">Producer Insights</h3>
          </div>
          @if (customer.eSignEnabled) {
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium" [style]="badgeStyle">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              eSign Enabled
            </span>
          }
        </div>

        <!-- Subtitle -->
        <p [style]="subtitleStyle">
          {{ customer.name }} - Performance Analytics & Growth Metrics
        </p>

        <!-- Spacer -->
        <div class="h-8"></div>

        <!-- Stats Grid - 3 cards -->
        <div class="grid grid-cols-3 gap-4">
          <!-- Total Volume -->
          <div class="rounded-xl p-4" [style]="cardStyle">
            <div class="flex items-center justify-between mb-3">
              <span [style]="labelStyle">Total Volume</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [style]="iconStyle">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              </svg>
            </div>
            <div class="text-2xl text-white mb-1">
              {{ totalContracted | number }}
            </div>
            <div [style]="sublabelStyle">bushels contracted</div>
          </div>

          <!-- Average Contract Size -->
          <div class="rounded-xl p-4" [style]="cardStyle">
            <div class="flex items-center justify-between mb-3">
              <span [style]="labelStyle">Avg Contract</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [style]="iconStyle">
                <line x1="12" x2="12" y1="20" y2="10"/>
                <line x1="18" x2="18" y1="20" y2="4"/>
                <line x1="6" x2="6" y1="20" y2="16"/>
              </svg>
            </div>
            <div class="text-2xl text-white mb-1">
              {{ averageContractSize | number:'1.0-0' }}
            </div>
            <div [style]="sublabelStyle">bushels per contract</div>
          </div>

          <!-- Engagement -->
          <div class="rounded-xl p-4" [style]="cardStyle">
            <div class="flex items-center justify-between mb-3">
              <span [style]="labelStyle">Engagement</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [style]="iconStyle">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <div class="text-2xl text-white mb-1">
              {{ totalInteractions }}
            </div>
            <div [style]="sublabelStyle">total interactions</div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class ProducerInsightsComponent {
  @Input() customer!: Customer;
  @Input() contracts: Contract[] = [];
  @Input() tickets: Ticket[] = [];
  @Input() plantingIntentions: PlantingIntention[] = [];
  @Input() notes: Note[] = [];
  @Input() storedGrain: StoredGrain[] = [];

  private themeService = inject(ThemeService);

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  get gradientStyle(): string {
    return this.isDarkMode
      ? 'background: linear-gradient(145deg, #166534 0%, #15803d 20%, #14532d 50%, #052e16 100%);'
      : 'background: linear-gradient(145deg, #22c55e 0%, #16a34a 35%, #15803d 65%, #166534 100%);';
  }

  get subtitleStyle(): string {
    return this.isDarkMode
      ? 'color: #86efac; font-size: 0.875rem;'
      : 'color: #bbf7d0; font-size: 0.875rem;';
  }

  get cardStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(21, 128, 61, 0.3); border: 1px solid rgba(34, 197, 94, 0.4);'
      : 'background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(134, 239, 172, 0.3);';
  }

  get labelStyle(): string {
    return this.isDarkMode
      ? 'color: #86efac; font-size: 0.875rem;'
      : 'color: #bbf7d0; font-size: 0.875rem;';
  }

  get iconStyle(): string {
    return this.isDarkMode
      ? 'color: #4ade80;'
      : 'color: #86efac;';
  }

  get sublabelStyle(): string {
    return 'color: #86efac; font-size: 0.75rem;';
  }

  get badgeStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4);'
      : 'background: rgba(255, 255, 255, 0.15); color: white; border: 1px solid rgba(255, 255, 255, 0.3);';
  }

  getPacingChangeStyle(pct: number): string {
    return pct >= 0 ? 'color: #4ade80;' : 'color: #f87171;';
  }

  getPacingBadgeStyle(pct: number): string {
    return pct >= 0
      ? 'background: rgba(74, 222, 128, 0.15); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3);'
      : 'background: rgba(248, 113, 113, 0.15); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3);';
  }

  get pacingRowStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(15, 100, 45, 0.3);'
      : 'background: rgba(255, 255, 255, 0.05);';
  }

  get colHeaderStyle(): string {
    return 'color: #86efac; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700;';
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  get totalContracted(): number {
    return this.contracts.reduce((sum, c) => sum + c.quantity, 0);
  }

  get averageContractSize(): number {
    if (this.contracts.length === 0) return 0;
    return this.totalContracted / this.contracts.length;
  }

  get totalInteractions(): number {
    return this.notes.length + this.tickets.length;
  }

  formatBu(bu: number): string {
    if (bu >= 1_000_000) return `${(bu / 1_000_000).toFixed(1)}M`;
    if (bu >= 1_000) return `${Math.round(bu / 1_000)}K`;
    return bu.toLocaleString();
  }

  formatRevenue(amount: number): string {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `${Math.floor(amount / 1000)}K`;
    return amount.toLocaleString();
  }
}
