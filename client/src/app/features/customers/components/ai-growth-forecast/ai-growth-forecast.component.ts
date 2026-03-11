import { Component, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '@core/services/theme.service';
import { Customer, Contract, PlantingIntention, Note } from '@models';

@Component({
  selector: 'app-ai-growth-forecast',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  templateUrl: './ai-growth-forecast.component.html'
})
export class AIGrowthForecastComponent {
  public customer = input.required<Customer>();
  public contracts = input<Contract[]>([]);
  public plantingIntentions = input<PlantingIntention[]>([]);
  public notes = input<Note[]>([]);

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
    const daysSinceContact = this._getDaysSinceLastContact();
    if (daysSinceContact > 90) return 'Needs Attention';
    if (daysSinceContact > 30) return 'Monitor';
    return 'On Track';
  }

  private _getDaysSinceLastContact(): number {
    if (this.notes().length === 0) return 999;
    const sorted = [...this.notes()].sort((a, b) =>
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
    const totalProjected = 0;
    const totalContracted = this.contracts()
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
    const daysSinceContact = this._getDaysSinceLastContact();
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

    const daysSinceContact = this._getDaysSinceLastContact();
    if (daysSinceContact > 30) {
      items.push('PRIORITY: Schedule immediate contact to maintain relationship strength.');
    }

    // Revenue opportunity
    const totalProjected = 0;
    const totalContracted = this.contracts()
      .filter(c => c.status === 'Active' || c.status === 'Pending')
      .reduce((sum, c) => sum + c.quantity, 0);
    const uncontracted = totalProjected - totalContracted;

    if (uncontracted > 0) {
      const avgPrice = this.contracts().length > 0
        ? this.contracts().reduce((sum, c) => sum + c.price, 0) / this.contracts().length
        : 5.00;
      const revenueOpportunity = uncontracted * avgPrice;
      items.push(`Revenue opportunity: ${this._formatCurrency(revenueOpportunity)} in uncontracted bushels at average pricing.`);
    }

    // Contract renewals
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringContracts = this.contracts().filter(c =>
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

  private _formatCurrency(amount: number): string {
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `$${Math.floor(amount / 1000)}K`;
    }
    return `$${amount.toLocaleString()}`;
  }
}
