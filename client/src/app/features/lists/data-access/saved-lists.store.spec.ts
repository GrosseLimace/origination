import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { NlqFilterContext, NlqFilterService } from '../nlq/nlq-filter.service';
import { ToastService } from '@core/services/toast.service';
import { Contract, Customer, Note, Ticket } from '@models';
import { CustomerStore } from '@features/customers';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { ProducerProfilesFake, producerProfile, producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { QueryLibraryItem } from '../models/query-library.model';
import { SavedList } from '../models/saved-list.model';
import { SavedListsApiService } from './saved-lists-api.service';
import { SavedListsStore } from './saved-lists.store';

const customer = (id: number) => ({ id, scoularId: `S-${id}`, name: `P${id}` }) as Customer;
const list = (id: number, over: Partial<SavedList> = {}): SavedList =>
  ({ id, name: `L${id}`, query: 'corn growers', tradeUnits: 'TU1', createdAt: '', ...over });

/** An engine whose every query matches producers 1 and 2, unless a test says otherwise. */
function nlqFake() {
  return {
    queryNeedsFullNotes: vi.fn((_q: string) => false),
    refineFiltersNeedFullNotes: vi.fn(() => false),
    queryInvolvesTickets: vi.fn((_q: string) => false),
    queryInvolvesStorage: vi.fn(() => false),
    queryInvolvesPlanting: vi.fn(() => false),
    queryInvolvesContracts: vi.fn(() => false),
    queryInvolvesDpContracts: vi.fn(() => false),
    resolveUserReferences: vi.fn((q: string) => q),
    parseAndFilter: vi.fn((_q: string, ctx: NlqFilterContext) =>
      ({ customers: ctx.customers.filter(c => c.id <= 2), detectedState: null, matchedPatterns: ['crop'] })),
    applyRefinementFilters: vi.fn((cs: Customer[], _filters?: unknown, _contracts?: unknown, _notes?: unknown,
      _context?: { producerProfiles?: unknown }) => cs),
    applyCustomerOverrides: vi.fn((ids: number[], inc?: number[], exc?: number[]) =>
      [...new Set([...ids, ...(inc ?? [])])].filter(id => !(exc ?? []).includes(id))),
  };
}

describe('SavedListsStore', () => {
  let store: SavedListsStore;
  let access: PermissionStub;
  let api: {
    getSavedLists: ReturnType<typeof vi.fn>;
    getQueryLibrary: ReturnType<typeof vi.fn>;
    getTeamSavedLists: ReturnType<typeof vi.fn>;
    updateSavedList: ReturnType<typeof vi.fn>;
  };
  let appApi: { getNotes: ReturnType<typeof vi.fn>; getTickets: ReturnType<typeof vi.fn> };
  let nlq: ReturnType<typeof nlqFake>;
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let profiles: ProducerProfilesFake;
  let appState: AppStateService;

  /** The roster arrives, and the effects that follow it run. */
  function roster(...ids: number[]): void {
    TestBed.inject(CustomerStore).setCustomers(ids.map(customer));
    TestBed.tick();
  }

  beforeEach(() => {
    localStorage.clear();
    access = permissionStub(['saved-lists:read:own', 'query-library:read']);
    api = {
      getSavedLists: vi.fn((): Observable<SavedList[]> => of([])),
      getQueryLibrary: vi.fn((): Observable<QueryLibraryItem[]> => of([])),
      getTeamSavedLists: vi.fn((): Observable<SavedList[]> => of([])),
      updateSavedList: vi.fn((id: number) => of(list(id))),
    };
    appApi = { getNotes: vi.fn((): Observable<Note[]> => of([])), getTickets: vi.fn((): Observable<Ticket[]> => of([])) };
    nlq = nlqFake();
    toast = { success: vi.fn(), error: vi.fn() };
    profiles = producerProfilesFake([producerProfile(1, { totalAcres: 900 })]);
    TestBed.configureTestingModule({
      providers: [
        { provide: SavedListsApiService, useValue: api },
        { provide: ApiService, useValue: appApi },
        { provide: NlqFilterService, useValue: nlq },
        { provide: ToastService, useValue: toast },
        providePermissions(access),
        provideProducerProfiles(profiles),
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => null, getAllAccounts: () => [{ name: 'Pat', username: 'pat@x' }] } } },
      ],
    });
    store = TestBed.inject(SavedListsStore);
    appState = TestBed.inject(AppStateService);
    TestBed.inject(TradeUnitContext).setTradeUnits(['TU1']);
  });

  describe('the lists it offers', () => {
    it('are the own lists sharing a selected trade unit', () => {
      store.setLists([list(1, { tradeUnits: 'TU9' }), list(2, { tradeUnits: 'TU1,TU9' })]);
      expect(store.listsInScope().map(l => l.id)).toEqual([2]);
    });
  });

  describe('who each list holds', () => {
    it('is worked out once the roster arrives: the query, then its includes and excludes, "me" being the first account when none is active', () => {
      store.setLists([list(7, { includedCustomerIds: [3], excludedCustomerIds: [1] })]);
      TestBed.tick();
      expect(store.ownListsWithMembers()[0].customerIds).toBeUndefined();

      roster(1, 2, 3);

      expect(store.ownListsWithMembers()[0].customerIds).toEqual([2, 3]);
      expect(nlq.resolveUserReferences).toHaveBeenCalledWith('corn growers', 'Pat', 'pat@x');
    });

    // The lists' acre, contact, link, grain and bin-site prompts and refines read every producer's saved details.
    it("reads the producers' saved details in the query and the refines", () => {
      store.setLists([list(7, { filters: { acresOver: 100 } as SavedList['filters'] })]);
      roster(1, 2, 3);
      store.ownListsWithMembers();
      expect(nlq.parseAndFilter.mock.calls.at(-1)![1].producerProfiles).toBe(profiles.profiles());
      expect(nlq.applyRefinementFilters.mock.calls.at(-1)![4]?.producerProfiles).toBe(profiles.profiles());
    });

    it("is worked out again when the trade unit's data lands", () => {
      store.setLists([list(7)]);
      roster(1, 2, 3);
      nlq.parseAndFilter.mockImplementation((_q: string, ctx: NlqFilterContext) =>
        ({ customers: ctx.customers.filter(c => c.id === 3), detectedState: null, matchedPatterns: ['crop'] }));

      appState.setContracts([{ id: 1 } as Contract]);
      TestBed.tick();

      expect(store.ownListsWithMembers()[0].customerIds).toEqual([3]);
    });

    // Its includes still count, in Add to List's ticks.
    it('is nobody of its own for a list whose query the engine understood none of', () => {
      nlq.parseAndFilter.mockImplementation((_q: string, ctx: NlqFilterContext) =>
        ({ customers: ctx.customers, detectedState: null, matchedPatterns: [] }));
      store.setLists([list(7)]);
      roster(1, 2, 3);
      expect(store.ownListsWithMembers()[0].customerIds).toBeUndefined();
    });

    it('needs the full notes read once, for a list that reads note bodies', () => {
      nlq.queryNeedsFullNotes.mockImplementation((q: string) => q.includes('notes'));
      appApi.getNotes.mockReturnValue(NEVER);
      store.setLists([list(7, { query: 'notes about drought' })]);
      roster(1, 2, 3);
      store.loadMembershipData();
      store.loadMembershipData();
      expect(appApi.getNotes).toHaveBeenCalledTimes(1);
    });

    it("needs the trade unit's tickets read once, for a list about tickets", () => {
      nlq.queryInvolvesTickets.mockImplementation((q: string) => q.includes('tickets'));
      appApi.getTickets.mockReturnValue(NEVER);
      store.setLists([list(7, { query: 'unapplied tickets' })]);
      roster(1, 2, 3);
      store.loadMembershipData();
      store.loadMembershipData();
      expect(appApi.getTickets).toHaveBeenCalledTimes(1);
      expect(appApi.getTickets).toHaveBeenCalledWith(['TU1']);
    });

    it('reads neither for lists that need neither', () => {
      store.setLists([list(7)]);
      roster(1, 2, 3);
      store.loadMembershipData();
      expect(appApi.getNotes).not.toHaveBeenCalled();
      expect(appApi.getTickets).not.toHaveBeenCalled();
    });
  });

  describe('load', () => {
    it('reads the lists, and the query library only while it has none', () => {
      api.getSavedLists.mockReturnValue(of([list(7)]));
      api.getQueryLibrary.mockReturnValue(of([{ id: 1 } as QueryLibraryItem]));

      store.load().subscribe();
      store.load().subscribe();

      expect(store.lists().map(l => l.id)).toEqual([7]);
      expect(store.loaded()).toBe(true);
      expect(api.getQueryLibrary).toHaveBeenCalledTimes(1);
    });

    it('reads nothing for a user who may not read their lists', () => {
      access.grant();
      store.load().subscribe();
      expect(api.getSavedLists).not.toHaveBeenCalled();
    });

    it('records a failed read, and clears it once the lists come back', () => {
      api.getSavedLists.mockReturnValue(throwError(() => new Error('500')));
      store.load().subscribe();
      expect(store.loadFailed()).toBe(true);

      api.getSavedLists.mockReturnValue(of([]));
      store.load().subscribe();
      expect(store.loadFailed()).toBe(false);
    });
  });

  describe('team lists', () => {
    it('are cleared without the team permissions, and with no trade unit', () => {
      store.loadTeamLists().subscribe();
      expect(api.getTeamSavedLists).not.toHaveBeenCalled();

      access.grant('saved-lists:read:team', 'saved-lists:write:team');
      TestBed.inject(TradeUnitContext).setTradeUnits([]);
      store.loadTeamLists().subscribe();
      expect(api.getTeamSavedLists).not.toHaveBeenCalled();
      expect(store.teamListsWithMembers()).toEqual([]);
    });

    // Adding a producer to a teammate's list is a team write.
    it('are not read with the team read alone', () => {
      access.grant('saved-lists:read:team');
      store.loadTeamLists().subscribe();
      expect(store.canEditTeamLists()).toBe(false);
      expect(api.getTeamSavedLists).not.toHaveBeenCalled();
    });

    it('are read for the selected trade units and worked out; a failure keeps the last ones', () => {
      access.grant('saved-lists:read:team', 'saved-lists:write:team');
      TestBed.inject(TradeUnitContext).setTradeUnits(['TU1', 'TU2']);
      api.getTeamSavedLists.mockReturnValue(of([list(40)]));
      store.loadTeamLists().subscribe();
      roster(1, 2, 3);
      expect(api.getTeamSavedLists).toHaveBeenCalledWith('TU1,TU2');
      expect(store.teamListsWithMembers()[0].customerIds).toEqual([1, 2]);

      api.getTeamSavedLists.mockReturnValue(throwError(() => new Error('500')));
      store.loadTeamLists().subscribe();
      expect(store.teamListsWithMembers().map(l => l.id)).toEqual([40]);
    });
  });

  describe('save', () => {
    it('includes the customer on a list, saving it whole, with one message', () => {
      store.setLists([list(7, { excludedCustomerIds: [3] })]);
      store.save(customer(3), [{ listId: 7, add: true }]);
      expect(api.updateSavedList).toHaveBeenCalledWith(7, expect.objectContaining({ includedCustomerIds: [3], excludedCustomerIds: [] }));
      expect(store.lists()[0].includedCustomerIds).toEqual([3]);
      expect(toast.success).toHaveBeenCalledWith('Saved list updated');
    });

    // As Build a List does: a manual include is dropped, a member the query matched is excluded.
    it('takes the customer off: a manual include dropped, a query match excluded', () => {
      store.setLists([list(7, { includedCustomerIds: [3] }), list(8)]);
      store.save(customer(3), [{ listId: 7, add: false }]);
      store.save(customer(1), [{ listId: 8, add: false }]);
      expect(store.lists()[0].includedCustomerIds).toEqual([]);
      expect(store.lists()[1].excludedCustomerIds).toEqual([1]);
    });

    it('puts own and team lists back together when any save fails', () => {
      access.grant('saved-lists:read:team', 'saved-lists:write:team');
      api.getTeamSavedLists.mockReturnValue(of([list(40)]));
      store.loadTeamLists().subscribe();
      store.setLists([list(7)]);
      api.updateSavedList.mockReturnValue(throwError(() => new Error('500')));

      store.save(customer(3), [{ listId: 7, add: true }, { listId: 40, add: true }]);

      expect(store.lists()[0].includedCustomerIds).toBeUndefined();
      expect(store.teamListsWithMembers()[0].includedCustomerIds).toBeUndefined();
      expect(toast.error).toHaveBeenCalledWith('Failed to save list changes');
    });
  });
});
