import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, Subject, of, throwError } from 'rxjs';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { Customer } from '@models';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { DataPreloadService } from '@core/context/data-preload.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { APP_MODULES } from '@core/modules/module-registry';
import { permissionStub, providePermissions } from '@testing/permission.stub';
import { CustomerStore } from './data-access/customer.store';
import { CustomersApiService } from './data-access/customers-api.service';
import { customersModule, preloadCustomers } from './customers.module';

function customer(id: number): Customer {
  return {
    id, scoularId: `C${id}`, name: `Farm ${id}`, location: 'Pratt, KS',
    phone: '', email: '', eSignEnabled: false, achEnabled: false,
  };
}

describe("Customers preload: the trade units' customers", () => {
  let api: { getCustomers: ReturnType<typeof vi.fn<(tradeUnits?: string[]) => Observable<Customer[]>>> };
  let store: CustomerStore;

  function setUp(granted: Parameters<typeof permissionStub>[0] = ['customers:read']) {
    api = { getCustomers: vi.fn((_tradeUnits?: string[]) => of([customer(1)])) };
    TestBed.configureTestingModule({
      providers: [{ provide: CustomersApiService, useValue: api }, providePermissions(permissionStub(granted))],
    });
    store = TestBed.inject(CustomerStore);
  }

  /** Runs the preload the way the trade-unit load does, returning the subscription so a test can cancel it. */
  const run = (tradeUnits: string[]) => TestBed.runInInjectionContext(() => preloadCustomers(tradeUnits)).subscribe();

  it('loads the selected trade units\' customers into the store', () => {
    setUp();
    run(['1085', '2190']);

    expect(api.getCustomers).toHaveBeenCalledWith(['1085', '2190']);
    expect(store.customers()).toEqual([customer(1)]);
    expect(store.customersLoading()).toBe(false);
    expect(store.customersLoadFailed()).toBe(false);
  });

  it('is loading until the customers land, so a screen waits rather than showing "no producers"', () => {
    setUp();
    const customers$ = new Subject<Customer[]>();
    api.getCustomers.mockReturnValue(customers$);
    run(['1085']);

    expect(store.customersLoading()).toBe(true);

    customers$.next([customer(1)]);
    customers$.complete();

    expect(store.customersLoading()).toBe(false);
  });

  it('records a failure, still resolving to [], so the empty list is not shown as "no producers"', () => {
    setUp();
    store.setCustomers([customer(9)]);
    api.getCustomers.mockReturnValue(throwError(() => new Error('500')));
    run(['1085']);

    expect(store.customersLoadFailed()).toBe(true);
    expect(store.customers()).toEqual([]);
    expect(store.customersLoading()).toBe(false);
  });

  it('clears a failure when the next load succeeds, even if it is empty', () => {
    setUp();
    api.getCustomers.mockReturnValueOnce(throwError(() => new Error('500'))).mockReturnValue(of([]));
    run(['1085']);
    expect(store.customersLoadFailed()).toBe(true);

    run(['1085']);

    expect(store.customersLoadFailed()).toBe(false);
  });

  it('starts clean even before the new read lands', () => {
    setUp();
    api.getCustomers.mockReturnValueOnce(throwError(() => new Error('500'))).mockReturnValue(NEVER);
    run(['1085']);
    expect(store.customersLoadFailed()).toBe(true);

    run(['2190']);

    expect(store.customersLoadFailed()).toBe(false);
    expect(store.customersLoading()).toBe(true);
  });

  it('stops loading when it is cancelled', () => {
    setUp();
    api.getCustomers.mockReturnValue(NEVER);
    const load = run(['1085']);
    expect(store.customersLoading()).toBe(true);

    load.unsubscribe();

    expect(store.customersLoading()).toBe(false);
  });

  it('makes no call for a user who may not read customers, so nobody gets a 403 on every trade-unit change', () => {
    setUp([]);
    run(['1085']);

    expect(api.getCustomers).not.toHaveBeenCalled();
    expect(store.customersLoading()).toBe(false);
  });

  it('drops the customers when the session ends', () => {
    setUp();
    run(['1085']);

    TestBed.inject(AppStateService).clearAll();

    expect(store.customers()).toEqual([]);
  });
});

describe('Customers preload, run by the trade-unit load', () => {
  let customersApi: { getCustomers: ReturnType<typeof vi.fn<(tradeUnits?: string[]) => Observable<Customer[]>>> };
  let store: CustomerStore;
  let inProgress$: Subject<InteractionStatus>;

  function selectTradeUnits(units: string[]): void {
    TestBed.inject(TradeUnitContext).setTradeUnits(units);
    TestBed.tick();
  }

  beforeEach(() => {
    localStorage.removeItem('origination_user_prefs');
    inProgress$ = new Subject<InteractionStatus>();
    customersApi = { getCustomers: vi.fn((_tradeUnits?: string[]) => NEVER as Observable<Customer[]>) };
    // The core reads the trade-unit load makes besides the modules' preloads: none matters here.
    const coreReads = new Proxy({}, { get: () => () => of([]) });
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: coreReads },
        { provide: CustomersApiService, useValue: customersApi },
        { provide: MsalBroadcastService, useValue: { inProgress$ } },
        { provide: MsalService, useValue: { instance: { getAllAccounts: () => [{ username: 'originator@scoular.example' }] } } },
        { provide: APP_MODULES, useValue: [customersModule] },
        providePermissions(permissionStub(['customers:read'])),
      ],
    });
    TestBed.inject(DataPreloadService);
    store = TestBed.inject(CustomerStore);
    inProgress$.next(InteractionStatus.None);
    TestBed.tick();
  });

  afterEach(() => localStorage.removeItem('origination_user_prefs'));

  it("keeps the new selection's load showing as loading when it replaces one still in flight", () => {
    selectTradeUnits(['1085']);
    expect(store.customersLoading()).toBe(true);

    selectTradeUnits(['2190']);

    expect(customersApi.getCustomers).toHaveBeenLastCalledWith(['2190']);
    expect(store.customersLoading()).toBe(true);
  });

  it('stops loading when every trade unit is deselected mid-load', () => {
    selectTradeUnits(['1085']);
    expect(store.customersLoading()).toBe(true);

    selectTradeUnits([]);

    expect(store.customersLoading()).toBe(false);
  });
});
