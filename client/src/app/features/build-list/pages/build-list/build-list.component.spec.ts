import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { Observable, Subject, of, throwError } from 'rxjs';
import { BuildListComponent } from './build-list.component';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { UserRolesService } from '@core/services/user-roles.service';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';
import { NlqFilterContext, NlqFilterResult, NlqFilterService } from '@core/services/nlq-filter.service';
import { Contract, Customer, NoteLastContact, QueryLibraryItem, RefinementFilters, SavedList, Ticket } from '@models';

// Behaviour safety net for the Build a List page ahead of its OnPush conversion and decomposition.
// Everything is driven through public methods / signals / computeds and the REAL rendered template,
// so the internals (private loaders, effects, change detection strategy) can be split up without
// touching this file. NlqFilterService is stubbed on purpose: the parser has its own specs, and a
// stub lets these tests say exactly which producers a prompt "matched" and assert what the
// COMPONENT does with them (sorting, counting, refinements, member overrides, empty/error states).
//
// Kept separate from build-list.trade-unit-reload.spec.ts, which pins the reload/parking timing.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Frozen "now" (Date only — timers stay real unless a test opts in) so the last-contact badges
 *  and not-contacted-in-N-days refinement never drift with the calendar. */
const NOW = new Date('2026-10-13T12:00:00');
const DAY = 24 * 60 * 60 * 1000;

function makeCustomer(over: Partial<Customer> & Pick<Customer, 'id' | 'name'>): Customer {
  return {
    scoularId: `C${over.id}`, farm: '', location: '', phone: '', email: '', totalAcres: 0,
    linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

const ALPHA = makeCustomer({ id: 1, name: 'Alpha Acres', location: 'Pratt', stateProvince: 'KS' });
const BRAVO = makeCustomer({ id: 2, name: 'Bravo Grain', location: 'Madrid', stateProvince: 'NE' });
const CHARLIE = makeCustomer({ id: 3, name: 'Charlie Farms', location: 'Hays', stateProvince: 'KS' });
const DELTA = makeCustomer({ id: 4, name: 'Delta Dairy', location: 'Salina', stateProvince: 'KS' });
/** Deliberately NOT alphabetical, so a test can tell "sorted by the component" from "API order". */
const ROSTER: Customer[] = [CHARLIE, ALPHA, BRAVO];

function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1, customerId: 1, ctrmCustomerId: 'C1', sourceContractId: 'PCW100', farmId: 'F1',
    contractNumber: '100', contractPrefixType: 'P', commodityCode: 'YC', commodityDescription: 'Corn',
    commodityGroup: 'Corn', quantity: 10000, unit: 'bushels', price: 0, openBalanceQuantity: 10000,
    deliveryStart: new Date(NOW.getTime() - 30 * DAY), deliveryEnd: new Date(NOW.getTime() + 30 * DAY),
    status: 'Active', signed: true, priceTypeCode: 'P', ...over,
  };
}

const LIB_CONTRACTS: QueryLibraryItem = {
  id: 1, category: 'Contracts', name: 'All producers with contracts', description: 'Every producer holding a purchase contract',
  queryText: 'All producers with contracts', sortOrder: 1,
};
const LIB_ACTIVE: QueryLibraryItem = {
  id: 2, category: 'Contracts', name: 'Producers with active contracts', queryText: 'Producers with active contracts', sortOrder: 2,
};
const LIB_DELIVERED: QueryLibraryItem = {
  id: 3, category: 'Tickets', name: 'Producers who delivered this month', queryText: 'Producers who delivered this month',
  sortOrder: 1, tags: 'deliveries scale',
};
const LIB_ALL: QueryLibraryItem = { id: 4, category: 'Producers', name: 'All producers', queryText: 'All producers', sortOrder: 1 };
const LIB_TOP: QueryLibraryItem = { id: 5, category: 'Producers', name: 'Top 10 by acres', queryText: 'Top 10 producers by acres', sortOrder: 2 };
const LIB_BLANK: QueryLibraryItem = { id: 6, category: 'Producers', name: 'Start with no producers', queryText: 'Start with no producers', sortOrder: 3 };
const LIBRARY: QueryLibraryItem[] = [LIB_CONTRACTS, LIB_ACTIVE, LIB_DELIVERED, LIB_ALL, LIB_TOP, LIB_BLANK];

const SAVED_KS: SavedList = {
  id: 10, name: 'KS contract holders', query: 'All producers with contracts', tradeUnits: '1000',
  filters: { states: ['KS'] }, excludedCustomerIds: [3], createdAt: '2026-10-01T00:00:00',
};
const SAVED_OTHER_TU: SavedList = {
  id: 11, name: 'Somebody else\'s trade unit', query: 'All producers', tradeUnits: '9999', createdAt: '2026-10-01T00:00:00',
};

// ── Stubs ─────────────────────────────────────────────────────────────────────

/** Every ApiService call the page makes. Defaults resolve immediately; a test swaps one for a
 *  Subject or throwError to control timing / failure. */
function makeApi() {
  return {
    getCustomers: vi.fn((_tus?: string[]): Observable<Customer[]> => of(ROSTER)),
    getContracts: vi.fn((_tus?: string[]): Observable<Contract[]> => of([])),
    getTickets: vi.fn((_tus?: string[]): Observable<Ticket[]> => of([])),
    getPlantingIntentions: vi.fn(() => of([])),
    getStoredGrain: vi.fn(() => of([])),
    getSavedLists: vi.fn((): Observable<SavedList[]> => of([SAVED_KS, SAVED_OTHER_TU])),
    getAllProducerDetails: vi.fn(() => of([])),
    getQueryLibrary: vi.fn((): Observable<QueryLibraryItem[]> => of(LIBRARY)),
    getPlantingCommodities: vi.fn(() => of([])),
    getUserTradeUnits: vi.fn(() => of([{ groupName: 'West', tradeUnitCodes: ['1000', '2000'], tradeUnits: [] }])),
    getTeamMembers: vi.fn(() => of([])),
    getTeamSavedLists: vi.fn(() => of([])),
    getNotes: vi.fn(() => of([])),
    getDpContracts: vi.fn(() => of([])),
    getCommodityConversions: vi.fn(() => of([])),
    searchCustomers: vi.fn(() => of([])),
    logQuerySearch: vi.fn(() => of(undefined)),
    createSavedList: vi.fn((): Observable<SavedList> => of({ ...SAVED_KS, id: 99 })),
    updateSavedList: vi.fn((): Observable<SavedList> => of(SAVED_KS)),
    deleteSavedList: vi.fn((): Observable<void> => of(undefined)),
    assignSavedList: vi.fn(() => of([])),
  };
}

/** The NLQ engine, reduced to keyword checks the tests can reason about. parseAndFilter returns
 *  whichever producers `matchIds` names (in roster order — the component owns the final order). */
function makeNlq() {
  const state = { matchIds: null as number[] | null, detectedState: null as string | null };
  const lower = (q: string) => q.toLowerCase();
  const stub = {
    state,
    parseAndFilter: vi.fn((_q: string, ctx: NlqFilterContext): NlqFilterResult => ({
      customers: state.matchIds === null ? ctx.customers : ctx.customers.filter(c => state.matchIds!.includes(c.id)),
      detectedState: state.detectedState,
      matchedPatterns: [],
    })),
    queryInvolvesTickets: vi.fn((q: string) => /deliver|ticket/.test(lower(q))),
    queryInvolvesContracts: vi.fn((q: string) => lower(q).includes('contract')),
    queryInvolvesStorage: vi.fn((q: string) => lower(q).includes('storage')),
    queryInvolvesDpContracts: vi.fn((q: string) => /\bdp\b/.test(lower(q))),
    queryInvolvesPlanting: vi.fn((q: string) => lower(q).includes('planting')),
    queryInvolvesContact: vi.fn((q: string) => /contacted|follow.?up/.test(lower(q))),
    isRankingQuery: vi.fn((q: string) => /top\s*\d+/.test(lower(q))),
    dataNeedsForCriteria: vi.fn(() => ({ tickets: false, contracts: false, storage: false, dp: false, planting: false, fullNotes: false })),
    extractNoteSearchKeywords: vi.fn((): string[] => []),
    getStateDisplayName: vi.fn((s: string) => (s === 'KS' ? 'Kansas' : s)),
    resolveUserReferences: vi.fn((q: string) => q),
    buildAuthorCandidates: vi.fn((): string[] => []),
    matchesAuthor: vi.fn(() => false),
    refineDimension: vi.fn(() => null),
  };
  return stub;
}

// ── Harness ───────────────────────────────────────────────────────────────────

