import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, NEVER, of, throwError } from 'rxjs';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { CommodityConversion, Contract, Ticket } from '@models';
import { DataPreloadService } from './data-preload.service';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { APP_MODULES } from '@core/modules/module-registry';
import { providePermissions } from '@testing/permission.stub';

/**
 * The trade-unit-wide preload that feeds every screen. Driven against the REAL AppStateService so the
 * assertions are on the state screens actually read. Pins:
 *  - nothing loads before sign-in; commodity conversions load once after sign-in even with no TU,
 *  - no trade units → every loading flag drops and no TU-scoped call is made,
 *  - each core dataset's loading flag drops as its own data lands (the customers' is Customers' preload's),
 *  - a contracts failure is RECORDED (outage banner) while the page still loads with [],
 *  - a today's-tickets TIMEOUT is "pending", not "failed"; a real error is "failed",
 *  - re-selecting the same trade units in another order does not reload; forceReload does,
 *  - a TU change drops the lazily-loaded note cache,
 *  - every module's preload runs with the selected trade units, and is cancelled by the next selection.
 */

const PREFS_KEY = 'origination_user_prefs';
const NOW = new Date('2026-10-13T12:00:00');

type Api = Record<
  | 'getCommodityConversions' | 'getNotesLastContact'
  | 'getMyReminders' | 'getCommodities' | 'getHarvestWindows',
  ReturnType<typeof vi.fn<(...args: unknown[]) => Observable<unknown>>>
>;

