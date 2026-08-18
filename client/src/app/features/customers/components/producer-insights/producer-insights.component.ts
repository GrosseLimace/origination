import { Component, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '@core/services/theme.service';
import { AppStateService } from '@core/services/app-state.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain } from '@models';
import { buildLbsPerBushelMap, sumInBushels } from '@shared/utils/production-coverage';

@Component({
  selector: 'app-producer-insights',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  templateUrl: './producer-insights.component.html'
})
export class ProducerInsightsComponent {
  public customer = input.required<Customer>();
  public contracts = input<Contract[]>([]);
  /** Historical closed contracts from base.Contract, supplied by parent (fetched once, shared with pacing card). */
  public historicalContracts = input<Contract[]>([]);
  public tickets = input<Ticket[]>([]);
  public plantingIntentions = input<PlantingIntention[]>([]);
  public notes = input<Note[]>([]);
  public storedGrain = input<StoredGrain[]>([]);

  private themeService = inject(ThemeService);
  private readonly appState = inject(AppStateService);

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

  // Blue variant for the ACH Payment pill (distinct from the green eSign pill).
  get achBadgeStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4);'
      : 'background: rgba(255, 255, 255, 0.15); color: white; border: 1px solid rgba(255, 255, 255, 0.3);';
  }

  // Amber variant for the Check Payment pill (shown when the producer is not on ACH).
  get checkBadgeStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);'
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

  /** Open + historical merged (deduped by id). Historical comes from base.Contract via parent. */
  private get allContracts(): Contract[] {
    const open = this.contracts();
    const hist = this.historicalContracts();
    if (hist.length === 0) return open;
    const seen = new Set<number>(open.map(c => c.id));
    const merged = [...open];
    for (const h of hist) if (!seen.has(h.id)) { merged.push(h); seen.add(h.id); }
    return merged;
  }

  /** The calendar year this card reports on — always the current one, shown on the card so the
   *  figure can't be mistaken for all-time or for the crop year selected elsewhere on the page. */
  get currentYear(): number {
    return new Date().getFullYear();
  }

  /** Contracts whose delivery period falls in the current calendar year. */
  private get currentYearContracts() {
    const year = new Date().getFullYear();
    return this.allContracts.filter(c => {
      if (!c.deliveryStart && !c.deliveryEnd) return false;
      const start = c.deliveryStart ? new Date(c.deliveryStart) : new Date(c.deliveryEnd!);
      const end = c.deliveryEnd ? new Date(c.deliveryEnd) : new Date(c.deliveryStart!);
      return start.getFullYear() <= year && end.getFullYear() >= year;
    });
  }

  /** The "bushels contracted" stat card. Genuinely bushels — a raw quantity sum would add soybean
   *  meal in short tons and popcorn by the pound to it, under a label that says bushels, sitting
   *  directly above the Growth Opportunity panel that excludes them. */
  get totalContracted(): number {
    return sumInBushels(
      this.currentYearContracts,
      buildLbsPerBushelMap(this.appState.commodityConversions()),
    ).contracted;
  }

  get averageContractSize(): number {
    const list = this.currentYearContracts;
    if (list.length === 0) return 0;
    return this.totalContracted / list.length;
  }

  get totalInteractions(): number {
    return this.notes().length;
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
