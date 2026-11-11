import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, Subject, firstValueFrom, lastValueFrom, of, throwError } from 'rxjs';
import { defaultIfEmpty } from 'rxjs/operators';
import { DpContract, PlantingIntention, StoredGrain } from '@models';
import { DashboardSummary } from './models/dashboard-summary.model';
import { ApiService } from '@core/services/api.service';
import { PermissionService } from '@core/access/permission.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { DashboardStore } from './data-access/dashboard.store';
import { ProducerProfileStore } from './data-access/producer-profile.store';
import { ProducerStore } from './data-access/producer.store';
import { ProducersApiService } from './data-access/producers-api.service';
import { YieldEstimateStore } from './data-access/yield-estimate.store';
import { permissionStub, providePermissions } from '@testing/permission.stub';
import { producerProfile } from '@testing/producer-profiles.fake';
import { provideSelectedProducerProduction, selectedProducerProductionFake } from '@testing/selected-producer-production.fake';
import { newestSeasonIntentionCount, preloadDashboardSummary, preloadProduction, producersModule } from './producers.module';
import { PlantingIntentionsTableComponent } from './components/planting-intentions-table/planting-intentions-table.component';
import { StoredGrainTableComponent } from './components/stored-grain-table/stored-grain-table.component';
import { DpContractsTableComponent } from './components/dp-contracts-table/dp-contracts-table.component';
import { OrganicBadgeComponent } from './components/organic/organic-badge.component';
import { OrganicPanelComponent } from './components/organic/organic-panel.component';
import { ProducerContactsComponent } from './components/producer-contacts/producer-contacts.component';
import { BinSitesComponent } from './components/bin-sites/bin-sites.component';
import { FarmDetailsComponent } from './components/farm-details/farm-details.component';
import { ProducerInsightsToggleComponent } from './components/producer-insights/producer-insights-toggle.component';
import { ContractPaceComponent } from './components/contract-pace/contract-pace.component';
import { ProducerInsightsComponent } from './components/producer-insights/producer-insights.component';
import { ContractPacingCardComponent } from './components/contract-pacing-card/contract-pacing-card.component';
import { GrowthOpportunityComponent } from './components/growth-opportunity/growth-opportunity.component';
import { ActivitySummaryComponent } from './components/activity-summary/activity-summary.component';
import { PrintReportButtonComponent } from './components/customer-print-report/print-report-button.component';
import { EditProducerButtonComponent } from './components/edit-customer-dialog/edit-producer-button.component';

describe('Producers preload: the Planting Dashboard summary', () => {
  const summary: DashboardSummary = { estimates: [], marketShares: [], actualHarvest: [] };
  let api: { getDashboardSummary: ReturnType<typeof vi.fn> };
  let canRead: boolean;

  function run(tradeUnits: string[]): Promise<unknown> {
    return firstValueFrom(
      TestBed.runInInjectionContext(() => preloadDashboardSummary(tradeUnits) as Observable<unknown>).pipe(defaultIfEmpty('none')),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00'));
    canRead = true;
    api = { getDashboardSummary: vi.fn(() => of(summary)) };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProducersApiService, useValue: api },
        { provide: PermissionService, useValue: { loaded: () => of('loaded'), has: () => canRead } },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('pre-fetches the dashboard summary under the sorted trade-unit key for the current year', async () => {
    await run(['2190', '1085']);

    expect(api.getDashboardSummary).toHaveBeenCalledWith('1085,2190', 2026);
    expect(TestBed.inject(DashboardStore).preloadedDashboardSummary()).toEqual({ tradeUnitsKey: '1085,2190', year: 2026, ...summary });
  });

  it('a failed prefetch is left unset, so the dashboard fetches its own instead of showing an empty season', async () => {
    api.getDashboardSummary.mockReturnValue(throwError(() => new Error('500')));

    await run(['1085']);

    expect(TestBed.inject(DashboardStore).preloadedDashboardSummary()).toBeNull();
  });

  it('makes no call for a user who may not read the dashboard, so nobody else gets a 403 on every trade-unit change', async () => {
    canRead = false;

    await run(['1085']);

    expect(api.getDashboardSummary).not.toHaveBeenCalled();
  });

  it('drops the previous selection\'s caches before it fetches', async () => {
    const store = TestBed.inject(DashboardStore);
    store.setPreloadedDashboardSummary('1085', 2026, summary);
    store.setDashboardCache({ tradeUnitsKey: '1085', year: 2026 } as never);
    canRead = false;

    await run(['2190']);

    expect(store.preloadedDashboardSummary()).toBeNull();
    expect(store.dashboardCache()).toBeNull();
  });
});

describe("Producers preload: every producer's details", () => {
  let api: Record<'getDashboardSummary' | 'getAllProducerDetails' | 'getPlantingIntentions' | 'getStoredGrain' | 'getDpContracts' | 'getDashboardPlantingEstimates', ReturnType<typeof vi.fn>>;

  function run(): Promise<unknown> {
    return lastValueFrom(
      TestBed.runInInjectionContext(() => producersModule.preload!(['2190']) as Observable<unknown>).pipe(defaultIfEmpty('none')),
    );
  }

  beforeEach(() => {
    api = {
      getDashboardSummary: vi.fn(() => of({ estimates: [], marketShares: [], actualHarvest: [] })),
      getAllProducerDetails: vi.fn(() => of([producerProfile(1, { totalAcres: 900 })])),
      getPlantingIntentions: vi.fn(() => of([])),
      getStoredGrain: vi.fn(() => of([])),
      getDpContracts: vi.fn(() => of([])),
      getDashboardPlantingEstimates: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ProducersApiService, useValue: api },
        providePermissions(permissionStub(['planting-estimates:read', 'producer-details:read'])),
      ],
    });
  });

  it('reads them beside the dashboard summary and keeps them in the store', async () => {
    await run();

    expect(api.getDashboardSummary).toHaveBeenCalled();
    expect(TestBed.inject(ProducerProfileStore).profileOf(1)?.totalAcres).toBe(900);
  });

  it("reads the trade units' production with them", async () => {
    await run();

    expect(api.getPlantingIntentions).toHaveBeenCalledWith(['2190']);
    expect(TestBed.inject(ProducerStore).dpContractsLoaded()).toBe(true);
  });

  // One module's outage must not stop another's preload, and the details read before stay.
  it('swallows a failed read, leaving the details it already held', async () => {
    await run();
    api.getAllProducerDetails.mockReturnValue(throwError(() => new Error('503')));

    await expect(run()).resolves.toBeDefined();
    expect(TestBed.inject(ProducerProfileStore).profileOf(1)?.totalAcres).toBe(900);
  });
});

