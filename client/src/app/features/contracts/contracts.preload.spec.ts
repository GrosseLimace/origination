import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, Subject, of, throwError } from 'rxjs';
import { Contract, Ticket } from '@models';
import { PermissionId } from '@core/access/permission-ids.generated';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { permissionStub, providePermissions } from '@testing/permission.stub';
import { ContractStore } from './data-access/contract.store';
import { ContractsApiService } from './data-access/contracts-api.service';
import { preloadContracts } from './contracts.module';

const contract = (id: number) => ({ id, contractNumber: `P${id}`, status: 'Active' }) as Contract;
const ticket = (id: number) => ({ id, ticketNumber: `${id}`, isApplied: false }) as Ticket;

/**
 * Contracts' preload: the trade units' contracts and today's tickets for each new trade-unit selection, with the
 * loading flags and failures the screens read. Formerly part of DataPreloadService.
 */
describe('Contracts preload', () => {
  let api: { getContracts: ReturnType<typeof vi.fn>; getTodaysTickets: ReturnType<typeof vi.fn> };
  let store: ContractStore;

  function setUp(granted: PermissionId[] = ['contracts:read', 'tickets:read']): void {
    TestBed.configureTestingModule({
      providers: [{ provide: ContractsApiService, useValue: api }, providePermissions(permissionStub(granted))],
    });
    store = TestBed.inject(ContractStore);
  }

  const preload = (tradeUnits: string[] = ['1085']): Observable<unknown> =>
    TestBed.runInInjectionContext(() => preloadContracts(tradeUnits));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    api = {
      getContracts: vi.fn((): Observable<Contract[]> => of([contract(1)])),
      getTodaysTickets: vi.fn((): Observable<Ticket[]> => of([ticket(1)])),
    };
  });

  afterEach(() => vi.useRealTimers());

  it("loads the trade units' contracts and today's tickets", () => {
    setUp();
    preload(['1085', '2190']).subscribe();

    expect(api.getContracts).toHaveBeenCalledWith(['1085', '2190']);
    expect(api.getTodaysTickets).toHaveBeenCalledWith(['1085', '2190']);
    expect(store.contracts()).toEqual([contract(1)]);
    expect(store.todaysTickets()).toEqual([ticket(1)]);
  });

  it('reads only what the user may read, and waits for nothing it skipped', () => {
    setUp(['tickets:read']);
    preload().subscribe();

    expect(api.getContracts).not.toHaveBeenCalled();
    expect(store.contractsLoading()).toBe(false);
    expect(api.getTodaysTickets).toHaveBeenCalled();
  });

  it("drops each dataset's loading flag as its own data lands", () => {
    const contracts$ = new Subject<Contract[]>();
    const tickets$ = new Subject<Ticket[]>();
    api.getContracts.mockReturnValue(contracts$);
    api.getTodaysTickets.mockReturnValue(tickets$);
    setUp();
    preload().subscribe();

    expect(store.contractsLoading()).toBe(true);
    expect(store.todaysTicketsLoading()).toBe(true);

    tickets$.next([ticket(1)]);
    expect(store.todaysTicketsLoading()).toBe(false); // each screen can render as its own data lands
    expect(store.contractsLoading()).toBe(true);

    contracts$.next([contract(1)]);
    expect(store.contractsLoading()).toBe(false);
  });

  it('drops the loading flags when the next selection cancels the load', () => {
    api.getContracts.mockReturnValue(NEVER);
    api.getTodaysTickets.mockReturnValue(NEVER);
    setUp();
    const load = preload().subscribe();
    expect(store.contractsLoading()).toBe(true);

    load.unsubscribe();

    expect(store.contractsLoading()).toBe(false);
    expect(store.todaysTicketsLoading()).toBe(false);
  });

  it('records a contracts failure for the outage banner while still loading the page with []', () => {
    api.getContracts.mockReturnValue(throwError(() => new Error('gateway')));
    setUp();
    preload().subscribe();

    expect(store.contractsLoadFailed()).toBe(true);
    expect(store.contracts()).toEqual([]);
    expect(store.contractsLoading()).toBe(false);
  });

  it('clears a previous contracts failure when the next load succeeds, even if it is empty', () => {
    api.getContracts.mockReturnValueOnce(throwError(() => new Error('gateway'))).mockReturnValue(of([]));
    setUp();
    preload().subscribe();
    expect(store.contractsLoadFailed()).toBe(true);

    preload().subscribe();

    expect(store.contractsLoadFailed()).toBe(false);
  });

  it("treats a today's-tickets TIMEOUT as pending, not as a CTRM failure", () => {
    api.getTodaysTickets.mockReturnValue(NEVER);
    setUp();
    preload().subscribe();

    vi.advanceTimersByTime(59_999);
    expect(store.todaysTicketsLoading()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(store.sourceLoadPending()).toBe(true);
    expect(store.ticketsLoadFailed()).toBe(false);
    expect(store.todaysTicketsLoading()).toBe(false);
    expect(store.todaysTickets()).toEqual([]);
  });

  it("records a real today's-tickets error as a failure", () => {
    api.getTodaysTickets.mockReturnValue(throwError(() => new Error('500')));
    setUp();
    preload().subscribe();

    expect(store.ticketsLoadFailed()).toBe(true);
    expect(store.sourceLoadPending()).toBe(false);
  });

  // The screens that need the trade unit's full ticket set read it themselves, for the selection they show.
  it("drops the trade unit's ticket set the last selection read", () => {
    setUp();
    TestBed.inject(TradeUnitContext).setTradeUnits(['1085']);
    store.setTickets([ticket(9)]);
    expect(store.ticketsLoaded()).toBe(true);

    preload(['3000']).subscribe();

    expect(store.ticketsLoaded()).toBe(false);
    expect(store.tickets()).toEqual([]);
  });
});
