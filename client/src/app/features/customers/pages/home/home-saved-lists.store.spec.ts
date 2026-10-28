import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { NlqFilterContext, NlqFilterService } from '@core/services/nlq-filter.service';
import { UserRolesService } from '@core/services/user-roles.service';
import type { Customer, Note, QueryLibraryItem, SavedList } from '@models';
import { HomeBackgroundFailures } from './home-background-failures';
import { HomePageState } from './home-page.state';
import { HomeSavedListsStore } from './home-saved-lists.store';

const customer = (id: number) => ({ id, scoularId: `S-${id}`, name: `P${id}` }) as Customer;
const list = (id: number, over: Partial<SavedList> = {}): SavedList =>
  ({ id, name: `L${id}`, query: 'corn growers', tradeUnits: 'TU1', createdAt: '', ...over });

describe('HomeSavedListsStore', () => {
  let store: HomeSavedListsStore;
  let page: HomePageState;
  let isAdmin: ReturnType<typeof signal<boolean>>;
  let api: {
    getSavedLists: ReturnType<typeof vi.fn>;
    getQueryLibrary: ReturnType<typeof vi.fn>;
    getTeamSavedLists: ReturnType<typeof vi.fn>;
    getNotes: ReturnType<typeof vi.fn>;
    updateSavedList: ReturnType<typeof vi.fn>;
  };
  let appState: Record<string, ReturnType<typeof vi.fn> | ReturnType<typeof signal>>;
  let nlq: {
    queryNeedsFullNotes: ReturnType<typeof vi.fn>;
    refineFiltersNeedFullNotes: ReturnType<typeof vi.fn>;
    resolveUserReferences: ReturnType<typeof vi.fn>;
    parseAndFilter: ReturnType<typeof vi.fn>;
    applyRefinementFilters: ReturnType<typeof vi.fn>;
    applyCustomerOverrides: ReturnType<typeof vi.fn>;
  };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let failures: { report: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    isAdmin = signal(false);
    api = {
      getSavedLists: vi.fn((): Observable<SavedList[]> => of([])),
      getQueryLibrary: vi.fn((): Observable<QueryLibraryItem[]> => of([])),
      getTeamSavedLists: vi.fn((): Observable<SavedList[]> => of([])),
      getNotes: vi.fn((): Observable<Note[]> => of([])),
      updateSavedList: vi.fn((id: number) => of(list(id))),
    };
    const notes = signal<Note[]>([]);
    const notesLoaded = signal(false);
    const queryLibrary = signal<QueryLibraryItem[]>([]);
    appState = {
      notes, notesLoaded, queryLibrary,
      noteLastContacts: signal([]), myReminders: signal([]), commodities: signal([]), commodityConversions: signal([]),
      setNotes: vi.fn((v: Note[]) => { notes.set(v); notesLoaded.set(true); }),
      setQueryLibrary: vi.fn((v: QueryLibraryItem[]) => queryLibrary.set(v)),
      setSavedLists: vi.fn(),
      setSavedListsLoadFailed: vi.fn(),
    };
    nlq = {
      queryNeedsFullNotes: vi.fn(() => false),
      refineFiltersNeedFullNotes: vi.fn(() => false),
      resolveUserReferences: vi.fn((q: string) => q),
      // Matches producers 1 and 2 for every query.
      parseAndFilter: vi.fn((_q: string, ctx: NlqFilterContext) =>
        ({ customers: ctx.customers.filter(c => c.id <= 2), detectedState: null, matchedPatterns: ['crop'] })),
      applyRefinementFilters: vi.fn((cs: Customer[]) => cs),
      applyCustomerOverrides: vi.fn((ids: number[], inc?: number[], exc?: number[]) =>
        [...new Set([...ids, ...(inc ?? [])])].filter(id => !(exc ?? []).includes(id))),
    };
    toast = { success: vi.fn(), error: vi.fn() };
    failures = { report: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        HomePageState, HomeSavedListsStore,
        { provide: ApiService, useValue: api },
        { provide: AppStateService, useValue: appState },
        { provide: ToastService, useValue: toast },
        { provide: NlqFilterService, useValue: nlq },
        { provide: HomeBackgroundFailures, useValue: failures },
        { provide: UserRolesService, useValue: { isAdmin } },
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => null, getAllAccounts: () => [{ name: 'Pat', username: 'pat@x' }] } } },
      ],
    });
    store = TestBed.inject(HomeSavedListsStore);
    page = TestBed.inject(HomePageState);
    page.customers.set([customer(1), customer(2), customer(3)]);
    page.selectedTradeUnits.set(['TU1']);
  });

  describe('enrichSavedLists', () => {
    it('resolves query + overrides into customerIds, resolving "me" with the first account when none is active', () => {
      store.savedLists.set([list(7, { includedCustomerIds: [3], excludedCustomerIds: [1] })]);
      store.enrichSavedLists();
      expect(store.savedLists()[0].customerIds).toEqual([2, 3]);
      expect(nlq.resolveUserReferences).toHaveBeenCalledWith('corn growers', 'Pat', 'pat@x');
    });

    it('does nothing before the roster has loaded', () => {
      page.customers.set([]);
      store.savedLists.set([list(7)]);
      store.enrichSavedLists();
      expect(store.savedLists()[0].customerIds).toBeUndefined();
    });

    it('leaves already-resolved lists alone unless forced', () => {
      store.savedLists.set([list(7, { customerIds: [9] })]);
      store.enrichSavedLists();
      expect(store.savedLists()[0].customerIds).toEqual([9]);
      store.enrichSavedLists(true);
      expect(store.savedLists()[0].customerIds).toEqual([1, 2]);
    });

    it('fetches full notes once, only for an unresolved list that needs note content, then re-resolves', () => {
      nlq.queryNeedsFullNotes.mockImplementation((q: string) => q.includes('notes'));
      api.getNotes.mockReturnValue(NEVER);
      store.savedLists.set([list(7, { query: 'notes about drought' })]);

      store.enrichSavedLists(true);
      store.enrichSavedLists(true);
      expect(api.getNotes).toHaveBeenCalledTimes(1);

      store.savedLists.set([list(8)]);
      api.getNotes.mockClear();
      store.enrichSavedLists(true);
      expect(api.getNotes).not.toHaveBeenCalled();
    });
  });

  describe('loadSavedLists', () => {
    it('loads lists, fetches the query library only when it is empty, and resolves', () => {
      api.getSavedLists.mockReturnValue(of([list(7)]));
      store.loadSavedLists();
      expect(api.getQueryLibrary).toHaveBeenCalledTimes(1);
      expect(appState['setSavedListsLoadFailed']).toHaveBeenCalledWith(false);
      expect(store.savedLists()[0].customerIds).toEqual([1, 2]);

      store.loadSavedLists();
      expect(api.getQueryLibrary).toHaveBeenCalledTimes(2); // the stub library above was empty
      (appState['queryLibrary'] as ReturnType<typeof signal<QueryLibraryItem[]>>).set([{ id: 1 } as QueryLibraryItem]);
      store.loadSavedLists();
      expect(api.getQueryLibrary).toHaveBeenCalledTimes(2);
    });

    it('flags and reports a failed read', () => {
      const err = new Error('500');
      api.getSavedLists.mockReturnValue(throwError(() => err));
      store.loadSavedLists();
      expect(appState['setSavedListsLoadFailed']).toHaveBeenCalledWith(true);
      expect(failures.report).toHaveBeenCalledWith('load saved lists', err);
    });
  });

  describe('team lists', () => {
    it('are cleared for a non-manager or with no trade unit', () => {
      store.teamSavedLists.set([list(40)]);
      store.loadTeamLists();
      expect(store.teamSavedLists()).toEqual([]);
      expect(api.getTeamSavedLists).not.toHaveBeenCalled();

      isAdmin.set(true);
      page.selectedTradeUnits.set([]);
      store.loadTeamLists();
      expect(api.getTeamSavedLists).not.toHaveBeenCalled();
      expect(store.teamListsForSelectedCustomer()).toEqual([]);
    });

    it('are fetched for the selected trade units and resolved for a manager; a failure keeps the prior set', () => {
      isAdmin.set(true);
      page.selectedTradeUnits.set(['TU1', 'TU2']);
      api.getTeamSavedLists.mockReturnValue(of([list(40)]));
      store.loadTeamLists();
      expect(api.getTeamSavedLists).toHaveBeenCalledWith('TU1,TU2');
      expect(store.teamListsForSelectedCustomer()[0].customerIds).toEqual([1, 2]);

      api.getTeamSavedLists.mockReturnValue(throwError(() => new Error('500')));
      store.loadTeamLists();
      expect(store.teamSavedLists().map(l => l.id)).toEqual([40]);
    });
  });

  describe('saveMembership', () => {
    it('reverts own and team lists together when any save fails', () => {
      page.selectedCustomer.set(customer(3));
      store.savedLists.set([list(7)]);
      store.teamSavedLists.set([list(40)]);
      api.updateSavedList.mockReturnValue(throwError(() => new Error('500')));

      store.saveMembership([{ listId: 7, add: true }, { listId: 40, add: true }]);

      expect(store.savedLists()[0].includedCustomerIds).toBeUndefined();
      expect(store.teamSavedLists()[0].includedCustomerIds).toBeUndefined();
      expect(toast.error).toHaveBeenCalledWith('Failed to save list changes');
    });
  });
});