describe("Producers preload: the trade units' planting, stored grain, DP and yield estimates", () => {
  const pi = (id: number, customerId = 1) => ({ id, customerId, plantingYear: 2026 }) as PlantingIntention;
  const grain = (id: string, customerId = 1) => ({ id, customerId }) as StoredGrain;
  const dp = (id: string, customerId = 1) => ({ id, customerId }) as DpContract;
  let api: Record<'getPlantingIntentions' | 'getStoredGrain' | 'getDpContracts' | 'getDashboardPlantingEstimates', ReturnType<typeof vi.fn>>;
  let store: ProducerStore;
  let granted: string[];

  function run(tradeUnits = ['2190', '1085']): Promise<unknown> {
    TestBed.inject(TradeUnitContext).setTradeUnits(tradeUnits);
    return lastValueFrom(TestBed.runInInjectionContext(() => preloadProduction(tradeUnits)).pipe(defaultIfEmpty('none')));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00'));
    granted = ['planting-estimates:read'];
    api = {
      getPlantingIntentions: vi.fn(() => of([pi(1)])),
      getStoredGrain: vi.fn(() => of([grain('g10')])),
      getDpContracts: vi.fn(() => of([dp('a')])),
      getDashboardPlantingEstimates: vi.fn((_key: string, year: number) => of([{ crop: 'YC', plantingYear: year }])),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProducersApiService, useValue: api },
        { provide: PermissionService, useValue: { loaded: () => of('loaded'), has: (p: string) => granted.includes(p) } },
      ],
    });
    store = TestBed.inject(ProducerStore);
  });

  afterEach(() => vi.useRealTimers());

  it('reads them for the trade units into ProducerStore, and marks DP loaded', async () => {
    await run();

    for (const call of [api.getPlantingIntentions, api.getStoredGrain, api.getDpContracts]) {
      expect(call).toHaveBeenCalledWith(['2190', '1085']);
    }
    expect(store.plantingIntentions().map(row => row.id)).toEqual([1]);
    expect(store.storedGrain().map(row => row.id)).toEqual(['g10']);
    expect(store.dpContracts().map(row => row.id)).toEqual(['a']);
    expect(store.dpContractsLoaded()).toBe(true);
  });

  it("drops the previous trade units' stored grain and DP at once, and keeps a producer's own rows read since", async () => {
    store.setStoredGrain([grain('g90', 9)]);
    store.setDpContracts([dp('old', 9)]);
    const grainRead = new Subject<StoredGrain[]>();
    const dpRead = new Subject<DpContract[]>();
    api.getStoredGrain.mockReturnValue(grainRead);
    api.getDpContracts.mockReturnValue(dpRead);
    const done = run();

    expect(store.storedGrain()).toEqual([]);
    expect(store.dpContracts()).toEqual([]);
    expect(store.dpContractsLoaded()).toBe(false);

    // The selected producer's own reads land first.
    store.setStoredGrain([grain('g20', 2)]);
    store.mergeCustomerDpContracts(2, [dp('b', 2)]);
    grainRead.next([grain('g10')]); grainRead.complete();
    dpRead.next([dp('a')]); dpRead.complete();
    await done;

    expect(store.storedGrain().map(row => row.id)).toEqual(['g10', 'g20']);
    expect(store.dpContracts().map(row => row.id)).toEqual(['a', 'b']);
    expect(store.dpContractsLoaded()).toBe(true);
  });

  it('records a failed planting or DP read, so it does not read as "none", and DP still counts as read', async () => {
    store.setPlantingIntentions([pi(5)]);
    api.getPlantingIntentions.mockReturnValue(throwError(() => new Error('500')));
    api.getDpContracts.mockReturnValue(throwError(() => new Error('500')));

    await run();

    expect(store.plantingIntentionsLoadFailed()).toBe(true);
    expect(store.plantingIntentions()).toEqual([]);
    expect(store.dpContractsLoadFailed()).toBe(true);
    expect(store.dpContractsLoaded()).toBe(true);
  });

  it("clears the last read's failures as the next one starts", async () => {
    store.setPlantingIntentionsLoadFailed(true);
    store.setDpContractsLoadFailed(true);
    api.getPlantingIntentions.mockReturnValue(NEVER);
    api.getDpContracts.mockReturnValue(NEVER);

    void run();

    expect(store.plantingIntentionsLoadFailed()).toBe(false);
    expect(store.dpContractsLoadFailed()).toBe(false);
  });

  it("reads this year's and last year's yield estimates for a user who may read them", async () => {
    await run();

    expect(api.getDashboardPlantingEstimates.mock.calls).toEqual([['1085,2190', 2026], ['1085,2190', 2025]]);
    expect(TestBed.inject(YieldEstimateStore).estimates().map(e => e.plantingYear).sort()).toEqual([2025, 2026]);
  });

  it('reads no yield estimates for a user who may not', async () => {
    granted = [];

    await run();

    expect(api.getDashboardPlantingEstimates).not.toHaveBeenCalled();
  });
});

