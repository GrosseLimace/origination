import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { NlqFilterContext, NlqFilterService } from '@core/services/nlq-filter.service';
import { ToastService } from '@core/services/toast.service';
import { Customer, Ticket } from '@models';
import { CustomerStore } from '@features/customers';
import { permissionStub, providePermissions } from '@testing/permission.stub';
import { producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { SavedList } from '../models/saved-list.model';
import { SavedListsApiService } from './saved-lists-api.service';
import { SavedListsStore } from './saved-lists.store';
import { RUNNING_SAVED_LIST, SavedListFilterStore } from './saved-list-filter.store';

const customer = (id: number, state = 'KS') => ({ id, scoularId: `S-${id}`, name: `P${id}`, stateProvince: state }) as Customer;
const list = (id: number, over: Partial<SavedList> = {}): SavedList =>
  ({ id, name: `L${id}`, query: 'kansas growers', tradeUnits: 'TU1', createdAt: '', ...over });

describe('SavedListFilterStore', () => {
  let filter: SavedListFilterStore;
  let lists: SavedListsStore;
  let customers: CustomerStore;
  let tradeUnits: TradeUnitContext;
  let appState: AppStateService;
  let nlq: NlqFilterService;
  let appApi: { getTickets: ReturnType<typeof vi.fn>; getNotes: ReturnType<typeof vi.fn> };

  /** Who the filter keeps, as ids, or its kind when it keeps no particular set. */
  const kept = (): number[] | string => {
    const k = filter.kept();
    return k.kind === 'some' ? [...k.ids].sort((a, b) => a - b) : k.kind;
  };

  function roster(...people: Customer[]): void {
    customers.setCustomers(people);
    TestBed.tick();
  }

  beforeEach(() => {
    localStorage.clear();
    appApi = { getTickets: vi.fn((): Observable<Ticket[]> => of([])), getNotes: vi.fn(() => of([])) };
    nlq = new NlqFilterService();
    // Kansas producers, for every query: the tests are about when a list runs, not the grammar.
    vi.spyOn(nlq, 'parseAndFilter').mockImplementation((_q: string, ctx: NlqFilterContext) =>
      ({ customers: ctx.customers.filter(c => c.stateProvince === 'KS'), detectedState: null, matchedPatterns: ['state'] }));
    TestBed.configureTestingModule({
      providers: [
        { provide: SavedListsApiService, useValue: { getSavedLists: () => of([]), getQueryLibrary: () => of([]) } },
        { provide: ApiService, useValue: appApi },
        { provide: NlqFilterService, useValue: nlq },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
        providePermissions(permissionStub(['saved-lists:read:own'])),
        provideProducerProfiles(producerProfilesFake()),
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => null, getAllAccounts: () => [] } } },
      ],
    });
    filter = TestBed.inject(SavedListFilterStore);
    lists = TestBed.inject(SavedListsStore);
    customers = TestBed.inject(CustomerStore);
    tradeUnits = TestBed.inject(TradeUnitContext);
    appState = TestBed.inject(AppStateService);
    tradeUnits.setTradeUnits(['TU1']);
    TestBed.tick();
    lists.setLists([list(10), list(11, { tradeUnits: 'TU9' })]);
    roster(customer(1), customer(2, 'NE'), customer(3));
  });

  it('keeps every customer until a list is picked', () => {
    expect(kept()).toBe('all');
  });

  it("offers the user's own lists that share a trade unit with the selection", () => {
    expect(filter.options().map(l => l.id)).toEqual([10]);
  });

  it('keeps who the picked list holds, with its count, and every customer again on "All Producers"', () => {
    filter.select('10');
    expect(kept()).toEqual([1, 3]);
    expect(filter.count()).toBe(2);

    filter.select('all');
    expect(kept()).toBe('all');
  });

  it("applies the list's own includes and excludes", () => {
    lists.setLists([list(10, { includedCustomerIds: [2], excludedCustomerIds: [3] })]);
    filter.select('10');
    expect(kept()).toEqual([1, 2]);
  });

  it('waits, keeping no set, while there are no customers yet; runs once they arrive', () => {
    roster();
    filter.select('10');
    expect(filter.kept()).toEqual({ kind: 'pending', message: RUNNING_SAVED_LIST });

    roster(customer(1), customer(3));

    expect(kept()).toEqual([1, 3]);
  });

  it('reads what the list needs first, waiting meanwhile: the trade unit\'s tickets for a list about tickets', () => {
    vi.spyOn(nlq, 'queryInvolvesTickets').mockReturnValue(true);
    const tickets = new Subject<Ticket[]>();
    appApi.getTickets.mockReturnValue(tickets);

    filter.select('10');
    expect(kept()).toBe('pending');
    expect(appApi.getTickets).toHaveBeenCalledWith(['TU1']);

    tickets.next([]);
    tickets.complete();
    expect(kept()).toEqual([1, 3]);
  });

  it('works the list out again when the trade unit\'s tickets arrive later, for a list about tickets', () => {
    vi.spyOn(nlq, 'queryInvolvesTickets').mockReturnValue(true);
    appState.setTickets([]);
    filter.select('10');
    vi.mocked(nlq.parseAndFilter).mockImplementation((_q, ctx) =>
      ({ customers: ctx.customers.filter(c => c.id === 1), detectedState: null, matchedPatterns: ['tickets'] }));

    appState.setTickets([{ id: 1 } as Ticket]);
    TestBed.tick();

    expect(kept()).toEqual([1]);
  });

  it('works the list out again when the roster grows', () => {
    filter.select('10');
    roster(customer(1), customer(2, 'NE'), customer(3), customer(4));
    expect(kept()).toEqual([1, 3, 4]);
  });

  it('works the list out again when the list changes, as when a customer is added to it', () => {
    filter.select('10');
    lists.setLists([list(10, { includedCustomerIds: [2] })]);
    TestBed.tick();
    expect(kept()).toEqual([1, 2, 3]);
  });

  it('goes back to every customer when the picked list is deleted', () => {
    filter.select('10');
    lists.setLists([list(12)]);
    TestBed.tick();
    expect(filter.selectedId()).toBe('all');
    expect(kept()).toBe('all');
  });

  it('keeps the pick for trade units the list still applies to, waiting for their customers, and runs against them', () => {
    filter.select('10');
    tradeUnits.setTradeUnits(['TU1', 'TU2']);
    TestBed.tick();
    expect(kept()).toBe('pending');

    roster(customer(5), customer(6, 'NE'));

    expect(kept()).toEqual([5]);
  });

  it('goes back to every customer for trade units the list does not apply to', () => {
    filter.select('10');
    tradeUnits.setTradeUnits(['TU9']);
    TestBed.tick();
    expect(filter.selectedId()).toBe('all');
    expect(kept()).toBe('all');
  });
});
