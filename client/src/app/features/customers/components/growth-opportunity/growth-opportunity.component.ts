import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '@core/services/theme.service';
import { AppStateService } from '@core/services/app-state.service';
import { Commodity, Contract, Customer, DashboardPlantingEstimate, Note, PlantingIntention } from '@models';
import { buildProductionCoverage } from '@shared/utils/production-coverage';

/**
 * Growth Opportunity — how much of a producer's projected production Scoular has already contracted,
 * and how much is still available.
 *
 * Was "AI Growth Forecast", which was neither: its market-analysis list opened with a hardcoded
 * sentence and both of its interesting branches were gated behind `const totalProjected = 0`, so the
 * market-share and revenue-opportunity lines could never render. It also accepted a
 * `plantingIntentions` input it never read — this component now actually uses it.
 */
@Component({
  selector: 'app-growth-opportunity',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  host: { class: 'block' },
  templateUrl: './growth-opportunity.component.html'
})
export class GrowthOpportunityComponent {
  public customer = input.required<Customer>();
  public contracts = input<Contract[]>([]);
  public plantingIntentions = input<PlantingIntention[]>([]);
  public notes = input<Note[]>([]);
  public commodities = input<Commodity[]>([]);
  public yieldEstimates = input<DashboardPlantingEstimate[]>([]);
  /** Planting year the profile is scoped to; 0 means all years. */
  public plantingYear = input<number>(0);
  /** Every year this producer has planting intentions or contracts for, newest first. */
  public availableYears = input<number[]>([]);
  /** True while the yield estimates are still loading, so we don't flash "no estimate set". */
  public isLoadingEstimates = input<boolean>(false);

  /** Emitted when the user picks a season here. The profile owns the selection, so changing it in
   *  this panel also moves the Planting tab — one year, one answer, wherever you look at it. */
  public yearSelect = output<number>();

  private readonly themeService = inject(ThemeService);
  private readonly appState = inject(AppStateService);

  /** Projected production vs. contracted, per commodity. Shared with the print report via the
   *  profile, and unit-tested in production-coverage.spec.ts. */
  readonly coverage = computed(() => buildProductionCoverage({
    intentions: this.plantingIntentions(),
    contracts: this.contracts(),
    commodities: this.commodities(),
    yieldEstimates: this.yieldEstimates(),
    harvestWindows: this.appState.harvestWindows(),
    year: this.plantingYear(),
  }));

  /** True when there are intentions but no yield estimate has been entered for any of them — the
   *  panel can't project anything, and saying so beats rendering a row of zeros. */
  readonly hasNoYieldEstimates = computed(() =>
    this.coverage().byCommodity.length > 0
    && this.coverage().byCommodity.every(c => c.projectedYield == null));

  readonly daysSinceLastContact = computed(() => {
    const notes = this.notes();
    if (notes.length === 0) return null;
    const newest = notes.reduce((latest, n) =>
      new Date(n.createdAt).getTime() > new Date(latest.createdAt).getTime() ? n : latest);
    return Math.floor((Date.now() - new Date(newest.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  });

  readonly statusLabel = computed(() => {
    const days = this.daysSinceLastContact();
    if (days == null || days > 90) return 'Needs Attention';
    if (days > 30) return 'Monitor';
    return 'On Track';
  });

  /** Concrete next steps. Every item here is derived from real data — the old version's hardcoded
   *  "volumes have remained stable" line and its unreachable revenue figure are gone. */
  readonly actionItems = computed<string[]>(() => {
    const items: string[] = [];
    const days = this.daysSinceLastContact();
    const cov = this.coverage();

    if (days == null) {
      items.push('No notes logged yet — an introductory call would establish the relationship baseline.');
    } else if (days > 30) {
      items.push(`Last contact was ${days} days ago — schedule a follow-up to keep the relationship warm.`);
    }

    // Uncontracted bushels are only meaningful when the commodities share a unit; otherwise the
    // per-commodity rows above already tell the story without a bogus combined total.
    if (!cov.hasMixedUnits && cov.bushelsAvailable > 0 && cov.totalProjectedYield > 0) {
      const unit = cov.totalUnit ?? 'bu';
      const bushels = cov.bushelsAvailable.toLocaleString(undefined, {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
      items.push(`${bushels} ${unit} of projected production are still uncontracted.`);
    }

    if (this.hasNoYieldEstimates()) {
      items.push('Set a season target for these crops on the Planting Intentions dashboard to project production.');
    }

    const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const expiring = this.contracts().filter(c =>
      c.deliveryEnd && new Date(c.deliveryEnd) <= thirtyDaysOut && c.status === 'Active').length;
    if (expiring > 0) {
      items.push(`Review ${expiring} contract${expiring === 1 ? '' : 's'} with delivery ending within 30 days.`);
    }

    if (items.length === 0) {
      items.push('Nothing outstanding — engagement is current and production is well covered.');
    }
    return items;
  });

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  get containerStyle(): string {
    return this.isDarkMode
      ? 'background: #1f2937; border-color: #374151;'
      : 'background: white; border-color: #e5e7eb;';
  }

  get headerStyle(): string {
    return this.isDarkMode
      ? 'background: linear-gradient(145deg, #451a03 0%, #371707 50%, #1c0a00 100%); border-bottom: 1px solid #78350f;'
      : 'background: #fefce8;';
  }

  get bodyStyle(): string {
    return this.isDarkMode ? 'background: #1f2937;' : 'background: white;';
  }

  get iconBgStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(251, 191, 36, 0.2);'
      : 'background: rgba(251, 191, 36, 0.3);';
  }

  get iconColorStyle(): string {
    return this.isDarkMode ? 'color: #fbbf24;' : 'color: #d97706;';
  }

  get titleStyle(): string {
    return this.isDarkMode ? 'color: #fde68a;' : 'color: #111827;';
  }

  get subtitleColorStyle(): string {
    return this.isDarkMode ? 'color: #fbbf24;' : 'color: #6b7280;';
  }

  get badgeStatusStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(251, 191, 36, 0.15); color: #fcd34d; border: 1px solid rgba(251, 191, 36, 0.3);'
      : 'background: #fef3c7; color: #d97706; border: 1px solid #fcd34d;';
  }

  get badgeIconStyle(): string {
    return this.isDarkMode ? 'color: #fcd34d;' : 'color: #d97706;';
  }

  get sectionTitleStyle(): string {
    return this.isDarkMode ? 'color: white;' : 'color: #111827;';
  }

  get actionItemStyle(): string {
    return this.isDarkMode
      ? 'background: rgba(20, 83, 45, 0.3); border-left: 4px solid #4ade80; margin-bottom: 16px;'
      : 'background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); border-left: 4px solid #22c55e; margin-bottom: 16px;';
  }

  get itemTextStyle(): string {
    return this.isDarkMode ? 'color: #e5e7eb;' : 'color: #374151;';
  }

  get mutedTextStyle(): string {
    return this.isDarkMode ? 'color: #9ca3af;' : 'color: #6b7280;';
  }
}
