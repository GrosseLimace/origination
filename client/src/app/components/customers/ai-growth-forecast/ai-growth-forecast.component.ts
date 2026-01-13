import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { Customer, Contract, PlantingIntention, Note } from '../../../models';

@Component({
  selector: 'app-ai-growth-forecast',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  template: `
    <div class="rounded-xl border overflow-hidden" [style]="containerStyle">
      <!-- Header with gradient background -->
      <div class="p-5" [style]="headerStyle">
        <div class="flex items-start justify-between">
          <div class="flex items-start gap-3">
            <div class="p-2 rounded-lg" [style]="iconBgStyle">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [style]="iconColorStyle">
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
              </svg>
            </div>
            <div>
              <h3 class="text-lg font-semibold" [style]="titleStyle">AI Growth Forecast</h3>
              <p class="text-sm" [style]="subtitleColorStyle">Revenue opportunity analysis and strategic recommendations</p>
            </div>
          </div>
          <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium" [style]="badgeStatusStyle">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [style]="badgeIconStyle">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
              <line x1="12" x2="12" y1="9" y2="13"/>
              <line x1="12" x2="12.01" y1="17" y2="17"/>
            </svg>
            {{ statusLabel }}
          </span>
        </div>
      </div>

      <!-- Body -->
      <div class="p-6 space-y-6" [style]="bodyStyle">
        <!-- Market Analysis Section -->
        <div>
          <div class="flex items-center gap-2 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #2563eb;">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
            <h4 class="font-semibold" [style]="sectionTitleStyle">Market Analysis</h4>
          </div>
          <div>
            @for (item of marketAnalysisItems; track item) {
              <div class="flex items-start gap-3 p-3 rounded-lg" [style]="marketItemStyle">
                <div class="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-blue-500"></div>
                <p class="text-sm" [style]="itemTextStyle">{{ item }}</p>
              </div>
            }
          </div>
        </div>

        <!-- Action Items Section -->
        <div>
          <div class="flex items-center gap-2 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #16a34a;">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="6"/>
              <circle cx="12" cy="12" r="2"/>
            </svg>
            <h4 class="font-semibold" [style]="sectionTitleStyle">Action Items</h4>
          </div>
          <div>
            @for (item of actionItems; track item) {
              <div class="flex items-start gap-3 p-3 rounded-lg" [style]="actionItemStyle">
                <div class="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-green-500"></div>
                <p class="text-sm" [style]="itemTextStyle">{{ item }}</p>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `
})
export class AIGrowthForecastComponent {
  @Input() customer!: Customer;
  @Input() contracts: Contract[] = [];
  @Input() plantingIntentions: PlantingIntention[] = [];
  @Input() notes: Note[] = [];

  private themeService = inject(ThemeService);

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  // Container styling
  get containerStyle(): string {
    return this.isDarkMode
      ? 'background: #1f2937; border-color: #374151;'
      : 'background: white; border-color: #e5e7eb;';
  }

  // Header gradient - Light: yellow, Dark: dark amber/brown
  get headerStyle(): string {
    return this.isDarkMode
      ? 'background: linear-gradient(145deg, #451a03 0%, #371707 50%, #1c0a00 100%); border-bottom: 1px solid #78350f;'
      : 'background: #fefce8;';
  }

  // Body background
  get bodyStyle(): string {
    return this.isDarkMode
      ? 'background: #1f2937;'
      : 'background: white;';
  }