describe("Producers module: the customer profile's tabs", () => {
  const tab = (id: string) => producersModule.customerTabs!.find(t => t.id === id)!;
  const intention = (id: number, plantingYear: number) => ({ id, plantingYear }) as PlantingIntention;

  it('contributes Planting, Storage and DP Contracts, after the Contracts tabs, for producers only', () => {
    expect(producersModule.customerTabs!.map(t => [t.id, t.label, t.shortLabel, t.order])).toEqual([
      ['planting', 'Planting', 'Plan', 30],
      ['storage', 'Storage', 'Stor', 40],
      ['dpContracts', 'DP Contracts', 'DP', 50],
    ]);
    for (const t of producersModule.customerTabs!) expect(t.segments).toEqual(['Producer']);
  });

  it('asks for the read each tab makes', () => {
    expect(tab('planting').requires).toEqual(['planting-intentions:read']);
    expect(tab('storage').requires).toEqual(['stored-grain:read']);
    expect(tab('dpContracts').requires).toEqual(['dp-contracts:read']);
  });

  it("counts the newest season's intentions, the crops in storage and the DP contracts, as they change", () => {
    const production = selectedProducerProductionFake();
    TestBed.configureTestingModule({ providers: [provideSelectedProducerProduction(production)] });
    const planting = TestBed.runInInjectionContext(tab('planting').badge!);
    const storage = TestBed.runInInjectionContext(tab('storage').badge!);
    const dp = TestBed.runInInjectionContext(tab('dpContracts').badge!);

    production.visiblePlantingIntentions.set([intention(1, 2025), intention(2, 2026), intention(3, 2026)]);
    production.storedGrain.set([{ crop: 'Corn' }, { crop: 'Corn' }, { crop: 'Soybeans' }, { crop: '' }] as StoredGrain[]);
    production.dpContracts.set([
      { id: 'a|2', ticketKey: 'a', contractNumber: 'PCPL111' },
      { id: 'a|S', ticketKey: 'a', contractNumber: 'PCPL111' },
      { id: 'b|2', ticketKey: 'b', contractNumber: 'PCPL222' },
    ] as DpContract[]);

    expect(planting()).toBe(2);
    expect(storage()).toBe(3); // Corn, Soybeans, Unknown
    expect(dp()).toBe(2);
  });

  it('counts every intention when none has a crop year, and none when there are none', () => {
    expect(newestSeasonIntentionCount([{ id: 1 }, { id: 2 }] as PlantingIntention[])).toBe(2);
    expect(newestSeasonIntentionCount([])).toBe(0);
  });

  it('loads each tab as its table', async () => {
    expect(await tab('planting').component()).toBe(PlantingIntentionsTableComponent);
    expect(await tab('storage').component()).toBe(StoredGrainTableComponent);
    expect(await tab('dpContracts').component()).toBe(DpContractsTableComponent);
  });
});

