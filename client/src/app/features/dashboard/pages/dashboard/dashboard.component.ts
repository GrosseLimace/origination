import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal, computed, effect, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { AppStateService, DashboardCacheEntry } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, Contract, PlantingIntention, StoredGrain, DashboardPlantingEstimate, DashboardMarketShare, DashboardActualHarvest, DashboardSummary, Commodity } from '@models';
import { buildLbsPerBushelMap } from '@shared/utils/production-coverage';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';
import { commodityColor, commodityRowClass } from '@shared/utils/commodity-color';
import { CommodityChipClassPipe } from '@shared/pipes/commodity-chip-class.pipe';
import { plantingCategory } from '@shared/utils/planting-category';
import { inSelectedTradeUnits } from '@shared/utils/planting-trade-unit-filter';
import { dashboardCropKey, formatAcres, formatK, getFormattedLocation, getInitials, toTitleCase } from '../../utils/dashboard-format';
import {
  buildContractCommodityLegend, buildContractCoverageRows, buildContractStatus, buildCropDistribution, buildHarvestTimeline,
  buildSalesOpportunities, contractedBushelsByCategory, filterContractsForYear,
} from '../../utils/dashboard-contracts';
import {
  ProducerTabRow, applyProducerFilters, buildCustomerCropsById, buildLastContactByCustomer, buildProducersWithIntentionsRows,
  buildProducersWithoutIntentionsRows, narrowProducerRowsToChip, sortProducerRows, withIntentionsChipOptions,
  withoutIntentionsChipOptions,
} from '../../utils/dashboard-producers';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, TradeUnitSelectorComponent, CommodityChipClassPipe],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent {
  private readonly apiService = inject(ApiService);
  private readonly appStateService = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly usageTracking = inject(UsageTrackingService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Read directly from appState — DataPreloadService populates these on TU change
  readonly customers = this.appStateService.customers;
  readonly contracts = this.appStateService.contracts;
  readonly plantingIntentions = this.appStateService.plantingIntentions;

  // Crop-year contracts from base.Contract (open + closed). Loaded reactively when the
  // user changes the selected planting year or trade unit selection. Used by the
  // Harvest & Contracts tab so older planting years still surface closed historical contracts
  // that vw_CurrentContracts (which feeds appState.contracts) has filtered out.
  private readonly _cropYearContracts = signal<Contract[]>([]);

  /** True when the crop-year contract read failed, so Harvest & Contracts is missing data rather than
   *  reporting genuine zeros. Dashboard-scoped: the trade-unit-wide flag drives Build-a-List, and this
   *  read says nothing about that list. */
  readonly cropYearLoadFailed = signal(false);
  private readonly _customerIdSet = computed(() => new Set(this.customers().map(c => c.id)));
  // Planting rows are tagged with the trade unit they were recorded for, and every acre figure on
  // this page counts a row only under that trade unit (see inSelectedTradeUnits). A producer on
  // Pratt and Tribune therefore contributes only Pratt acres to the Pratt view. In "All Producers"
  // mode there is no territory, so the set is empty and no row is filtered out.
  private readonly _scopedTradeUnitSet = computed(() =>
    this.appStateService.allProducersMode()
      ? new Set<string>()
      : new Set(this.appStateService.inScopeTradeUnitCodes())
  );
  private _inScope(p: PlantingIntention, customerIdSet: Set<number>, tradeUnitSet: Set<string>): boolean {
    return customerIdSet.has(p.customerId) && inSelectedTradeUnits(p, tradeUnitSet);
  }
  readonly storedGrain = computed(() => {
    const customerIds = new Set(this.appStateService.customers().map(c => c.id));
    return this.appStateService.storedGrain().filter(s => customerIds.has(s.customerId));
  });
  allCommodities = signal<Commodity[]>([]);

  get selectedTradeUnits(): string[] {
    return this.appStateService.selectedTradeUnits();
  }

  private readonly _localLoading = signal(false);
  // The dashboard doesn't use tickets, so it shouldn't wait on them. Gate on the data it
  // actually renders (customers + contracts) plus its own summary fetch — NOT the global
  // dataLoading, which also waits on today's tickets (a slow ODS scan).
  readonly loading = computed(() =>
    this.appStateService.customersLoading()
    || this.appStateService.contractsLoading()
    || this._localLoading());
  totalAcres = signal(0);
  activeContracts = signal(0);
  totalContractValue = signal(0);

  cropDistribution = signal<{ name: string; bushels: number; percentage: number; color: string }[]>([]);
  contractStatus = signal<{ name: string; count: number; dotColor: string }[]>([]);

  // Planting Intentions section state
  savedYieldEstimates = signal<DashboardPlantingEstimate[]>([]);
  savedMarketShares = signal<DashboardMarketShare[]>([]);
  savedActualHarvest = signal<DashboardActualHarvest[]>([]);

  // Table 5: Actual harvest edit state
  harvestEditMode = signal(false);
  tempHarvestMap = signal<Record<number, string>>({});
  showAddHarvestRow = signal(false);
  newHarvestCrop = signal('');
  newHarvestBushels = signal('');
  harvestSaving = signal(false);
  confirmDeleteHarvestRow = signal<{ id: number; cropCategory: string } | null>(null);

  // Table 1: Yield rows (crop code level)
  yieldRows = signal<{ cropCode: string; cropName: string; category: string; totalAcres: number; yieldEstimate: number | null }[]>([]);

  // Tables 2-4: Category rows
  categoryRows = signal<{ category: string; totalEstimatedProduction: number; marketSharePct: number | null; estimatedHarvestHandle: number }[]>([]);

  availablePlantingYears = signal<number[]>([]);
  selectedPlantingYear = signal<number>(new Date().getFullYear());

  plantingIntentionsExpanded = signal(false);
  showSeasonTargets = signal(false);

  // Tab / filter state
  activeTab = signal<'byCrop' | 'producers' | 'harvestContracts'>('byCrop');

  selectDashboardTab(tabId: 'byCrop' | 'producers' | 'harvestContracts'): void {
    this.activeTab.set(tabId);
    const subFeatureMap: Record<string, string> = {
      byCrop: 'by-crop',
      producers: 'producers-and-intentions',
      harvestContracts: 'harvest-contracts'
    };
    this.usageTracking.trackDashboardTabClick(subFeatureMap[tabId]);
  }

  goToCustomerProfile(customerId: number): void {
    // Pass the customerId as targetId so the Usage Dashboard's customer-name
    // resolver can render the producer's name in the Recent Activity table.
    this.usageTracking.postClickEvent('interaction', 'dashboard', 'producer-row-click', customerId.toString());
    this.router.navigate(['/'], {
      queryParams: { customerId, tab: 'planting', year: this.selectedPlantingYear() }
    });
  }

  toggleProducerSort(key: 'acres' | 'production'): void {
    if (this.producerSortKey() === key) {
      this.producerSortDir.set(this.producerSortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.producerSortKey.set(key);
      this.producerSortDir.set('desc');
    }
  }

  clearProducerFilters(): void {
    this.producerSearch.set('');
    this.producerCropFilter.set('');
  }

  /** Last-contact display for a customer — shown only on the "without intentions" producer view. */
  getLastContactInfo(customerId: number): { text: string; colorClass: string; daysAgo: number } {
    // Reads only the last-contact aggregate; if that failed to load, "no row" means unknown.
    const unknown = this.appStateService.noteLastContactsLoadFailed() && this.appStateService.noteLastContacts().length === 0;
    return this._lastContactByCustomer().get(customerId)
      ?? (unknown
        ? { text: 'Last contact unavailable', colorClass: 'text-gray-400 dark:text-gray-500', daysAgo: Infinity }
        : { text: 'Never contacted', colorClass: 'text-scoular-red', daysAgo: Infinity });
  }

  selectedCropFilter = signal('');

  readonly tabs = [
    { id: 'byCrop' as const, label: 'By Crop' },
    { id: 'producers' as const, label: 'Producers & Planting Intentions' },
    { id: 'harvestContracts' as const, label: 'Harvest & Contracts' },
  ];

  // Producers tab — local filter state
  producerView = signal<'with' | 'without'>('with');
  producerSearch = signal('');
  producerCropFilter = signal<string>('');
  producerSortKey = signal<'acres' | 'production'>('acres');
  producerSortDir = signal<'asc' | 'desc'>('desc');

  estimatesSaving = signal(false);

  // Buffered user edits. Entries here = unsaved changes. Cleared on Save success or Cancel.
  tempYieldMap = signal<Record<string, number | null>>({});
  tempMarketShareMap = signal<Record<string, number | null>>({});

  readonly seasonTargetsDirty = computed(() =>
    Object.keys(this.tempYieldMap()).length > 0 ||
    Object.keys(this.tempMarketShareMap()).length > 0
  );

  // Pre-indexed commodity lookup — computed so it's stable within a CD cycle (prevents NG0100)
  private readonly _commodityByCode = computed(() => new Map(this.allCommodities().map(c => [c.code, c])));

  // Memoized trade unit key — avoids re-deriving sorted string 10+ times per cycle
  readonly tradeUnitKey = computed(() => [...this.appStateService.selectedTradeUnits()].sort().join(','));

  // Pre-indexed intentions by crop key — O(n) lookup instead of O(n²) in cropDetailsRows
  private readonly _intentionsByCropKey = computed(() => {
    const map = new Map<string, PlantingIntention[]>();
    for (const p of this.filteredIntentionsForYear()) {
      const commodity = this._commodityByCode().get(p.crop);
      const category = plantingCategory(p, commodity);
      const key = this.selectedCropFilter()
        ? dashboardCropKey(p.type, category)
        : category;
      const arr = map.get(key);
      if (arr) arr.push(p); else map.set(key, [p]);
    }
    return map;
  });

  // Pre-indexed contracted quantity by resolved category — uses Commodities table lookup
  // so contracts group by the same category name as planting intentions.
  private readonly _contractedByCategory = computed(() =>
    contractedBushelsByCategory(
      this.contractsForYear(),
      this._commodityByCode(),
      buildLbsPerBushelMap(this.appStateService.commodityConversions())));

  // Data-ready guard — skip expensive computations until commodities are loaded
  private readonly _dataReady = computed(() =>
    this.allCommodities().length > 0 || !this.appStateService.dataLoading()
  );

  // Request-ID pattern for concurrent load handling
  private _loadRequestId = 0;

  // Debounce flag — collapses burst signal updates (up to 5 on load) into one recalculation
  private _recalcPending = false;

  // =========================================================================
  // Computed signals — cached derived data (replaces get accessors)
  // =========================================================================

  // Actual harvest rows (Table 5)
  readonly actualHarvestRows = computed(() =>
    [...this.savedActualHarvest()]
      .filter(h => h.tradeUnitKey === this.tradeUnitKey() && h.plantingYear === this.selectedPlantingYear() - 1)
      .sort((a, b) => a.cropCategory.localeCompare(b.cropCategory))
      .map(h => ({ id: h.id, cropCategory: h.cropCategory, bushels: h.bushels }))
  );

  readonly usedHarvestCrops = computed(() =>
    new Set(this.actualHarvestRows().map(r => r.cropCategory))
  );

  private static readonly _HARVEST_EXCLUDED_CATEGORIES = ['transportation', 'currency', 'feed & fert ingredients'];

  readonly availableHarvestCropCategories = computed(() => {
    const all = [...new Set(this.allCommodities().map(c => c.category).filter(Boolean) as string[])].sort();
    return all.filter(cat =>
      !this.usedHarvestCrops().has(cat) &&
      !DashboardComponent._HARVEST_EXCLUDED_CATEGORIES.includes(cat.toLowerCase())
    );
  });

  readonly actualMarketShareRows = computed(() => {
    const allCrops = new Set<string>();
    for (const r of this.actualHarvestRows()) allCrops.add(r.cropCategory);
    for (const r of this.categoryRows()) allCrops.add(r.category);

    return [...allCrops].sort().map(crop => {
      const harvestRow = this.actualHarvestRows().find(r => r.cropCategory === crop);
      const prodRow = this.categoryRows().find(r => r.category === crop);
      const harvestBushels = harvestRow?.bushels ?? 0;
      const totalEstimatedProduction = prodRow?.totalEstimatedProduction ?? 0;
      const pct = totalEstimatedProduction > 0
        ? (harvestBushels / totalEstimatedProduction) * 100
        : null;
      return { cropCategory: crop, harvestBushels, totalEstimatedProduction, pct };
    });
  });

  readonly filteredIntentionsForYear = computed(() => {
    const customerIdSet = this._customerIdSet();
    const tradeUnitSet = this._scopedTradeUnitSet();
    return this.plantingIntentions().filter(p => {
      if (+p.plantingYear !== +this.selectedPlantingYear()) return false;
      if (!this._inScope(p, customerIdSet, tradeUnitSet)) return false;
      if (this.selectedCropFilter()) {
        const commodity = this._commodityByCode().get(p.crop);
        const category = plantingCategory(p, commodity);
        if (category !== this.selectedCropFilter()) return false;
      }
      return true;
    });
  });

  readonly totalAcresForYear = computed(() =>
    this.filteredIntentionsForYear().reduce((sum, p) => sum + p.acres, 0)
  );

  readonly acresTrend = computed(() => {
    const prevYear = this.selectedPlantingYear() - 1;
    const customerIdSet = this._customerIdSet();
    const tradeUnitSet = this._scopedTradeUnitSet();
    const prevAcres = this.plantingIntentions()
      .filter(p => +p.plantingYear === prevYear && this._inScope(p, customerIdSet, tradeUnitSet))
      .reduce((sum, p) => sum + p.acres, 0);
    if (prevAcres === 0) return null;
    return ((this.totalAcresForYear() - prevAcres) / prevAcres) * 100;
  });

  private readonly _yieldEstimateMap = computed(() => {
    const map = new Map<string, number | null>();
    for (const e of this.savedYieldEstimates()) {
      map.set(e.crop, e.yieldEstimate ?? null);
    }
    return map;
  });

  private readonly intentionProductionPairs = computed(() => {
    const yieldMap = this._yieldEstimateMap();
    return this.filteredIntentionsForYear().map(p => {
      const commodity = this._commodityByCode().get(p.crop);
      const category = plantingCategory(p, commodity);
      const cropKey = dashboardCropKey(p.type, category);
      return { acres: p.acres, yieldEst: yieldMap.get(cropKey) ?? null };
    });
  });

  readonly projectedProductionFormatted = computed(() => {
    const total = this.intentionProductionPairs()
      .filter(p => p.yieldEst != null)
      .reduce((sum, p) => sum + p.acres * p.yieldEst!, 0);
    return this.formatK(Math.round(total));
  });

  readonly averageYield = computed(() => {
    const pairs = this.intentionProductionPairs().filter(p => p.yieldEst != null);
    const totalAcres = pairs.reduce((sum, p) => sum + p.acres, 0);
    const totalProd = pairs.reduce((sum, p) => sum + p.acres * p.yieldEst!, 0);
    return totalAcres > 0 ? Math.round(totalProd / totalAcres) : 0;
  });

  readonly activeGrowers = computed(() =>
    new Set(this.filteredIntentionsForYear().map(p => p.customerId)).size
  );

  readonly availableCrops = computed(() => {
    const customerIdSet = this._customerIdSet();
    const tradeUnitSet = this._scopedTradeUnitSet();
    const crops = new Set<string>();

    for (const p of this.plantingIntentions()) {
      if (!this._inScope(p, customerIdSet, tradeUnitSet)) continue;
      const commodity = this._commodityByCode().get(p.crop);
      const category = plantingCategory(p, commodity);
      if (category) crops.add(toTitleCase(category));
    }

    // Contracts come from ODS, where strings are stored ALL-CAPS ("WHEAT",
    // "HARD RED WINTER WHEAT"). Title-case them on the way into the dropdown
    // so they merge with the already-Title-Cased planting-intention categories
    // instead of appearing as duplicate "WHEAT" / "Wheat" options.
    for (const c of this.contracts()) {
      const group = c.commodityGroup || c.commodityDescription;
      if (group) crops.add(toTitleCase(group));
    }

    return [...crops].sort();
  });

  readonly cropBreakdown = computed(() => {
    // Track the underlying crop CATEGORY per row so color is by crop, not sort position —
    // e.g. "Irrigated Corn" and "Dryland Corn" stay as separate rows but both color as Corn.
    const cropMap = new Map<string, { acres: number; category: string }>();
    for (const p of this.filteredIntentionsForYear()) {
      const commodity = this._commodityByCode().get(p.crop);
      const category = plantingCategory(p, commodity);
      const key = this.selectedCropFilter()
        ? dashboardCropKey(p.type, category)
        : category;
      const entry = cropMap.get(key);
      if (entry) entry.acres += p.acres;
      else cropMap.set(key, { acres: p.acres, category });
    }
    const total = [...cropMap.values()].reduce((a, b) => a + b.acres, 0);
    return [...cropMap.entries()]
      .sort((a, b) => b[1].acres - a[1].acres)
      .map(([name, { acres, category }]) => {
        const color = commodityColor(category); // shared per-crop color (same everywhere)
        return {
          name,
          acres,
          pct: total > 0 ? Math.round((acres / total) * 100) : 0,
          barColor: color.bar,
          dotColor: color.bar,
          hex: color.hex
        };
      });
  });

  readonly maxCropAcres = computed(() =>
    Math.max(...this.cropBreakdown().map(c => c.acres), 1)
  );

  readonly cropDistributionGradient = computed(() => {
    if (this.cropBreakdown().length === 0) return 'conic-gradient(#e5e7eb 0deg 360deg)';
    let deg = 0;
    const stops: string[] = [];
    for (const c of this.cropBreakdown()) {
      const end = deg + (c.pct / 100) * 360;
      stops.push(`${c.hex} ${deg}deg ${end}deg`);
      deg = end;
    }
    if (deg < 360) stops.push(`${this.cropBreakdown()[0].hex} ${deg}deg 360deg`);
    return `conic-gradient(${stops.join(', ')})`;
  });

  readonly cropDetailsRows = computed(() => {
    const yieldMap = this._yieldEstimateMap();
    const intentionsMap = this._intentionsByCropKey();
    return this.cropBreakdown().map(c => {
      const matching = intentionsMap.get(c.name) || [];
      let totalProd = 0;
      let totalAcresWeighted = 0;
      for (const p of matching) {
        const commodity = this._commodityByCode().get(p.crop);
        const category = plantingCategory(p, commodity);
        const cropKey = dashboardCropKey(p.type, category);
        const yieldEst = yieldMap.get(cropKey);
        if (yieldEst != null) {
          totalProd += p.acres * yieldEst;
          totalAcresWeighted += p.acres;
        }
      }
      const avgYield = totalAcresWeighted > 0 ? Math.round(totalProd / totalAcresWeighted) : null;
      const production = totalProd > 0 ? Math.round(totalProd) : null;
      const growers = new Set(matching.map(p => p.customerId)).size;
      return { name: c.name, acres: c.acres, avgYield, production, growers, dotColor: c.dotColor };
    });
  });

  private readonly _customerById = computed(() => {
    const map = new Map<number, Customer>();
    for (const c of this.customers()) map.set(c.id, c);
    return map;
  });

  readonly producersWithIntentionsRows = computed(() =>
    buildProducersWithIntentionsRows(
      this.filteredIntentionsForYear(), this._yieldEstimateMap(), this._customerById(), this._commodityByCode()));

  // Combined crops per customer — mirrors build-list's resolution logic.
  private readonly _customerCropsById = computed(() =>
    buildCustomerCropsById(this.appStateService.producerDetails(), this.contracts(), this.customers()));

  readonly producersWithoutIntentionsRows = computed(() =>
    buildProducersWithoutIntentionsRows({
      plantingIntentions: this.plantingIntentions(),
      customers: this.customers(),
      year: this.selectedPlantingYear(),
      cropFilter: this.selectedCropFilter(),
      tradeUnitSet: this._scopedTradeUnitSet(),
      commodityByCode: this._commodityByCode(),
      cropsMap: this._customerCropsById(),
    }));

  // Apply search + (optional) chip filter. Chip filter is view-specific, so the inactive
  // view's count skips it — that's why the With count doesn't move when you toggle a chip
  // while sitting on the Without view, and vice versa.
  private _applyProducerFilters(
    rows: ProducerTabRow[],
    view: 'with' | 'without',
    opts: { applyChipFilter: boolean } = { applyChipFilter: true }
  ): ProducerTabRow[] {
    return applyProducerFilters(
      rows,
      view,
      this.producerSearch(),
      opts.applyChipFilter ? this.producerCropFilter() : '',
      !!this.selectedCropFilter());
  }

  readonly producerWithCount = computed(() =>
    this._applyProducerFilters(
      this.producersWithIntentionsRows(),
      'with',
      { applyChipFilter: this.producerView() === 'with' }
    ).length
  );
  readonly producerWithoutCount = computed(() =>
    this._applyProducerFilters(
      this.producersWithoutIntentionsRows(),
      'without',
      { applyChipFilter: this.producerView() === 'without' }
    ).length
  );

  // Last-contacted info per customer, from the last-contact aggregate (see buildLastContactByCustomer).
  private readonly _lastContactByCustomer = computed(() =>
    buildLastContactByCustomer(this.appStateService.noteLastContacts(), this.customers()));

  readonly producersTabRows = computed(() => {
    const view = this.producerView();
    const sortKey = this.producerSortKey();
    const dir = this.producerSortDir() === 'asc' ? 1 : -1;

    const source = view === 'with'
      ? this.producersWithIntentionsRows()
      : this.producersWithoutIntentionsRows();
    const rows: ProducerTabRow[] = this._applyProducerFilters(source, view);

    // When a chip is active on the With view, narrow each row's acres/production to the matching crop(s).
    const narrowed = narrowProducerRowsToChip(rows, view, this.producerCropFilter(), !!this.selectedCropFilter());
    return sortProducerRows(narrowed, sortKey, dir);
  });

  readonly showProducerTradeUnitColumn = computed(() =>
    this.appStateService.selectedTradeUnits().length > 1
  );

  // Crop chips — semantics differ between views (see withIntentionsChipOptions / withoutIntentionsChipOptions).
  readonly producerCropChipOptions = computed(() => {
    return this.producerView() === 'with'
      ? withIntentionsChipOptions(this.producersWithIntentionsRows(), !!this.selectedCropFilter())
      : withoutIntentionsChipOptions(this.producersWithoutIntentionsRows(), this.selectedCropFilter(), this._commodityByCode());
  });

  readonly contractsForYear = computed(() => {
    // Prefer the base.Contract feed for the selected year (open + closed historical).
    // Falls back to appState.contracts() while the crop-year fetch is in flight or empty
    // so the UI never goes blank during the swap.
    const cropYearContracts = this._cropYearContracts();
    const source = cropYearContracts.length > 0 ? cropYearContracts : this.contracts();
    return filterContractsForYear(source, this.selectedPlantingYear(), this.selectedCropFilter(), this._commodityByCode());
  });

  readonly harvestTimelineMonths = computed(() => buildHarvestTimeline(this.contractsForYear()));

  readonly harvestTimelineMax = computed(() =>
    Math.max(...this.harvestTimelineMonths().map(m => m.total), 1)
  );

  readonly harvestTimelineMidpoint = computed(() =>
    Math.floor(this.harvestTimelineMax() / 2)
  );

  readonly contractCommodityLegend = computed(() => buildContractCommodityLegend(this.harvestTimelineMonths()));

  readonly contractCoverageRows = computed(() =>
    buildContractCoverageRows(this.categoryRows(), this._contractedByCategory()));

  // In BUSHELS, like Contract Coverage beside it; contracts whose unit cannot be expressed in
  // bushels are left out and counted (see buildSalesOpportunities).
  private readonly _salesOpportunities = computed(() =>
    buildSalesOpportunities(this.contractsForYear(), buildLbsPerBushelMap(this.appStateService.commodityConversions())));

  readonly salesOpportunityRows = computed(() => this._salesOpportunities().rows);
  /** Contracts left out of Sales Opportunities because their unit cannot be shown in bushels. */
  readonly salesOpportunityExcluded = computed(() => this._salesOpportunities().excludedContracts);

  constructor() {
    const savedState = localStorage.getItem('plantingIntentionsExpanded');
    if (savedState !== null) {
      this.plantingIntentionsExpanded.set(savedState === 'true');
    }

    // Restore commodities + dashboard-specific data from cache if available, otherwise fetch.
    // The year has to match as well as the trade unit — the cached estimates/market shares/harvest
    // are year-specific, and selectedPlantingYear resets to the current year here while the cache
    // survives navigation, so a TU-only match re-applied whichever year was cached last.
    const cached = this.appStateService.dashboardCache();
    const tradeUnitsKey = this.tradeUnitKey();
    if (cached && cached.tradeUnitsKey === tradeUnitsKey && cached.year === this.selectedPlantingYear()) {
      this._restoreFromCache(cached);
    } else {
      this._loadLocalData();
    }

    // Fetch crop-year contracts from base.Contract whenever the selected planting year or
    // trade-unit selection changes. Powers the Harvest & Contracts tab so historical years
    // include closed contracts not present in vw_CurrentContracts.
    effect(() => {
      const year = this.selectedPlantingYear();
      const tus = this.appStateService.selectedTradeUnits();

      // Cleared on year/trade-unit change, so last year's failure does not caption this year's chart
      // while the new read is still in flight.
      this.cropYearLoadFailed.set(false);

      untracked(() => {
        this.apiService.getContractsByCropYear(year, tus.length > 0 ? tus : undefined)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: contracts => { this._cropYearContracts.set(contracts); this.cropYearLoadFailed.set(false); },
            error: () => {
              // Cleared, so Harvest & Contracts cannot show last year's numbers under this year's
              // heading. Flagged LOCALLY: this is the dashboard's own read, and the trade-unit-wide flag
              // drives Build-a-List's banner, which this says nothing about.
              this._cropYearContracts.set([]);
              this.cropYearLoadFailed.set(true);
            }
          });
      });
    });

    // Sync commodities from appState when DataPreloadService populates them.
    // This avoids a duplicate getCommodities() fetch — the dashboard uses what
    // DataPreloadService already fetched in its secondary group.
    effect(() => {
      const appCommodities = this.appStateService.commodities();
      untracked(() => {
        if (appCommodities.length > 0 && this.allCommodities().length === 0) {
          this.allCommodities.set(appCommodities);
        }
      });
    });

    // Recalculate metrics and yield rows whenever preloaded data or commodities change.
    // Guarded by _dataReady to avoid wasted cycles when commodities haven't loaded yet.
    // queueMicrotask debounce collapses burst signal arrivals into a single recalculation pass.
    // Note: storedGrain is intentionally NOT tracked here — it's not used in either calculation
    // and would cause an extra recalc when 100k+ stored grain records finish downloading.
    effect(() => {
      this.appStateService.customers();
      this.appStateService.contracts();
      this.appStateService.plantingIntentions();
      this.allCommodities();
      const ready = this._dataReady();
      untracked(() => {
        if (!ready) return;
        if (!this._recalcPending) {
          this._recalcPending = true;
          queueMicrotask(() => {
            this._recalcPending = false;
            this._calculateMetrics();
            this._calculateYieldRows();
          });
        }
      });
    });

    // Reload dashboard-specific data when trade units change.
    // Only fetch the 3 dashboard APIs (estimates/shares/harvest) — commodities and
    // planting intentions are handled by DataPreloadService's secondary group.
    let lastTuKey = tradeUnitsKey;
    effect(() => {
      const newKey = this.tradeUnitKey();
      if (newKey === lastTuKey) return;
      lastTuKey = newKey;
      untracked(() => {
        if (newKey) {
          // Use commodities from appState if available (DataPreloadService fetches them)
          const preloaded = this.appStateService.commodities();
          if (preloaded.length > 0) this.allCommodities.set(preloaded);
          this._loadDashboardData();
        }
      });
    });
  }

  togglePlantingIntentions(): void {
    this.plantingIntentionsExpanded.update(v => !v);
    localStorage.setItem('plantingIntentionsExpanded', this.plantingIntentionsExpanded().toString());
    if (this.plantingIntentionsExpanded()) {
      this.reloadPlantingIntentions();
    }
  }

  reloadPlantingIntentions(): void {
    // If appState already has planting intentions, skip re-fetching them — just refresh
    // the 3 dashboard-specific APIs (estimates, shares, harvest) which are year-specific.
    if (this.appStateService.plantingIntentions().length > 0) {
      this._loadDashboardData();
      return;
    }

    const requestId = ++this._loadRequestId;
    const key = this.tradeUnitKey();
    const year = this.selectedPlantingYear();
    this._localLoading.set(true);

    // PI not yet loaded — fetch PI and combined dashboard summary in parallel
    const emptySummary: DashboardSummary = { estimates: [], marketShares: [], actualHarvest: [] };
    forkJoin({
      pi: this.apiService.getPlantingIntentions(this.selectedTradeUnits)
        .pipe(catchError(() => of([] as PlantingIntention[]))),
      summary: key ? this.apiService.getDashboardSummary(key, year)
        .pipe(catchError(() => of(emptySummary))) : of(emptySummary),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ pi, summary }) => {
        if (requestId !== this._loadRequestId) return; // discard stale response
        this.appStateService.setPlantingIntentions(pi);
        this.savedYieldEstimates.set(summary.estimates);
        this.savedMarketShares.set(summary.marketShares);
        this.savedActualHarvest.set(summary.actualHarvest);
        this._calculateYieldRows();
        this._calculateCategoryRows();
        this._saveDashboardCache();
        this._localLoading.set(false);
      },
      error: () => {
        if (requestId !== this._loadRequestId) return;
        this._localLoading.set(false);
      }
    });
  }

  private _restoreFromCache(cached: DashboardCacheEntry): void {
    // customers/contracts/plantingIntentions/storedGrain come from appState (no restore needed)
    this.allCommodities.set(cached.commodities);
    this.savedYieldEstimates.set(cached.savedYieldEstimates);
    this.savedMarketShares.set(cached.savedMarketShares);
    this.savedActualHarvest.set(cached.savedActualHarvest);
    this._calculateMetrics();
    this._calculateYieldRows();
    this._calculateCategoryRows();
  }

  private _saveDashboardCache(): void {
    this.appStateService.setDashboardCache({
      tradeUnitsKey: this.tradeUnitKey(),
      year: this.selectedPlantingYear(),
      customers: this.customers(),
      contracts: this.contracts(),
      plantingIntentions: this.plantingIntentions(),
      storedGrain: this.storedGrain(),
      commodities: this.allCommodities(),
      savedYieldEstimates: this.savedYieldEstimates(),
      savedMarketShares: this.savedMarketShares(),
      savedActualHarvest: this.savedActualHarvest(),
      loadedAt: new Date()
    });
  }

  private _loadLocalData(): void {
    const requestId = ++this._loadRequestId;
    this._localLoading.set(true);

    const preloaded = this.appStateService.commodities();
    const commodities$ = preloaded.length > 0
      ? of(preloaded)
      : this.apiService.getCommodities().pipe(catchError(() => of([] as Commodity[])));

    const key = this.tradeUnitKey();
    const year = this.selectedPlantingYear();

    if (!key) {
      // No trade unit — just load commodities
      commodities$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(c => {
        if (requestId !== this._loadRequestId) return;
        this.allCommodities.set(c);
        if (preloaded.length === 0) this.appStateService.setCommodities(c);
        this.savedYieldEstimates.set([]);
        this.savedMarketShares.set([]);
        this.savedActualHarvest.set([]);
        this._localLoading.set(false);
      });
      return;
    }

    // If DataPreloadService already fetched the summary for this TU+year, use it
    // and only wait for commodities (which are also likely already in AppState).
    const preloadedSummary = this.appStateService.preloadedDashboardSummary();
    const summaryReady = preloadedSummary && preloadedSummary.tradeUnitsKey === key && preloadedSummary.year === year;

    if (summaryReady && preloaded.length > 0) {
      // Both commodities and dashboard summary are already in memory — no HTTP calls needed
      this.allCommodities.set(preloaded);
      this.savedYieldEstimates.set(preloadedSummary!.estimates);
      this.savedMarketShares.set(preloadedSummary!.marketShares);
      this.savedActualHarvest.set(preloadedSummary!.actualHarvest);
      this._calculateYieldRows();
      this._calculateCategoryRows();
      this._saveDashboardCache();
      this._localLoading.set(false);
      return;
    }

    // Fetch commodities + combined dashboard summary in parallel (eliminates waterfall)
    const emptySummary: DashboardSummary = { estimates: [], marketShares: [], actualHarvest: [] };
    const summary$ = summaryReady
      ? of(preloadedSummary! as DashboardSummary)
      : this.apiService.getDashboardSummary(key, year).pipe(catchError(() => of(emptySummary)));

    forkJoin({
      commodities: commodities$,
      summary: summary$
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ commodities, summary }) => {
        if (requestId !== this._loadRequestId) return; // discard stale response
        this.allCommodities.set(commodities);
        if (preloaded.length === 0) this.appStateService.setCommodities(commodities);
        this.savedYieldEstimates.set(summary.estimates);
        this.savedMarketShares.set(summary.marketShares);
        this.savedActualHarvest.set(summary.actualHarvest);
        this._saveDashboardCache();
        this._localLoading.set(false);
      },
      error: () => {
        if (requestId !== this._loadRequestId) return;
        this._localLoading.set(false);
      }
    });
  }

  // Fetches only the three year-specific dashboard API calls in parallel.
  // Used for year changes and planting intentions reload (not initial load).
  private _loadDashboardData(): void {
    const key = this.tradeUnitKey();
    const year = this.selectedPlantingYear();
    if (!key) {
      this.savedYieldEstimates.set([]);
      this.savedMarketShares.set([]);
      this.savedActualHarvest.set([]);
      this._calculateYieldRows();
      this._calculateCategoryRows();
      this._localLoading.set(false);
      return;
    }

    // Use pre-fetched data from DataPreloadService if available and fresh (same TU + year)
    const preloaded = this.appStateService.preloadedDashboardSummary();
    if (preloaded && preloaded.tradeUnitsKey === key && preloaded.year === year) {
      this.savedYieldEstimates.set(preloaded.estimates);
      this.savedMarketShares.set(preloaded.marketShares);
      this.savedActualHarvest.set(preloaded.actualHarvest);
      this._calculateYieldRows();
      this._calculateCategoryRows();
      this._saveDashboardCache();
      this._localLoading.set(false);
      return;
    }

    // Stale-response guard, matching reloadPlantingIntentions/_loadLocalData. This runs on every
    // year and trade-unit change, so without it rapid navigation lets an older response land after
    // a newer one and overwrite current estimates/market-share/harvest figures with stale data.
    const requestId = ++this._loadRequestId;

    this._localLoading.set(true);
    this.apiService.getDashboardSummary(key, year)
      .pipe(
        catchError(() => of<DashboardSummary>({ estimates: [], marketShares: [], actualHarvest: [] })),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe({
        next: (summary) => {
          if (requestId !== this._loadRequestId) return; // discard stale response
          this.savedYieldEstimates.set(summary.estimates);
          this.savedMarketShares.set(summary.marketShares);
          this.savedActualHarvest.set(summary.actualHarvest);
          this._calculateYieldRows();
          this._calculateCategoryRows();
          this._saveDashboardCache();
          this._localLoading.set(false);
        },
        error: () => {
          if (requestId !== this._loadRequestId) return;
          this._localLoading.set(false);
        }
      });
  }

  private _calculateMetrics(): void {
    const openContracts = this.contracts().filter(c => !c.closedDate);
    this.totalAcres.set(this.customers().reduce((sum, c) => sum + c.totalAcres, 0));
    this.activeContracts.set(openContracts.filter(c => c.status === 'Active').length);
    this.totalContractValue.set(openContracts.reduce((sum, c) => sum + (c.totalValue || 0), 0));

    // Shares are in bushels, so a tonnage commodity's slice is not sized by its ton count.
    this.cropDistribution.set(
      buildCropDistribution(this.contracts(), buildLbsPerBushelMap(this.appStateService.commodityConversions())));
    this.contractStatus.set(buildContractStatus(this.contracts()));
  }

  navigateToCustomer(customerId: number): void {
    this.router.navigate(['/'], { queryParams: { customerId } });
  }

  // =========================================================================
  // Planting Intentions - computed key and row logic
  // =========================================================================

  // tradeUnitKey is now a computed signal (line ~112)

  onPlantingYearChange(): void {
    this.selectedPlantingYear.set(+this.selectedPlantingYear());
    // Only refetch year-specific data (estimates/shares/harvest).
    // Planting intentions don't change by year — already in appState.
    this._loadDashboardData();
  }

  private _calculateYieldRows(): void {
    const customerIdSet = this._customerIdSet();
    const tradeUnitSet = this._scopedTradeUnitSet();

    const forGlobalTUs = this.plantingIntentions().filter(p =>
      this._inScope(p, customerIdSet, tradeUnitSet)
    );

    // Available years
    const years = [...new Set(forGlobalTUs.map(p => p.plantingYear))].sort((a, b) => b - a);
    this.availablePlantingYears.set(years);

    // Filter by selected year
    const filtered = forGlobalTUs.filter(p => +p.plantingYear === +this.selectedPlantingYear());

    // Group acres by combined type+category key (e.g. "Dryland Wheat", "Irrigated Corn")
    const cropAcresMap = new Map<string, number>();
    const cropCategoryMap = new Map<string, string>();
    for (const p of filtered) {
      const commodity = this._commodityByCode().get(p.crop);
      const category = plantingCategory(p, commodity);
      const cropKey = dashboardCropKey(p.type, category);
      cropAcresMap.set(cropKey, (cropAcresMap.get(cropKey) || 0) + p.acres);
      cropCategoryMap.set(cropKey, category);
    }

    // Use crop keys from planting intentions only
    const allCropCodes = new Set<string>(cropAcresMap.keys());
    const yieldMap = this._yieldEstimateMap();

    this.yieldRows.set(
      [...allCropCodes]
        .map(cropCode => ({
          cropCode,
          cropName: cropCode,
          category: cropCategoryMap.get(cropCode) || 'Unknown',
          totalAcres: cropAcresMap.get(cropCode) || 0,
          yieldEstimate: yieldMap.get(cropCode) ?? null
        }))
        // Group rows by commodity (all Corn variants together, then Soybeans, etc.), then by the
        // crop label within a commodity — instead of a flat alphabetical sort that splits e.g.
        // "Dryland Corn" and "Irrigated Corn" apart.
        .sort((a, b) => a.category.localeCompare(b.category) || a.cropName.localeCompare(b.cropName))
    );

    this._calculateCategoryRows();
  }

  private _calculateCategoryRows(): void {
    // Group yield rows by category, sum production
    const categoryMap = new Map<string, number>();
    for (const row of this.yieldRows()) {
      const production = (row.yieldEstimate != null && row.totalAcres > 0)
        ? row.totalAcres * row.yieldEstimate
        : 0;
      const current = categoryMap.get(row.category) || 0;
      categoryMap.set(row.category, current + production);
    }

    this.categoryRows.set(
      [...categoryMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, totalEstimatedProduction]) => {
          const savedShare = this.savedMarketShares().find(s => s.cropCategory === category);
          const marketSharePct = savedShare?.marketSharePct ?? null;
          const estimatedHarvestHandle = (marketSharePct != null && totalEstimatedProduction > 0)
            ? totalEstimatedProduction * (marketSharePct / 100)
            : 0;
          return { category, totalEstimatedProduction, marketSharePct, estimatedHarvestHandle };
        })
    );
  }

  loadDashboardEstimates(): void {
    const key = this.tradeUnitKey();
    if (!key) {
      this.savedYieldEstimates.set([]);
      this._calculateYieldRows();
      return;
    }
    this.apiService.getDashboardPlantingEstimates(key, this.selectedPlantingYear())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.savedYieldEstimates.set(data);
          this._calculateYieldRows();
          this._saveDashboardCache();
        },
        error: () => {
          this.savedYieldEstimates.set([]);
          this._calculateYieldRows();
        }
      });
  }

  loadDashboardMarketShares(): void {
    const key = this.tradeUnitKey();
    if (!key) {
      this.savedMarketShares.set([]);
      this._calculateCategoryRows();
      return;
    }
    this.apiService.getDashboardMarketShares(key, this.selectedPlantingYear())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.savedMarketShares.set(data);
          this._calculateCategoryRows();
          this._saveDashboardCache();
        },
        error: () => {
          this.savedMarketShares.set([]);
          this._calculateCategoryRows();
        }
      });
  }

  loadActualHarvest(): void {
    const key = this.tradeUnitKey();
    if (!key) {
      this.savedActualHarvest.set([]);
      return;
    }
    this.apiService.getDashboardActualHarvest(key, this.selectedPlantingYear() - 1)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.savedActualHarvest.set(data);
          this._saveDashboardCache();
        },
        error: () => {
          this.savedActualHarvest.set([]);
          this._saveDashboardCache();
        }
      });
  }

  // =========================================================================
  // Season Targets — batched Save / Cancel for both yield estimates and market share
  // =========================================================================

  saveSeasonTargets(): void {
    if (!this.seasonTargetsDirty()) return;
    const key = this.tradeUnitKey();
    if (!key) return;

    const yieldEdits = this.tempYieldMap();
    const shareEdits = this.tempMarketShareMap();
    const yieldEntries = Object.entries(yieldEdits);
    const shareEntries = Object.entries(shareEdits);

    const yieldPayload = yieldEntries.map(([crop, value]) => ({
      tradeUnitKey: key,
      crop,
      plantingYear: this.selectedPlantingYear(),
      yieldEstimate: value ?? null,
    }));
    const sharePayload = shareEntries.map(([cropCategory, value]) => ({
      tradeUnitKey: key,
      cropCategory,
      plantingYear: this.selectedPlantingYear(),
      marketSharePct: value ?? null,
    }));

    const yield$ = yieldPayload.length > 0
      ? this.apiService.upsertDashboardPlantingEstimates(yieldPayload)
      : of(null);
    const share$ = sharePayload.length > 0
      ? this.apiService.upsertDashboardMarketShares(sharePayload)
      : of(null);

    this.estimatesSaving.set(true);
    // Track one event per affected crop with what was set so the Usage Dashboard
    // shows "CORN — yield 180 bu/ac, 15% share" instead of an opaque save event.
    const allCrops = new Set<string>([...Object.keys(yieldEdits), ...Object.keys(shareEdits)]);
    for (const crop of allCrops) {
      const yieldVal = yieldEdits[crop];
      const shareVal = shareEdits[crop];
      const parts: string[] = [];
      if (yieldVal !== undefined && yieldVal !== null) parts.push(`yield ${yieldVal} bu/ac`);
      if (shareVal !== undefined && shareVal !== null) parts.push(`${shareVal}% share`);
      if (parts.length === 0) continue;
      this.usageTracking.postClickEvent('interaction', 'dashboard', 'set-season-targets', `${crop} — ${parts.join(', ')}`);
    }
    forkJoin([yield$, share$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.estimatesSaving.set(false);
          this.tempYieldMap.set({});
          this.tempMarketShareMap.set({});
          this.toastService.success('Season targets saved');
          if (yieldPayload.length > 0) this.loadDashboardEstimates();
          if (sharePayload.length > 0) this.loadDashboardMarketShares();
          this.showSeasonTargets.set(false);
        },
        error: () => {
          this.estimatesSaving.set(false);
          this.toastService.error('Failed to save season targets');
        },
      });
  }

  cancelSeasonTargetsEdits(): void {
    this.tempYieldMap.set({});
    this.tempMarketShareMap.set({});
  }

  // =========================================================================
  // Template-safe map update helpers (Angular templates cannot use computed
  // property key syntax like { [key]: value } in event bindings)
  // =========================================================================

  setTempYield(cropCode: string, value: number | null): void {
    this.tempYieldMap.update(m => ({ ...m, [cropCode]: value }));
  }

  setTempMarketShare(category: string, value: number | null): void {
    this.tempMarketShareMap.update(m => ({ ...m, [category]: value }));
  }

  /** Value to show in a yield input: the pending edit if one exists (including an
   *  explicit null/cleared value), otherwise the saved estimate. Distinguishing
   *  "no edit" (key absent) from "cleared" (key present, null) is what lets a user
   *  actually empty the field — a plain `?? saved` would snap it back. */
  yieldInputValue(cropCode: string, saved: number | null): number | null {
    const m = this.tempYieldMap();
    return cropCode in m ? m[cropCode] : saved;
  }

  marketShareInputValue(category: string, saved: number | null): number | null {
    const m = this.tempMarketShareMap();
    return category in m ? m[category] : saved;
  }

  /** Clears a yield/market-share field (marks it dirty with null → saved as cleared). */
  clearTempYield(cropCode: string): void {
    this.setTempYield(cropCode, null);
  }

  clearTempMarketShare(category: string): void {
    this.setTempMarketShare(category, null);
  }

  setTempHarvest(id: number, value: string): void {
    this.tempHarvestMap.update(m => ({ ...m, [id]: value }));
  }

  // =========================================================================
  // Row color coding (consistent category colors across all 6 tables)
  // =========================================================================


  readonly categoryColorMap = computed(() => {
    const map = new Map<string, string>();
    for (const r of this.categoryRows()) {
      // Shared per-crop tint so Season Targets rows match the crop's color everywhere else.
      map.set(r.category, `${commodityRowClass(r.category)} transition-colors`);
    }
    return map;
  });

  // =========================================================================
  // Actual harvest CRUD
  // =========================================================================

  startHarvestEdit(): void {
    const map: Record<number, string> = {};
    for (const row of this.actualHarvestRows()) {
      map[row.id] = row.bushels.toString();
    }
    this.tempHarvestMap.set(map);
    this.harvestEditMode.set(true);
  }

  cancelHarvestEdit(): void {
    this.harvestEditMode.set(false);
    this.tempHarvestMap.set({});
  }

  saveHarvestEdit(): void {
    const rows = this.actualHarvestRows();
    const items = rows
      .map(row => {
        const bushels = parseInt(this.tempHarvestMap()[row.id] ?? '', 10);
        return { tradeUnitKey: this.tradeUnitKey(), cropCategory: row.cropCategory, plantingYear: this.selectedPlantingYear() - 1, bushels };
      })
      .filter(item => !isNaN(item.bushels) && item.bushels >= 0);
    if (items.length === 0) { this.cancelHarvestEdit(); return; }
    this.harvestSaving.set(true);
    this.apiService.upsertDashboardActualHarvest(items).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.harvestSaving.set(false);
        this.harvestEditMode.set(false);
        this.tempHarvestMap.set({});
        this.loadActualHarvest();
      },
      error: () => {
        this.harvestSaving.set(false);
        this.toastService.error('Failed to save harvest data');
      }
    });
  }

  deleteHarvestRow(id: number): void {
    this.apiService.deleteDashboardActualHarvest(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadActualHarvest(),
        error: () => this.toastService.error('Failed to delete harvest row')
      });
  }

  addHarvestRow(): void {
    const bushels = parseInt(this.newHarvestBushels(), 10);
    if (!this.newHarvestCrop() || isNaN(bushels) || bushels < 0) return;
    const key = this.tradeUnitKey();
    this.harvestSaving.set(true);
    this.apiService.upsertDashboardActualHarvest([{
      tradeUnitKey: key,
      cropCategory: this.newHarvestCrop(),
      plantingYear: this.selectedPlantingYear() - 1,
      bushels
    }]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.harvestSaving.set(false);
        this.showAddHarvestRow.set(false);
        this.newHarvestCrop.set('');
        this.newHarvestBushels.set('');
        this.loadActualHarvest();
      },
      error: () => {
        this.harvestSaving.set(false);
        this.toastService.error('Failed to add harvest row');
      }
    });
  }

  // =========================================================================
  // Year navigation
  // =========================================================================

  prevYear(): void {
    this.selectedPlantingYear.update(y => y - 1);
    this.selectedCropFilter.set('');
    this.onPlantingYearChange();
  }

  nextYear(): void {
    this.selectedPlantingYear.update(y => y + 1);
    this.selectedCropFilter.set('');
    this.onPlantingYearChange();
  }

  goToSeasonTargets(): void {
    this.showSeasonTargets.set(true);
  }

  onCropFilterChange(): void {
    // Reset the producer crop chip filter — its valid values change when the top filter changes
    this.producerCropFilter.set('');
  }

  // =========================================================================
  // Formatting helpers (pure; see utils/dashboard-format)
  // =========================================================================

  readonly formatAcres = formatAcres;
  readonly formatK = formatK;
  readonly getInitials = getInitials;
  readonly getFormattedLocation = getFormattedLocation;
}
