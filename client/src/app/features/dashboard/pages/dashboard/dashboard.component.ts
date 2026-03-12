import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AppStateService, DashboardCacheEntry } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { Customer, Contract, PlantingIntention, StoredGrain, DashboardPlantingEstimate, DashboardMarketShare, DashboardActualHarvest, Commodity } from '@models';
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
  private readonly apiService = inject(ApiService);
  private readonly appStateService = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Data for display
  customers = signal<Customer[]>([]);
  contracts = signal<Contract[]>([]);
  plantingIntentions = signal<PlantingIntention[]>([]);
  storedGrain = signal<StoredGrain[]>([]);
  allCommodities = signal<Commodity[]>([]);

  // Trade unit selection
  availableTradeUnits = signal<string[]>([]);
  selectedDashboardTradeUnits = signal<string[]>([]);
  showTradeUnitDropdown = signal(false);

  loading = signal(false);
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

  // Pre-indexed commodity lookup for O(1) access instead of O(n) .find() per iteration
  private _commodityByCode = new Map<string, Commodity>();

  // Loading state to prevent concurrent data loads
  private _isLoading = false;

  constructor() {
    const savedState = localStorage.getItem('plantingIntentionsExpanded');
    if (savedState !== null) {
      this.plantingIntentionsExpanded.set(savedState === 'true');
    }

    this.availableTradeUnits.set(this.appStateService.selectedTradeUnits());
    this.selectedDashboardTradeUnits.set([...this.availableTradeUnits()]);

    // Restore from cache if available for the same trade units
    const cached = this.appStateService.dashboardCache();
    const tradeUnitsKey = [...this.selectedDashboardTradeUnits()].sort().join(',');
    if (cached && cached.tradeUnitsKey === tradeUnitsKey) {
      this._restoreFromCache(cached);
    } else {
      this._loadData();
    }
  }

  togglePlantingIntentions(): void {
    this.plantingIntentionsExpanded.update(v => !v);
    localStorage.setItem('plantingIntentionsExpanded', this.plantingIntentionsExpanded().toString());
    if (this.plantingIntentionsExpanded()) {
      this.reloadPlantingIntentions();
    }
  }

  reloadPlantingIntentions(): void {
    this.apiService.getPlantingIntentions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.plantingIntentions.set(data);
          this._calculateYieldRows();
          this.loadDashboardEstimates();

        }
      });
  }

  toggleDashboardTradeUnit(unit: string): void {
    const idx = this.selectedDashboardTradeUnits().indexOf(unit);
    if (idx >= 0) {
      if (this.selectedDashboardTradeUnits().length > 1) {
        this.selectedDashboardTradeUnits.update(arr => arr.filter(u => u !== unit));
      }
    } else {
      this.selectedDashboardTradeUnits.update(arr => [...arr, unit]);
    }
    this.selectedCropFilter.set('');
    this._loadData();
  }

  private _restoreFromCache(cached: DashboardCacheEntry): void {
    this.customers.set(cached.customers);
    this.contracts.set(cached.contracts);
    this.plantingIntentions.set(cached.plantingIntentions);
    this.storedGrain.set(cached.storedGrain);
    this.allCommodities.set(cached.commodities);
    this._commodityByCode = new Map(cached.commodities.map(c => [c.code, c]));
    this.savedYieldEstimates.set(cached.savedYieldEstimates);
    this.savedMarketShares.set(cached.savedMarketShares);
    this.savedActualHarvest.set(cached.savedActualHarvest);

    this._calculateMetrics();
    this._calculateYieldRows();
    this._calculateCategoryRows();
  }

  private _saveDashboardCache(): void {
    this.appStateService.setDashboardCache({
      tradeUnitsKey: this.tradeUnitKey,
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

  private _loadData(): void {
    if (this._isLoading) return;
    this._isLoading = true;
    const tradeUnitToLoad = this.selectedDashboardTradeUnits().length > 0 ? this.selectedDashboardTradeUnits() : undefined;
    this.loading.set(true);

    forkJoin({
      customers: this.apiService.getCustomers(tradeUnitToLoad),
      contracts: this.apiService.getContracts(tradeUnitToLoad),
      plantingIntentions: this.apiService.getPlantingIntentions(),
      storedGrain: this.apiService.getStoredGrain(),
      commodities: this.apiService.getCommodities()
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.customers.set(data.customers);
        this.contracts.set(data.contracts);
        this.plantingIntentions.set(data.plantingIntentions);

        const customerIds = new Set(data.customers.map(c => c.id));
        this.storedGrain.set(data.storedGrain.filter(s => customerIds.has(s.customerId)));
        this.allCommodities.set(data.commodities);
        this._commodityByCode = new Map(data.commodities.map(c => [c.code, c]));

        this._calculateMetrics();
        this._calculateYieldRows();
        this.loadDashboardEstimates();

        this._isLoading = false;
        this.loading.set(false);

      },
      error: () => {
        this.toastService.error('Failed to load dashboard data');
        this._isLoading = false;
        this.loading.set(false);

      }
    });
  }

  private _calculateMetrics(): void {
    this.totalAcres.set(this.customers().reduce((sum, c) => sum + c.totalAcres, 0));
    this.activeContracts.set(this.contracts().filter(c => c.status === 'Active').length);
    this.totalContractValue.set(this.contracts().reduce((sum, c) => sum + c.quantity * c.price, 0));

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

  get tradeUnitKey(): string {
    return [...this.selectedDashboardTradeUnits()].sort().join(',');
  }

  onPlantingYearChange(): void {
    this.selectedPlantingYear.set(+this.selectedPlantingYear());
    this.reloadPlantingIntentions();
  }

  private _calculateYieldRows(): void {
    const selectedTUs = this.selectedDashboardTradeUnits();

    const forGlobalTUs = this.plantingIntentions().filter(p =>
      selectedTUs.length === 0 || selectedTUs.includes(p.tradeUnit)
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
      const commodity = this._commodityByCode.get(p.crop);
      const category = commodity?.category || p.crop;
      const cropKey = [p.type, category].filter(Boolean).join(' ');
      cropAcresMap.set(cropKey, (cropAcresMap.get(cropKey) || 0) + p.acres);
      cropCategoryMap.set(cropKey, category);
    }

    // Use crop keys from planting intentions only
    const allCropCodes = new Set<string>(cropAcresMap.keys());

    this.yieldRows.set(
      [...allCropCodes].sort().map(cropCode => {
        const saved = this.savedYieldEstimates().find(e => e.crop === cropCode);
        return {
          cropCode,
          cropName: cropCode,
          category: cropCategoryMap.get(cropCode) || 'Unknown',
          totalAcres: cropAcresMap.get(cropCode) || 0,
          yieldEstimate: saved?.yieldEstimate ?? null
        };
      })
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
    const key = this.tradeUnitKey;
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
          this.loadDashboardMarketShares();

        },
        error: () => {
          this.savedYieldEstimates.set([]);
          this._calculateYieldRows();

        }
      });
  }

  loadDashboardMarketShares(): void {
    const key = this.tradeUnitKey;
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
          this.loadActualHarvest();

        },
        error: () => {
          this.savedMarketShares.set([]);
          this._calculateCategoryRows();

        }
      });
  }

  loadActualHarvest(): void {
    const key = this.tradeUnitKey;
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
    const key = this.tradeUnitKey;
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
    const key = this.tradeUnitKey;
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
  // Add crop to yield estimates
  // =========================================================================

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

  rowColorBg(category: string): string {
    const idx = this.categoryRows().findIndex(r => r.category === category);
    if (idx < 0) return 'transition-colors';
    return `${DashboardComponent._CATEGORY_ROW_COLORS[idx % DashboardComponent._CATEGORY_ROW_COLORS.length]} transition-colors`;
  }

  // =========================================================================
  // Actual harvest rows (Table 5) computed
  // =========================================================================

  get actualHarvestRows(): { id: number; cropCategory: string; bushels: number }[] {
    return [...this.savedActualHarvest()]
      .filter(h => h.tradeUnitKey === this.tradeUnitKey && h.plantingYear === this.selectedPlantingYear() - 1)
      .sort((a, b) => a.cropCategory.localeCompare(b.cropCategory))
      .map(h => ({ id: h.id, cropCategory: h.cropCategory, bushels: h.bushels }));
  }

  /** Categories already added to Table 5 (prevents duplicates in dropdown) */
  get usedHarvestCrops(): Set<string> {
    return new Set(this.actualHarvestRows.map(r => r.cropCategory));
  }

  private static readonly _HARVEST_EXCLUDED_CATEGORIES = ['transportation', 'currency', 'feed & fert ingredients'];

  /** Commodity categories available to add (not already in Table 5, excluding non-crop categories) */
  get availableHarvestCropCategories(): string[] {
    const all = [...new Set(this.allCommodities().map(c => c.category).filter(Boolean) as string[])].sort();
    return all.filter(cat =>
      !this.usedHarvestCrops.has(cat) &&
      !DashboardComponent._HARVEST_EXCLUDED_CATEGORIES.includes(cat.toLowerCase())
    );
  }

  // =========================================================================
  // Actual market share rows (Table 6) computed
  // =========================================================================

  get actualMarketShareRows(): { cropCategory: string; harvestBushels: number; totalEstimatedProduction: number; pct: number | null }[] {
    const allCrops = new Set<string>();
    for (const r of this.actualHarvestRows) allCrops.add(r.cropCategory);
    for (const r of this.categoryRows()) allCrops.add(r.category);

    return [...allCrops].sort().map(crop => {
      const harvestRow = this.actualHarvestRows.find(r => r.cropCategory === crop);
      const prodRow = this.categoryRows().find(r => r.category === crop);
      const harvestBushels = harvestRow?.bushels ?? 0;
      const totalEstimatedProduction = prodRow?.totalEstimatedProduction ?? 0;
      const pct = totalEstimatedProduction > 0
        ? (harvestBushels / totalEstimatedProduction) * 100
        : null;
      return { cropCategory: crop, harvestBushels, totalEstimatedProduction, pct };
    });
  }

  // =========================================================================
  // Actual harvest CRUD
  // =========================================================================

  startHarvestEdit(): void {
    const map: Record<number, string> = {};
    for (const row of this.actualHarvestRows) {
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
    const rows = this.actualHarvestRows;
    const items = rows
      .map(row => {
        const bushels = parseInt(this.tempHarvestMap()[row.id] ?? '', 10);
        return { tradeUnitKey: this.tradeUnitKey, cropCategory: row.cropCategory, plantingYear: this.selectedPlantingYear() - 1, bushels };
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
    const key = this.tradeUnitKey;
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
  // New stat card / chart getters
  // =========================================================================

  get filteredIntentionsForYear(): PlantingIntention[] {
    const selectedTUs = this.selectedDashboardTradeUnits();
    return this.plantingIntentions().filter(p => {
      if (+p.plantingYear !== +this.selectedPlantingYear()) return false;
      if (selectedTUs.length > 0 && !selectedTUs.includes(p.tradeUnit)) return false;
      if (this.selectedCropFilter()) {
        const commodity = this._commodityByCode.get(p.crop);
        const category = commodity?.category || p.crop;
        if (category !== this.selectedCropFilter()) return false;
      }
      return true;
    });
  }

  get totalAcresForYear(): number {
    return this.filteredIntentionsForYear.reduce((sum, p) => sum + p.acres, 0);
  }

  get acresTrend(): number | null {
    const prevYear = this.selectedPlantingYear() - 1;
    const selectedTUs = this.selectedDashboardTradeUnits();
    const prevAcres = this.plantingIntentions()
      .filter(p => +p.plantingYear === prevYear && (selectedTUs.length === 0 || selectedTUs.includes(p.tradeUnit)))
      .reduce((sum, p) => sum + p.acres, 0);
    if (prevAcres === 0) return null;
    return ((this.totalAcresForYear - prevAcres) / prevAcres) * 100;
  }

  private _yieldEstimateMap(): Map<string, number | null> {
    const map = new Map<string, number | null>();
    for (const e of this.savedYieldEstimates()) {
      map.set(e.crop, e.yieldEstimate ?? null);
    }
    return map;
  }

  private get intentionProductionPairs(): { acres: number; yieldEst: number | null }[] {
    const yieldMap = this._yieldEstimateMap();
    return this.filteredIntentionsForYear.map(p => {
      const commodity = this._commodityByCode.get(p.crop);
      const category = commodity?.category || p.crop;
      const cropKey = [p.type, category].filter(Boolean).join(' ');
      return { acres: p.acres, yieldEst: yieldMap.get(cropKey) ?? null };
    });
  }

  get projectedProductionFormatted(): string {
    const total = this.intentionProductionPairs
      .filter(p => p.yieldEst != null)
      .reduce((sum, p) => sum + p.acres * p.yieldEst!, 0);
    return this.formatK(Math.round(total));
  }

  get averageYield(): number {
    const pairs = this.intentionProductionPairs.filter(p => p.yieldEst != null);
    const totalAcres = pairs.reduce((sum, p) => sum + p.acres, 0);
    const totalProd = pairs.reduce((sum, p) => sum + p.acres * p.yieldEst!, 0);
    return totalAcres > 0 ? Math.round(totalProd / totalAcres) : 0;
  }

  get activeGrowers(): number {
    return new Set(this.filteredIntentionsForYear.map(p => p.customerId)).size;
  }

  get availableCrops(): string[] {
    const selectedTUs = this.selectedDashboardTradeUnits();
    const crops = new Set<string>();

    // From planting intentions (all years) in the selected trade units
    for (const p of this.plantingIntentions()) {
      if (selectedTUs.length > 0 && !selectedTUs.includes(p.tradeUnit)) continue;
      const commodity = this._commodityByCode.get(p.crop);
      const category = commodity?.category || p.crop;
      if (category) crops.add(category);
    }

    // From contracts — use commodityGroup (broad name like "Corn", "Wheat", "Soybeans")
    for (const c of this.contracts()) {
      const group = c.commodityGroup || c.commodityDescription;
      if (group) crops.add(group);
    }

    return [...crops].sort();
  }

  get cropBreakdown(): { name: string; acres: number; pct: number; barColor: string; dotColor: string; hex: string }[] {
    const cropAcresMap = new Map<string, number>();
    for (const p of this.filteredIntentionsForYear) {
      const commodity = this._commodityByCode.get(p.crop);
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
  }

  get maxCropAcres(): number {
    return Math.max(...this.cropBreakdown.map(c => c.acres), 1);
  }

  get cropDistributionGradient(): string {
    if (this.cropBreakdown.length === 0) return 'conic-gradient(#e5e7eb 0deg 360deg)';
    let deg = 0;
    const stops: string[] = [];
    for (const c of this.cropBreakdown) {
      const end = deg + (c.pct / 100) * 360;
      stops.push(`${c.hex} ${deg}deg ${end}deg`);
      deg = end;
    }
    if (deg < 360) stops.push(`${this.cropBreakdown[0].hex} ${deg}deg 360deg`);
    return `conic-gradient(${stops.join(', ')})`;
  }

  get cropDetailsRows(): { name: string; acres: number; avgYield: number | null; production: number | null; growers: number; dotColor: string }[] {
    const yieldMap = this._yieldEstimateMap();
    return this.cropBreakdown.map(c => {
      const matching = this.filteredIntentionsForYear.filter(p => {
        const commodity = this._commodityByCode.get(p.crop);
        const category = commodity?.category || p.crop;
        const key = this.selectedCropFilter()
          ? [p.type, category].filter(Boolean).join(' ')
          : category;
        return key === c.name;
      });
      let totalProd = 0;
      let totalAcresWeighted = 0;
      for (const p of matching) {
        const commodity = this._commodityByCode.get(p.crop);
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
  }

  get topProducersRows(): { customerId: number; customerName: string; tradeUnit: string; acres: number; production: number | null; crops: string[] }[] {
    const yieldMap = this._yieldEstimateMap();
    const map = new Map<number, { customerName: string; tradeUnit: string; acres: number; production: number; cropSet: Set<string> }>();
    for (const p of this.filteredIntentionsForYear) {
      const commodity = this._commodityByCode.get(p.crop);
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
  }

  // =========================================================================
  // Harvest & Contracts tab computed data
  // =========================================================================

  get contractsForYear(): Contract[] {
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
  }

  get harvestTimelineMonths(): { month: string; monthIndex: number; segments: { commodity: string; bushels: number; hex: string }[]; total: number; barHeightPx: number }[] {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const commodityColorMap = new Map<string, string>();
    let colorIdx = 0;
    const monthData: Map<number, Map<string, number>> = new Map();
    for (let i = 0; i < 12; i++) monthData.set(i, new Map());

    for (const c of this.contractsForYear) {
      if (!c.deliveryStart) continue;
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
  }

  get harvestTimelineMax(): number {
    return Math.max(...this.harvestTimelineMonths.map(m => m.total), 1);
  }

  get harvestTimelineMidpoint(): number {
    return Math.floor(this.harvestTimelineMax / 2);
  }

  get contractCommodityLegend(): { commodity: string; hex: string }[] {
    const seen = new Set<string>();
    const result: { commodity: string; hex: string }[] = [];
    for (const m of this.harvestTimelineMonths) {
      for (const seg of m.segments) {
        if (!seen.has(seg.commodity)) {
          seen.add(seg.commodity);
          result.push({ commodity: seg.commodity, hex: seg.hex });
        }
      }
    }
    return result;
  }

  get contractCoverageRows(): { category: string; estimatedBu: number; contractedBu: number; pct: number; hex: string }[] {
    return this.categoryRows().map((row, i) => {
      const categoryLower = row.category.toLowerCase();
      const contracted = this.contractsForYear
        .filter(c => {
          const d = (c.commodityDescription || c.commodityGroup || c.commodityCode || '').toLowerCase();
          return d.includes(categoryLower) || categoryLower.startsWith(d.split(' ')[0]);
        })
        .reduce((s, c) => s + (c.quantity || 0), 0);
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
  }

  get salesOpportunityRows(): { commodity: string; contracts: number; totalBu: number; openBu: number; unpricedBu: number; avgPrice: number; hex: string }[] {
    const map = new Map<string, { total: number; open: number; priced: number; value: number; count: number }>();
    for (const c of this.contractsForYear) {
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
