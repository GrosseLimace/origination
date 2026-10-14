import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, NEVER, of, throwError } from 'rxjs';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { CommodityConversion, Contract, Customer, DashboardSummary, Ticket } from '@models';
import { DataPreloadService } from './data-preload.service';
import { ApiService } from './api.service';
import { AppStateService } from './app-state.service';

/**
 * The trade-unit-wide preload that feeds every screen. Driven against the REAL AppStateService so the
 * assertions are on the state screens actually read. Pins:
 *  - nothing loads before sign-in; commodity conversions load once after sign-in even with no TU,
 *  - no trade units → every loading flag drops and no TU-scoped call is made,
 *  - dataLoading stays up until ALL THREE core reads (customers, contracts, today's tickets) land,
 *  - a contracts failure is RECORDED (outage banner) while the page still loads with [],
 *  - a today's-tickets TIMEOUT is "pending", not "failed"; a real error is "failed",
 *  - re-selecting the same trade units in another order does not reload; forceReload does,
 *  - a TU change drops the lazily-loaded ticket / note / DP caches,
 *  - the dashboard summary is pre-fetched under the sorted TU key for the current year.
 */

const PREFS_KEY = 'origination_user_prefs';
const NOW = new Date('2026-10-13T12:00:00');

function customer(id: number): Customer {
  return {
    id, scoularId: `C${id}`, name: `Farm ${id}`, farm: `Farm ${id}`, location: 'Pratt, KS',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, achEnabled: false,
  };
}

function contract(id: number): Contract {
  return {
    id, customerId: 1, farmId: '', contractNumber: `P${id}`, quantity: 1000, unit: 'bushels', price: 0,
    deliveryStart: new Date(2026, 8, 1), deliveryEnd: new Date(2026, 10, 30), status: 'Active', signed: true,
  };
}

function ticket(id: number): Ticket {
  return { id, farmId: '', ticketNumber: `${id}`, date: '2026-10-13', grossWeight: 0, tareWeight: 0, netWeight: 0, isApplied: false, isActive: true };
}

type Api = Record<
  | 'getCommodityConversions' | 'getCustomers' | 'getContracts' | 'getTodaysTickets' | 'getNotesLastContact'
  | 'getMyReminders' | 'getPlantingIntentions' | 'getStoredGrain' | 'getDpContracts' | 'getSavedLists'
  | 'getCommodities' | 'getHarvestWindows' | 'getAllProducerDetails' | 'getDashboardSummary',
  ReturnType<typeof vi.fn<(...args: unknown[]) => Observable<unknown>>>
>;

