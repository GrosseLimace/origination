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
import { Customer, Contract, PlantingIntention, StoredGrain, DashboardPlantingEstimate, DashboardMarketShare, DashboardActualHarvest, Commodity } from '@models';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, TradeUnitSelectorComponent],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent {
  private readonly apiService = inject(ApiService);
  private readonly appStateService = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Read directly from appState — DataPreloadService populates these on TU change
  readonly customers = this.appStateService.customers;
  readonly contracts = this.appStateService.contracts;
  readonly plantingIntentions = this.appStateService.plantingIntentions;
  private readonly _customerIdSet = computed(() => new Set(this.customers().map(c => c.id)));
  readonly storedGrain = computed(() => {
    const customerIds = new Set(this.appStateService.customers().map(c => c.id));
    return this.appStateService.storedGrain().filter(s => customerIds.has(s.customerId));
  });
  allCommodities = signal<Commodity[]>([]);

  get selectedTradeUnits(): string[] {
    return this.appStateService.selectedTradeUnits();
  }

  private readonly _localLoading = signal(false);
  readonly loading = computed(() => this.appStateService.dataLoading() || this._localLoading());
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
  activeTab = signal<'byCrop' | 'topProducers' | 'harvestContracts'>('byCrop');
  selectedCropFilter = signal('');

  readonly tabs = [
    { id: 'byCrop' as const, label: 'By Crop' },
    { id: 'topProducers' as const, label: 'Top Producers' },
    { id: 'harvestContracts' as const, label: 'Harvest & Contracts' },
  ];

  private readonly CHART_COLORS = [
    { bar: 'bg-scoular-green', dot: 'bg-scoular-green', hex: '#00A36F' },
    { bar: 'bg-blue-500', dot: 'bg-blue-500', hex: '#3b82f6' },
    { bar: 'bg-amber-500', dot: 'bg-amber-500', hex: '#f59e0b' },
    { bar: 'bg-purple-500', dot: 'bg-purple-500', hex: '#a855f7' },
    { bar: 'bg-red-500', dot: 'bg-red-500', hex: '#ef4444' },
    { bar: 'bg-teal-500', dot: 'bg-teal-500', hex: '#14b8a6' },
    { bar: 'bg-orange-500', dot: 'bg-orange-500', hex: '#f97316' },
    { bar: 'bg-indigo-500', dot: 'bg-indigo-500', hex: '#6366f1' },
  ];

  // Edit mode flags
  yieldEditMode = signal(false);
  marketShareEditMode = signal(false);
  estimatesSaving = signal(false);

  // Temporary edit maps
  tempYieldMap = signal<Record<string, number | null>>({});
  tempMarketShareMap = signal<Record<string, number | null>>({});

  // Pre-indexed commodity lookup — computed so it's stable within a CD cycle (prevents NG0100)
  private readonly _commodityByCode = computed(() => new Map(this.allCommodities().map(c => [c.code, c])));

  // Memoized trade unit key — avoids re-deriving sorted string 10+ times per cycle
  readonly tradeUnitKey = computed(() => [...this.appStateService.selectedTradeUnits()].sort().join(','));

  // Pre-indexed intentions by crop key — O(n) lookup instead of O(n²) in cropDetailsRows
  private readonly _intentionsByCropKey = computed(() => {
    const map = new Map<string, PlantingIntention[]>();
    for (const p of this.filteredIntentionsForYear()) {
      const commodity = this._commodityByCode().get(p.crop);
      const category = commodity?.category || p.crop;
      const key = this.selectedCropFilter()
        ? [p.type, category].filter(Boolean).join(' ')
        : category;
      const arr = map.get(key);
      if (arr) arr.push(p); else map.set(key, [p]);
    }
    return map;
  });

  // Pre-indexed contracted quantity by commodity description — O(n) lookup for contractCoverageRows
  private readonly _contractedByDesc = computed(() => {
    const map = new Map<string, number>();
    for (const c of this.contractsForYear()) {
      const desc = (c.commodityDescription || c.commodityGroup || c.commodityCode || '').toLowerCase();
      map.set(desc, (map.get(desc) || 0) + (c.quantity || 0));
    }
    return map;
  });

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
    return this.plantingIntentions().filter(p => {
      if (+p.plantingYear !== +this.selectedPlantingYear()) return false;
      if (!customerIdSet.has(p.customerId)) return false;
      if (this.selectedCropFilter()) {
        const commodity = this._commodityByCode().get(p.crop);
        const category = commodity?.category || p.crop;
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
    const prevAcres = this.plantingIntentions()
      .filter(p => +p.plantingYear === prevYear && customerIdSet.has(p.customerId))
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
      const category = commodity?.category || p.crop;
      const cropKey = [p.type, category].filter(Boolean).join(' ');
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
    const crops = new Set<string>();

    for (const p of this.plantingIntentions()) {
      if (!customerIdSet.has(p.customerId)) continue;
      const commodity = this._commodityByCode().get(p.crop);
      const category = commodity?.category || p.crop;
      if (category) crops.add(category);
    }

    for (const c of this.contracts()) {
      const group = c.commodityGroup || c.commodityDescription;
      if (group) crops.add(group);
    }

    return [...crops].sort();
  });

  readonly cropBreakdown = computed(() => {
    const cropAcresMap = new Map<string, number>();
    for (const p of this.filteredIntentionsForYear()) {
      const commodity = this._commodityByCode().get(p.crop);
      const category = commodity?.category || p.crop;
      const key = this.selectedCropFilter()
        ? [p.type, category].filter(Boolean).join(' ')
        : category;
      cropAcresMap.set(key, (cropAcresMap.get(key) || 0) + p.acres);
    }
    const total = [...cropAcresMap.values()].reduce((a, b) => a + b, 0);
    return [...cropAcresMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, acres], i) => {
        const color = this.CHART_COLORS[i % this.CHART_COLORS.length];
        return {
          name,
          acres,
          pct: total > 0 ? Math.round((acres / total) * 100) : 0,
          barColor: color.bar,
          dotColor: color.dot,
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
        const category = commodity?.category || p.crop;
        const cropKey = [p.type, category].filter(Boolean).join(' ');
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

  readonly topProducersRows = computed(() => {
    const yieldMap = this._yieldEstimateMap();
    const map = new Map<number, { customerName: string; tradeUnit: string; acres: number; production: number; cropSet: Set<string> }>();
    for (const p of this.filteredIntentionsForYear()) {
      const commodity = this._commodityByCode().get(p.crop);
      const category = commodity?.category || p.crop;
      const cropKey = [p.type, category].filter(Boolean).join(' ');
      const yieldEst = yieldMap.get(cropKey);
      const production = yieldEst != null ? p.acres * yieldEst : 0;
      const existing = map.get(p.customerId);
      if (existing) {
        existing.acres += p.acres;
        existing.production += production;
        existing.cropSet.add(category);
      } else {
        map.set(p.customerId, { customerName: p.customerName, tradeUnit: p.tradeUnit, acres: p.acres, production, cropSet: new Set([category]) });
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].acres - a[1].acres)
      .slice(0, 10)
      .map(([customerId, v]) => ({
        customerId,
        customerName: v.customerName,
        tradeUnit: v.tradeUnit,
        acres: v.acres,
        production: v.production > 0 ? Math.round(v.production) : null,
        crops: [...v.cropSet].sort()
      }));
  });

  readonly contractsForYear = computed(() => {
    const year = this.selectedPlantingYear();
    const cropFilter = this.selectedCropFilter();
    return this.contracts().filter(c => {
      if (c.cropYear !== year) return false;
      if (cropFilter) {
        const group = (c.commodityGroup || c.commodityDescription || c.commodityCode || '').toLowerCase();
        if (!group.includes(cropFilter.toLowerCase()) && cropFilter.toLowerCase() !== group) return false;
      }
      return true;
    });
  });

  readonly harvestTimelineMonths = computed(() => {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const commodityColorMap = new Map<string, string>();
    let colorIdx = 0;
    const monthData: Map<number, Map<string, number>> = new Map();
    for (let i = 0; i < 12; i++) monthData.set(i, new Map());

    for (const c of this.contractsForYear()) {
      if (!c.deliveryStart) continue;
      if (!c.sourceContractId?.startsWith('P')) continue; // Purchase contracts only
      const d = new Date(c.deliveryStart);
      const monthIdx = d.getMonth();
      const commodity = c.commodityDescription || c.commodityGroup || c.commodityCode || 'Other';
      if (!commodityColorMap.has(commodity)) {
        commodityColorMap.set(commodity, this.CHART_COLORS[colorIdx++ % this.CHART_COLORS.length].hex);
      }
      const m = monthData.get(monthIdx)!;
      m.set(commodity, (m.get(commodity) || 0) + (c.quantity || 0));
    }

    const raw = MONTHS.map((month, i) => {
      const m = monthData.get(i)!;
      const segments = [...m.entries()].map(([commodity, bushels]) => ({
        commodity, bushels, hex: commodityColorMap.get(commodity)!
      }));
      const total = segments.reduce((s, x) => s + x.bushels, 0);
      return { month, monthIndex: i, segments, total, barHeightPx: 0 };
    });

    const max = Math.max(...raw.map(m => m.total), 1);
    return raw.map(m => ({ ...m, barHeightPx: Math.round((m.total / max) * 128) }));
  });

  readonly harvestTimelineMax = computed(() =>
    Math.max(...this.harvestTimelineMonths().map(m => m.total), 1)
  );

  readonly harvestTimelineMidpoint = computed(() =>
    Math.floor(this.harvestTimelineMax() / 2)
  );

  readonly contractCommodityLegend = computed(() => {
    const seen = new Set<string>();
    const result: { commodity: string; hex: string }[] = [];
    for (const m of this.harvestTimelineMonths()) {
      for (const seg of m.segments) {
        if (!seen.has(seg.commodity)) {
          seen.add(seg.commodity);
          result.push({ commodity: seg.commodity, hex: seg.hex });
        }
      }
    }
    return result;
  });

  readonly contractCoverageRows = computed(() => {
    const contractedMap = this._contractedByDesc();
    return this.categoryRows().map((row, i) => {
      const categoryLower = row.category.toLowerCase();
      // Look up contracted quantity from pre-indexed map
      let contracted = contractedMap.get(categoryLower) || 0;
      // Also check partial matches (e.g., "corn" matches "corn #2 yellow")
      if (contracted === 0) {
        for (const [desc, qty] of contractedMap) {
          if (desc.includes(categoryLower) || categoryLower.startsWith(desc.split(' ')[0])) {
            contracted += qty;
          }
        }
      }
      const pct = row.totalEstimatedProduction > 0
        ? Math.min(Math.round((contracted / row.totalEstimatedProduction) * 100), 999)
        : 0;
      return {
        category: row.category,
        estimatedBu: Math.round(row.totalEstimatedProduction),
        contractedBu: contracted,
        pct,
        hex: this.CHART_COLORS[i % this.CHART_COLORS.length].hex
      };
    });
  });

  readonly salesOpportunityRows = computed(() => {
    const map = new Map<string, { total: number; open: number; priced: number; value: number; count: number }>();
    for (const c of this.contractsForYear()) {
      const cat = c.commodityDescription || c.commodityGroup || c.commodityCode || 'Other';
      if (!map.has(cat)) map.set(cat, { total: 0, open: 0, priced: 0, value: 0, count: 0 });
      const m = map.get(cat)!;
      m.total += c.quantity || 0;
      m.open += c.openBalanceQuantity || 0;
      m.priced += c.pricedQuantity || 0;
      m.value += c.totalValue || ((c.quantity || 0) * (c.price || 0));
      m.count++;
    }
    return [...map.entries()]
      .map(([commodity, v], i) => ({
        commodity,
        contracts: v.count,
        totalBu: v.total,
        openBu: v.open,
        unpricedBu: Math.max(0, v.total - v.priced),
        avgPrice: v.total > 0 ? v.value / v.total : 0,
        hex: this.CHART_COLORS[i % this.CHART_COLORS.length].hex
      }))
      .filter(r => r.totalBu > 0)
      .sort((a, b) => b.openBu - a.openBu);
  });

  constructor() {
    const savedState = localStorage.getItem('plantingIntentionsExpanded');
    if (savedState !== null) {
      this.plantingIntentionsExpanded.set(savedState === 'true');
    }

    // Restore commodities + dashboard-specific data from cache if available, otherwise fetch
    const cached = this.appStateService.dashboardCache();
    const tradeUnitsKey = this.tradeUnitKey();
    if (cached && cached.tradeUnitsKey === tradeUnitsKey) {
      this._restoreFromCache(cached);
    } else {
      this._loadLocalData();
    }

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

    // PI not yet loaded — fetch PI and dashboard APIs in parallel
    forkJoin({
      pi: this.apiService.getPlantingIntentions(this.selectedTradeUnits)
        .pipe(catchError(() => of([] as PlantingIntention[]))),
      estimates: key ? this.apiService.getDashboardPlantingEstimates(key, year)
        .pipe(catchError(() => of([] as DashboardPlantingEstimate[]))) : of([] as DashboardPlantingEstimate[]),
      shares: key ? this.apiService.getDashboardMarketShares(key, year)
        .pipe(catchError(() => of([] as DashboardMarketShare[]))) : of([] as DashboardMarketShare[]),
      harvest: key ? this.apiService.getDashboardActualHarvest(key, year - 1)
        .pipe(catchError(() => of([] as DashboardActualHarvest[]))) : of([] as DashboardActualHarvest[]),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ pi, estimates, shares, harvest }) => {
        if (requestId !== this._loadRequestId) return; // discard stale response
        this.appStateService.setPlantingIntentions(pi);
        this.savedYieldEstimates.set(estimates);
        this.savedMarketShares.set(shares);
        this.savedActualHarvest.set(harvest);
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
        this._calculateYieldRows();
        this._calculateCategoryRows();
        this._localLoading.set(false);
      });
      return;
    }

    // Fetch commodities + 3 dashboard API calls in parallel (eliminates waterfall)
    forkJoin({
      commodities: commodities$,
      estimates: this.apiService.getDashboardPlantingEstimates(key, year)
        .pipe(catchError(() => of([] as DashboardPlantingEstimate[]))),
      shares: this.apiService.getDashboardMarketShares(key, year)
        .pipe(catchError(() => of([] as DashboardMarketShare[]))),
      harvest: this.apiService.getDashboardActualHarvest(key, year - 1)
        .pipe(catchError(() => of([] as DashboardActualHarvest[])))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ commodities, estimates, shares, harvest }) => {
        if (requestId !== this._loadRequestId) return; // discard stale response
        this.allCommodities.set(commodities);
        if (preloaded.length === 0) this.appStateService.setCommodities(commodities);
        this.savedYieldEstimates.set(estimates);
        this.savedMarketShares.set(shares);
        this.savedActualHarvest.set(harvest);
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
    this._localLoading.set(true);
    forkJoin({
      estimates: this.apiService.getDashboardPlantingEstimates(key, year)
        .pipe(catchError(() => of([] as DashboardPlantingEstimate[]))),
      shares: this.apiService.getDashboardMarketShares(key, year)
        .pipe(catchError(() => of([] as DashboardMarketShare[]))),
      harvest: this.apiService.getDashboardActualHarvest(key, year - 1)
        .pipe(catchError(() => of([] as DashboardActualHarvest[])))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ estimates, shares, harvest }) => {
        this.savedYieldEstimates.set(estimates);
        this.savedMarketShares.set(shares);
        this.savedActualHarvest.set(harvest);
        this._calculateYieldRows();
        this._calculateCategoryRows();
        this._saveDashboardCache();
        this._localLoading.set(false);
      },
      error: () => {
        this._localLoading.set(false);
      }
    });
  }

  private _calculateMetrics(): void {
    this.totalAcres.set(this.customers().reduce((sum, c) => sum + c.totalAcres, 0));
    this.activeContracts.set(this.contracts().filter(c => c.status === 'Active').length);
    this.totalContractValue.set(this.contracts().reduce((sum, c) => sum + (c.totalValue || 0), 0));

    this._calculateCropDistribution();
    this._calculateContractStatus();
  }

  navigateToCustomer(customerId: number): void {
    this.router.navigate(['/'], { queryParams: { customerId } });
  }

  private _calculateCropDistribution(): void {
    const cropMap = new Map<string, number>();
    for (const contract of this.contracts()) {
      const commodity = contract.commodityDescription || contract.commodityCode || 'Unknown';
      cropMap.set(commodity, (cropMap.get(commodity) || 0) + (contract.quantity || 0));
    }

    const total = Array.from(cropMap.values()).reduce((a, b) => a + b, 0);
    const cropColors: Record<string, string> = {
      'Corn': 'bg-green-500',
      'Soybeans': 'bg-blue-500',
      'Wheat': 'bg-amber-500',
      'Milo': 'bg-orange-500'
    };

    this.cropDistribution.set(
      Array.from(cropMap.entries())
        .map(([name, bushels]) => ({
          name,
          bushels,
          percentage: Math.round((bushels / total) * 100),
          color: cropColors[name] || 'bg-gray-500'
        }))
        .sort((a, b) => b.bushels - a.bushels)
    );
  }

  private _calculateContractStatus(): void {
    const statusMap = new Map<string, number>();
    for (const contract of this.contracts()) {
      statusMap.set(contract.status, (statusMap.get(contract.status) || 0) + 1);
    }

    const statusColors: Record<string, string> = {
      'Active': 'bg-green-500',
      'Pending': 'bg-amber-500',
      'Fulfilled': 'bg-blue-500',
      'Cancelled': 'bg-scoular-red'
    };

    this.contractStatus.set(
      Array.from(statusMap.entries()).map(([name, count]) => ({
        name,
        count,
        dotColor: statusColors[name] || 'bg-gray-500'
      }))
    );
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

    const forGlobalTUs = this.plantingIntentions().filter(p =>
      customerIdSet.has(p.customerId)
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
      const category = commodity?.category || p.crop;
      const cropKey = [p.type, category].filter(Boolean).join(' ');
      cropAcresMap.set(cropKey, (cropAcresMap.get(cropKey) || 0) + p.acres);
      cropCategoryMap.set(cropKey, category);
    }

    // Use crop keys from planting intentions only
    const allCropCodes = new Set<string>(cropAcresMap.keys());
    const yieldMap = this._yieldEstimateMap();

    this.yieldRows.set(
      [...allCropCodes].sort().map(cropCode => ({
        cropCode,
        cropName: cropCode,
        category: cropCategoryMap.get(cropCode) || 'Unknown',
        totalAcres: cropAcresMap.get(cropCode) || 0,
        yieldEstimate: yieldMap.get(cropCode) ?? null
      }))
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
  // Yield edit
  // =========================================================================

  startYieldEdit(): void {
    this.yieldEditMode.set(true);
    const map: Record<string, number | null> = {};
    for (const row of this.yieldRows()) {
      map[row.cropCode] = row.yieldEstimate;
    }
    this.tempYieldMap.set(map);
  }

  saveYieldEdit(): void {
    const key = this.tradeUnitKey();
    if (!key) return;
    const estimates = this.yieldRows().map(row => ({
      tradeUnitKey: key,
      crop: row.cropCode,
      plantingYear: this.selectedPlantingYear(),
      yieldEstimate: this.tempYieldMap()[row.cropCode] ?? null
    }));
    this.estimatesSaving.set(true);
    this.apiService.upsertDashboardPlantingEstimates(estimates)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.yieldEditMode.set(false);
          this.estimatesSaving.set(false);
          this.toastService.success('Yield estimates saved');
          this.loadDashboardEstimates();
        },
        error: () => {
          this.estimatesSaving.set(false);
          this.toastService.error('Failed to save yield estimates');
        }
      });
  }

  cancelYieldEdit(): void {
    this.yieldEditMode.set(false);
    this.tempYieldMap.set({});
  }

  // =========================================================================
  // Market share edit
  // =========================================================================

  startMarketShareEdit(): void {
    this.marketShareEditMode.set(true);
    const map: Record<string, number | null> = {};
    for (const row of this.categoryRows()) {
      map[row.category] = row.marketSharePct;
    }
    this.tempMarketShareMap.set(map);
  }

  saveMarketShareEdit(): void {
    const key = this.tradeUnitKey();
    if (!key) return;
    const shares = this.categoryRows().map(row => ({
      tradeUnitKey: key,
      cropCategory: row.category,
      plantingYear: this.selectedPlantingYear(),
      marketSharePct: this.tempMarketShareMap()[row.category] ?? null
    }));
    this.estimatesSaving.set(true);
    this.apiService.upsertDashboardMarketShares(shares)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.marketShareEditMode.set(false);
          this.estimatesSaving.set(false);
          this.toastService.success('Market share saved');
          this.loadDashboardMarketShares();
        },
        error: () => {
          this.estimatesSaving.set(false);
          this.toastService.error('Failed to save market share');
        }
      });
  }

  cancelMarketShareEdit(): void {
    this.marketShareEditMode.set(false);
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

  setTempHarvest(id: number, value: string): void {
    this.tempHarvestMap.update(m => ({ ...m, [id]: value }));
  }

  // =========================================================================
  // Row color coding (consistent category colors across all 6 tables)
  // =========================================================================

  private static readonly _CATEGORY_ROW_COLORS = [
    'bg-emerald-100 dark:bg-emerald-800/35',
    'bg-sky-100 dark:bg-sky-800/35',
    'bg-amber-100 dark:bg-amber-800/35',
    'bg-violet-100 dark:bg-violet-800/35',
    'bg-rose-100 dark:bg-rose-800/35',
    'bg-teal-100 dark:bg-teal-800/35',
    'bg-orange-100 dark:bg-orange-800/35',
    'bg-indigo-100 dark:bg-indigo-800/35',
  ];

  readonly categoryColorMap = computed(() => {
    const map = new Map<string, string>();
    this.categoryRows().forEach((r, i) => {
      map.set(r.category, `${DashboardComponent._CATEGORY_ROW_COLORS[i % DashboardComponent._CATEGORY_ROW_COLORS.length]} transition-colors`);
    });
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
    this.activeTab.set('harvestContracts');
    this.showSeasonTargets.set(true);
  }

  onCropFilterChange(): void {
    // signal read triggers change detection in zoneless mode automatically
  }

  // =========================================================================
  // Formatting helpers
  // =========================================================================

  formatAcres(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return Math.round(n / 1_000) + 'K';
    return n.toString();
  }

  formatK(n: number): string {
    if (n === 0) return '--';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return Math.round(n / 1_000) + 'K';
    return n.toString();
  }
}
