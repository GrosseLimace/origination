import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectorRef, Component, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { Observable, Subject, of, throwError } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { AppStateService, DashboardCacheEntry } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';
import { commodityChipClass } from '@shared/utils/commodity-color';
import { CommodityChipClassPipe } from '@shared/pipes/commodity-chip-class.pipe';
import { makeMsalServiceMock } from '@testing/msal.mocks';
import {
  Commodity, CommodityConversion, Contract, Customer, DashboardActualHarvest, DashboardMarketShare,
  DashboardPlantingEstimate, DashboardSummary, NoteLastContact, PlantingIntention, ProducerDetails, StoredGrain,
} from '@models';

import { DashboardComponent } from './dashboard.component';

// Behaviour safety net for the origination dashboard ahead of an OnPush/memoisation refactor.
// Everything is driven through public methods, signals and computeds plus the rendered DOM, so
// internals (private caches, the microtask debounce, request ids) can change underneath freely.
//
// The REAL template renders. The only swap is <app-trade-unit-selector>, replaced by an inert stub
// with the same selector: it owns its own service graph (UserTradeUnitsService, groups fetch) that
// has nothing to do with the dashboard's behaviour.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Frozen (Date only) so selectedPlantingYear starts at 2026 and "contacted N days ago" is stable. */
const NOW = new Date('2026-10-13T12:00:00');
const YEAR = 2026;
const TU = '2090';
const OTHER_TU = '3811';

const COMMODITIES: Commodity[] = [
  { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true },
  { id: 2, code: 'SB', name: 'Soybeans', category: 'Soybeans', isActive: true },
  { id: 3, code: 'HRW', name: 'Hard Red Winter Wheat', category: 'Wheat', isActive: true },
  { id: 4, code: 'FRT', name: 'Freight', category: 'Transportation', isActive: true },
];

/** SB weighs 60 lb/bu, so a 30 short-ton contract is 30 * 2000 / 60 = 1,000 bu. */
const CONVERSIONS: CommodityConversion[] = [{ commodityCode: 'SB', lbsPerUnit: 60 }];