describe("Producers module: the customer profile's header panels", () => {
  const headerIds = ['organic-badge', 'organic-panel', 'contacts', 'bin-sites', 'farm-details'];
  const panels = () => producersModule.customerPanels!.filter(p => headerIds.includes(p.id));

  it('adds the Organic badge and its panel, the contacts, the bin sites and Farm Details, for producers only', () => {
    expect(panels().map(p => [p.slot, p.id, p.order])).toEqual([
      ['badges', 'organic-badge', 30],
      ['badge-panels', 'organic-panel', 20],
      ['contacts', 'contacts', 10],
      ['locations', 'bin-sites', 10],
      ['details', 'farm-details', 20],
    ]);
    for (const p of panels()) expect(p.segments).toEqual(['Producer']);
  });

  it("asks for the producer's saved details, which each of them reads", () => {
    for (const p of panels()) expect(p.requires).toEqual(['producer-details:read']);
  });

  it('loads each panel as its component', async () => {
    expect(await Promise.all(panels().map(p => p.component()))).toEqual([
      OrganicBadgeComponent, OrganicPanelComponent, ProducerContactsComponent, BinSitesComponent, FarmDetailsComponent,
    ]);
  });
});

describe("Producers module: the producer's performance on the profile", () => {
  const ids = ['insights-toggle', 'contract-pace', 'producer-insights', 'contract-pacing', 'growth-opportunity', 'activity-summary'];
  const panels = () => producersModule.customerPanels!.filter(p => ids.includes(p.id));
  const panel = (id: string) => panels().find(p => p.id === id)!;

  it('adds the Insights button, Harvest Contract Pace after Farm Details, and the Insights panels above Activity Summary, for producers only', () => {
    expect(panels().map(p => [p.slot, p.id, p.order])).toEqual([
      ['actions', 'insights-toggle', 10],
      ['details', 'contract-pace', 30],
      ['summary', 'producer-insights', 10],
      ['summary', 'contract-pacing', 20],
      ['summary', 'growth-opportunity', 30],
      ['summary', 'activity-summary', 40],
    ]);
    for (const p of panels()) expect(p.segments).toEqual(['Producer']);
  });

  it('asks for every read each one makes', () => {
    expect(panel('contract-pace').requires).toEqual(['contracts:read', 'contract-pacing:read']);
    expect(panel('producer-insights').requires).toEqual(['contracts:read', 'contract-pacing:read', 'notes:read']);
    expect(panel('contract-pacing').requires).toEqual(['contracts:read', 'contract-pacing:read']);
    expect(panel('growth-opportunity').requires).toEqual(['contracts:read', 'planting-intentions:read', 'notes:read', 'planting-estimates:read']);
    expect(panel('activity-summary').requires).toEqual(['contracts:read', 'tickets:read', 'contract-pacing:read', 'planting-intentions:read', 'stored-grain:read', 'notes:read']);
  });

  // A button that opens panels the user can't see would open an empty space.
  it('shows the Insights button only to a user who can see at least the Contract Pacing card', () => {
    expect(panel('insights-toggle').requires).toEqual(panel('contract-pacing').requires);
  });

  it('loads each one as its component', async () => {
    expect(await Promise.all(panels().map(p => p.component()))).toEqual([
      ProducerInsightsToggleComponent, ContractPaceComponent, ProducerInsightsComponent, ContractPacingCardComponent,
      GrowthOpportunityComponent, ActivitySummaryComponent,
    ]);
  });
});

describe("Producers module: Print and Edit on the profile", () => {
  const panel = (id: string) => producersModule.customerPanels!.find(p => p.id === id)!;
  const toolbar = () => producersModule.customerPanels!.filter(p => p.slot === 'toolbar');

  it("adds Print, then Edit, to the header's buttons, for producers only", () => {
    expect(toolbar().map(p => [p.id, p.order])).toEqual([['print-report', 90], ['edit-producer', 100]]);
    for (const p of toolbar()) expect(p.segments).toEqual(['Producer']);
  });

  // The report's header needs only the customer; each section checks its own read.
  it('asks for no permission of its own for Print', () => {
    expect(panel('print-report').requires).toEqual([]);
  });

  // Edit re-reads the producer's details, and its save always writes them.
  it("asks for the producer's details, to read and to change, for Edit", () => {
    expect(panel('edit-producer').requires).toEqual(['producer-details:read', 'producer-details:write']);
  });

  it('loads each as its button', async () => {
    expect(await panel('print-report').component()).toBe(PrintReportButtonComponent);
    expect(await panel('edit-producer').component()).toBe(EditProducerButtonComponent);
  });
});