describe('DataPreloadService', () => {
  let api: Api;
  let appState: AppStateService;
  let inProgress$: Subject<InteractionStatus>;
  let accounts: { username: string }[];

  function create(): DataPreloadService {
    const service = TestBed.inject(DataPreloadService);
    appState = TestBed.inject(AppStateService);
    TestBed.tick();
    return service;
  }

  function signIn(): void {
    accounts = [{ username: 'originator@scoular.example' }];
    inProgress$.next(InteractionStatus.None);
    TestBed.tick();
  }

  function selectTradeUnits(units: string[]): void {
    appState.setTradeUnits(units);
    TestBed.tick();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    localStorage.removeItem(PREFS_KEY);
    inProgress$ = new Subject<InteractionStatus>();
    accounts = [];
    const emptySummary: DashboardSummary = { estimates: [], marketShares: [], actualHarvest: [] };
    api = {
      getCommodityConversions: vi.fn(() => of<CommodityConversion[]>([])),
      getCustomers: vi.fn(() => of([customer(1)])),
      getContracts: vi.fn(() => of([contract(1)])),
      getTodaysTickets: vi.fn(() => of([ticket(1)])),
      getNotesLastContact: vi.fn(() => of([])),
      getMyReminders: vi.fn(() => of([])),
      getPlantingIntentions: vi.fn(() => of([])),
      getStoredGrain: vi.fn(() => of([])),
      getDpContracts: vi.fn(() => of([])),
      getSavedLists: vi.fn(() => of([])),
      getCommodities: vi.fn(() => of([])),
      getHarvestWindows: vi.fn(() => of([])),
      getAllProducerDetails: vi.fn(() => of([])),
      getDashboardSummary: vi.fn(() => of(emptySummary)),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: MsalBroadcastService, useValue: { inProgress$ } },
        { provide: MsalService, useValue: { instance: { getAllAccounts: () => accounts } } },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(PREFS_KEY);
  });

  it('loads nothing before the user is signed in', () => {
    create();
    selectTradeUnits(['1085']);
    inProgress$.next(InteractionStatus.None); // idle, but no account
    TestBed.tick();

    expect(api.getCommodityConversions).not.toHaveBeenCalled();
    expect(api.getCustomers).not.toHaveBeenCalled();
  });

  it('loads commodity conversions once after sign-in even with no trade unit selected', () => {
    const conversions: CommodityConversion[] = [{ commodityCode: 'YC', lbsPerUnit: 56 }];
    api.getCommodityConversions.mockReturnValue(of(conversions));
    create();
    signIn();

    expect(appState.commodityConversions()).toEqual(conversions);
    expect(api.getCustomers).not.toHaveBeenCalled();
  });

  it('with no trade units, drops every loading flag and makes no trade-unit-scoped call', () => {
    create();
    appState.setDataLoading(true);
    appState.setCustomersLoading(true);
    appState.setContractsLoading(true);
    appState.setTodaysTicketsLoading(true);
    signIn();

    expect(appState.dataLoading()).toBe(false);
    expect(appState.customersLoading()).toBe(false);
    expect(appState.contractsLoading()).toBe(false);
    expect(appState.todaysTicketsLoading()).toBe(false);
    expect(api.getCustomers).not.toHaveBeenCalled();
    expect(api.getDashboardSummary).not.toHaveBeenCalled();
  });

  it('loads every dataset for the selected trade units into app state', () => {
    create();
    selectTradeUnits(['1085', '2190']);
    signIn();

    for (const fn of [api.getCustomers, api.getContracts, api.getTodaysTickets, api.getPlantingIntentions, api.getStoredGrain, api.getDpContracts]) {
      expect(fn).toHaveBeenCalledWith(['1085', '2190']);
    }
    expect(appState.customers()).toEqual([customer(1)]);
    expect(appState.contracts()).toEqual([contract(1)]);
    expect(appState.todaysTickets()).toEqual([ticket(1)]);
    expect(appState.dpContractsLoaded()).toBe(true);
  });

  it('keeps dataLoading up until customers, contracts AND today\'s tickets have all landed', () => {
    const customers$ = new Subject<Customer[]>();
    const contracts$ = new Subject<Contract[]>();
    const tickets$ = new Subject<Ticket[]>();
    api.getCustomers.mockReturnValue(customers$);
    api.getContracts.mockReturnValue(contracts$);
    api.getTodaysTickets.mockReturnValue(tickets$);
    create();
    selectTradeUnits(['1085']);
    signIn();

    expect(appState.dataLoading()).toBe(true);

    customers$.next([customer(1)]);
    expect(appState.customersLoading()).toBe(false); // each screen can render as its own data lands
    expect(appState.dataLoading()).toBe(true);

    tickets$.next([ticket(1)]);
    expect(appState.todaysTicketsLoading()).toBe(false);
    expect(appState.dataLoading()).toBe(true);

    contracts$.next([contract(1)]);
    expect(appState.contractsLoading()).toBe(false);
    expect(appState.dataLoading()).toBe(false);
  });

  it('records a contracts failure for the outage banner while still loading the page with []', () => {
    api.getContracts.mockReturnValue(throwError(() => new Error('gateway')));
    create();
    selectTradeUnits(['1085']);
    signIn();

    expect(appState.contractsLoadFailed()).toBe(true);
    expect(appState.contracts()).toEqual([]);
    expect(appState.dataLoading()).toBe(false);
  });

  it('clears a previous contracts failure when the next load succeeds, even if it is empty', () => {
    api.getContracts.mockReturnValueOnce(throwError(() => new Error('gateway'))).mockReturnValue(of([]));
    const service = create();
    selectTradeUnits(['1085']);
    signIn();
    expect(appState.contractsLoadFailed()).toBe(true);

    service.forceReload();

    expect(appState.contractsLoadFailed()).toBe(false);
  });

  it("treats a today's-tickets TIMEOUT as pending, not as a CTRM failure", () => {
    api.getTodaysTickets.mockReturnValue(NEVER);
    create();
    selectTradeUnits(['1085']);
    signIn();

    vi.advanceTimersByTime(59_999);
    expect(appState.todaysTicketsLoading()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(appState.sourceLoadPending()).toBe(true);
    expect(appState.ticketsLoadFailed()).toBe(false);
    expect(appState.todaysTicketsLoading()).toBe(false);
    expect(appState.todaysTickets()).toEqual([]);
  });

  it("records a real today's-tickets error as a failure", () => {
    api.getTodaysTickets.mockReturnValue(throwError(() => new Error('500')));
    create();
    selectTradeUnits(['1085']);
    signIn();

    expect(appState.ticketsLoadFailed()).toBe(true);
    expect(appState.sourceLoadPending()).toBe(false);
  });

  it('does not reload when the same trade units are re-selected in a different order', () => {
    create();
    selectTradeUnits(['1085', '2190']);
    signIn();
    selectTradeUnits(['2190', '1085']);

    expect(api.getCustomers).toHaveBeenCalledTimes(1);

    selectTradeUnits(['2190']);
    expect(api.getCustomers).toHaveBeenCalledTimes(2);
  });

  it('forceReload re-runs the load for the current trade units, and is a no-op with none selected', () => {
    const service = create();
    signIn();
    service.forceReload();
    expect(api.getCustomers).not.toHaveBeenCalled();

    selectTradeUnits(['1085']);
    service.forceReload();
    expect(api.getCustomers).toHaveBeenCalledTimes(2);
  });

  it('drops the lazily-loaded ticket and note caches on a trade-unit change', () => {
    create();
    selectTradeUnits(['1085']);
    signIn();
    appState.setTickets([ticket(9)]);
    appState.setNotes([]);
    expect(appState.ticketsLoaded()).toBe(true);
    expect(appState.notesLoaded()).toBe(true);

    selectTradeUnits(['3000']);

    expect(appState.ticketsLoaded()).toBe(false);
    expect(appState.tickets()).toEqual([]);
    expect(appState.notesLoaded()).toBe(false);
  });

  it('pre-fetches the dashboard summary under the sorted trade-unit key for the current year', () => {
    const summary: DashboardSummary = { estimates: [], marketShares: [], actualHarvest: [] };
    api.getDashboardSummary.mockReturnValue(of(summary));
    create();
    selectTradeUnits(['2190', '1085']);
    signIn();

    expect(api.getDashboardSummary).toHaveBeenCalledWith('1085,2190', 2026);
    expect(appState.preloadedDashboardSummary()).toEqual({ tradeUnitsKey: '1085,2190', year: 2026, ...summary });
  });

  it('a failing secondary read does not stop the others', () => {
    api.getStoredGrain.mockReturnValue(throwError(() => new Error('500')));
    api.getSavedLists.mockReturnValue(throwError(() => new Error('500')));
    create();
    selectTradeUnits(['1085']);
    signIn();

    expect(appState.storedGrain()).toEqual([]);
    expect(appState.dpContractsLoaded()).toBe(true);
    expect(appState.dataLoading()).toBe(false);
  });
});