function makeCustomer(over: Partial<Customer>): Customer {
  return {
    id: 0, name: '', farm: '', location: '', phone: '', email: '', totalAcres: 0,
    linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

const CUSTOMERS: Customer[] = [
  makeCustomer({ id: 1, scoularId: 'ALPHA', name: 'Alpha Farms', totalAcres: 400 }),
  makeCustomer({ id: 2, scoularId: 'BRAVO', name: 'Bravo Ag', totalAcres: 300 }),
  // No planting intentions at all — the "without intentions" producer.
  makeCustomer({ id: 3, scoularId: 'CHARLIE', name: 'Charlie Grain', totalAcres: 100, commodities: ['YC', 'HRW'] }),
];

function pi(over: Partial<PlantingIntention>): PlantingIntention {
  return {
    id: 0, customerId: 1, customerName: 'Alpha Farms', customerCode: 'ALPHA', tradeUnit: TU,
    plantingYear: YEAR, crop: 'YC', acres: 0, createdAt: '2026-01-01', createdBy: 'test', ...over,
  };
}

/**
 * In scope for 2026 on TU 2090: Alpha 100 ac Irrigated Corn + 50 ac Dryland Corn, Bravo 200 ac
 * Soybeans = 350 ac. 2025 (prior year): 80 + 120 = 200 ac. Everything else must be filtered out.
 */
const INTENTIONS: PlantingIntention[] = [
  pi({ id: 1, crop: 'YC', type: 'Irrigated', acres: 100 }),
  pi({ id: 2, crop: 'YC', type: 'Dryland', acres: 50 }),
  pi({ id: 3, customerId: 2, customerName: 'Bravo Ag', customerCode: 'BRAVO', crop: 'SB', acres: 200 }),
  // Bravo's other trade unit — counts only when 3811 is in scope.
  pi({ id: 4, customerId: 2, customerName: 'Bravo Ag', customerCode: 'BRAVO', crop: 'YC', type: 'Dryland', acres: 30, tradeUnit: OTHER_TU }),
  pi({ id: 5, crop: 'YC', type: 'Irrigated', acres: 80, plantingYear: 2025 }),
  pi({ id: 6, customerId: 2, customerName: 'Bravo Ag', customerCode: 'BRAVO', crop: 'SB', acres: 120, plantingYear: 2025 }),
  // A producer who isn't loaded for this trade unit — never counted, not even for the year list.
  pi({ id: 7, customerId: 99, customerName: 'Stranger', customerCode: 'STRNGR', crop: 'YC', acres: 500 }),
  pi({ id: 8, customerId: 99, customerName: 'Stranger', customerCode: 'STRNGR', crop: 'YC', acres: 500, plantingYear: 2024 }),
];

function estimate(crop: string, yieldEstimate: number | undefined, plantingYear = YEAR): DashboardPlantingEstimate {
  return { id: 0, tradeUnitKey: TU, crop, plantingYear, yieldEstimate };
}
function share(cropCategory: string, marketSharePct: number | undefined, plantingYear = YEAR): DashboardMarketShare {
  return { id: 0, tradeUnitKey: TU, cropCategory, plantingYear, marketSharePct };
}
function harvest(id: number, cropCategory: string, bushels: number, over: Partial<DashboardActualHarvest> = {}): DashboardActualHarvest {
  return { id, tradeUnitKey: TU, cropCategory, plantingYear: YEAR - 1, bushels, ...over };
}

/** 2026 production: Irrigated Corn 100*200 + Dryland Corn 50*120 = 26,000; Soybeans 200*50 = 10,000. */
const ESTIMATES_2026 = [estimate('Irrigated Corn', 200), estimate('Dryland Corn', 120), estimate('Soybeans', 50)];
const SHARES_2026 = [share('Corn', 10)];
const HARVEST = [
  harvest(11, 'Corn', 13000),
  harvest(12, 'Wheat', 5000),
  harvest(13, 'Corn', 999, { tradeUnitKey: OTHER_TU }), // another trade-unit key
  harvest(14, 'Corn', 7000, { plantingYear: YEAR - 2 }), // wrong year
];
const SUMMARY_2026: DashboardSummary = { estimates: ESTIMATES_2026, marketShares: SHARES_2026, actualHarvest: HARVEST };
const SUMMARY_2025: DashboardSummary = {
  estimates: [estimate('Irrigated Corn', 180, 2025), estimate('Soybeans', 45, 2025)],
  marketShares: [],
  actualHarvest: [],
};
const EMPTY_SUMMARY: DashboardSummary = { estimates: [], marketShares: [], actualHarvest: [] };

function contract(over: Partial<Contract>): Contract {
  return {
    id: 0, customerId: 1, ctrmCustomerId: 'ALPHA', sourceContractId: 'P0', farmId: 'F1', contractNumber: '0',
    contractPrefixType: 'P', commodityCode: 'YC', commodityDescription: 'Corn', commodityGroup: 'Corn',
    quantity: 0, unit: 'BU', price: 0, cropYear: YEAR,
    deliveryStart: new Date(2026, 9, 15, 12), deliveryEnd: new Date(2026, 11, 31, 12),
    status: 'Active', signed: true, ...over,
  };
}

/** base.Contract crop-year read: 13,000 bu Corn (Oct) + 30 ST Soybeans = 1,000 bu (Nov). */
const CROP_YEAR_CONTRACTS: Contract[] = [
  contract({ id: 100, sourceContractId: 'PYC100', quantity: 13000, openBalanceQuantity: 10000, pricedQuantity: 3000, totalValue: 52000 }),
  contract({
    id: 200, sourceContractId: 'PSB200', ctrmCustomerId: 'BRAVO', commodityCode: 'SB', commodityDescription: 'Soybeans',
    commodityGroup: 'Soybeans', quantity: 30, unit: 'ST', price: 400, openBalanceQuantity: 30, pricedQuantity: 0,
    deliveryStart: new Date(2026, 10, 2, 12),
  }),
  contract({ id: 300, sourceContractId: 'PYC300', quantity: 777, cropYear: 2025 }), // another crop year
];

/** vw_CurrentContracts (app state): drives the headline metrics and the fallback when the crop-year read is empty. */
const APP_CONTRACTS: Contract[] = [
  contract({ id: 1, sourceContractId: 'PYC1', quantity: 3000, totalValue: 12000, status: 'Active' }),
  contract({
    id: 2, sourceContractId: 'PSB2', ctrmCustomerId: 'CHARLIE', commodityCode: 'SB', commodityDescription: 'Soybeans',
    commodityGroup: 'Soybeans', quantity: 30, unit: 'ST', totalValue: 4000, status: 'Pending',
  }),
  contract({ id: 3, sourceContractId: 'PYC3', quantity: 5000, totalValue: 99999, closedDate: new Date(2026, 5, 1) }),
];

// ── Stubs ─────────────────────────────────────────────────────────────────────

@Component({ selector: 'app-trade-unit-selector', standalone: true, template: '' })
class TradeUnitSelectorStub {}

/** The AppStateService members the dashboard reads, as real signals so its computeds/effects react. */
function makeAppState() {
  const selectedTradeUnits = signal<string[]>([TU]);
  const commodities = signal<Commodity[]>([]);
  const plantingIntentions = signal<PlantingIntention[]>(INTENTIONS);
  const dashboardCache = signal<DashboardCacheEntry | null>(null);
  return {
    customers: signal<Customer[]>(CUSTOMERS),
    contracts: signal<Contract[]>(APP_CONTRACTS),
    plantingIntentions,
    storedGrain: signal<StoredGrain[]>([]),
    commodities,
    commodityConversions: signal<CommodityConversion[]>(CONVERSIONS),
    noteLastContacts: signal<NoteLastContact[]>([]),
    noteLastContactsLoadFailed: signal(false),
    plantingIntentionsLoadFailed: signal(false),
    commodityConversionsLoadFailed: signal(false),
    customersLoadFailed: signal(false),
    producerDetails: signal<ProducerDetails[]>([]),
    customersLoading: signal(false),
    contractsLoading: signal(false),
    dataLoading: signal(false),
    allProducersMode: signal(false),
    selectedTradeUnits,
    inScopeTradeUnitCodes: computed<readonly string[]>(() => selectedTradeUnits()),
    dashboardCache,
    preloadedDashboardSummary: signal<(DashboardSummary & { tradeUnitsKey: string; year: number }) | null>(null),
    setCommodities: vi.fn((c: Commodity[]) => commodities.set(c)),
    setPlantingIntentions: vi.fn((p: PlantingIntention[]) => plantingIntentions.set(p)),
    setPlantingIntentionsLoadFailed: vi.fn((_failed: boolean) => undefined),
    setDashboardCache: vi.fn((e: DashboardCacheEntry) => dashboardCache.set(e)),
  };
}

function makeApi() {
  return {
    getCommodities: vi.fn((): Observable<Commodity[]> => of(COMMODITIES)),
    getDashboardSummary: vi.fn((_key: string, year: number): Observable<DashboardSummary> =>
      of(year === YEAR ? SUMMARY_2026 : year === YEAR - 1 ? SUMMARY_2025 : EMPTY_SUMMARY)),
    getContractsByCropYear: vi.fn((_year: number, _tus?: string[]): Observable<Contract[]> => of(CROP_YEAR_CONTRACTS)),
    getPlantingIntentions: vi.fn((_tus: string[]): Observable<PlantingIntention[]> => of(INTENTIONS)),
    getDashboardPlantingEstimates: vi.fn((_key: string, _year: number): Observable<DashboardPlantingEstimate[]> => of(ESTIMATES_2026)),
    getDashboardMarketShares: vi.fn((_key: string, _year: number): Observable<DashboardMarketShare[]> => of(SHARES_2026)),
    getDashboardActualHarvest: vi.fn((_key: string, _year: number): Observable<DashboardActualHarvest[]> => of(HARVEST)),
    upsertDashboardPlantingEstimates: vi.fn((_items: unknown[]): Observable<void> => of(undefined)),
    upsertDashboardMarketShares: vi.fn((_items: unknown[]): Observable<void> => of(undefined)),
    upsertDashboardActualHarvest: vi.fn((_items: unknown[]): Observable<void> => of(undefined)),
    deleteDashboardActualHarvest: vi.fn((_id: number): Observable<void> => of(undefined)),
  };
}

const fail = <T>(): Observable<T> => throwError(() => new Error('boom'));

// ── Harness ───────────────────────────────────────────────────────────────────

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let c: DashboardComponent;
  let appState: ReturnType<typeof makeAppState>;
  let api: ReturnType<typeof makeApi>;
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let usage: { postClickEvent: ReturnType<typeof vi.fn>; trackDashboardTabClick: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => host().textContent ?? '';

  /** Run CD (which runs the effects), let the queueMicrotask-debounced recalculation land, then
   *  render again. Direct method calls don't dirty the view the way a DOM event does, so mark it. */
  async function settle(): Promise<void> {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }

  /** Arrange app state / API overrides BEFORE construction — the constructor picks the load path. */
  async function build(arrange: () => void = () => {}): Promise<void> {
    arrange();
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: AppStateService, useValue: appState },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: UsageTrackingService, useValue: usage },
        { provide: Router, useValue: router },
        { provide: MsalService, useValue: makeMsalServiceMock() },
      ],
    });
    TestBed.overrideComponent(DashboardComponent, {
      remove: { imports: [TradeUnitSelectorComponent] },
      add: { imports: [TradeUnitSelectorStub] },
    });
    fixture = TestBed.createComponent(DashboardComponent);
    c = fixture.componentInstance;
    await settle();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    appState = makeAppState();
    api = makeApi();
    toast = { success: vi.fn(), error: vi.fn() };
    usage = { postClickEvent: vi.fn(), trackDashboardTabClick: vi.fn() };
    router = { navigate: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial load + headline rollups ─────────────────────────────────────────

  describe('initial load', () => {
    it('fetches commodities, the year summary and the crop-year contracts for the selected trade unit and year', async () => {
      await build();

      expect(c.selectedPlantingYear()).toBe(YEAR);
      expect(api.getCommodities).toHaveBeenCalledTimes(1);
      expect(api.getDashboardSummary).toHaveBeenCalledWith(TU, YEAR);
      expect(api.getContractsByCropYear).toHaveBeenCalledWith(YEAR, [TU]);
      // Commodities fetched here are shared back into app state, and the result is cached by TU + year.
      expect(appState.setCommodities).toHaveBeenCalledWith(COMMODITIES);
      expect(appState.dashboardCache()).toMatchObject({ tradeUnitsKey: TU, year: YEAR, savedYieldEstimates: ESTIMATES_2026 });
      expect(c.loading()).toBe(false);
    });

    it('rolls up only in-scope, current-year acres into the headline stats and renders them', async () => {
      await build();

      // 100 + 50 + 200 — excludes the 3811 row, the unloaded producer and other years.
      expect(c.totalAcresForYear()).toBe(350);
      expect(c.activeGrowers()).toBe(2);
      // 2025 had 200 in-scope acres → +75%.
      expect(c.acresTrend()).toBe(75);
      // 20,000 + 6,000 + 10,000 bu.
      expect(c.projectedProductionFormatted()).toBe('36K');
      // 36,000 bu / 350 ac, acre-weighted.
      expect(c.averageYield()).toBe(103);

      expect(text()).toContain('350');
      expect(text()).toContain('36K');
      expect(text()).toContain('vs 2025');
    });

    it('lists only in-scope planting years, newest first', async () => {
      await build();

      // 2024 exists only for a producer who is not loaded, so it is not offered.
      expect(c.availablePlantingYears()).toEqual([2026, 2025]);
    });

    it('excludes acres without a yield estimate from projected production and the weighted average', async () => {
      await build(() => {
        api.getDashboardSummary.mockReturnValue(of({ ...SUMMARY_2026, estimates: [estimate('Irrigated Corn', 200)] }));
      });

      expect(c.projectedProductionFormatted()).toBe('20K');
      // Only the 100 estimated acres count toward the average, not all 350.
      expect(c.averageYield()).toBe(200);
    });

    it('computes headline contract metrics from OPEN app-state contracts only, in bushels', async () => {
      await build();

      expect(c.totalAcres()).toBe(800);
      expect(c.activeContracts()).toBe(1);
      expect(c.totalContractValue()).toBe(16000); // the closed 99,999 contract is excluded
      // Corn 3,000 bu vs Soybeans 30 ST = 1,000 bu → 75 / 25 (raw quantity would read 99 / 1).
      expect(c.cropDistribution()).toEqual([
        { name: 'Corn', bushels: 3000, percentage: 75, color: 'bg-green-500' },
        { name: 'Soybeans', bushels: 1000, percentage: 25, color: 'bg-blue-500' },
      ]);
      expect(c.contractStatus()).toEqual([
        { name: 'Active', count: 1, dotColor: 'bg-green-500' },
        { name: 'Pending', count: 1, dotColor: 'bg-amber-500' },
      ]);
    });
  });

  // ── Per-crop and per-category rollups ───────────────────────────────────────

  describe('crop and category rollups', () => {
    it('groups the crop breakdown by category, largest first, with rounded shares and per-crop colours', async () => {
      await build();

      const rows = c.cropBreakdown();
      expect(rows.map(r => [r.name, r.acres, r.pct])).toEqual([
        ['Soybeans', 200, 57],
        ['Corn', 150, 43],
      ]);
      // Colour follows the crop, not the sort position.
      expect(rows[0].barColor).toBe('bg-blue-500');
      expect(rows[1].barColor).toBe('bg-amber-500');
      expect(c.maxCropAcres()).toBe(200);
      expect(c.cropDistributionGradient()).toBe('conic-gradient(#3b82f6 0deg 205.2deg, #f59e0b 205.2deg 360deg)');
    });

    it('derives per-crop average yield, production and grower counts', async () => {
      await build();

      expect(c.cropDetailsRows().map(r => ({ name: r.name, avgYield: r.avgYield, production: r.production, growers: r.growers }))).toEqual([
        { name: 'Soybeans', avgYield: 50, production: 10000, growers: 1 },
        // (100*200 + 50*120) / 150 = 173.3
        { name: 'Corn', avgYield: 173, production: 26000, growers: 1 },
      ]);
    });

    it('builds yield rows per planting type + crop, grouped by commodity, carrying saved estimates', async () => {
      await build();

      expect(c.yieldRows()).toEqual([
        { cropCode: 'Dryland Corn', cropName: 'Dryland Corn', category: 'Corn', totalAcres: 50, yieldEstimate: 120 },
        { cropCode: 'Irrigated Corn', cropName: 'Irrigated Corn', category: 'Corn', totalAcres: 100, yieldEstimate: 200 },
        { cropCode: 'Soybeans', cropName: 'Soybeans', category: 'Soybeans', totalAcres: 200, yieldEstimate: 50 },
      ]);
    });

    it('applies market share to category production, leaving the handle at 0 when no share is set', async () => {
      await build();

      expect(c.categoryRows()).toEqual([
        { category: 'Corn', totalEstimatedProduction: 26000, marketSharePct: 10, estimatedHarvestHandle: 2600 },
        { category: 'Soybeans', totalEstimatedProduction: 10000, marketSharePct: null, estimatedHarvestHandle: 0 },
      ]);
      expect(c.categoryColorMap().get('Corn')).toContain('bg-amber-100');
    });

    it('computes actual market share against estimated production, guarding divide-by-zero with null', async () => {
      await build();

      // Only last year's rows for THIS trade-unit key.
      expect(c.actualHarvestRows()).toEqual([
        { id: 11, cropCategory: 'Corn', bushels: 13000 },
        { id: 12, cropCategory: 'Wheat', bushels: 5000 },
      ]);
      expect(c.actualMarketShareRows()).toEqual([
        { cropCategory: 'Corn', harvestBushels: 13000, totalEstimatedProduction: 26000, pct: 50 },
        { cropCategory: 'Soybeans', harvestBushels: 0, totalEstimatedProduction: 10000, pct: 0 },
        // Harvest recorded but no estimated production → null, never Infinity/NaN.
        { cropCategory: 'Wheat', harvestBushels: 5000, totalEstimatedProduction: 0, pct: null },
      ]);
      // Crops already harvested and non-crop categories are not offered for a new harvest row.
      expect(c.availableHarvestCropCategories()).toEqual(['Soybeans']);
    });

    it('offers planting categories and title-cased ODS contract groups as one de-duplicated crop list', async () => {
      await build(() => appState.contracts.set([
        ...APP_CONTRACTS,
        contract({ id: 4, sourceContractId: 'PHRW4', commodityCode: 'HRW', commodityDescription: 'HARD RED WINTER WHEAT', commodityGroup: 'WHEAT' }),
        contract({ id: 5, sourceContractId: 'PYC5', commodityGroup: 'CORN' }),
      ]));

      expect(c.availableCrops()).toEqual(['Corn', 'Soybeans', 'Wheat']);
      const options = Array.from(host().querySelectorAll('select option')).map(o => o.textContent?.trim());
      expect(options).toEqual(['All Crops', 'Corn', 'Soybeans', 'Wheat']);
    });

    it('renders the By Crop charts with compact acre labels and the crop details table', async () => {
      await build(() => appState.plantingIntentions.set([
        ...INTENTIONS,
        pi({ id: 9, customerId: 2, customerName: 'Bravo Ag', customerCode: 'BRAVO', crop: 'SB', acres: 1800 }),
      ]));

      // Soybeans 2,000 ac → "2K"; Corn 150 ac stays as is.
      expect(text()).toContain('2K');
      expect(text()).toContain('150');
      expect(text()).toContain('Crop Details');
      expect(text()).toContain('100K bu'); // Soybeans 2,000 ac × 50 bu/ac
      expect(text()).toContain('26K bu');
    });

    it('narrows every rollup to the top crop filter and splits that crop by planting type', async () => {
      await build();
      c.producerCropFilter.set('dryland corn');

      c.selectedCropFilter.set('Corn');
      c.onCropFilterChange();
      await settle();

      expect(c.totalAcresForYear()).toBe(150);
      expect(c.cropBreakdown().map(r => [r.name, r.acres])).toEqual([['Irrigated Corn', 100], ['Dryland Corn', 50]]);
      expect(c.contractsForYear().map(x => x.id)).toEqual([100]);
      // The chip filter's valid values change with the top filter, so it is reset.
      expect(c.producerCropFilter()).toBe('');
    });
  });

  // ── Harvest & Contracts ─────────────────────────────────────────────────────

  describe('harvest & contracts', () => {
    it('measures contract coverage in bushels per category and shows it on the tab', async () => {
      await build();

      expect(c.contractCoverageRows().map(r => [r.category, r.estimatedBu, r.contractedBu, r.pct])).toEqual([
        ['Corn', 26000, 13000, 50],
        ['Soybeans', 10000, 1000, 10], // 30 ST → 1,000 bu, not 30
      ]);

      c.selectDashboardTab('harvestContracts');
      await settle();
      expect(text()).toContain('Contract Coverage');
      expect(text()).toContain('50%');
      expect(text()).toContain('13K bu contracted');
    });

    it('caps coverage at 999% and reports 0% for a category with no estimated production', async () => {
      await build(() => {
        api.getDashboardSummary.mockReturnValue(of({ ...SUMMARY_2026, estimates: [estimate('Soybeans', 50)] }));
        api.getContractsByCropYear.mockReturnValue(of([
          contract({ id: 400, sourceContractId: 'PSB400', commodityCode: 'SB', commodityDescription: 'Soybeans', commodityGroup: 'Soybeans', quantity: 500000 }),
          contract({ id: 401, sourceContractId: 'PYC401', quantity: 5000 }),
        ]));
      });

      const byCategory = new Map(c.contractCoverageRows().map(r => [r.category, r.pct]));
      expect(byCategory.get('Soybeans')).toBe(999);
      expect(byCategory.get('Corn')).toBe(0);
    });

    it('summarises sales opportunities per commodity in bushels, sorted by open bushels', async () => {
      await build();

      expect(c.salesOpportunityRows().map(r => ({
        commodity: r.commodity, contracts: r.contracts, totalBu: r.totalBu, openBu: r.openBu, unpricedBu: r.unpricedBu, avgPrice: r.avgPrice,
      }))).toEqual([
        { commodity: 'Corn', contracts: 1, totalBu: 13000, openBu: 10000, unpricedBu: 10000, avgPrice: 4 },
        // 30 ST at $400/ST is 1,000 bu at $12/bu: the same figure Contract Coverage shows beside it.
        // On raw quantity this row read 30 bu at $400.
        { commodity: 'Soybeans', contracts: 1, totalBu: 1000, openBu: 1000, unpricedBu: 1000, avgPrice: 12 },
      ]);
      expect(c.salesOpportunityExcluded()).toBe(0);
    });

    it('leaves out, and says it left out, contracts whose unit cannot be shown in bushels', async () => {
      await build(() => {
        api.getContractsByCropYear.mockReturnValue(of([
          ...CROP_YEAR_CONTRACTS,
          contract({ id: 600, sourceContractId: 'PYC600', quantity: 3, unit: 'RC', openBalanceQuantity: 3 }), // rail cars
        ]));
      });

      expect(c.salesOpportunityExcluded()).toBe(1);
      expect(c.salesOpportunityRows().find(r => r.commodity === 'Corn')?.contracts).toBe(1);

      c.selectDashboardTab('harvestContracts');
      await settle();
      expect(text()).toContain("1 contract not shown: its unit can't be converted to bushels.");
    });

    it('buckets PURCHASE contract volume into the harvest timeline by delivery month', async () => {
      await build(() => {
        api.getContractsByCropYear.mockReturnValue(of([
          ...CROP_YEAR_CONTRACTS,
          contract({ id: 500, sourceContractId: 'SYC500', quantity: 50000 }), // sale — excluded
        ]));
      });

      const months = c.harvestTimelineMonths();
      expect(months[9].total).toBe(13000);
      expect(months[9].barHeightPct).toBe(100);
      expect(months[10].total).toBe(1000); // 30 short tons of soybeans, in bushels like the tables beside it
      expect(months.filter(m => m.total === 0)).toHaveLength(10);
      expect(c.harvestTimelineMax()).toBe(13000);
      expect(c.harvestTimelineMidpoint()).toBe(6500);
      expect(c.contractCommodityLegend().map(l => l.commodity)).toEqual(['Corn', 'Soybeans']);
    });

    it('falls back to app-state contracts when the crop-year read returns nothing', async () => {
      await build(() => api.getContractsByCropYear.mockReturnValue(of([])));

      expect(c.cropYearLoadFailed()).toBe(false);
      expect(c.contractsForYear().map(x => x.id)).toEqual([1, 2, 3]);
    });

    it('flags a failed crop-year read, says so on the tab, and clears the flag for the next year', async () => {
      await build(() => api.getContractsByCropYear.mockReturnValueOnce(fail<Contract[]>()));

      expect(c.cropYearLoadFailed()).toBe(true);
      c.selectDashboardTab('harvestContracts');
      await settle();
      expect(text()).toContain('could not be loaded from CTRM');

      c.prevYear();
      await settle();

      expect(api.getContractsByCropYear).toHaveBeenLastCalledWith(2025, [TU]);
      expect(c.cropYearLoadFailed()).toBe(false);
      expect(text()).not.toContain('could not be loaded from CTRM');
    });
  });

  // ── Year and trade-unit changes ─────────────────────────────────────────────

  describe('year and trade-unit changes', () => {
    it('refetches year-specific data on year navigation and recomputes for that year', async () => {
      await build();
      c.selectedCropFilter.set('Corn');

      c.prevYear();
      await settle();

      expect(c.selectedPlantingYear()).toBe(2025);
      expect(c.selectedCropFilter()).toBe('');
      expect(api.getDashboardSummary).toHaveBeenLastCalledWith(TU, 2025);
      expect(api.getContractsByCropYear).toHaveBeenLastCalledWith(2025, [TU]);
      expect(c.totalAcresForYear()).toBe(200);
      expect(c.acresTrend()).toBeNull(); // no in-scope 2024 acres
      expect(c.yieldRows().map(r => [r.cropCode, r.yieldEstimate])).toEqual([['Irrigated Corn', 180], ['Soybeans', 45]]);
      expect(c.projectedProductionFormatted()).toBe('20K'); // 80*180 + 120*45 = 19,800
      expect(text()).toContain('No prior year data');

      c.nextYear();
      await settle();
      expect(api.getDashboardSummary).toHaveBeenLastCalledWith(TU, YEAR);
      expect(c.totalAcresForYear()).toBe(350);
    });

    it('discards a stale year response that lands after a newer one', async () => {
      const late2025 = new Subject<DashboardSummary>();
      const prompt2026 = new Subject<DashboardSummary>();
      await build();
      api.getDashboardSummary.mockImplementation((_key: string, year: number) => (year === 2025 ? late2025 : prompt2026));

      c.prevYear();
      c.nextYear();
      prompt2026.next(SUMMARY_2026);
      late2025.next(SUMMARY_2025);
      await settle();

      expect(c.selectedPlantingYear()).toBe(YEAR);
      expect(c.savedYieldEstimates()).toEqual(ESTIMATES_2026);
      expect(c.yieldRows().find(r => r.cropCode === 'Irrigated Corn')?.yieldEstimate).toBe(200);
    });

    it('refetches with a sorted trade-unit key when the selection changes, and widens the scope', async () => {
      await build();
      api.getDashboardSummary.mockClear();

      appState.selectedTradeUnits.set([OTHER_TU, TU]);
      await settle();

      expect(c.tradeUnitKey()).toBe('2090,3811');
      expect(api.getDashboardSummary).toHaveBeenCalledWith('2090,3811', YEAR);
      expect(api.getContractsByCropYear).toHaveBeenLastCalledWith(YEAR, [OTHER_TU, TU]);
      // Bravo's 3811 row now counts, and the producer row lists both trade units.
      expect(c.totalAcresForYear()).toBe(380);
      expect(c.showProducerTradeUnitColumn()).toBe(true);
      expect(c.producersWithIntentionsRows().find(r => r.customerId === 2)?.tradeUnit).toBe('2090, 3811');
    });

    it('counts every trade unit in All Producers mode and asks for a trade unit instead of fetching', async () => {
      await build(() => {
        appState.allProducersMode.set(true);
        appState.selectedTradeUnits.set([]);
      });

      expect(c.totalAcresForYear()).toBe(380);
      expect(api.getDashboardSummary).not.toHaveBeenCalled();
      expect(api.getContractsByCropYear).toHaveBeenCalledWith(YEAR, undefined);
      expect(text()).toContain('Select a trade unit above to view dashboard');
    });
  });

  // ── Cached / preloaded paths ────────────────────────────────────────────────

  describe('cache and preload', () => {
    function cacheEntry(year: number): DashboardCacheEntry {
      return {
        tradeUnitsKey: TU, year, customers: CUSTOMERS, contracts: APP_CONTRACTS, plantingIntentions: INTENTIONS,
        storedGrain: [], commodities: COMMODITIES, savedYieldEstimates: [estimate('Soybeans', 60)],
        savedMarketShares: [share('Soybeans', 25)], savedActualHarvest: [], loadedAt: NOW,
      };
    }

    it('restores a cache entry for the same trade unit AND year without any summary/commodity fetch', async () => {
      await build(() => appState.dashboardCache.set(cacheEntry(YEAR)));

      expect(api.getDashboardSummary).not.toHaveBeenCalled();
      expect(api.getCommodities).not.toHaveBeenCalled();
      expect(c.categoryRows().find(r => r.category === 'Soybeans')).toEqual(
        { category: 'Soybeans', totalEstimatedProduction: 12000, marketSharePct: 25, estimatedHarvestHandle: 3000 },
      );
    });

    it('ignores a cache entry from another year and fetches fresh', async () => {
      await build(() => appState.dashboardCache.set(cacheEntry(2025)));

      expect(api.getDashboardSummary).toHaveBeenCalledWith(TU, YEAR);
      expect(c.savedYieldEstimates()).toEqual(ESTIMATES_2026);
    });

    it('uses a preloaded summary and preloaded commodities with no HTTP at all', async () => {
      await build(() => {
        appState.commodities.set(COMMODITIES);
        appState.preloadedDashboardSummary.set({ ...SUMMARY_2026, tradeUnitsKey: TU, year: YEAR });
      });

      expect(api.getDashboardSummary).not.toHaveBeenCalled();
      expect(api.getCommodities).not.toHaveBeenCalled();
      expect(c.projectedProductionFormatted()).toBe('36K');
    });

    it('fetches planting intentions alongside the summary when app state has none yet', async () => {
      await build(() => appState.plantingIntentions.set([]));
      expect(c.totalAcresForYear()).toBe(0);

      c.reloadPlantingIntentions();
      await settle();

      expect(api.getPlantingIntentions).toHaveBeenCalledWith([TU]);
      expect(appState.setPlantingIntentions).toHaveBeenCalledWith(INTENTIONS);
      expect(c.totalAcresForYear()).toBe(350);
      expect(c.loading()).toBe(false);
    });
  });

  // ── Empty data and failures ─────────────────────────────────────────────────

  describe('empty data and API failures', () => {
    it('renders sane zero states with no planting intentions', async () => {
      await build(() => appState.plantingIntentions.set([]));

      expect(c.totalAcresForYear()).toBe(0);
      expect(c.acresTrend()).toBeNull();
      expect(c.averageYield()).toBe(0);
      expect(c.projectedProductionFormatted()).toBe('--');
      expect(c.cropBreakdown()).toEqual([]);
      expect(c.maxCropAcres()).toBe(1);
      expect(c.cropDistributionGradient()).toBe('conic-gradient(#e5e7eb 0deg 360deg)');
      expect(c.yieldRows()).toEqual([]);
      expect(c.categoryRows()).toEqual([]);
      expect(c.contractCoverageRows()).toEqual([]);
      expect(text()).toContain('No prior year data');
    });

    it('stays usable when the initial summary and commodity reads both fail', async () => {
      await build(() => {
        api.getDashboardSummary.mockReturnValue(fail<DashboardSummary>());
        api.getCommodities.mockReturnValue(fail<Commodity[]>());
      });

      expect(c.loading()).toBe(false);
      expect(c.allCommodities()).toEqual([]);
      // Acres still roll up; with no commodity lookup the crop code stands in for the category.
      expect(c.totalAcresForYear()).toBe(350);
      expect(c.yieldRows().every(r => r.yieldEstimate === null)).toBe(true);
      expect(c.projectedProductionFormatted()).toBe('--');
      expect(text()).toContain('Total Acres');
      expect(text()).not.toContain('Loading dashboard data');
    });

    it('drops the previous year\'s figures when the summary for the new year fails', async () => {
      await build();
      api.getDashboardSummary.mockReturnValue(fail<DashboardSummary>());

      c.prevYear();
      await settle();

      expect(c.loading()).toBe(false);
      expect(c.savedYieldEstimates()).toEqual([]);
      expect(c.yieldRows().every(r => r.yieldEstimate === null)).toBe(true);
      expect(c.actualHarvestRows()).toEqual([]);
    });
  });

  // ── Recorded load failures ──────────────────────────────────────────────────
  // A failed trade-unit read resolves to an empty list, so each empty state must say "could not be
  // loaded" when the matching app-state flag is set, and read exactly as before when it is not.

  describe('recorded load failures', () => {
    const count = (s: string): number => text().split(s).length - 1;
    const PLANTING_CHART_FAILED = 'Planting intentions for 2026 could not be loaded, so this chart is empty. Refresh the page to try again.';
    const PLANTING_TARGETS_FAILED =
      'Planting intentions for 2026 could not be loaded, so there are no crops to set targets for. Refresh the page to try again.';
    const PRODUCERS_FAILED = 'Producers for the selected trade units could not be loaded. Refresh the page to try again.';

    it('says the By Crop charts could not be loaded when planting intentions failed', async () => {
      await build(() => {
        appState.plantingIntentions.set([]);
        appState.plantingIntentionsLoadFailed.set(true);
      });

      expect(count(PLANTING_CHART_FAILED)).toBe(2);
      expect(text()).not.toContain('No planting data');
    });

    it('still reads "No planting data" for a season that genuinely has none', async () => {
      await build(() => appState.plantingIntentions.set([]));

      expect(count('No planting data for 2026')).toBe(2);
      expect(text()).not.toContain('could not be loaded');
    });

    it('draws the charts, not the failure, once intentions are back despite a stale flag', async () => {
      await build(() => appState.plantingIntentionsLoadFailed.set(true));

      expect(text()).toContain('Crop Details');
      expect(text()).not.toContain('could not be loaded');

      // A filter that leaves the charts empty is a genuine "none", not the old failure.
      c.selectedCropFilter.set('Wheat');
      await settle();
      expect(count('No planting data for 2026')).toBe(2);
      expect(text()).not.toContain('could not be loaded');
    });

    it('says why Season Targets has no crops when planting intentions failed, and keeps the normal empty text otherwise', async () => {
      await build(() => {
        appState.plantingIntentions.set([]);
        appState.plantingIntentionsLoadFailed.set(true);
      });
      c.goToSeasonTargets();
      await settle();
      expect(text()).toContain(PLANTING_TARGETS_FAILED);
      expect(text()).not.toContain('No planting intentions for 2026');

      appState.plantingIntentionsLoadFailed.set(false);
      await settle();
      expect(text()).toContain('No planting intentions for 2026');
      expect(text()).not.toContain('could not be loaded');
    });

    it('blames the failed conversions, not the units, for contracts left out of Sales Opportunities', async () => {
      await build(() => {
        appState.commodityConversions.set([]);
        appState.commodityConversionsLoadFailed.set(true);
      });
      c.selectDashboardTab('harvestContracts');
      await settle();

      // The 30 ST soybean contract has no conversion, so only Corn is listed.
      expect(c.salesOpportunityExcluded()).toBe(1);
      expect(text()).toContain("1 contract not shown: the bushel conversions couldn't be loaded. Refresh the page to try again.");
      expect(text()).not.toContain("can't be converted to bushels");
    });

    it('still blames the unit when the conversions loaded but none fits', async () => {
      await build(() => appState.commodityConversions.set([]));
      c.selectDashboardTab('harvestContracts');
      await settle();

      expect(text()).toContain("1 contract not shown: its unit can't be converted to bushels.");
      expect(text()).not.toContain('bushel conversions');
    });

    it('says the conversions failed, not "No contract data", when every contract was left out for that reason', async () => {
      const tonnage = [
        contract({ id: 700, sourceContractId: 'PSB700', commodityCode: 'SB', commodityDescription: 'Soybeans', commodityGroup: 'Soybeans', quantity: 30, unit: 'ST' }),
        contract({ id: 701, sourceContractId: 'PSB701', commodityCode: 'SB', commodityDescription: 'Soybeans', commodityGroup: 'Soybeans', quantity: 60, unit: 'ST' }),
      ];
      await build(() => {
        appState.commodityConversions.set([]);
        appState.commodityConversionsLoadFailed.set(true);
        api.getContractsByCropYear.mockReturnValue(of(tonnage));
      });
      c.selectDashboardTab('harvestContracts');
      await settle();
      expect(text()).toContain("2 contracts for 2026 not shown: the bushel conversions couldn't be loaded. Refresh the page to try again.");
      expect(text()).not.toContain('No contract data for 2026');

      appState.commodityConversionsLoadFailed.set(false);
      await settle();
      // Sales Opportunities reads as before; the Harvest Timeline still charts the raw quantity.
      expect(count('No contract data for 2026')).toBe(1);
      expect(text()).not.toContain('bushel conversions');
    });

    it('says the producers could not be loaded, on both views, when the producer read failed', async () => {
      await build(() => {
        appState.customers.set([]);
        appState.customersLoadFailed.set(true);
      });
      c.selectDashboardTab('producers');
      await settle();
      expect(text()).toContain(PRODUCERS_FAILED);
      expect(text()).not.toContain('No producers match your search');

      c.producerView.set('without');
      await settle();
      expect(text()).toContain(PRODUCERS_FAILED);
      expect(text()).not.toContain('Every producer in this trade unit');
    });

    it('keeps the normal empty producer text on both views when nothing failed', async () => {
      await build(() => appState.customers.set([]));
      c.selectDashboardTab('producers');
      await settle();
      expect(text()).toContain('No producers match your search for 2026.');

      c.producerView.set('without');
      await settle();
      expect(text()).toContain('Every producer in this trade unit has planting intentions for 2026.');
      expect(text()).not.toContain('could not be loaded');
    });

    const HEADLINE_FAILED =
      'Planting intentions for 2026 could not be loaded, so the acres, production, yield and grower figures below are empty. Refresh the page to try again.';

    it('says the headline figures are empty because planting intentions failed, not because the season is', async () => {
      await build(() => {
        appState.plantingIntentions.set([]);
        appState.plantingIntentionsLoadFailed.set(true);
      });
      expect(text()).toContain(HEADLINE_FAILED);

      appState.plantingIntentionsLoadFailed.set(false);
      await settle();
      expect(text()).not.toContain(HEADLINE_FAILED);
      expect(text()).toContain('No prior year data');
    });

    it('does not list every producer as "without intentions" when the intentions failed to load', async () => {
      await build(() => {
        appState.plantingIntentions.set([]);
        appState.plantingIntentionsLoadFailed.set(true);
      });
      c.selectDashboardTab('producers');
      c.producerView.set('without');
      await settle();
      // Every producer lacks intentions only because none loaded: the list would be the whole roster.
      expect(c.producersTabRows().length).toBeGreaterThan(0);
      expect(text()).toContain('Planting intentions for 2026 could not be loaded. Refresh the page to try again.');

      appState.plantingIntentionsLoadFailed.set(false);
      await settle();
      expect(text()).not.toContain('could not be loaded');
    });

    it('says Contract Coverage leaves contracts out because the conversions failed, and stays quiet otherwise', async () => {
      const COVERAGE_NOTE = "1 contract not counted: the bushel conversions couldn't be loaded. Refresh the page to try again.";
      await build(() => {
        appState.commodityConversions.set([]);
        appState.commodityConversionsLoadFailed.set(true);
      });
      c.selectDashboardTab('harvestContracts');
      await settle();
      expect(c.contractCoverageRows().length).toBeGreaterThan(0);
      expect(text()).toContain(COVERAGE_NOTE);

      appState.commodityConversionsLoadFailed.set(false);
      await settle();
      expect(text()).not.toContain('not counted');
    });

    it("records the dashboard's own planting read failing, and clears it when the read succeeds", async () => {
      await build(() => appState.plantingIntentions.set([]));
      api.getPlantingIntentions.mockReturnValue(fail());
      c.reloadPlantingIntentions();
      await settle();
      expect(appState.setPlantingIntentionsLoadFailed).toHaveBeenLastCalledWith(true);

      api.getPlantingIntentions.mockReturnValue(of(INTENTIONS));
      appState.plantingIntentions.set([]);
      c.reloadPlantingIntentions();
      await settle();
      expect(appState.setPlantingIntentionsLoadFailed).toHaveBeenLastCalledWith(false);
    });

    it('says planting intentions could not be loaded on an empty "with intentions" view when they failed', async () => {
      await build(() => {
        appState.plantingIntentions.set([]);
        appState.plantingIntentionsLoadFailed.set(true);
      });
      c.selectDashboardTab('producers');
      await settle();

      expect(text()).toContain('Planting intentions for 2026 could not be loaded. Refresh the page to try again.');
      expect(text()).not.toContain('No producers match your search');
    });
  });

  // ── Season targets (yield estimates + market share) ─────────────────────────

  describe('season targets', () => {
    it('tracks dirtiness and distinguishes a cleared value from an untouched one', async () => {
      await build();
      expect(c.seasonTargetsDirty()).toBe(false);
      expect(c.yieldInputValue('Soybeans', 50)).toBe(50);

      c.clearTempYield('Soybeans');
      expect(c.seasonTargetsDirty()).toBe(true);
      expect(c.yieldInputValue('Soybeans', 50)).toBeNull();

      c.setTempMarketShare('Corn', 12);
      expect(c.marketShareInputValue('Corn', 10)).toBe(12);

      c.cancelSeasonTargetsEdits();
      expect(c.seasonTargetsDirty()).toBe(false);
      expect(c.marketShareInputValue('Corn', 10)).toBe(10);
    });

    it('upserts exactly the edited yields and shares, then reloads both and closes', async () => {
      await build();
      c.goToSeasonTargets();
      c.setTempYield('Irrigated Corn', 210);
      c.clearTempYield('Dryland Corn');
      c.setTempMarketShare('Soybeans', 15);
      api.getDashboardPlantingEstimates.mockReturnValue(of([estimate('Irrigated Corn', 210), estimate('Soybeans', 50)]));
      api.getDashboardMarketShares.mockReturnValue(of([share('Corn', 10), share('Soybeans', 15)]));

      c.saveSeasonTargets();
      await settle();

      expect(api.upsertDashboardPlantingEstimates).toHaveBeenCalledWith([
        { tradeUnitKey: TU, crop: 'Irrigated Corn', plantingYear: YEAR, yieldEstimate: 210 },
        { tradeUnitKey: TU, crop: 'Dryland Corn', plantingYear: YEAR, yieldEstimate: null },
      ]);
      expect(api.upsertDashboardMarketShares).toHaveBeenCalledWith([
        { tradeUnitKey: TU, cropCategory: 'Soybeans', plantingYear: YEAR, marketSharePct: 15 },
      ]);
      // One usage event per crop that got a value; the cleared one is not described.
      expect(usage.postClickEvent).toHaveBeenCalledWith('interaction', 'dashboard', 'set-season-targets', 'Irrigated Corn — yield 210 bu/ac');
      expect(usage.postClickEvent).toHaveBeenCalledWith('interaction', 'dashboard', 'set-season-targets', 'Soybeans — 15% share');
      expect(usage.postClickEvent).toHaveBeenCalledTimes(2);

      expect(toast.success).toHaveBeenCalledWith('Season targets saved');
      expect(api.getDashboardPlantingEstimates).toHaveBeenCalledWith(TU, YEAR);
      expect(api.getDashboardMarketShares).toHaveBeenCalledWith(TU, YEAR);
      expect(c.seasonTargetsDirty()).toBe(false);
      expect(c.showSeasonTargets()).toBe(false);
      expect(c.estimatesSaving()).toBe(false);
      // Reloaded values flow back into the rollups.
      expect(c.yieldRows().find(r => r.cropCode === 'Dryland Corn')?.yieldEstimate).toBeNull();
      expect(c.categoryRows().find(r => r.category === 'Soybeans')?.estimatedHarvestHandle).toBe(1500);
    });

    it('only calls the endpoint that has edits', async () => {
      await build();

      c.setTempYield('Soybeans', 55);
      c.saveSeasonTargets();

      expect(api.upsertDashboardPlantingEstimates).toHaveBeenCalledTimes(1);
      expect(api.upsertDashboardMarketShares).not.toHaveBeenCalled();
      expect(api.getDashboardMarketShares).not.toHaveBeenCalled();
    });

    it('does nothing when there are no edits, or no trade unit', async () => {
      await build();
      c.saveSeasonTargets();
      expect(api.upsertDashboardPlantingEstimates).not.toHaveBeenCalled();

      appState.selectedTradeUnits.set([]);
      c.setTempYield('Soybeans', 55);
      c.saveSeasonTargets();
      expect(api.upsertDashboardPlantingEstimates).not.toHaveBeenCalled();
    });

    it('keeps the edits and reports an error when the save fails', async () => {
      await build();
      api.upsertDashboardMarketShares.mockReturnValue(fail<void>());
      c.goToSeasonTargets();
      c.setTempMarketShare('Corn', 20);

      c.saveSeasonTargets();
      await settle();

      expect(toast.error).toHaveBeenCalledWith('Failed to save season targets');
      expect(toast.success).not.toHaveBeenCalled();
      expect(c.estimatesSaving()).toBe(false);
      expect(c.seasonTargetsDirty()).toBe(true);
      expect(c.showSeasonTargets()).toBe(true);
      expect(text()).toContain('Season Targets — 2026');
    });

    it('renders the season targets modal with an input per yield row and per category row', async () => {
      await build();
      c.goToSeasonTargets();
      await settle();

      expect(host().querySelectorAll('input[type="number"]')).toHaveLength(c.yieldRows().length + c.categoryRows().length);
      expect(text()).toContain('Irrigated Corn');
      expect(text()).not.toContain('No planting intentions for 2026');
    });
  });

  // ── Actual harvest CRUD ─────────────────────────────────────────────────────

  describe('actual harvest', () => {
    it('saves valid edited rows for LAST year and reloads', async () => {
      await build();
      c.startHarvestEdit();
      expect(c.harvestEditMode()).toBe(true);
      expect(c.tempHarvestMap()).toEqual({ 11: '13000', 12: '5000' });

      c.setTempHarvest(11, '14000');
      c.setTempHarvest(12, 'abc'); // invalid → skipped
      c.saveHarvestEdit();

      expect(api.upsertDashboardActualHarvest).toHaveBeenCalledWith([
        { tradeUnitKey: TU, cropCategory: 'Corn', plantingYear: YEAR - 1, bushels: 14000 },
      ]);
      expect(api.getDashboardActualHarvest).toHaveBeenCalledWith(TU, YEAR - 1);
      expect(c.harvestEditMode()).toBe(false);
      expect(c.harvestSaving()).toBe(false);
    });

    it('cancels without a call when nothing valid was entered, and stays in edit mode on failure', async () => {
      await build();
      c.startHarvestEdit();
      c.setTempHarvest(11, '-5');
      c.setTempHarvest(12, '');
      c.saveHarvestEdit();
      expect(api.upsertDashboardActualHarvest).not.toHaveBeenCalled();
      expect(c.harvestEditMode()).toBe(false);

      api.upsertDashboardActualHarvest.mockReturnValue(fail<void>());
      c.startHarvestEdit();
      c.saveHarvestEdit();
      expect(toast.error).toHaveBeenCalledWith('Failed to save harvest data');
      expect(c.harvestEditMode()).toBe(true);
      expect(c.harvestSaving()).toBe(false);
    });

    it('validates and adds a new harvest row for last year', async () => {
      await build();
      c.newHarvestCrop.set('Soybeans');
      c.newHarvestBushels.set('not a number');
      c.addHarvestRow();
      expect(api.upsertDashboardActualHarvest).not.toHaveBeenCalled();

      c.showAddHarvestRow.set(true);
      c.newHarvestBushels.set('8000');
      c.addHarvestRow();

      expect(api.upsertDashboardActualHarvest).toHaveBeenCalledWith([
        { tradeUnitKey: TU, cropCategory: 'Soybeans', plantingYear: YEAR - 1, bushels: 8000 },
      ]);
      expect(c.showAddHarvestRow()).toBe(false);
      expect(c.newHarvestCrop()).toBe('');
      expect(c.newHarvestBushels()).toBe('');
      expect(api.getDashboardActualHarvest).toHaveBeenCalledWith(TU, YEAR - 1);
    });

    it('deletes a row and reloads, or reports the failure without reloading', async () => {
      await build();
      c.deleteHarvestRow(12);
      expect(api.deleteDashboardActualHarvest).toHaveBeenCalledWith(12);
      expect(api.getDashboardActualHarvest).toHaveBeenCalledTimes(1);

      api.deleteDashboardActualHarvest.mockReturnValue(fail<void>());
      c.deleteHarvestRow(11);
      expect(toast.error).toHaveBeenCalledWith('Failed to delete harvest row');
      expect(api.getDashboardActualHarvest).toHaveBeenCalledTimes(1);
    });
  });

  // ── Producers tab + chips ───────────────────────────────────────────────────

  describe('producers tab', () => {
    it('builds per-producer rows with production, sorted by acres and togglable', async () => {
      await build();

      expect(c.producersTabRows().map(r => [r.customerName, r.acres, r.production])).toEqual([
        ['Bravo Ag', 200, 10000],
        ['Alpha Farms', 150, 26000],
      ]);
      c.toggleProducerSort('acres');
      expect(c.producerSortDir()).toBe('asc');
      expect(c.producersTabRows()[0].customerName).toBe('Alpha Farms');

      c.toggleProducerSort('production');
      expect(c.producerSortDir()).toBe('desc');
      expect(c.producersTabRows()[0].customerName).toBe('Alpha Farms');
    });

    it('narrows rows and acres to a crop chip without moving the other view\'s count, and searches', async () => {
      await build();
      expect(c.producerCropChipOptions()).toEqual(['Dryland Corn', 'Irrigated Corn', 'Soybeans']);

      c.producerCropFilter.set('dryland corn');
      const rows = c.producersTabRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ customerName: 'Alpha Farms', acres: 50, production: 6000 });
      expect([...(rows[0].highlightedCrops ?? [])]).toEqual(['Dryland YC']);
      expect(c.producerWithCount()).toBe(1);
      expect(c.producerWithoutCount()).toBe(1);

      c.clearProducerFilters();
      c.producerSearch.set('brav');
      expect(c.producersTabRows().map(r => r.customerName)).toEqual(['Bravo Ag']);
    });

    it('renders crop chips coloured by crop category for producers without intentions', async () => {
      await build();
      c.selectDashboardTab('producers');
      c.producerView.set('without');
      await settle();

      const row = c.producersTabRows()[0];
      expect(row.customerName).toBe('Charlie Grain');
      // Crops merged from producer data (YC, HRW) and contracts (SB), grouped by crop category.
      expect(row.plantingChips.map((ch: { display: string; colorKey: string }) => [ch.display, ch.colorKey])).toEqual([
        ['YC', 'Corn'], ['SB', 'Soybeans'], ['HRW', 'Wheat'],
      ]);

      const chips = Array.from(host().querySelectorAll('span.rounded-md'));
      const classOf = (code: string): string => chips.find(el => el.textContent?.trim() === code)?.className ?? '';
      expect(classOf('YC')).toContain('bg-amber-100');
      expect(classOf('SB')).toContain('bg-blue-100');
      expect(classOf('HRW')).toContain('bg-green-100');
      expect(text()).toContain('Never contacted');
    });

    it('renders planting chips coloured by plain crop for producers with intentions', async () => {
      await build();
      c.selectDashboardTab('producers');
      await settle();

      const chips = Array.from(host().querySelectorAll('span.rounded-md')).map(el => ({
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), className: el.className,
      }));
      const classOf = (prefix: string): string => chips.find(ch => ch.text.startsWith(prefix))?.className ?? '';
      expect(chips.map(ch => ch.text)).toEqual(['SB · 200 ac', 'Irrigated YC · 100 ac', 'Dryland YC · 50 ac']);
      expect(classOf('SB')).toContain('bg-blue-100');
      expect(classOf('Irrigated YC')).toContain('bg-amber-100');
      expect(classOf('Dryland YC')).toContain('bg-amber-100');
    });

    it('recolours a chip in place when its crop category changes', async () => {
      await build();
      c.selectDashboardTab('producers');
      c.producerView.set('without');
      await settle();
      const classOf = (code: string): string =>
        Array.from(host().querySelectorAll('span.rounded-md')).find(el => el.textContent?.trim() === code)?.className ?? '';
      expect(classOf('YC')).toContain('bg-amber-100');

      // Same chip text, new colour key: the chip's view is kept (tracked by text), its class must follow.
      c.allCommodities.set(COMMODITIES.map(m => m.code === 'YC' ? { ...m, plantingCategory: 'Organic Soybeans' } : m));
      await settle();

      expect(classOf('YC')).toContain('bg-blue-100');
      expect(classOf('YC')).not.toContain('bg-amber-100');
    });

    it('resolves each chip\'s classes once, not on every change-detection pass', async () => {
      await build();
      c.selectDashboardTab('producers');
      await settle();
      const transform = vi.spyOn(CommodityChipClassPipe.prototype, 'transform');
      // A pass that re-checks this OnPush view without changing any input.
      const rerender = () => { fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck(); fixture.detectChanges(); };

      rerender(); rerender(); rerender();

      expect(transform).not.toHaveBeenCalled();
      expect(Array.from(host().querySelectorAll('span.rounded-md'))).toHaveLength(3);
      transform.mockRestore();
    });

    it('maps chip classes by crop name, folding specialty variants into the base crop', () => {
      // The pipe the chip template binds through.
      const chipClass = (crop: string) => new CommodityChipClassPipe().transform(crop);

      expect(chipClass('Corn')).toContain('bg-amber-100');
      expect(chipClass('SOYBEANS')).toContain('bg-blue-100');
      expect(chipClass('Organic Soybeans')).toBe(commodityChipClass('Soybeans'));
      expect(chipClass('Waxy Corn')).toBe(commodityChipClass('Corn'));
      // Unknown crops get a stable, case-insensitive pick from the fallback palette.
      expect(chipClass('Sunflowers')).toBe(chipClass('sunflowers'));
    });

    it('describes last contact by recency, including never', async () => {
      await build(() => appState.noteLastContacts.set([
        { customerId: 3, customerCode: 'CHARLIE', lastNoteAt: new Date(2026, 9, 10, 12) },
        { customerId: 1, customerCode: 'ALPHA', lastNoteAt: new Date(2026, 9, 1, 12) },
      ]));

      expect(c.getLastContactInfo(3)).toEqual({ text: 'Contacted 3 days ago', colorClass: 'text-scoular-green', daysAgo: 3 });
      expect(c.getLastContactInfo(1)).toEqual({ text: 'Contacted 12 days ago', colorClass: 'text-yellow-500', daysAgo: 12 });
      expect(c.getLastContactInfo(2)).toEqual({ text: 'Never contacted', colorClass: 'text-scoular-red', daysAgo: Infinity });
    });

    it('says last contact is unavailable, not "Never contacted", when the last-contact load failed', async () => {
      await build(() => appState.noteLastContactsLoadFailed.set(true));

      expect(c.getLastContactInfo(2)).toEqual({ text: 'Last contact unavailable', colorClass: 'text-gray-400 dark:text-gray-500', daysAgo: Infinity });
    });

    it('narrows the without-intentions view and its chips to producers who grow the top-filter crop', async () => {
      await build();
      c.producerView.set('without');
      // No top filter: every producer without a 2026 intention, chips from their merged crop codes.
      expect(c.producersTabRows().map(r => r.customerName)).toEqual(['Charlie Grain']);
      expect(c.producerCropChipOptions()).toEqual(['HRW', 'SB', 'YC']);

      // Nobody has a Wheat intention, so everyone is a candidate, but only Charlie grows wheat (HRW).
      c.selectedCropFilter.set('Wheat');
      expect(c.producersTabRows().map(r => r.customerName)).toEqual(['Charlie Grain']);
      expect(c.producerWithoutCount()).toBe(1);
      expect(c.producerCropChipOptions()).toEqual(['HRW']);

      // Corn: Alpha and Charlie grow it, but Alpha has a Corn intention this year.
      c.selectedCropFilter.set('Corn');
      expect(c.producersTabRows().map(r => r.customerName)).toEqual(['Charlie Grain']);
      expect(c.producerCropChipOptions()).toEqual(['YC']);
    });

    it('renders producer initials and the best available location on each row', async () => {
      await build(() => appState.customers.set([
        { ...CUSTOMERS[0], extendedCity: 'Garden City', extendedStateProvince: 'KS', location: 'Ignored', stateProvince: 'NE' },
        { ...CUSTOMERS[1], location: 'Pratt', stateProvince: 'KS' },
        { ...CUSTOMERS[2], name: 'Zed', stateProvince: 'OK' },
      ]));
      c.selectDashboardTab('producers');
      await settle();

      expect(text()).toContain('AF');
      expect(text()).toContain('BA');
      expect(text()).toContain('Garden City, KS');
      expect(text()).toContain('Pratt, KS');
      expect(text()).not.toContain('Ignored');

      c.producerView.set('without');
      await settle();
      expect(text()).toContain('ZE'); // a one-word name uses its first two letters
      expect(text()).toContain('OK'); // only a state on file
    });

    it('tracks tab clicks and opens the producer on the planting tab for the selected year', async () => {
      await build();

      c.selectDashboardTab('harvestContracts');
      expect(c.activeTab()).toBe('harvestContracts');
      expect(usage.trackDashboardTabClick).toHaveBeenCalledWith('harvest-contracts');

      c.prevYear();
      c.goToCustomerProfile(2);
      expect(usage.postClickEvent).toHaveBeenCalledWith('interaction', 'dashboard', 'producer-row-click', '2');
      expect(router.navigate).toHaveBeenCalledWith(['/'], { queryParams: { customerId: 2, tab: 'planting', year: 2025 } });
    });
  });
});