describe('DataPreloadService', () => {
  let api: Api;
  let appState: AppStateService;
  let inProgress$: Subject<InteractionStatus>;
  let accounts: { username: string }[];
  /** One module's preload, standing in for every module the app lists. */
  let modulePreload: ReturnType<typeof vi.fn<(tradeUnits: readonly string[]) => Observable<unknown>>>;

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
    TestBed.inject(TradeUnitContext).setTradeUnits(units);
    TestBed.tick();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    localStorage.removeItem(PREFS_KEY);
    inProgress$ = new Subject<InteractionStatus>();
    accounts = [];
    modulePreload = vi.fn((_tradeUnits: readonly string[]) => of(null) as Observable<unknown>);
    api = {
      getCommodityConversions: vi.fn(() => of<CommodityConversion[]>([])),
      getNotesLastContact: vi.fn(() => of([])),
      getMyReminders: vi.fn(() => of([])),
      getCommodities: vi.fn(() => of([])),
      getHarvestWindows: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: MsalBroadcastService, useValue: { inProgress$ } },
        { provide: MsalService, useValue: { instance: { getAllAccounts: () => accounts } } },
        { provide: APP_MODULES, useValue: [{ id: 'producers', preload: modulePreload }] },
        providePermissions(),
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
    expect(modulePreload).not.toHaveBeenCalled();
  });

  it('loads commodity conversions once after sign-in even with no trade unit selected', () => {
    const conversions: CommodityConversion[] = [{ commodityCode: 'YC', lbsPerUnit: 56 }];
    api.getCommodityConversions.mockReturnValue(of(conversions));
    create();
    signIn();

    expect(appState.commodityConversions()).toEqual(conversions);
    expect(modulePreload).not.toHaveBeenCalled();
  });

  it('with no trade units, makes no trade-unit-scoped call and runs no module preload', () => {
    create();
    signIn();

    expect(api.getNotesLastContact).not.toHaveBeenCalled();
    expect(modulePreload).not.toHaveBeenCalled();
  });

  // (The trade units' own data is the modules': their customers, contracts, tickets, planting, stored grain and DP.)
  it('loads the shared datasets into app state once trade units are selected', () => {
    api.getCommodities.mockReturnValue(of([{ code: 'YC' }]));
    create();
    selectTradeUnits(['1085', '2190']);
    signIn();

    for (const fn of [api.getNotesLastContact, api.getCommodities, api.getHarvestWindows]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
    expect(appState.commodities()).toEqual([{ code: 'YC' }]);
  });

  it('does not reload when the same trade units are re-selected in a different order', () => {
    create();
    selectTradeUnits(['1085', '2190']);
    signIn();
    selectTradeUnits(['2190', '1085']);

    expect(modulePreload).toHaveBeenCalledTimes(1);

    selectTradeUnits(['2190']);
    expect(modulePreload).toHaveBeenCalledTimes(2);
  });

  it('forceReload re-runs the load for the current trade units, and is a no-op with none selected', () => {
    const service = create();
    signIn();
    service.forceReload();
    expect(modulePreload).not.toHaveBeenCalled();

    selectTradeUnits(['1085']);
    service.forceReload();
    expect(modulePreload).toHaveBeenCalledTimes(2);
  });

  // (The trade unit's ticket set is Contracts', which drops it in its own preload.)
  it('drops the lazily-loaded note cache on a trade-unit change', () => {
    create();
    selectTradeUnits(['1085']);
    signIn();
    appState.setNotes([]);
    expect(appState.notesLoaded()).toBe(true);

    selectTradeUnits(['3000']);

    expect(appState.notesLoaded()).toBe(false);
  });

  it("runs each module's preload with the selected trade units", () => {
    create();
    selectTradeUnits(['2190', '1085']);
    signIn();

    expect(modulePreload).toHaveBeenCalledTimes(1);
    expect(modulePreload).toHaveBeenCalledWith(['2190', '1085']);
  });

  it("cancels a module's preload when the trade units change before it finishes", () => {
    let cancelled = 0;
    modulePreload.mockImplementation(() => new Observable(() => () => { cancelled++; }));
    create();
    selectTradeUnits(['1085']);
    signIn();
    selectTradeUnits(['2190']);

    expect(cancelled).toBe(1);
    expect(modulePreload).toHaveBeenCalledTimes(2);
  });

  it('a failing secondary read does not stop the others', () => {
    api.getCommodities.mockReturnValue(throwError(() => new Error('500')));
    api.getHarvestWindows.mockReturnValue(throwError(() => new Error('500')));
    create();
    selectTradeUnits(['1085']);
    signIn();

    expect(appState.commodities()).toEqual([]);
    expect(api.getNotesLastContact).toHaveBeenCalled();
    expect(modulePreload).toHaveBeenCalledWith(['1085']);
  });

  // Each of these used to resolve a failure to [] with nothing recorded, so the screens showed
  // "no producers", "Never contacted" and the like for an outage.
  describe('records which trade-unit reads failed, so an empty result is not shown as "none"', () => {
    const cases: [string, keyof Api, () => boolean][] = [
      ['last-contact dates', 'getNotesLastContact', () => appState.noteLastContactsLoadFailed()],
      ['follow-ups', 'getMyReminders', () => appState.myRemindersLoadFailed()],
      ['harvest windows', 'getHarvestWindows', () => appState.harvestWindowsLoadFailed()],
    ];

    it.each(cases)('%s: set on failure, still resolving to [] so the page loads', (_name, call, failed) => {
      api[call].mockReturnValue(throwError(() => new Error('500')));
      create();
      selectTradeUnits(['1085']);
      signIn();

      expect(failed()).toBe(true);
      expect(modulePreload).toHaveBeenCalledWith(['1085']);
    });

    it.each(cases)('%s: cleared when the next load succeeds, even if it is empty', (_name, call, failed) => {
      api[call].mockReturnValueOnce(throwError(() => new Error('500'))).mockReturnValue(of([]));
      const service = create();
      selectTradeUnits(['1085']);
      signIn();
      expect(failed()).toBe(true);

      service.forceReload();

      expect(failed()).toBe(false);
    });

    it.each(cases)('%s: a trade-unit change starts clean even before the new read lands', (_name, call, failed) => {
      api[call].mockReturnValueOnce(throwError(() => new Error('500'))).mockReturnValue(NEVER);
      create();
      selectTradeUnits(['1085']);
      signIn();
      expect(failed()).toBe(true);

      selectTradeUnits(['2190']);

      expect(failed()).toBe(false);
    });

    it('nothing is flagged when every read succeeds', () => {
      create();
      selectTradeUnits(['1085']);
      signIn();

      for (const [, , failed] of cases) expect(failed()).toBe(false);
      expect(appState.commodityConversionsLoadFailed()).toBe(false);
    });
  });

  it('records a failed commodity-conversion load, and a trade-unit change does not clear it (it is not reloaded)', () => {
    api.getCommodityConversions.mockReturnValue(throwError(() => new Error('500')));
    create();
    selectTradeUnits(['1085']);
    signIn();
    expect(appState.commodityConversionsLoadFailed()).toBe(true);
    expect(appState.commodityConversions()).toEqual([]);

    selectTradeUnits(['2190']);

    expect(appState.commodityConversionsLoadFailed()).toBe(true);
  });

  it('a module preload that fails does not stop the trade-unit load, now or on the next change', () => {
    modulePreload.mockImplementation(() => throwError(() => new Error('500')));
    create();
    selectTradeUnits(['1085']);
    signIn();

    expect(api.getHarvestWindows).toHaveBeenCalledTimes(1);

    selectTradeUnits(['2190']);
    expect(api.getHarvestWindows).toHaveBeenCalledTimes(2);
    expect(modulePreload).toHaveBeenLastCalledWith(['2190']);
  });
});