describe('BuildListComponent', () => {
  let api: ReturnType<typeof makeApi>;
  let nlq: ReturnType<typeof makeNlq>;
  let toast: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
  let usage: { postClickEvent: ReturnType<typeof vi.fn>; trackProfileOpened: ReturnType<typeof vi.fn> };
  let isAdmin: boolean;
  let appState: AppStateService;
  let fixture: ComponentFixture<BuildListComponent>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    api = makeApi();
    nlq = makeNlq();
    toast = { info: vi.fn(), error: vi.fn(), success: vi.fn() };
    usage = { postClickEvent: vi.fn(), trackProfileOpened: vi.fn() };
    isAdmin = false;
    TestBed.configureTestingModule({
      imports: [BuildListComponent],
      providers: [
        provideRouter([]),
        AppStateService,
        { provide: ApiService, useValue: api },
        { provide: NlqFilterService, useValue: nlq },
        { provide: DataPreloadService, useValue: {} },
        // The header's trade-unit picker renders for real; its own service is stubbed because the page
        // only reacts to AppStateService.selectedTradeUnits, which these tests drive directly.
        { provide: UserTradeUnitsService, useValue: { load: () => of([]), openPreferences: vi.fn(), computeAvailableTradeUnits: () => [] } },
        { provide: ToastService, useValue: toast },
        { provide: UsageTrackingService, useValue: usage },
        { provide: UserRolesService, useValue: { isAdmin: () => isAdmin } },
        {
          provide: MsalService,
          useValue: { instance: { getActiveAccount: () => ({ name: 'Pat Merchant', username: 'pat@scoular.com' }), getAllAccounts: () => [] } },
        },
      ],
    });
    appState = TestBed.inject(AppStateService);
    appState.setUserGroups([]); // groups "loaded" (none needed here), so the header does not block on them
    appState.setTradeUnits(['1000']);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mount(): BuildListComponent {
    fixture = TestBed.createComponent(BuildListComponent);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /** Re-renders and returns the page text with whitespace collapsed. */
  function text(): string {
    TestBed.tick();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  }

  function buttonByText(label: string): HTMLButtonElement | undefined {
    fixture.detectChanges();
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find(b => b.textContent!.replace(/\s+/g, ' ').trim().startsWith(label));
  }

  const names = (list: Customer[]) => list.map(c => c.name);

  // ── Initial load, empty and error states ──────────────────────────────────

  describe('initial load', () => {
    it('loads the selected trade unit and renders the prompt library grouped by category, clickable', () => {
      const c = mount();

      expect(api.getCustomers).toHaveBeenCalledWith(['1000']);
      expect(c.coreDataLoaded()).toBe(true);
      expect(c.loading()).toBe(false);
      expect(c.customers()).toHaveLength(3);
      expect(c.queryLibraryLoaded()).toBe(true);
      // The shared cache is warmed so other pages can resolve a saved list's category.
      expect(appState.queryLibrary()).toEqual(LIBRARY);

      expect(c.groupedLibrary().map(g => g.category)).toEqual(['Contracts', 'Tickets', 'Producers']);
      expect(c.libraryCategories()).toEqual(['Saved Lists', 'Contracts', 'Producers', 'Tickets']);
      const button = buttonByText('All producers with contracts');
      expect(button).toBeDefined();
      expect(button!.disabled).toBe(false);
      expect(text()).toContain('Every producer holding a purchase contract');
    });

    it('with no trade unit selected, loads nothing and disables every library prompt', () => {
      appState.setTradeUnits([]);
      const c = mount();

      expect(api.getCustomers).not.toHaveBeenCalled();
      expect(c.hasSelectedTradeUnit()).toBe(false);
      expect(c.coreDataLoaded()).toBe(false);
      expect(c.loading()).toBe(false);
      expect(buttonByText('All producers with contracts')!.disabled).toBe(true);
    });

    it('shows the "no producers" empty state for a trade unit with an empty roster', () => {
      api.getCustomers.mockReturnValue(of([]));
      const c = mount();

      expect(c.coreDataLoaded()).toBe(true);
      expect(c.sourceLoadFailed()).toBe(false);
      expect(text()).toContain('No producers found for the selected trade units');
    });

    it('a failed customers read lands as an empty roster, never a stuck spinner — and says it failed', () => {
      api.getCustomers.mockReturnValue(throwError(() => new Error('500')));
      const c = mount();

      expect(c.loading()).toBe(false);
      expect(c.coreDataLoaded()).toBe(true);
      expect(c.customers()).toEqual([]);
      // An outage must not read as an empty trade unit.
      expect(text()).toContain('Producers for the selected trade units could not be loaded');
      expect(text()).not.toContain('No producers found for the selected trade units');
    });

    it('a genuinely empty trade unit still says "no producers found"', () => {
      api.getCustomers.mockReturnValue(of([]));
      mount();

      expect(text()).toContain('No producers found for the selected trade units');
      expect(text()).not.toContain('could not be loaded');
    });

    it('an empty roster caused by a CTRM contract outage says so instead of "no producers"', () => {
      api.getCustomers.mockReturnValue(of([]));
      api.getContracts.mockReturnValue(throwError(() => new Error('timeout')));
      const c = mount();

      expect(c.contractsLoadFailed()).toBe(true);
      expect(c.sourceLoadFailed()).toBe(true);
      const page = text();
      expect(page).toContain('Contract and ticket data could not be loaded from CTRM');
      expect(page).not.toContain('No producers found for the selected trade units');
    });

    it('a failed query-library read stops the library spinner and tells the user', () => {
      api.getQueryLibrary.mockReturnValue(throwError(() => new Error('500')));
      const c = mount();

      expect(c.queryLibraryLoaded()).toBe(true);
      expect(c.queryLibrary()).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith('Failed to load query library');
      expect(text()).not.toContain('Loading queries...');
    });
  });

  // ── Prompt selection and results ──────────────────────────────────────────

  describe('prompt selection', () => {
    it('runs the picked prompt through the NLQ engine and renders the count and producers alphabetically', () => {
      nlq.state.matchIds = [3, 1];
      const c = mount();

      c.selectLibraryQuery(LIB_CONTRACTS);

      expect(c.queryText()).toBe(LIB_CONTRACTS.queryText);
      expect(c.selectedLibraryQuery()).toBe(LIB_CONTRACTS);
      expect(c.isProcessing()).toBe(false);
      expect(c.hasGenerated()).toBe(true);
      expect(c.queryReturnedNoMatches()).toBe(false);
      const [query, ctx] = nlq.parseAndFilter.mock.calls.at(-1)!;
      expect(query).toBe('All producers with contracts');
      expect(ctx.customers).toHaveLength(3);
      expect(ctx.currentUserUsername).toBe('pat@scoular.com');
      expect(usage.postClickEvent).toHaveBeenCalledWith('interaction', 'build-a-list', 'library-query-selected', '1');

      // The engine returned Charlie before Alpha; the page orders by name.
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Charlie Farms']);
      const page = text();
      expect(page).toContain('Found 2 of 3 producer(s) matching your criteria');
      expect(page.indexOf('Alpha Acres')).toBeLessThan(page.indexOf('Charlie Farms'));
      expect(page).not.toContain('Bravo Grain');
    });

    it('keeps the NLQ engine\'s order for ranking prompts instead of alphabetising', () => {
      nlq.parseAndFilter.mockImplementation((): NlqFilterResult => ({ customers: [CHARLIE, BRAVO, ALPHA], detectedState: null, matchedPatterns: ['top_n'] }));
      const c = mount();

      c.selectLibraryQuery(LIB_TOP);

      expect(names(c.displayedCustomers())).toEqual(['Charlie Farms', 'Bravo Grain', 'Alpha Acres']);
      expect(c.matchedPatternLabels()).toEqual(['Top N ranking']);
    });

    it('shows the detected state in the result summary', () => {
      nlq.state.matchIds = [1, 3];
      nlq.state.detectedState = 'KS';
      const c = mount();

      c.selectLibraryQuery(LIB_ALL);

      expect(c.detectedState()).toBe('KS');
      expect(text()).toContain('Found 2 of 3 producer(s) matching your criteria in Kansas');
    });

    it('a prompt that matches nobody shows the "no producers matched" banner and empty card', () => {
      nlq.state.matchIds = [];
      const c = mount();

      c.selectLibraryQuery(LIB_ALL);

      expect(c.queryReturnedNoMatches()).toBe(true);
      expect(c.displayedCustomers()).toEqual([]);
      const page = text();
      expect(page).toContain('Your query was understood but no producers matched');
      expect(page).toContain('No Producers Found');
    });

    it('"Start with no producers" is an intentional blank start, not a no-match', () => {
      nlq.state.matchIds = [];
      const c = mount();

      c.selectLibraryQuery(LIB_BLANK);

      expect(c.isBlankStartQuery()).toBe(true);
      expect(c.hasGenerated()).toBe(true);
      expect(c.queryReturnedNoMatches()).toBe(false);
      expect(text()).not.toContain('Your query was understood but no producers matched');
    });

    it('a ticket prompt waits for the background ticket read, then resolves', () => {
      const tickets$ = new Subject<Ticket[]>();
      api.getTickets.mockReturnValue(tickets$.asObservable());
      const c = mount();

      c.selectLibraryQuery(LIB_DELIVERED);
      expect(c.waitingForTickets()).toBe(true);
      expect(c.hasGenerated()).toBe(false);
      expect(text()).toContain('Loading ticket data');

      tickets$.next([]);
      tickets$.complete();
      TestBed.tick();

      expect(c.waitingForTickets()).toBe(false);
      expect(c.isProcessing()).toBe(false);
      expect(c.hasGenerated()).toBe(true);
    });

    it('a failed ticket read releases a ticket prompt and surfaces the ticket-outage state', () => {
      api.getTickets.mockReturnValue(throwError(() => new Error('500')));
      const c = mount();

      c.selectLibraryQuery(LIB_DELIVERED);

      expect(c.ticketsLoadFailed()).toBe(true);
      expect(c.ticketsUnavailableForQuery()).toBe(true);
      expect(c.waitingForTickets()).toBe(false);
      expect(c.isProcessing()).toBe(false);
      expect(c.hasGenerated()).toBe(true);
      expect(text()).toContain("Couldn't load ticket data");
    });

    it('a contract prompt after a failed contract read shows the retry panel, and retry reloads everything', () => {
      api.getContracts.mockReturnValueOnce(throwError(() => new Error('timeout')));
      nlq.state.matchIds = [];
      const c = mount();

      c.selectLibraryQuery(LIB_CONTRACTS);
      expect(c.contractsUnavailableForQuery()).toBe(true);
      expect(c.hasGenerated()).toBe(true);
      // The no-match banner is suppressed: an outage must not read as "nobody matched".
      const page = text();
      expect(page).toContain("Couldn't load contract data");
      expect(page).not.toContain('Your query was understood but no producers matched');

      api.getCustomers.mockClear();
      nlq.state.matchIds = [1];
      buttonByText('Retry')!.click();
      TestBed.tick();

      expect(api.getCustomers).toHaveBeenCalledWith(['1000']);
      expect(c.contractsLoadFailed()).toBe(false);
      expect(c.contractsUnavailableForQuery()).toBe(false);
      expect(c.isProcessing()).toBe(false);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);
      expect(text()).not.toContain("Couldn't load contract data");
    });

    it('a DP prompt after a failed DP read says the DP data is missing instead of "no producers matched"', () => {
      api.getDpContracts.mockReturnValue(throwError(() => new Error('500')));
      nlq.state.matchIds = [];
      const c = mount();

      c.queryText.set('Producers with DP contracts');
      c.processQuery();
      TestBed.tick();

      expect(appState.dpContractsLoadFailed()).toBe(true);
      expect(c.unavailableDataForQuery()).toEqual(['DP contracts']);
      const page = text();
      expect(page).toContain("Couldn't load DP contracts, so results below may be incomplete");
      expect(page).not.toContain('Your query was understood but no producers matched');
    });

    it('a contact prompt names the failed last-contact and follow-up loads', () => {
      appState.setNoteLastContactsLoadFailed(true);
      appState.setMyRemindersLoadFailed(true);
      const c = mount();

      c.queryText.set('Producers not contacted in 30 days');
      c.processQuery();
      TestBed.tick();

      expect(text()).toContain("Couldn't load last-contacted dates and follow-ups");
    });

    it('shows no missing-data panel when the prompt does not depend on the failed data', () => {
      appState.setNoteLastContactsLoadFailed(true);
      const c = mount();

      c.selectLibraryQuery(LIB_CONTRACTS);

      expect(c.unavailableDataForQuery()).toEqual([]);
      expect(text()).not.toContain("Couldn't load last-contacted dates");
    });

    it('row badges say "Last contact unavailable", not "Never contacted", when that load failed', () => {
      appState.setNoteLastContactsLoadFailed(true);
      const c = mount();

      c.selectLibraryQuery(LIB_ALL);

      expect(c.getLastContactInfo(1).text).toBe('Last contact unavailable');
      expect(text()).not.toContain('Never contacted');
    });

    it('processQuery with blank text does nothing', () => {
      const c = mount();
      c.queryText.set('   ');

      c.processQuery();

      expect(nlq.parseAndFilter).not.toHaveBeenCalled();
      expect(c.isProcessing()).toBe(false);
      expect(c.hasGenerated()).toBe(false);
    });

    it('clearQuery resets the results and returns the library to the prompt\'s category', () => {
      const c = mount();
      c.selectLibraryQuery(LIB_CONTRACTS);
      c.togglePendingState('KS');
      c.excludeCustomerFromList(1);
      c.toggleRefinePanel();

      c.clearQuery();

      expect(c.queryText()).toBe('');
      expect(c.hasGenerated()).toBe(false);
      expect(c.filteredCustomers()).toEqual([]);
      expect(c.appliedRefinements()).toEqual({});
      expect(c.pendingRefinements()).toEqual({});
      expect(c.manuallyExcludedCustomerIds().size).toBe(0);
      expect(c.showRefinePanel()).toBe(false);
      expect(c.selectedLibraryQuery()).toBeNull();
      expect(c.selectedCategory()).toBe('Contracts');
      expect(text()).not.toContain('Found ');
    });

    it('opening a producer navigates to their profile on the tab the prompt was about', () => {
      const c = mount();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      c.selectLibraryQuery(LIB_CONTRACTS);

      c.selectCustomer(ALPHA);

      expect(usage.trackProfileOpened).toHaveBeenCalledWith('1');
      expect(navigate).toHaveBeenCalledWith(['/'], { queryParams: { customerId: 1, tab: 'contracts' } });
    });
  });

  // ── Refinements ───────────────────────────────────────────────────────────

  describe('refinements', () => {
    it('a state chip narrows the displayed results and the summary switches to "Showing X of Y"', () => {
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);
      expect(c.availableStates()).toEqual(['KS', 'NE']);

      c.togglePendingState('KS');

      expect(c.isStateSelected('KS')).toBe(true);
      expect(c.appliedRefinements().states).toEqual(['KS']);
      expect(c.activeRefinementCount()).toBe(1);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Charlie Farms']);
      expect(text()).toContain('Showing 2 of 3 producer(s)');
      expect(text()).toContain('(1 filter applied)');

      c.togglePendingState('KS');
      expect(c.appliedRefinements().states).toBeUndefined();
      expect(c.activeRefinementCount()).toBe(0);
      expect(c.displayedCustomers()).toHaveLength(3);
    });

    it('prefers the extended state over the merchandising one for chips and filtering', () => {
      api.getCustomers.mockReturnValue(of([...ROSTER, makeCustomer({ id: 4, name: 'Delta Dairy', stateProvince: 'KS', extendedStateProvince: 'CO' })]));
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);

      expect(c.availableStates()).toEqual(['CO', 'KS', 'NE']);
      c.togglePendingState('KS');
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Charlie Farms']);
    });

    it('a refinement that excludes everyone shows "No Producers After Refinement", and clearing restores', () => {
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);

      c.togglePendingState('ZZ');
      expect(c.displayedCustomers()).toEqual([]);
      expect(c.filteredCustomers()).toHaveLength(3);
      expect(text()).toContain('No Producers After Refinement');

      c.clearRefinements();
      expect(c.appliedRefinements()).toEqual({});
      expect(c.displayedCustomers()).toHaveLength(3);
      expect(text()).not.toContain('No Producers After Refinement');
    });

    it('the unpriced-contracts refinement keeps only producers holding an open U/D contract', () => {
      api.getContracts.mockReturnValue(of([
        makeContract({ id: 1, ctrmCustomerId: 'C1', priceTypeCode: 'U' }),
        makeContract({ id: 2, ctrmCustomerId: 'C2', priceTypeCode: 'P' }),
        // Closed contracts never count toward a refinement.
        makeContract({ id: 3, ctrmCustomerId: 'C3', priceTypeCode: 'D', closedDate: new Date(NOW.getTime() - DAY) }),
      ]));
      const c = mount();
      c.selectLibraryQuery(LIB_CONTRACTS);

      c.updateRefinement(r => ({ ...r, hasUnpricedContracts: true }));

      expect(c.pendingRefinements().hasUnpricedContracts).toBe(true);
      expect(c.appliedRefinements().hasUnpricedContracts).toBe(true);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);
    });

    it('not-contacted-in-N-days keeps never-contacted and stale producers, and the badge text follows the clock', () => {
      const lastContacts: NoteLastContact[] = [
        { customerId: 1, customerCode: 'C1', lastNoteAt: new Date(NOW.getTime() - 3 * DAY) },
        { customerId: 3, customerCode: 'C3', lastNoteAt: new Date(NOW.getTime() - 45 * DAY) },
      ];
      appState.setNoteLastContacts(lastContacts);
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);

      expect(c.getLastContactInfo(1)).toEqual({ text: 'Contacted 3 days ago', colorClass: 'text-scoular-green', daysAgo: 3 });
      expect(c.getLastContactInfo(3).colorClass).toBe('text-scoular-red');
      expect(c.getLastContactInfo(2).text).toBe('Never contacted');

      c.notContactedDaysInput.set('30');
      c.applyNotContactedDays();

      expect(c.appliedRefinements().notContactedDays).toBe(30);
      // Batched note prompts sort by last contact, newest first; never-contacted sinks to the bottom.
      expect(names(c.displayedCustomers())).toEqual(['Charlie Farms', 'Bravo Grain']);

      c.notContactedDaysInput.set('abc');
      c.applyNotContactedDays();
      expect(c.appliedRefinements().notContactedDays).toBeNull();
      expect(c.displayedCustomers()).toHaveLength(3);
    });

    it('hides refine checkboxes that just restate the prompt and shows the panel for its category', () => {
      const c = mount();

      c.selectLibraryQuery(LIB_ACTIVE);

      expect(c.effectiveLibraryCategory()).toBe('Contracts');
      expect(c.showContractFilters()).toBe(true);
      expect(c.showTicketFilters()).toBe(false);
      expect(c.showGeneralFilters()).toBe(false);
      expect(c.hiddenFilters().has('noActiveContracts')).toBe(true);
      expect(c.hiddenFilters().has('hasActiveContracts')).toBe(true);
      expect(c.hiddenFilters().has('hasUnpricedContracts')).toBe(false);
    });

    it('hasAnyRefinement ignores empty/zero criteria and counts real ones', () => {
      const c = mount();
      const empty: RefinementFilters = { crops: [], states: [], notContactedDays: 0, noteKeyword: '  ' };
      expect(c.hasAnyRefinement(empty)).toBe(false);
      expect(c.hasAnyRefinement({ states: ['KS'] })).toBe(true);
      expect(c.hasAnyRefinement({ notContactedDays: 30 })).toBe(true);
    });
  });

  // ── Manage members ────────────────────────────────────────────────────────

  describe('manual member overrides', () => {
    it('excluding and restoring a matched producer changes the displayed list and the override count', () => {
      nlq.state.matchIds = [1, 3];
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);

      c.excludeCustomerFromList(3);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);
      expect(names(c.excludedCustomersList())).toEqual(['Charlie Farms']);
      expect(c.memberOverrideCount()).toBe(1);

      c.restoreCustomer(3);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Charlie Farms']);
      expect(c.memberOverrideCount()).toBe(0);
    });

    it('a hand-added producer joins the results; removing them drops the add rather than recording an exclusion', () => {
      nlq.state.matchIds = [1];
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);

      c.addCustomerToList(DELTA);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Delta Dairy']);
      expect(c.memberOverrideCount()).toBe(1);
      expect(usage.postClickEvent).toHaveBeenCalledWith('interaction', 'build-a-list', 'member-added', '4');

      c.excludeCustomerFromList(4);
      expect(c.manuallyIncludedCustomers()).toEqual([]);
      expect(c.manuallyExcludedCustomerIds().size).toBe(0);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);
    });

    it('adding back a previously excluded producer clears the exclusion', () => {
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);
      c.excludeCustomerFromList(2);

      c.addCustomerToList(BRAVO);

      expect(c.manuallyExcludedCustomerIds().has(2)).toBe(false);
      expect(c.displayedCustomers().filter(x => x.id === 2)).toHaveLength(1);
    });
  });

  // ── Library search ────────────────────────────────────────────────────────

  describe('library search and categories', () => {
    it('filters prompts by name, tag and category text, and by the selected category', () => {
      const c = mount();

      c.onLibrarySearchChange('scale');
      expect(c.filteredLibrary()).toEqual([LIB_DELIVERED]);
      c.onLibrarySearchChange('contracts');
      expect(c.filteredLibrary().map(q => q.id)).toEqual([1, 2]);

      c.onLibrarySearchChange('');
      c.selectedCategory.set('Producers');
      expect(c.groupedLibrary()).toEqual([{ category: 'Producers', queries: [LIB_ALL, LIB_TOP, LIB_BLANK] }]);
      // Saved lists are hidden under a real prompt category.
      expect(c.librarySavedLists()).toEqual([]);
    });

    it('logs a search that matches nothing after the debounce, so admins can see the gap', () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(NOW);
      const c = mount();

      c.onLibrarySearchChange('organic barley');
      expect(text()).toContain('No queries match');
      vi.advanceTimersByTime(1999);
      expect(api.logQuerySearch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);

      expect(api.logQuerySearch).toHaveBeenCalledWith('organic barley');
      expect(usage.postClickEvent).toHaveBeenCalledWith('interaction', 'build-a-list', 'library-search-no-match', 'organic barley');
    });

    it('managers get the Team Lists pseudo-category after Saved Lists', () => {
      isAdmin = true;
      const c = mount();
      expect(c.libraryCategories().slice(0, 3)).toEqual(['Saved Lists', 'Team Lists', 'Contracts']);
      expect(api.getTeamSavedLists).toHaveBeenCalledWith('1000');
    });
  });

  // ── Saved lists ───────────────────────────────────────────────────────────

  describe('saved lists', () => {
    it('says the lists failed to load instead of "No saved lists yet"', () => {
      api.getSavedLists.mockReturnValue(throwError(() => new Error('500')));
      const c = mount();
      c.selectedCategory.set('Saved Lists');

      expect(appState.savedListsLoadFailed()).toBe(true);
      expect(text()).toContain("Couldn't load your saved lists");
      expect(text()).not.toContain('No saved lists yet');
    });

    it('still says "No saved lists yet" when the user genuinely has none', () => {
      api.getSavedLists.mockReturnValue(of([]));
      const c = mount();
      c.selectedCategory.set('Saved Lists');

      expect(text()).toContain('No saved lists yet');
      expect(text()).not.toContain("Couldn't load your saved lists");
    });

    it('only offers saved lists that share a trade unit with the selection, and the search narrows them', () => {
      const c = mount();

      expect(c.visibleSavedLists()).toEqual([SAVED_KS]);
      expect(c.librarySavedLists()).toEqual([SAVED_KS]);
      c.onLibrarySearchChange('nothing like it');
      expect(c.librarySavedLists()).toEqual([]);
    });

    it('opening a saved list restores its refinements and exclusions and runs it against the current trade unit', () => {
      const c = mount();

      c.loadSavedList(SAVED_KS);

      expect(c.activeSavedList()).toBe(SAVED_KS);
      expect(c.queryText()).toBe(SAVED_KS.query);
      expect(c.appliedRefinements()).toEqual({ states: ['KS'] });
      expect(c.manuallyExcludedCustomerIds()).toEqual(new Set([3]));
      // Not a library selection — the category is resolved by matching the list's query text.
      expect(c.selectedLibraryQuery()).toBeNull();
      expect(c.effectiveLibraryCategory()).toBe('Contracts');
      expect(c.hasGenerated()).toBe(true);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);
      expect(usage.postClickEvent).toHaveBeenCalledWith('interaction', 'build-a-list', 'saved-list-loaded', '10');
      expect(text()).toContain('for KS contract holders');
    });

    it('a saved list clicked while a query is still processing is refused with a message', () => {
      const tickets$ = new Subject<Ticket[]>();
      api.getTickets.mockReturnValue(tickets$.asObservable());
      const c = mount();
      c.selectLibraryQuery(LIB_DELIVERED);
      c.isProcessing.set(true);

      c.loadSavedList(SAVED_KS);

      expect(toast.info).toHaveBeenCalledWith('Still loading — please wait a moment and try again');
      expect(c.activeSavedList()).toBeNull();
      expect(c.queryText()).toBe(LIB_DELIVERED.queryText);
    });

    it('while the query library is still loading, an active saved list hides every refine section', () => {
      const library$ = new Subject<QueryLibraryItem[]>();
      api.getQueryLibrary.mockReturnValue(library$.asObservable());
      const c = mount();
      c.loadSavedList(SAVED_KS);

      expect(c.isResolvingSavedListCategory()).toBe(true);
      expect(c.showGeneralFilters()).toBe(false);
      expect(c.showContractFilters()).toBe(false);

      library$.next(LIBRARY);
      expect(c.isResolvingSavedListCategory()).toBe(false);
      expect(c.showContractFilters()).toBe(true);
    });

    it('saving a new list posts the query, trade units, refinements with the prompt category, and overrides', () => {
      const c = mount();
      c.selectLibraryQuery(LIB_CONTRACTS);
      c.togglePendingState('KS');
      c.excludeCustomerFromList(3);
      c.openSaveDialog();
      c.newListName.set('My KS list');
      api.getSavedLists.mockClear();

      c.saveList();

      expect(api.createSavedList).toHaveBeenCalledWith({
        name: 'My KS list',
        query: 'All producers with contracts',
        tradeUnits: '1000',
        filters: { states: ['KS'], _promptCategory: 'Contracts' },
        includedCustomerIds: undefined,
        excludedCustomerIds: [3],
      });
      expect(api.updateSavedList).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('List "My KS list" saved');
      expect(api.getSavedLists).toHaveBeenCalled();
      // The canvas is cleared immediately so a quick navigation can't cache stale results.
      expect(c.showSaveDialog()).toBe(false);
      expect(c.queryText()).toBe('');
    });

    it('re-saving an open saved list updates it in place', () => {
      const c = mount();
      c.loadSavedList(SAVED_KS);
      c.openSaveDialog();
      expect(c.newListName()).toBe('KS contract holders');

      c.saveList();

      expect(api.updateSavedList).toHaveBeenCalledWith(10, expect.objectContaining({ name: 'KS contract holders', excludedCustomerIds: [3] }));
      expect(api.createSavedList).not.toHaveBeenCalled();
    });

    it('refuses to save without a name or with no producers, and reports a failed save', () => {
      nlq.state.matchIds = [];
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);
      c.newListName.set('Empty');
      c.saveList();
      expect(api.createSavedList).not.toHaveBeenCalled();

      nlq.state.matchIds = null;
      c.selectLibraryQuery(LIB_ALL);
      c.newListName.set('   ');
      c.saveList();
      expect(api.createSavedList).not.toHaveBeenCalled();

      api.createSavedList.mockReturnValue(throwError(() => new Error('500')));
      c.newListName.set('Will fail');
      c.saveList();
      expect(toast.error).toHaveBeenCalledWith('Failed to save list');
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('deleting the open list removes it at once and drops it as the active list', () => {
      const c = mount();
      c.loadSavedList(SAVED_KS);

      c.deleteList(10);
      expect(c.showDeleteDialog()).toBe(true);
      c.confirmDeleteList();

      expect(api.deleteSavedList).toHaveBeenCalledWith(10);
      expect(c.showDeleteDialog()).toBe(false);
      expect(c.savedLists().map(l => l.id)).toEqual([11]);
      expect(appState.savedLists().map(l => l.id)).toEqual([11]);
      expect(c.activeSavedList()).toBeNull();
      expect(toast.info).toHaveBeenCalledWith('List deleted');
    });

    it('a failed delete re-fetches the saved lists so the list comes back', () => {
      api.deleteSavedList.mockReturnValue(throwError(() => new Error('500')));
      const c = mount();

      c.deleteList(10);
      c.confirmDeleteList();

      expect(toast.error).toHaveBeenCalledWith('Failed to delete list');
      expect(c.savedLists().map(l => l.id)).toEqual([10, 11]);
    });
  });

  // ── Trade units and page lifecycle ────────────────────────────────────────

  describe('trade units and lifecycle', () => {
    it('changing the trade unit clears the active query and reloads the roster for the new selection', () => {
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);
      expect(c.hasGenerated()).toBe(true);
      api.getCustomers.mockReturnValue(of([DELTA]));

      appState.setTradeUnits(['2000']);
      TestBed.tick();

      expect(api.getCustomers).toHaveBeenLastCalledWith(['2000']);
      expect(c.queryText()).toBe('');
      expect(c.hasGenerated()).toBe(false);
      expect(c.filteredCustomers()).toEqual([]);
      expect(names(c.customers())).toEqual(['Delta Dairy']);
      expect(c.coreDataLoaded()).toBe(true);
    });

    it('falls back to all of the user\'s trade units for scoping when only a group is selected', () => {
      appState.setTradeUnits([]);
      const c = mount();
      expect(c.effectiveTradeUnits()).toEqual(['1000', '2000']);
      expect(c.hasTradeUnits()).toBe(true);
      expect(c.hasSelectedTradeUnit()).toBe(false);
    });

    it('leaving and coming back on the same trade unit restores the query, refinements and results', () => {
      nlq.state.matchIds = [1, 3];
      const first = mount();
      first.selectLibraryQuery(LIB_CONTRACTS);
      first.togglePendingState('KS');
      fixture.destroy();

      const saved = appState.buildListState();
      expect(saved?.queryText).toBe(LIB_CONTRACTS.queryText);
      expect([...saved!.filteredCustomerIds].sort()).toEqual([1, 3]);
      expect(saved?.tradeUnits).toEqual(['1000']);

      const second = mount();
      expect(second.queryText()).toBe(LIB_CONTRACTS.queryText);
      expect(second.selectedLibraryQuery()?.id).toBe(1);
      expect(second.appliedRefinements()).toEqual({ states: ['KS'] });
      expect(second.hasGenerated()).toBe(true);
      expect(names(second.displayedCustomers())).toEqual(['Alpha Acres', 'Charlie Farms']);
    });

    it('coming back after the trade unit changed elsewhere starts blank instead of restoring the old query', () => {
      const first = mount();
      first.selectLibraryQuery(LIB_ALL);
      fixture.destroy();
      expect(appState.buildListState()?.tradeUnits).toEqual(['1000']);

      appState.setTradeUnits(['2000']);
      const second = mount();

      expect(second.queryText()).toBe('');
      expect(second.hasGenerated()).toBe(false);
      expect(second.selectedLibraryQuery()).toBeNull();
      expect(appState.buildListState()).toBeNull();
    });

    it('all-producers mode shows the pick-a-trade-unit gate instead of the library', () => {
      appState.setAllProducersMode(true);
      const c = mount();
      expect(c.allProducersMode()).toBe(true);
      expect(text()).toContain('Build a List works by trade unit');
      expect(buttonByText('All producers with contracts')).toBeUndefined();
    });
  });

  // ── Characterisation added before the 2026-10-14 decomposition ────────────
  // Pins behaviour of logic that moved into features/build-list/utils, through the real template.

  describe('characterisation', () => {
    it('marks a saved list carrying refinements as "Refined" in the library, and not a plain one', () => {
      const PLAIN: SavedList = { id: 12, name: 'Plain list', query: 'All producers', tradeUnits: '1000', createdAt: '2026-10-01T00:00:00' };
      api.getSavedLists.mockReturnValue(of([SAVED_KS, PLAIN]));
      mount();

      const page = text();
      expect(page).toContain('KS contract holders');
      expect(page).toContain('Plain list');
      expect(page.match(/Refined/g)).toHaveLength(1);
    });

    it('the summary counts every applied refinement', () => {
      api.getContracts.mockReturnValue(of([makeContract({ ctrmCustomerId: 'C1', priceTypeCode: 'U' })]));
      const c = mount();
      c.selectLibraryQuery(LIB_CONTRACTS);

      c.togglePendingState('KS');
      c.updateRefinement(r => ({ ...r, hasUnpricedContracts: true, contractQuantityOver: 0 }));

      expect(c.activeRefinementCount()).toBe(2);
      expect(text()).toContain('(2 filters applied)');
    });

    it('hides the refine checkboxes a re-opened saved list\'s prompt already restates', () => {
      const c = mount();
      c.loadSavedList({ ...SAVED_KS, query: 'Producers with active contracts' });

      expect(c.hiddenFilters().has('noActiveContracts')).toBe(true);
      expect(c.hiddenFilters().has('hasUnpricedContracts')).toBe(false);
    });

    // ── Refinement filtering (displayedCustomers) ──

    it('storage refinements total each producer\'s receipts, and a crop chip scopes them to the Storage dimension', () => {
      api.getStoredGrain.mockReturnValue(of([
        { customerId: 1, crop: 'YC', quantity: 6000, receivableAmount: 10 },
        { customerId: 1, crop: 'SB', quantity: 100, receivableAmount: 10 },
        { customerId: 3, crop: 'SB', quantity: 9000, receivableAmount: 900 },
      ] as never));
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);

      c.updateRefinement(r => ({ ...r, storageQuantityOver: 5000 }));
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Charlie Farms']);

      c.updateRefinement(r => ({ ...r, storageReceivableOver: 100 }));
      expect(names(c.displayedCustomers())).toEqual(['Charlie Farms']);

      c.updateRefinement(r => ({ ...r, storageReceivableOver: null }));
      nlq.refineDimension.mockReturnValue('Storage' as never);
      c.togglePendingCrop('YC');
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);
      expect(text()).toContain('Showing 1 of 3 producer(s)');
    });

    it('ticket refinements: deliveries this year (UTC year), recent tickets and delivery locations', () => {
      api.getTickets.mockReturnValue(of([
        { id: 1, customerCode: 'C1', date: '2026-10-10', elevatorCity: 'Madrid, NE', productCode: 'YC' },
        { id: 2, customerCode: 'C2', date: '2026-01-01', elevatorCity: 'Pratt, KS', productCode: 'SB' },
        { id: 3, customerCode: 'C3', date: '2025-12-31', elevatorCity: 'Madrid, NE', productCode: 'YC' },
      ] as never));
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);
      expect(c.availableDeliveryLocations()).toEqual(['Madrid, NE', 'Pratt, KS']);

      c.updateRefinement(r => ({ ...r, hasDeliveriesThisYear: true }));
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Bravo Grain']);

      c.updateRefinement(r => ({ ...r, hasDeliveriesThisYear: false, ticketsInLastDays: 30 }));
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);

      c.updateRefinement(r => ({ ...r, ticketsInLastDays: null }));
      c.togglePendingDeliveryLocation('Madrid, NE');
      expect(c.isDeliveryLocationSelected('Madrid, NE')).toBe(true);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Charlie Farms']);
    });

    it('contract refinements read open contracts only: none active, overdue, expiring, multi-commodity and bushel totals', () => {
      api.getContracts.mockReturnValue(of([
        makeContract({ id: 1, ctrmCustomerId: 'C1', commodityCode: 'YC', quantity: 4000, openBalanceQuantity: 4000,
          deliveryEnd: new Date(NOW.getTime() - 5 * DAY) }),
        makeContract({ id: 2, ctrmCustomerId: 'C1', commodityCode: 'SB', commodityDescription: 'Soybeans', commodityGroup: 'Soybeans', quantity: 3000 }),
        makeContract({ id: 3, ctrmCustomerId: 'C2', status: 'Fulfilled', quantity: 50000, deliveryEnd: new Date('2026-10-20T12:00:00') }),
        makeContract({ id: 4, ctrmCustomerId: 'C3', quantity: 90000, closedDate: new Date(NOW.getTime() - DAY) }),
      ]));
      const c = mount();
      c.selectLibraryQuery(LIB_CONTRACTS);

      c.updateRefinement(r => ({ ...r, noActiveContracts: true }));
      expect(names(c.displayedCustomers())).toEqual(['Bravo Grain', 'Charlie Farms']);

      c.updateRefinement(r => ({ ...r, noActiveContracts: false, noContractsAtAll: true }));
      expect(names(c.displayedCustomers())).toEqual(['Charlie Farms']);

      c.updateRefinement(r => ({ ...r, noContractsAtAll: false, hasOverdueContracts: true }));
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);

      c.updateRefinement(r => ({ ...r, hasOverdueContracts: false, contractsExpiringThisMonth: true }));
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Bravo Grain']);

      c.updateRefinement(r => ({ ...r, contractsExpiringThisMonth: false, multipleCommoditiesContracted: true }));
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);

      c.updateRefinement(r => ({ ...r, multipleCommoditiesContracted: false, contractQuantityOver: 6000 }));
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Bravo Grain']);

      c.updateRefinement(r => ({ ...r, contractQuantityOver: null, hasActiveContracts: true }));
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);
    });

    it('producer-level refinements: acres, contact details, linked producers, eSign and grain on farm', () => {
      api.getCustomers.mockReturnValue(of([
        makeCustomer({ id: 1, name: 'Alpha Acres', totalAcres: 900, email: 'a@x.com', linkedProducerIds: ['C2'],
          grainOnFarm: [{ commodityCode: 'YC', bushelsOnHand: 8000, targetBushels: 4.5, grade: '15.5%' }] }),
        makeCustomer({ id: 2, name: 'Bravo Grain', totalAcres: 200, contacts: [{ name: 'Son', phone: '(555) 555-5555' }] as never,
          eSignEnabled: true, grainOnFarm: [{ commodityCode: 'SB', bushelsOnHand: 500 }] }),
        makeCustomer({ id: 3, name: 'Charlie Farms', totalAcres: 600, primaryContact: 'Chuck' }),
      ]));
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);

      const only = (patch: RefinementFilters) => { c.clearRefinements(); c.updateRefinement(r => ({ ...r, ...patch })); return names(c.displayedCustomers()); };
      expect(only({ acresOver: 500 })).toEqual(['Alpha Acres', 'Charlie Farms']);
      expect(only({ hasEmail: true })).toEqual(['Alpha Acres']);
      expect(only({ hasPhone: true })).toEqual(['Bravo Grain']);
      expect(only({ hasPrimaryContact: true })).toEqual(['Charlie Farms']);
      expect(only({ noPrimaryContact: true })).toEqual(['Alpha Acres', 'Bravo Grain']);
      expect(only({ hasLinkedProducers: true })).toEqual(['Alpha Acres']);
      expect(only({ notEsignEnrolled: true })).toEqual(['Alpha Acres', 'Charlie Farms']);
      expect(only({ grainOnFarmBushelsOver: 1000 })).toEqual(['Alpha Acres']);
      expect(only({ noGrainTarget: true })).toEqual(['Bravo Grain']);
      expect(only({ grainTargetOver: 4 })).toEqual(['Alpha Acres']);
      expect(only({ gradeOver: 15 })).toEqual(['Alpha Acres']);
    });

    it('planting and DP refinements', () => {
      api.getPlantingIntentions.mockReturnValue(of([
        { id: 1, customerId: 1, crop: 'YC', acres: 400, plantingYear: 2026, type: 'Irrigated' },
        { id: 2, customerId: 3, crop: 'SB', acres: 900, plantingYear: 2027, type: 'Dryland' },
      ] as never));
      appState.setDpContracts([
        { id: 'a', ticketKey: 't1', customerId: 2, crop: 'YC', quantity: 7000, bushels: 7000, storageDays: 120, receivableAmount: 300 },
        { id: 'b', ticketKey: 't2', customerId: 3, crop: 'SB', quantity: 100, bushels: 100, storageDays: 10, receivableAmount: 5 },
      ] as never);
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);

      const only = (patch: RefinementFilters) => { c.clearRefinements(); c.updateRefinement(r => ({ ...r, ...patch })); return names(c.displayedCustomers()); };
      expect(only({ hasPlantingIntentions: true })).toEqual(['Alpha Acres', 'Charlie Farms']);
      expect(only({ plantingYear: 2027 })).toEqual(['Charlie Farms']);
      expect(only({ irrigatedOnly: true })).toEqual(['Alpha Acres']);
      expect(only({ plantingAcresOver: 500 })).toEqual(['Charlie Farms']);
      expect(only({ hasDpContracts: true })).toEqual(['Bravo Grain', 'Charlie Farms']);
      expect(only({ dpBushelsOver: 1000 })).toEqual(['Bravo Grain']);
      expect(only({ dpDaysOver: 90 })).toEqual(['Bravo Grain']);
      expect(only({ dpChargesOver: 10 })).toEqual(['Bravo Grain']);
    });

    it('note refinements aggregate a linked producer\'s notes and collapse the pair into one row', () => {
      api.getCustomers.mockReturnValue(of([
        makeCustomer({ id: 1, name: 'Alpha Acres', linkedProducerIds: ['C2'] }),
        makeCustomer({ id: 2, name: 'Bravo Grain' }),
        makeCustomer({ id: 3, name: 'Charlie Farms' }),
      ]));
      api.getNotes.mockReturnValue(of([
        { id: 1, customerId: 2, customerCode: 'C2', customerName: 'Bravo Grain', content: 'Drought hit the beans', isPinned: false,
          createdBy: 'Pat Merchant', createdAt: '2026-10-12T10:00:00' },
        { id: 2, customerId: 3, customerCode: 'C3', customerName: 'Charlie Farms', content: 'All good here', isPinned: true,
          createdBy: 'Someone Else', createdAt: '2026-10-11T10:00:00' },
      ] as never));
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);

      c.updateRefinement(r => ({ ...r, noteKeyword: 'drought' }));
      TestBed.tick();
      expect(c.noteFilterActive()).toBe(true);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);
      const page = text();
      expect(page).toContain('Drought hit the beans');
      expect(page).toContain('Bravo Grain (C2)');
      expect(page).not.toContain('All good here');

      c.clearRefinements();
      c.updateRefinement(r => ({ ...r, hasPinnedNotes: true }));
      TestBed.tick();
      expect(names(c.displayedCustomers())).toEqual(['Charlie Farms']);

      c.clearRefinements();
      c.updateRefinement(r => ({ ...r, contactedBySomeoneElse: true }));
      TestBed.tick();
      expect(names(c.displayedCustomers())).toEqual(['Charlie Farms']);

      c.clearRefinements();
      c.updateRefinement(r => ({ ...r, contactedByMeOnly: true }));
      TestBed.tick();
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);
    });

    // ── Note prompts: scope of the note fetch, inline notes, order ──

    it('a "contacted in the last N days" prompt fetches a windowed slice, shows only notes inside it, newest producer first', () => {
      api.getNotes.mockReturnValue(of([
        { id: 1, customerId: 1, customerCode: 'C1', customerName: 'Alpha Acres', content: 'Called about basis', isPinned: false,
          createdBy: 'Someone', createdAt: '2026-10-08T10:00:00' },
        { id: 2, customerId: 3, customerCode: 'C3', customerName: 'Charlie Farms', content: 'Pinned earlier chat', isPinned: true,
          createdBy: 'Someone', createdAt: '2026-10-12T09:00:00' },
        { id: 3, customerId: 3, customerCode: 'C3', customerName: 'Charlie Farms', content: 'Old visit', isPinned: false,
          createdBy: 'Someone', createdAt: '2026-09-20T10:00:00' },
      ] as never));
      nlq.state.matchIds = [1, 3];
      const c = mount();

      c.queryText.set('Producers contacted in the last 7 days');
      c.processQuery();
      TestBed.tick();

      expect(api.getNotes).toHaveBeenCalledWith(['1000'], { sinceDays: 8 });
      expect(c.noteFilterActive()).toBe(true);
      expect(names(c.displayedCustomers())).toEqual(['Charlie Farms', 'Alpha Acres']);
      expect(c.matchingNotesByCustomer().get(3)!.map(n => n.id)).toEqual([2]);
      const page = text();
      expect(page).toContain('Called about basis');
      expect(page).toContain('Pinned earlier chat');
      expect(page).not.toContain('Old visit');
    });

    it('a "producers I have contacted" prompt fetches the current user\'s notes across trade units', () => {
      nlq.buildAuthorCandidates.mockReturnValue(['pat@scoular.com', 'pat merchant']);
      const c = mount();

      c.queryText.set('Producers I have contacted');
      c.processQuery();
      TestBed.tick();

      expect(api.getNotes).toHaveBeenCalledWith(undefined, { authorAny: ['pat merchant', 'pat@scoular.com'] });
    });

    it('a "producers with notes" prompt loads note bodies per rendered batch, sorted by last contact', () => {
      appState.setNoteLastContacts([
        { customerId: 1, customerCode: 'C1', lastNoteAt: new Date(NOW.getTime() - 9 * DAY) },
        { customerId: 2, customerCode: 'C2', lastNoteAt: new Date(NOW.getTime() - 2 * DAY) },
      ]);
      const c = mount();

      c.queryText.set('Producers with notes');
      c.processQuery();
      TestBed.tick();

      expect(api.getNotes).toHaveBeenCalledWith(undefined, { customerIds: [2, 1, 3] });
      expect(names(c.displayedCustomers())).toEqual(['Bravo Grain', 'Alpha Acres', 'Charlie Farms']);
      expect(c.getLastContactInfo(1)).toEqual({ text: 'Contacted 9 days ago', colorClass: 'text-yellow-500', daysAgo: 9 });
    });

    it('note-count prompts load the full note set', () => {
      const c = mount();

      c.queryText.set('Producers with notes, most notes first');
      c.processQuery();
      TestBed.tick();

      expect(api.getNotes).toHaveBeenCalledWith();
      expect(appState.notesLoaded()).toBe(true);
    });

    // ── Harvest-window pacing ──

    it('pacing prompts and the down-pace refinement compare this year\'s harvest-window bushels with last year\'s', () => {
      appState.setHarvestWindows([
        { id: 1, commodity: 'Corn', deliveryStartMonth: 9, deliveryStartDay: 1, deliveryEndMonth: 11, deliveryEndDay: 30, isActive: true },
        { id: 2, commodity: 'Wheat', deliveryStartMonth: 6, deliveryStartDay: 1, deliveryEndMonth: 7, deliveryEndDay: 31, isActive: false },
      ]);
      const oct = (y: number) => new Date(y, 9, 15);
      api.getContracts.mockReturnValue(of([
        makeContract({ id: 1, ctrmCustomerId: 'C1', quantity: 5000, deliveryStart: oct(2026), deliveryEnd: oct(2026) }),
        // Closed prior-year contracts still count for pacing.
        makeContract({ id: 2, ctrmCustomerId: 'C1', quantity: 9000, deliveryStart: oct(2025), deliveryEnd: oct(2025), closedDate: oct(2025) }),
        makeContract({ id: 3, ctrmCustomerId: 'C2', quantity: 9000, commodityGroup: '', commodityDescription: 'YELLOW CORN', deliveryStart: oct(2026), deliveryEnd: oct(2026) }),
        makeContract({ id: 4, ctrmCustomerId: 'C2', quantity: 1000, deliveryStart: oct(2025), deliveryEnd: oct(2025) }),
        // Only the inactive wheat window covers July — no pacing data for Charlie.
        makeContract({ id: 5, ctrmCustomerId: 'C3', quantity: 1000, deliveryStart: new Date(2026, 6, 1), deliveryEnd: new Date(2026, 6, 2) }),
      ]));
      const c = mount();

      c.queryText.set('Producers behind on pacing');
      c.processQuery();
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);

      c.queryText.set('Producers ahead on pacing');
      c.processQuery();
      expect(names(c.displayedCustomers())).toEqual(['Bravo Grain']);

      c.selectLibraryQuery(LIB_ALL);
      c.updateRefinement(r => ({ ...r, downHarvestPace: true }));
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres']);
    });

    // ── Planting coverage prompts ──

    describe('planting coverage', () => {
      function setUp(estimates: unknown[]) {
        appState.setCommodities([
          { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true },
          { id: 2, code: 'SB', name: 'Soybeans', category: 'Soybeans', isActive: true },
        ]);
        api.getPlantingIntentions.mockReturnValue(of([
          { id: 1, customerId: 1, crop: 'YC', acres: 100, plantingYear: 2026 },
          { id: 2, customerId: 2, crop: 'SB', acres: 50, plantingYear: 2026 },
        ] as never));
        const extra = {
          getContractsByCropYear: vi.fn(() => of([
            makeContract({ ctrmCustomerId: 'C1', commodityCode: 'YC', quantity: 10000, cropYear: 2026 }),
            // Different crop year — never covers 2026.
            makeContract({ ctrmCustomerId: 'C2', commodityCode: 'SB', commodityGroup: 'Soybeans', quantity: 99999, cropYear: 2025 }),
          ])),
          getDashboardPlantingEstimates: vi.fn(() => of(estimates)),
        };
        Object.assign(api, extra);
        return extra;
      }
      const run = (c: BuildListComponent, q: string) => { c.queryText.set(q); c.processQuery(); };

      it('"planting with no contracts" keeps producers with an uncovered crop year', () => {
        const extra = setUp([]);
        const c = mount();
        run(c, 'Producers with planting intentions and no contracts');

        expect(extra.getContractsByCropYear).toHaveBeenCalledWith(2026, ['1000']);
        expect(c.isProcessing()).toBe(false);
        expect(names(c.filteredCustomers())).toEqual(['Bravo Grain']);
        expect(c.queryReturnedNoMatches()).toBe(false);
      });

      it('"under N percent contracted" compares contracted bushels with acres x the season yield target', () => {
        const extra = setUp([
          { id: 1, tradeUnitKey: '1000', crop: 'Corn', plantingYear: 2026, yieldEstimate: 200 },
          { id: 2, tradeUnitKey: '1000', crop: 'Soybeans', plantingYear: 2026, yieldEstimate: 50 },
        ]);
        const c = mount();

        run(c, 'Producers under 50 percent contracted');
        expect(extra.getDashboardPlantingEstimates).toHaveBeenCalledWith('1000', 2026);
        expect(names(c.filteredCustomers())).toEqual(['Bravo Grain']);

        run(c, 'Producers under 60 percent contracted');
        expect(names(c.filteredCustomers())).toEqual(['Alpha Acres', 'Bravo Grain']);

        run(c, 'Highest uncontracted bushels');
        expect(names(c.filteredCustomers())).toEqual(['Alpha Acres', 'Bravo Grain']);
      });

      it('with no season yield targets saved, says so instead of "no producers matched"', () => {
        setUp([]);
        const c = mount();
        run(c, 'Producers under 50 percent contracted');

        expect(c.filteredCustomers()).toEqual([]);
        expect(c.coverageNeedsYieldTargets()).toBe(true);
        expect(c.queryReturnedNoMatches()).toBe(false);
        expect(text()).toContain('This prompt needs a saved season yield target');
      });

      it('planting prompts show per-crop acre chips and put the most acres first', () => {
        setUp([]);
        api.getPlantingIntentions.mockReturnValue(of([
          { id: 1, customerId: 1, crop: 'YC', acres: 100, plantingYear: 2026 },
          { id: 2, customerId: 2, crop: 'SB', acres: 50, plantingYear: 2026, type: 'Irrigated' },
          { id: 3, customerId: 2, crop: 'SB', acres: 400, plantingYear: 2026, type: 'Irrigated' },
        ] as never));
        const c = mount();
        c.selectLibraryQuery({ id: 9, category: 'Planting', name: 'Planting', queryText: 'Producers with planting intentions', sortOrder: 1 });

        expect(names(c.displayedCustomers())).toEqual(['Bravo Grain', 'Alpha Acres', 'Charlie Farms']);
        expect(c.resultChips(BRAVO).map(x => x.text)).toEqual(['Irrigated SB · 450 ac · 2026']);
        expect(text()).toContain('YC · 100 ac · 2026');
      });

      it('with no planting intentions, ends with an empty result and no spinner', () => {
        setUp([]);
        api.getPlantingIntentions.mockReturnValue(of([]));
        const c = mount();
        run(c, 'Highest uncontracted bushels');

        expect(c.isProcessing()).toBe(false);
        expect(c.filteredCustomers()).toEqual([]);
        expect(c.queryReturnedNoMatches()).toBe(true);
      });
    });

    // ── Result rows: identity, crops, inline chips, linked producers, bin sites ──

    it('result rows show initials, the best location, and up to five de-duplicated crops from every source', () => {
      api.getCustomers.mockReturnValue(of([
        makeCustomer({ id: 1, name: 'Alpha Acres', location: 'Pratt', stateProvince: 'KS', extendedCity: 'Dodge City', extendedStateProvince: 'KS',
          commodities: ['Corn', 'corn ', 'Soybeans'] }),
        makeCustomer({ id: 2, name: 'Bravo', location: 'Madrid', stateProvince: 'NE' }),
        makeCustomer({ id: 3, name: 'C', location: '', stateProvince: 'KS' }),
      ]));
      api.getContracts.mockReturnValue(of([
        makeContract({ id: 1, ctrmCustomerId: 'C1', commodityCode: 'YC' }),
        makeContract({ id: 2, ctrmCustomerId: 'C1', commodityCode: 'SB', closedDate: new Date(NOW.getTime() - DAY) }),
        makeContract({ id: 3, ctrmCustomerId: 'C2', commodityCode: 'HRW' }),
      ]));
      api.getPlantingIntentions.mockReturnValue(of([{ id: 1, customerId: 1, crop: 'WHT', acres: 1, plantingYear: 2026 }] as never));
      api.getTickets.mockReturnValue(of([{ id: 1, customerId: 1, customerCode: 'C1', productCode: 'MILO', date: '2026-10-01' }] as never));
      api.getStoredGrain.mockReturnValue(of([{ customerId: 2, crop: 'OATS', quantity: 5 }] as never));
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);

      expect(c.getCustomerCrops(1)).toEqual(['Corn', 'Soybeans', 'YC', 'SB', 'WHT']);
      expect(c.getCustomerCrops(2)).toEqual(['HRW', 'OATS']);
      expect(c.getCustomerCrops(99)).toEqual([]);
      const page = text();
      expect(page).toContain('Dodge City, KS');
      expect(page).toContain('Madrid, NE');
      expect(c.getInitials('Alpha Acres')).toBe('AA');
      expect(c.getInitials('Bravo')).toBe('BR');
      expect(c.getInitials('C')).toBe('??');
      expect(c.getFormattedLocation(c.customers()[2])).toBe('KS');
    });

    it('storage prompts show per-crop bushel chips and put the most storage first', () => {
      appState.setCommodities([{ id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true }]);
      api.getStoredGrain.mockReturnValue(of([
        { customerId: 1, crop: 'YC', quantity: 3000 },
        { customerId: 1, crop: 'YC', quantity: 3000 },
        { customerId: 1, crop: 'SB', quantity: 100 },
        { customerId: 3, crop: 'SB', quantity: 9000 },
        { customerId: 3, crop: 'XX', quantity: 0 },
      ] as never));
      const c = mount();
      c.selectLibraryQuery({ id: 8, category: 'Storage', name: 'Storage', queryText: 'Producers with grain in storage', sortOrder: 1 });

      expect(names(c.displayedCustomers())).toEqual(['Charlie Farms', 'Alpha Acres', 'Bravo Grain']);
      expect(c.resultChips(ALPHA)).toEqual([{ text: 'YC 6,000', colorKey: 'Corn' }, { text: 'SB 100', colorKey: 'SB' }]);
      expect(c.storageBu(CHARLIE)).toBe(9000);
      expect(text()).toContain('SB 9,000');
    });

    it('DP prompts count each delivery once in the chips and the order', () => {
      api.getDpContracts.mockReturnValue(of([
        { id: 'a1', ticketKey: 'a', customerId: 2, crop: 'YC', bushels: 7000, receivableAmount: 10 },
        { id: 'a2', ticketKey: 'a', customerId: 2, crop: 'YC', bushels: 7000, receivableAmount: 10 },
        { id: 'b1', ticketKey: 'b', customerId: 1, crop: 'SB', bushels: 500, receivableAmount: 10 },
      ] as never));
      const c = mount();
      c.selectLibraryQuery({ id: 10, category: 'DP Contracts', name: 'DP', queryText: 'Producers on DP', sortOrder: 1 });
      TestBed.tick();

      expect(names(c.displayedCustomers())).toEqual(['Bravo Grain', 'Alpha Acres', 'Charlie Farms']);
      expect(c.resultChips(BRAVO).map(x => x.text)).toEqual(['YC 7,000']);
      expect(c.dpBu(BRAVO)).toBe(7000);
    });

    // ── Prompt library ──

    it('library search also matches descriptions and prompt text', () => {
      const c = mount();
      c.onLibrarySearchChange('PURCHASE contract');
      expect(c.filteredLibrary().map(q => q.id)).toEqual([1]);
      c.onLibrarySearchChange('top 10 producers');
      expect(c.filteredLibrary().map(q => q.id)).toEqual([5]);
      c.onLibrarySearchChange('');
      c.selectedCategory.set('Tickets');
      expect(c.groupedLibrary()).toEqual([{ category: 'Tickets', queries: [LIB_DELIVERED] }]);
    });

    it('managers\' team lists match the search on name, prompt or owner and hide under a prompt category', () => {
      isAdmin = true;
      const TEAM: SavedList[] = [
        { id: 20, name: 'Corn growers', query: 'All producers', createdBy: 'Lee Smith', createdAt: '2026-10-01T00:00:00' },
        { id: 21, name: 'Beans', query: 'Producers with active contracts', createdBy: 'Pat Jones', createdAt: '2026-10-01T00:00:00' },
      ];
      api.getTeamSavedLists.mockReturnValue(of(TEAM) as never);
      const c = mount();

      expect(c.libraryTeamLists()).toEqual(TEAM);
      c.onLibrarySearchChange('smith');
      expect(c.libraryTeamLists().map(l => l.id)).toEqual([20]);
      c.onLibrarySearchChange('active');
      expect(c.libraryTeamLists().map(l => l.id)).toEqual([21]);
      c.onLibrarySearchChange('');
      c.selectedCategory.set('Team Lists');
      expect(c.libraryTeamLists()).toHaveLength(2);
      expect(c.librarySavedLists()).toEqual([]);
      c.selectedCategory.set('Contracts');
      expect(c.libraryTeamLists()).toEqual([]);
    });

    it('matched-pattern labels are de-duplicated and unknown patterns dropped', () => {
      nlq.parseAndFilter.mockImplementation((_q: string, ctx: NlqFilterContext): NlqFilterResult => ({
        customers: ctx.customers, detectedState: null,
        matchedPatterns: ['unsigned_contract', 'mystery_pattern', 'contract_unconfirmed', 'state_filter'],
      }));
      const c = mount();
      c.selectLibraryQuery(LIB_ALL);
      expect(c.matchedPatternLabels()).toEqual(['Unconfirmed contracts', 'State']);
    });

    // ── Opening a producer: which profile tab ──

    it('opens the producer on the tab the prompt or refinement is about', () => {
      const c = mount();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const tabFor = (q: string, r: RefinementFilters = {}) => {
        c.clearQuery();
        c.queryText.set(q);
        c.appliedRefinements.set(r);
        c.selectCustomer(ALPHA);
        return (navigate.mock.calls.at(-1)![1] as { queryParams: Record<string, unknown> }).queryParams['tab'];
      };

      expect(tabFor('Producers on DP with storage over 90 days')).toBe('dpContracts');
      expect(tabFor('All producers', { dpChargesOver: 10 })).toBe('dpContracts');
      expect(tabFor('Producers with grain in storage')).toBe('storage');
      expect(tabFor('All producers', { storageDaysOver: 30 })).toBe('storage');
      expect(tabFor('Producers with applied tickets')).toBe('contracts');
      expect(tabFor('Producers with unapplied tickets')).toBe('tickets');
      expect(tabFor('All producers', { avgMoistureOver: 15 })).toBe('tickets');
      expect(tabFor('Producers with planting intentions')).toBe('planting');
      expect(tabFor('All producers', { irrigatedOnly: true })).toBe('planting');
      expect(tabFor('Producers with overdue bushels')).toBe('contracts');
      expect(tabFor('All producers', { hasActiveContracts: true })).toBe('contracts');
      expect(tabFor('All producers')).toBeUndefined();
      // Notes are always visible on the profile, so a note prompt opens no particular tab.
      expect(tabFor('Producers contacted this week about their contracts')).toBeUndefined();
    });

    it('the linked-records prompt folds linked producers into one row with a linked panel', () => {
      api.getCustomers.mockReturnValue(of([
        makeCustomer({ id: 1, name: 'Alpha Acres', linkedProducerIds: ['C2'] }),
        makeCustomer({ id: 2, name: 'Bravo Grain' }),
        makeCustomer({ id: 3, name: 'Charlie Farms' }),
      ]));
      const c = mount();
      c.queryText.set('Producers with linked records');
      c.processQuery();

      expect(c.linkedFeatureActive()).toBe(true);
      expect(names(c.displayedCustomers())).toEqual(['Alpha Acres', 'Charlie Farms']);
      expect(c.linkedProducerInfoByCustomer().get(1)).toEqual({ count: 1, producers: [expect.objectContaining({ id: 2 })] });
      expect(c.linkedProducerInfoByCustomer().get(2)!.producers.map(p => p.id)).toEqual([1]);
      expect(c.logicallyInResultsIds()).toEqual(new Set([1, 2, 3]));

      c.excludeCustomerFromList(2);
      expect(c.linkedProducerInfoByCustomer().has(1)).toBe(false);
    });

    it('grain-on-farm prompts list bin sites with a grain summary and a "show more" link', () => {
      const sites = ['North', 'South', 'East', 'West', 'Home'].map((name, i) => ({ siteKey: `k${i}`, name }));
      api.getCustomers.mockReturnValue(of([
        makeCustomer({ id: 1, name: 'Alpha Acres', binSites: sites, grainOnFarm: [
          { binSiteKey: 'k0', commodityCode: 'YC', bushelsOnHand: 20000 },
          { binSiteKey: 'k0', commodityCode: 'SB', bushelsOnHand: 15000 },
          { binSiteKey: 'k1', commodityCode: 'YC', bushelsOnHand: 500 },
        ] }),
        makeCustomer({ id: 2, name: 'Bravo Grain', binSites: [{ siteKey: 'b', name: 'Only' }] }),
        makeCustomer({ id: 3, name: 'Charlie Farms' }),
      ]));
      const c = mount();
      c.selectLibraryQuery({ id: 11, category: 'Grain on Farm & Bin Sites', name: 'GoF', queryText: 'Producers with grain on farm', sortOrder: 1 });

      expect(c.resultChips(c.customers()[0])).toEqual([{ text: '5 bin sites', colorKey: '', neutral: true }]);
      expect(c.resultChips(c.customers()[1])[0].text).toBe('1 bin site');
      expect(c.resultChips(c.customers()[2])[0].text).toBe('No bin sites');
      expect(c.grainOnFarmBreakdown(c.customers()[0])).toEqual([
        { commodityCode: 'YC', bushelsOnHand: 20500 }, { commodityCode: 'SB', bushelsOnHand: 15000 },
      ]);
      const page = text();
      expect(page).toContain('North');
      expect(page).toContain('2 crops · 35,000 bu');
      expect(page).toContain('1 crop · 500 bu');
      expect(page).toContain('No grain on farm');
      expect(page).toContain('Show 1 more bin site');
      expect(page).not.toContain('Home');
    });
  });
});
