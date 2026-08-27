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
import { buildLbsPerBushelMap, quantityInBushels, sumInBushels } from '@shared/utils/production-coverage';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';
import { commodityColor, commodityChipClass } from '@shared/utils/commodity-color';

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

  /** Shared per-crop chip classes (pastel bg+text), same palette as Build-A-List planting chips. */
  readonly commodityChipClass = commodityChipClass;

  /** Last-contact display for a customer — shown only on the "without intentions" producer view. */
  getLastContactInfo(customerId: number): { text: string; colorClass: string; daysAgo: number } {
    return this._lastContactByCustomer().get(customerId)
      ?? { text: 'Never contacted', colorClass: 'text-scoular-red', daysAgo: Infinity };
  }

  getInitials(name: string): string {
    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1 && parts[0].length >= 2) return parts[0].substring(0, 2).toUpperCase();
    return '??';
  }

  getFormattedLocation(customer: Customer | undefined): string {
    if (!customer) return '';
    if (customer.extendedCity && customer.extendedStateProvince) {
      return `${customer.extendedCity}, ${customer.extendedStateProvince}`;
    }
    if (customer.location && customer.stateProvince) {
      return `${customer.location}, ${customer.stateProvince}`;
    }
    return customer.extendedCity || customer.location || customer.stateProvince || '';
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
      const category = p.category || commodity?.category || p.crop;
      const key = this.selectedCropFilter()
        ? this._dashboardCropKey(p.type, category)
        : category;
      const arr = map.get(key);
      if (arr) arr.push(p); else map.set(key, [p]);
    }
    return map;
  });

  // Pre-indexed contracted quantity by resolved category — uses Commodities table lookup
  // so contracts group by the same category name as planting intentions.
  private readonly _contractedByCategory = computed(() => {
    const commodityMap = this._commodityByCode();
    // Totals are BUSHELS, not raw quantity. A commodity group carries processed products priced by
    // weight — soybean meal and oil in short tons, popcorn by the pound — and adding their quantity
    // straight in overstated contracted volume against a bushel production estimate. Same helper the
    // producer page uses, so the two agree.
    const lbsPerBushelByCode = buildLbsPerBushelMap(this.appStateService.commodityConversions());
    const byCategory = new Map<string, Contract[]>();
    for (const c of this.contractsForYear()) {
      const commodity = commodityMap.get(c.commodityCode || '') || commodityMap.get(c.commodityDescription || '');
      const category = (commodity?.category || c.commodityDescription || c.commodityGroup || c.commodityCode || '').toLowerCase();
      const arr = byCategory.get(category);
      if (arr) arr.push(c); else byCategory.set(category, [c]);
    }

    const map = new Map<string, number>();
    for (const [category, contracts] of byCategory) {
      map.set(category, sumInBushels(contracts, lbsPerBushelByCode).contracted);
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
        const category = p.category || commodity?.category || p.crop;
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
      const category = p.category || commodity?.category || p.crop;
      const cropKey = this._dashboardCropKey(p.type, category);
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
      const category = p.category || commodity?.category || p.crop;
      if (category) crops.add(this._toTitleCase(category));
    }

    // Contracts come from ODS, where strings are stored ALL-CAPS ("WHEAT",
    // "HARD RED WINTER WHEAT"). Title-case them on the way into the dropdown
    // so they merge with the already-Title-Cased planting-intention categories
    // instead of appearing as duplicate "WHEAT" / "Wheat" options.
    for (const c of this.contracts()) {
      const group = c.commodityGroup || c.commodityDescription;
      if (group) crops.add(this._toTitleCase(group));
    }

    return [...crops].sort();
  });

  /**
   * Convert any-case input to Title Case: "WHEAT" → "Wheat",
   * "hard red winter wheat" → "Hard Red Winter Wheat", "Co-Product" → "Co-Product".
   * Word boundaries are preserved so hyphenated and multi-word strings stay readable.
   */
  private _toTitleCase(s: string): string {
    if (!s) return s;
    return s.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase());
  }

  /**
   * Crop key/label for the dashboard from a planting intention: planting type + label
   * (e.g. "Irrigated Corn", "Double Crop Corn"). Double Crop is just a type now, so it splits
   * out like Irrigated / Dryland — including in Season Targets.
   */
  private _dashboardCropKey(type: string | undefined, label: string): string {
    return [type, label].filter(Boolean).join(' ');
  }

  readonly cropBreakdown = computed(() => {
    // Track the underlying crop CATEGORY per row so color is by crop, not sort position —
    // e.g. "Irrigated Corn" and "Dryland Corn" stay as separate rows but both color as Corn.
    const cropMap = new Map<string, { acres: number; category: string }>();
    for (const p of this.filteredIntentionsForYear()) {
      const commodity = this._commodityByCode().get(p.crop);
      const category = p.category || commodity?.category || p.crop;
      const key = this.selectedCropFilter()
        ? this._dashboardCropKey(p.type, category)
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
        const category = p.category || commodity?.category || p.crop;
        const cropKey = this._dashboardCropKey(p.type, category);
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

  readonly producersWithIntentionsRows = computed(() => {
    const yieldMap = this._yieldEstimateMap();
    const customerMap = this._customerById();
    const commodityByCode = this._commodityByCode();
    const map = new Map<number, {
      customerName: string;
      tradeUnit: string;
      acres: number;
      production: number;
      // Per-crop breakdown so we can recompute the displayed acres/production when a chip is active.
      // colorKey = the PLAIN crop category (e.g. "Corn"/"Wheat") so the chip color matches the app-wide
      // palette; category = the type-prefixed key (e.g. "Dryland Corn") kept for the chip-filter logic.
      byKey: Map<string, { display: string; category: string; colorKey: string; acres: number; production: number }>;
    }>();
    for (const p of this.filteredIntentionsForYear()) {
      const commodity = commodityByCode.get(p.crop);
      const category = p.category || commodity?.category || p.crop;
      const categoryKey = this._dashboardCropKey(p.type, category);
      const displayKey = this._dashboardCropKey(p.type, p.crop);
      const yieldEst = yieldMap.get(categoryKey);
      const production = yieldEst != null ? p.acres * yieldEst : 0;
      let entry = map.get(p.customerId);
      if (!entry) {
        entry = {
          customerName: p.customerName,
          tradeUnit: p.tradeUnit,
          acres: 0,
          production: 0,
          byKey: new Map(),
        };
        map.set(p.customerId, entry);
      }
      entry.acres += p.acres;
      entry.production += production;
      const existingDetail = entry.byKey.get(displayKey);
      if (existingDetail) {
        existingDetail.acres += p.acres;
        existingDetail.production += production;
      } else {
        entry.byKey.set(displayKey, { display: displayKey, category: categoryKey, colorKey: category, acres: p.acres, production });
      }
    }
    return [...map.entries()].map(([customerId, v]) => {
      const customer = customerMap.get(customerId);
      const cropEntries = [...v.byKey.values()].sort((a, b) => a.display.localeCompare(b.display));
      // Build-A-List-style planting chips: "<Type> <Crop> · <acres> ac", grouped by crop (same crops
      // adjacent) then acres desc, colored by the plain crop category.
      const plantingChips = [...cropEntries]
        .sort((a, b) => a.colorKey.localeCompare(b.colorKey) || b.acres - a.acres)
        .map(e => ({
          display: e.display,
          colorKey: e.colorKey,
          text: `${e.display} · ${e.acres.toLocaleString('en-US')} ac`,
        }));
      return {
        customerId,
        customerName: v.customerName,
        scoularId: customer?.scoularId ?? null,
        customer,
        tradeUnit: v.tradeUnit,
        acres: v.acres,
        production: v.production > 0 ? Math.round(v.production) : null,
        crops: cropEntries.map(e => e.display),
        cropCategoryKeys: [...new Set(cropEntries.map(e => e.category))].sort(),
        cropEntries,
        plantingChips,
        highlightedCrops: null as Set<string> | null,
      };
    });
  });

  // Combined crops per customer — mirrors build-list's resolution logic.
  // Sources (deduped, case-insensitive): producer details, contract commodity codes/descriptions.
  private readonly _customerCropsById = computed(() => {
    const result = new Map<number, string[]>();

    // Producer details by customerId
    const pdByCustomer = new Map<number, string[]>();
    for (const pd of this.appStateService.producerDetails()) {
      if (pd.commodities) {
        const list = pd.commodities.split(',').map(s => s.trim()).filter(Boolean);
        if (list.length > 0) pdByCustomer.set(pd.customerId, list);
      }
    }

    // Contracts grouped by ctrmCustomerId (the FK on contracts that maps to customer.scoularId)
    const contractCropsBySrcId = new Map<string, string[]>();
    for (const c of this.contracts()) {
      const key = c.ctrmCustomerId;
      if (!key) continue;
      const crop = (c.commodityCode || c.commodityDescription || c.commodityGroup || '').trim();
      if (!crop) continue;
      const arr = contractCropsBySrcId.get(key);
      if (arr) arr.push(crop); else contractCropsBySrcId.set(key, [crop]);
    }

    for (const customer of this.customers()) {
      const detailCrops = pdByCustomer.get(customer.id) ?? customer.commodities ?? [];
      const contractCrops = customer.scoularId
        ? (contractCropsBySrcId.get(customer.scoularId) ?? [])
        : [];
      const seen = new Set<string>();
      const merged: string[] = [];
      for (const crop of [...detailCrops, ...contractCrops]) {
        const key = crop.trim().toUpperCase();
        if (key && !seen.has(key)) { seen.add(key); merged.push(crop.trim()); }
      }
      if (merged.length > 0) result.set(customer.id, merged);
    }
    return result;
  });

  readonly producersWithoutIntentionsRows = computed(() => {
    const year = this.selectedPlantingYear();
    const cropFilter = this.selectedCropFilter();
    const cropFilterLower = cropFilter.toLowerCase();
    const cropsMap = this._customerCropsById();

    // When a crop is selected at the top, "without intentions" narrows to:
    //   producers who work with that crop (per their crops list) but have NO intention
    //   for THAT crop this year. Otherwise: producers with NO intention at all this year.
    const matchingIntentionCustomers = new Set<number>();
    for (const p of this.plantingIntentions()) {
      if (+p.plantingYear !== +year) continue;
      if (cropFilter) {
        const commodity = this._commodityByCode().get(p.crop);
        const category = p.category || commodity?.category || p.crop;
        if (category !== cropFilter) continue;
      }
      matchingIntentionCustomers.add(p.customerId);
    }

    const commodityByCode = this._commodityByCode();
    return this.customers()
      .filter(c => !matchingIntentionCustomers.has(c.id))
      .filter(c => {
        if (!cropFilter) return true;
        const crops = cropsMap.get(c.id) ?? [];
        return crops.some(crop => {
          const raw = crop.trim();
          if (raw.toLowerCase() === cropFilterLower) return true;
          // Resolve code (e.g. "YC") to its category (e.g. "Corn") via commodities lookup
          const commodity = commodityByCode.get(raw) || commodityByCode.get(raw.toUpperCase());
          return (commodity?.category || '').toLowerCase() === cropFilterLower;
        });
      })
      .map(c => {
        const crops = [...(cropsMap.get(c.id) ?? [])].sort();
        // These producers have no planting intentions, so no acres/type — chips are just the crop
        // code, colored + grouped by crop category (resolved via the commodities lookup).
        const plantingChips = crops
          .map(code => {
            const commodity = commodityByCode.get(code) || commodityByCode.get(code.toUpperCase());
            const colorKey = commodity?.category || code;
            return { display: code, colorKey, text: code };
          })
          .sort((a, b) => a.colorKey.localeCompare(b.colorKey) || a.display.localeCompare(b.display));
        return {
          customerId: c.id,
          customerName: c.name,
          scoularId: c.scoularId ?? null,
          customer: c,
          crops,
          plantingChips,
        };
      });
  });

  // Apply search + (optional) chip filter. Chip filter is view-specific, so the inactive
  // view's count skips it — that's why the With count doesn't move when you toggle a chip
  // while sitting on the Without view, and vice versa.
  private _applyProducerFilters(
    rows: any[],
    view: 'with' | 'without',
    opts: { applyChipFilter: boolean } = { applyChipFilter: true }
  ): any[] {
    const search = this.producerSearch().trim().toLowerCase();
    const cropFilter = opts.applyChipFilter ? this.producerCropFilter().trim().toLowerCase() : '';
    const topFilterSet = !!this.selectedCropFilter();

    let result = rows;
    if (search) {
      result = result.filter(r =>
        r.customerName.toLowerCase().includes(search) ||
        (r.scoularId && r.scoularId.toLowerCase().includes(search))
      );
    }
    if (cropFilter) {
      result = result.filter(r => {
        if (view === 'with' && !topFilterSet) {
          const keys = (r as any).cropCategoryKeys as string[] | undefined;
          return Array.isArray(keys) && keys.some(c => c.toLowerCase() === cropFilter);
        }
        return Array.isArray(r.crops) && r.crops.some((c: string) => c.toLowerCase() === cropFilter);
      });
    }
    return result;
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


  // Last-contacted info per customer — mirrors build-list's lastContactByCustomer.
  // Walks the last-contact aggregate (incl. linked producers, forward + reverse edges) to
  // find the most recent. Fed by noteLastContacts — one MAX(CreatedAt) row per customer,
  // all trade units — instead of the full note download.
  private readonly _lastContactByCustomer = computed(() => {
    const map = new Map<number, { text: string; colorClass: string; daysAgo: number }>();
    const parseUtc = (ts: string | Date) => {
      const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
      return new Date(raw).getTime();
    };

    const notesByCode = new Map<string, { time: number }>();
    for (const row of this.appStateService.noteLastContacts()) {
      if (!row.customerCode) continue;
      const time = parseUtc(row.lastNoteAt);
      const existing = notesByCode.get(row.customerCode);
      if (!existing || time > existing.time) notesByCode.set(row.customerCode, { time });
    }

    const all = this.customers();
    const linkedById = new Map<number, string[]>();
    for (const c of all) {
      if (c.linkedProducerIds?.length) linkedById.set(c.id, c.linkedProducerIds);
    }
    const incomingCodeLinks = new Map<string, Set<string>>();
    for (const c of all) {
      if (!c.scoularId) continue;
      for (const linkedCode of (c.linkedProducerIds || [])) {
        if (!incomingCodeLinks.has(linkedCode)) incomingCodeLinks.set(linkedCode, new Set());
        incomingCodeLinks.get(linkedCode)!.add(c.scoularId);
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const customer of all) {
      const codes = new Set<string>();
      if (customer.scoularId) codes.add(customer.scoularId);
      for (const code of (linkedById.get(customer.id) ?? customer.linkedProducerIds ?? [])) codes.add(code);
      for (const code of (incomingCodeLinks.get(customer.scoularId || '') || [])) codes.add(code);
      let latestTime = 0;
      for (const code of codes) {
        const e = notesByCode.get(code);
        if (e && e.time > latestTime) latestTime = e.time;
      }
      if (latestTime === 0) continue;
      const noteDate = new Date(latestTime);
      noteDate.setHours(0, 0, 0, 0);
      const daysAgo = Math.max(0, Math.round((today.getTime() - noteDate.getTime()) / 86400000));
      let info: { text: string; colorClass: string; daysAgo: number };
      if (daysAgo === 0) info = { text: 'Contacted today', colorClass: 'text-scoular-green', daysAgo };
      else if (daysAgo === 1) info = { text: 'Contacted yesterday', colorClass: 'text-scoular-green', daysAgo };
      else if (daysAgo < 7) info = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-green', daysAgo };
      else if (daysAgo < 30) info = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-yellow-500', daysAgo };
      else info = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-red', daysAgo };
      map.set(customer.id, info);
    }
    return map;
  });

  readonly producersTabRows = computed(() => {
    const view = this.producerView();
    const sortKey = this.producerSortKey();
    const dir = this.producerSortDir() === 'asc' ? 1 : -1;

    const source = view === 'with'
      ? this.producersWithIntentionsRows()
      : this.producersWithoutIntentionsRows();
    let rows: any[] = this._applyProducerFilters(source, view);

    // When a chip is active on the With view, narrow each row's acres/production to the matching
    // crop(s) only, and mark which crop badges should be highlighted on the card.
    const chip = this.producerCropFilter().trim().toLowerCase();
    if (chip && view === 'with') {
      const topFilterSet = !!this.selectedCropFilter();
      rows = rows.map(r => {
        const entries: { display: string; category: string; acres: number; production: number }[] = r.cropEntries ?? [];
        const matches = entries.filter(e => {
          const target = topFilterSet ? e.display : e.category;
          return target.toLowerCase() === chip;
        });
        if (matches.length === 0) return r;
        const acres = matches.reduce((s, e) => s + e.acres, 0);
        const productionRaw = matches.reduce((s, e) => s + e.production, 0);
        return {
          ...r,
          acres,
          production: productionRaw > 0 ? Math.round(productionRaw) : null,
          highlightedCrops: new Set(matches.map(e => e.display)),
        };
      });
    }

    rows = [...rows].sort((a, b) => {
      if (sortKey === 'acres') {
        const av = a.acres ?? a.customer?.totalAcres ?? 0;
        const bv = b.acres ?? b.customer?.totalAcres ?? 0;
        return (av - bv) * dir;
      }
      if (sortKey === 'production') return ((a.production ?? 0) - (b.production ?? 0)) * dir;
      return a.customerName.localeCompare(b.customerName);
    });
    return rows;
  });

  readonly showProducerTradeUnitColumn = computed(() =>
    this.appStateService.selectedTradeUnits().length > 1
  );

  // Crop chips — semantics differ between views:
  //   With view:
  //     - Top filter empty: chips are "type + category" (e.g. "Dryland Corn") — broader buckets
  //     - Top filter set:   chips are "type + crop code" (e.g. "Dryland YC") — drill-down within that crop
  //   Without view:
  //     - Chips are crop codes (e.g. "YC", "SRWW") drawn from each customer's merged crops list
  //     - When top filter is set, chips are limited to codes whose category matches the top filter
  readonly producerCropChipOptions = computed(() => {
    const set = new Set<string>();
    if (this.producerView() === 'with') {
      const rows = this.producersWithIntentionsRows();
      if (this.selectedCropFilter()) {
        for (const r of rows) for (const k of r.crops) set.add(k);
      } else {
        for (const r of rows) for (const k of r.cropCategoryKeys) set.add(k);
      }
      return [...set].sort();
    }
    // Without view
    const cropFilter = this.selectedCropFilter();
    const cropFilterLower = cropFilter.toLowerCase();
    const commodityByCode = this._commodityByCode();
    for (const r of this.producersWithoutIntentionsRows()) {
      for (const c of r.crops) {
        const raw = c.trim();
        if (!raw) continue;
        if (cropFilter) {
          // Limit chips to codes that resolve to the selected category
          const commodity = commodityByCode.get(raw) || commodityByCode.get(raw.toUpperCase());
          const category = (commodity?.category || '').toLowerCase();
          if (category !== cropFilterLower && raw.toLowerCase() !== cropFilterLower) continue;
        }
        set.add(raw);
      }
    }
    return [...set].sort();
  });

  readonly contractsForYear = computed(() => {
    const year = this.selectedPlantingYear();
    const cropFilter = this.selectedCropFilter();
    // Prefer the base.Contract feed for the selected year (open + closed historical).
    // Falls back to appState.contracts() while the crop-year fetch is in flight or empty
    // so the UI never goes blank during the swap.
    const cropYearContracts = this._cropYearContracts();
    const source = cropYearContracts.length > 0 ? cropYearContracts : this.contracts();
    return source.filter(c => {
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
      return { month, monthIndex: i, segments, total, barHeightPct: 0 };
    });

    const max = Math.max(...raw.map(m => m.total), 1);
    return raw.map(m => ({ ...m, barHeightPct: (m.total / max) * 100 }));
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
    const contractedMap = this._contractedByCategory();
    return this.categoryRows().map((row, i) => {
      const categoryLower = row.category.toLowerCase();
      const contracted = contractedMap.get(categoryLower) || 0;
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

    // Fetch crop-year contracts from base.Contract whenever the selected planting year or
    // trade-unit selection changes. Powers the Harvest & Contracts tab so historical years
    // include closed contracts not present in vw_CurrentContracts.
    effect(() => {
      const year = this.selectedPlantingYear();
      const tus = this.appStateService.selectedTradeUnits();
      untracked(() => {
        this.apiService.getContractsByCropYear(year, tus.length > 0 ? tus : undefined)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: contracts => this._cropYearContracts.set(contracts),
            error: () => {
              // Harvest & Contracts would otherwise show last year's numbers under this year's heading.
              this._cropYearContracts.set([]);
              this.appStateService.setContractsLoadFailed(true);
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

    this._localLoading.set(true);
    this.apiService.getDashboardSummary(key, year)
      .pipe(
        catchError(() => of<DashboardSummary>({ estimates: [], marketShares: [], actualHarvest: [] })),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe({
        next: (summary) => {
          this.savedYieldEstimates.set(summary.estimates);
          this.savedMarketShares.set(summary.marketShares);
          this.savedActualHarvest.set(summary.actualHarvest);
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
    const openContracts = this.contracts().filter(c => !c.closedDate);
    this.totalAcres.set(this.customers().reduce((sum, c) => sum + c.totalAcres, 0));
    this.activeContracts.set(openContracts.filter(c => c.status === 'Active').length);
    this.totalContractValue.set(openContracts.reduce((sum, c) => sum + (c.totalValue || 0), 0));

    this._calculateCropDistribution();
    this._calculateContractStatus();
  }

  navigateToCustomer(customerId: number): void {
    this.router.navigate(['/'], { queryParams: { customerId } });
  }

  private _calculateCropDistribution(): void {
    // Shares are computed from BUSHELS. On raw quantity a tonnage commodity's slice was sized by its
    // ton count, so it looked far smaller than the volume it represents.
    const lbsPerBushelByCode = buildLbsPerBushelMap(this.appStateService.commodityConversions());
    const cropMap = new Map<string, number>();
    for (const contract of this.contracts().filter(c => !c.closedDate)) {
      const commodity = contract.commodityDescription || contract.commodityCode || 'Unknown';
      const bushels = quantityInBushels(contract, contract.quantity || 0, lbsPerBushelByCode);
      if (bushels == null) continue;
      cropMap.set(commodity, (cropMap.get(commodity) || 0) + bushels);
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
    for (const contract of this.contracts().filter(c => !c.closedDate)) {
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
      const category = p.category || commodity?.category || p.crop;
      const cropKey = this._dashboardCropKey(p.type, category);
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
      map.set(r.category, `${commodityColor(r.category).row} transition-colors`);
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