  // Icon background
  get iconBgStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(251, 191, 36, 0.2);'
      : 'background: rgba(251, 191, 36, 0.3);';
  }

  // Icon color
  get iconColorStyle(): string {
    return this.isDarkMode
      ? 'color: #fbbf24;'
      : 'color: #d97706;';
  }

  // Title color
  get titleStyle(): string {
    return this.isDarkMode
      ? 'color: #fde68a;'
      : 'color: #111827;';
  }

  // Subtitle color
  get subtitleColorStyle(): string {
    return this.isDarkMode
      ? 'color: #fbbf24;'
      : 'color: #6b7280;';
  }

  // Badge styling
  get badgeStatusStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(251, 191, 36, 0.15); color: #fcd34d; border: 1px solid rgba(251, 191, 36, 0.3);'
      : 'background: #fef3c7; color: #d97706; border: 1px solid #fcd34d;';
  }

  get badgeIconStyle(): string {
    return this.isDarkMode
      ? 'color: #fcd34d;'
      : 'color: #d97706;';
  }

  // Section title
  get sectionTitleStyle(): string {
    return this.isDarkMode
      ? 'color: white;'
      : 'color: #111827;';
  }

  // Market Analysis item - Blue
  get marketItemStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(30, 58, 138, 0.3); border-left: 4px solid #60a5fa; margin-bottom: 16px;'
      : 'background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border-left: 4px solid #3b82f6; margin-bottom: 16px;';
  }

  // Action item - Green
  get actionItemStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(20, 83, 45, 0.3); border-left: 4px solid #4ade80; margin-bottom: 16px;'
      : 'background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); border-left: 4px solid #22c55e; margin-bottom: 16px;';
  }

  // Item text
  get itemTextStyle(): string {
    return this.isDarkMode
      ? 'color: #e5e7eb;'
      : 'color: #374151;';
  }

  get statusLabel(): string {
    const daysSinceContact = this.getDaysSinceLastContact();
    if (daysSinceContact > 90) return 'Needs Attention';
    if (daysSinceContact > 30) return 'Monitor';
    return 'On Track';
  }

  private getDaysSinceLastContact(): number {
    if (this.notes.length === 0) return 999;
    const sorted = [...this.notes].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const lastNote = sorted[0];
    return Math.floor((Date.now() - new Date(lastNote.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  }

  get marketAnalysisItems(): string[] {
    const items: string[] = [];

    // Volume analysis
    items.push('Contract volumes have remained relatively stable year-over-year.');

    // Market share analysis
    const totalProjected = this.plantingIntentions.reduce((sum, p) => sum + (p.acres * p.estimatedYield), 0);
    const totalContracted = this.contracts
      .filter(c => c.status === 'Active' || c.status === 'Pending')
      .reduce((sum, c) => sum + c.quantity, 0);

    if (totalProjected > 0) {
      const marketShare = (totalContracted / totalProjected) * 100;
      if (marketShare >= 70) {
        items.push(`Strong ${Math.floor(marketShare)}% market share demonstrates excellent originator relationship.`);
      } else if (marketShare >= 40) {
        items.push(`Moderate ${Math.floor(marketShare)}% market share indicates room for growth.`);
      } else {
        items.push(`Low ${Math.floor(marketShare)}% market share presents significant opportunity.`);
      }
    }

    // Engagement analysis
    const daysSinceContact = this.getDaysSinceLastContact();
    if (daysSinceContact > 90) {
      items.push(`No recent engagement in the past ${daysSinceContact} days — relationship may be at risk.`);
    } else if (daysSinceContact > 30) {
      items.push(`Last engagement was ${daysSinceContact} days ago — consider scheduling follow-up.`);
    } else {
      items.push('Recent engagement indicates healthy relationship status.');
    }

    return items;
  }

  get actionItems(): string[] {
    const items: string[] = [];

    const daysSinceContact = this.getDaysSinceLastContact();
    if (daysSinceContact > 30) {
      items.push('PRIORITY: Schedule immediate contact to maintain relationship strength.');
    }

    // Revenue opportunity
    const totalProjected = this.plantingIntentions.reduce((sum, p) => sum + (p.acres * p.estimatedYield), 0);
    const totalContracted = this.contracts
      .filter(c => c.status === 'Active' || c.status === 'Pending')
      .reduce((sum, c) => sum + c.quantity, 0);
    const uncontracted = totalProjected - totalContracted;

    if (uncontracted > 0) {
      const avgPrice = this.contracts.length > 0
        ? this.contracts.reduce((sum, c) => sum + c.price, 0) / this.contracts.length
        : 5.00;
      const revenueOpportunity = uncontracted * avgPrice;
      items.push(`Revenue opportunity: ${this.formatCurrency(revenueOpportunity)} in uncontracted bushels at average pricing.`);
    }

    // Contract renewals
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringContracts = this.contracts.filter(c =>
      new Date(c.deliveryEnd) <= thirtyDaysFromNow && c.status === 'Active'
    ).length;

    if (expiringContracts > 0) {
      items.push(`Review ${expiringContracts} contract(s) expiring within 30 days for renewal discussions.`);
    }

    if (items.length === 0) {
      items.push('Continue current engagement strategy — relationship is healthy.');
    }

    return items;
  }

  private formatCurrency(amount: number): string {
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `$${Math.floor(amount / 1000)}K`;
    }
    return `$${amount.toLocaleString()}`;
  }
}
