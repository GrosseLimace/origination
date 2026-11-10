import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { defaultIfEmpty } from 'rxjs/operators';
import { DashboardSummary, DpContract, PlantingIntention, StoredGrain } from '@models';
import { ApiService } from '@core/services/api.service';
import { PermissionService } from '@core/access/permission.service';
import { DashboardStore } from './data-access/dashboard.store';
import { provideSelectedProducerProduction, selectedProducerProductionFake } from '@testing/selected-producer-production.fake';
import { newestSeasonIntentionCount, preloadDashboardSummary, producersModule } from './producers.module';
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
        { provide: ApiService, useValue: api },
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

describe("Producers module: Print on the profile", () => {
  const panel = () => producersModule.customerPanels!.find(p => p.id === 'print-report')!;

  it("adds Print to the header's buttons, before Edit, for producers only", () => {
    expect([panel().slot, panel().order]).toEqual(['toolbar', 90]);
    expect(panel().segments).toEqual(['Producer']);
  });

  // The report's header needs only the customer; each section checks its own read.
  it('asks for no permission of its own', () => {
    expect(panel().requires).toEqual([]);
  });

  it('loads as its button', async () => {
    expect(await panel().component()).toBe(PrintReportButtonComponent);
  });
});
