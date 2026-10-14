import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { BehaviorSubject, NEVER, Observable, Subject, of, throwError } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { NlqFilterContext, NlqFilterResult, NlqFilterService } from '@core/services/nlq-filter.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { UserRolesService } from '@core/services/user-roles.service';
import { OutlookCalendarService } from '@core/services/outlook-calendar.service';
import { environment } from '@env/environment';
import {
  Commodity, CommodityConversion, Contract, ContractPricingLine, Customer, DashboardPlantingEstimate, DpContract,
  Note, NoteLastContact, PlantingIntention, ProducerDetails, QueryLibraryItem, Reminder, ReminderDue, SavedList,
  StoredGrain, Ticket,
} from '@models';

import { HomeComponent } from './home.component';

/**
 * Safety net for the producer page ahead of the OnPush conversion and decomposition. HomeComponent
 * owns a lot of asynchronous state - per-producer loads, request-id guards against stale responses,
 * linked-producer discovery across trade units, saved-list enrichment, CTRM read-ahead (hover
 * prefetch + 4s convergence re-read) and a throttled background-failure toast - and none of it was
 * covered. These tests drive it only through public methods, signals and computed values, so they
 * survive the internals being split up.
 *
 * The template is blanked: it composes the customer list / profile / notes / reminders children,
 * each with its own service graph, and every behaviour pinned here lives in the class. Rendering the
 * real tree would make these tests about the children instead.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-13T15:00:00Z');

function customer(id: number, over: Partial<Customer> = {}): Customer {
  return {
    id,
    scoularId: `S-${id}`,
    name: `Producer ${id}`,
    farm: '',
    location: 'Omaha, NE',
    phone: '',
    email: '',
    totalAcres: 0,
    linkedProducerIds: [],
    eSignEnabled: false,
    achEnabled: false,
    ...over,
  };
}

function contract(id: number, ctrmCustomerId: string, over: Partial<Contract> = {}): Contract {
  return {
    id,
    customerId: 0,
    ctrmCustomerId,
    sourceContractId: `P${id}`,
    farmId: '',
    contractNumber: `P${id}`,
    quantity: 5000,
    unit: 'bushels',
    price: 4.25,
    deliveryStart: new Date('2026-10-01'),
    deliveryEnd: new Date('2026-12-31'),
    status: 'Active',
    signed: true,
    ...over,
  };
}

function ticket(id: number, customerCode: string, over: Partial<Ticket> = {}): Ticket {
  return {
    id,
    customerCode,
    farmId: '',
    ticketNumber: `T${id}`,
    date: '2026-10-01',
    grossWeight: 0,
    tareWeight: 0,
    netWeight: 0,
    isApplied: false,
    isActive: true,
    ...over,
  };
}

function intention(id: number, customerId: number): PlantingIntention {
  return {
    id,
    customerId,
    customerName: `Producer ${customerId}`,
    customerCode: `S-${customerId}`,
    tradeUnit: 'TU1',
    plantingYear: 2027,
    crop: 'CORN',
    acres: 100,
    createdAt: '2026-10-01T00:00:00Z',
    createdBy: 'tester',
  };
}

function grain(id: string, customerId: number): StoredGrain {
  return {
    id,
    receiptNumber: id,
    customerId,
    customerCode: `S-${customerId}`,
    crop: 'CORN',
    quantity: 1000,
    grossQuantity: 1000,
    storageStartDate: new Date('2026-09-01'),
    storageRate: 0.05,
    bin: '1',
    receivableAmount: 0,
    storageDays: 10,
    chargedFromDate: null,
    chargedThruDate: null,
    locationCity: 'Omaha',
    locationState: 'NE',
    bushels: 1000,
    dateReceived: new Date('2026-09-01'),
  };
}

function details(customerId: number, over: Partial<ProducerDetails> = {}): ProducerDetails {
  return {
    id: customerId,
    customerId,
    customerName: `Producer ${customerId}`,
    createdBy: 'tester',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function note(id: number, customerId: number, createdAt: Date): Note {
  return {
    id,
    customerId,
    customerName: `Producer ${customerId}`,
    content: `note ${id}`,
    isPinned: false,
    createdBy: 'tester',
    createdAt,
  };
}

function savedList(id: number, over: Partial<SavedList> = {}): SavedList {
  return { id, name: `List ${id}`, query: 'corn growers', tradeUnits: 'TU1', createdAt: '2026-01-01T00:00:00Z', ...over };
}

function reminder(id: number, customerId: number, over: Partial<Reminder> = {}): Reminder {
  return {
    id,
    customerId,
    customerName: `Producer ${customerId}`,
    customerCode: `S-${customerId}`,
    dueAt: '2026-10-20T15:00:00Z',
    subject: 'Call back',
    isCompleted: false,
    createdAt: NOW.toISOString(),
    ...over,
  };
}

function httpError(status: number, error: unknown = null): { status: number; error: unknown } {
  return { status, error };
}

// ── Service stubs ───────────────────────────────────────────────────────────

function makeApi() {
  return {
    getCustomers: vi.fn((_tu?: string[]): Observable<Customer[]> => of([])),
    getContracts: vi.fn((_tu?: string[]): Observable<Contract[]> => of([])),
    getPlantingIntentions: vi.fn((_tu?: string[]): Observable<PlantingIntention[]> => of([])),
    getStoredGrain: vi.fn((_tu?: string[]): Observable<StoredGrain[]> => of([])),
    getDpContracts: vi.fn((_tu?: string[]): Observable<DpContract[]> => of([])),
    getSavedLists: vi.fn((): Observable<SavedList[]> => of([])),
    getTeamSavedLists: vi.fn((_tus: string): Observable<SavedList[]> => of([])),
    updateSavedList: vi.fn((id: number, body: Partial<SavedList>): Observable<SavedList> =>
      of(savedList(id, body))),
    getQueryLibrary: vi.fn((): Observable<QueryLibraryItem[]> => of([])),
    getAllProducerDetails: vi.fn((): Observable<ProducerDetails[]> => of([])),
    getProducerDetails: vi.fn((id: number): Observable<ProducerDetails> => of(details(id))),
    saveProducerDetails: vi.fn((id: number): Observable<ProducerDetails> => of(details(id))),
    getDashboardPlantingEstimates: vi.fn((_key: string, _year: number): Observable<DashboardPlantingEstimate[]> => of([])),
    getCommodities: vi.fn((): Observable<Commodity[]> => of([])),
    getNotes: vi.fn((): Observable<Note[]> => of([])),
    getNotesLastContact: vi.fn((): Observable<NoteLastContact[]> => of([])),
    getNotesByCustomer: vi.fn((_id: number): Observable<Note[]> => of([])),
    getRemindersByCustomer: vi.fn((_id: number): Observable<Reminder[]> => of([])),
    createReminder: vi.fn((customerId: number, dueAt: string, subject?: string): Observable<Reminder> =>
      of(reminder(900, customerId, { dueAt, subject: subject ?? '' }))),
    updateReminder: vi.fn((id: number): Observable<Reminder> => of(reminder(id, 1))),
    setReminderCompleted: vi.fn((id: number, completed: boolean): Observable<Reminder> =>
      of(reminder(id, 1, { isCompleted: completed }))),
    deleteReminder: vi.fn((_id: number): Observable<void> => of(undefined)),
    getCustomerBySourceId: vi.fn((_sourceId: string): Observable<Customer | null> => of(null)),
    getCustomersLinkedTo: vi.fn((_sourceId: string): Observable<Customer[]> => of([])),
    getCustomerById: vi.fn((id: number): Observable<Customer> => of(customer(id))),
    getPlantingIntentionsByCustomer: vi.fn((_id: number): Observable<PlantingIntention[]> => of([])),
    getPricingLinesByCustomer: vi.fn((_scoularId: string): Observable<ContractPricingLine[]> => of([])),
    getContractsByCustomer: vi.fn((_id: number, _scoularId?: string): Observable<Contract[]> => of([])),
    getTicketsByCustomer: vi.fn((_id: number, _scoularId?: string): Observable<Ticket[]> => of([])),
    getStoredGrainByCustomer: vi.fn((_id: number): Observable<StoredGrain[]> => of([])),
    getDpContractsByCustomer: vi.fn((_id: number): Observable<DpContract[]> => of([])),
  };
}
type ApiStub = ReturnType<typeof makeApi>;

/** Signal-backed stand-in for AppStateService: the same signals the page reads, and setters that
 *  write them, so the page's restore/sync paths behave as they do against the real store. */
function makeAppState() {
  const s = {
    selectedTradeUnits: signal<string[]>(['TU1']),
    selectedCustomer: signal<Customer | null>(null),
    customers: signal<Customer[]>([]),
    contracts: signal<Contract[]>([]),
    plantingIntentions: signal<PlantingIntention[]>([]),
    notes: signal<Note[]>([]),
    notesLoaded: signal(false),
    noteLastContacts: signal<NoteLastContact[]>([]),
    myReminders: signal<ReminderDue[]>([]),
    storedGrain: signal<StoredGrain[]>([]),
    dpContracts: signal<DpContract[]>([]),
    dpContractsLoaded: signal(false),
    savedLists: signal<SavedList[]>([]),
    commodities: signal<Commodity[]>([]),
    commodityConversions: signal<CommodityConversion[]>([]),
    queryLibrary: signal<QueryLibraryItem[]>([]),
    pricingLines: signal<ContractPricingLine[]>([]),
    selectCustomer: vi.fn((c: Customer | null) => s.selectedCustomer.set(c)),
    setCustomers: vi.fn((v: Customer[]) => s.customers.set(v)),
    setContracts: vi.fn((v: Contract[]) => s.contracts.set(v)),
    setPlantingIntentions: vi.fn((v: PlantingIntention[]) => s.plantingIntentions.set(v)),
    setNotes: vi.fn((v: Note[]) => { s.notes.set(v); s.notesLoaded.set(true); }),
    setNoteLastContacts: vi.fn((v: NoteLastContact[]) => s.noteLastContacts.set(v)),
    setMyReminders: vi.fn((v: ReminderDue[]) => s.myReminders.set(v)),
    setStoredGrain: vi.fn((v: StoredGrain[]) => s.storedGrain.set(v)),
    setDpContracts: vi.fn((v: DpContract[]) => { s.dpContracts.set(v); s.dpContractsLoaded.set(true); }),
    mergeCustomerDpContracts: vi.fn((customerId: number, rows: DpContract[]) =>
      s.dpContracts.update(e => [...e.filter(d => d.customerId !== customerId), ...rows])),
    setPricingLines: vi.fn((v: ContractPricingLine[]) => s.pricingLines.set(v)),
    setSavedLists: vi.fn((v: SavedList[]) => s.savedLists.set(v)),
    setQueryLibrary: vi.fn((v: QueryLibraryItem[]) => s.queryLibrary.set(v)),
  };
  return s;
}
type AppStateStub = ReturnType<typeof makeAppState>;

function noMatch(customers: Customer[]): NlqFilterResult {
  return { customers, detectedState: null, matchedPatterns: [] };
}

function makeNlq() {
  return {
    queryNeedsFullNotes: vi.fn((_q: string) => false),
    refineFiltersNeedFullNotes: vi.fn((_f: unknown) => false),
    resolveUserReferences: vi.fn((q: string, _name?: string, _user?: string) => q),
    parseAndFilter: vi.fn((_q: string, ctx: NlqFilterContext): NlqFilterResult => noMatch(ctx.customers)),
    applyRefinementFilters: vi.fn((cs: Customer[]) => cs),
    applyCustomerOverrides: vi.fn((ids: number[], included?: number[], excluded?: number[]) =>
      [...new Set([...ids, ...(included ?? [])])].filter(id => !(excluded ?? []).includes(id))),
  };
}

interface Harness {
  fixture: ComponentFixture<HomeComponent>;
  c: HomeComponent;
  api: ApiStub;
  app: AppStateStub;
  toast: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  nlq: ReturnType<typeof makeNlq>;
  outlook: { addToOutlook: ReturnType<typeof vi.fn> };
  router: { navigate: ReturnType<typeof vi.fn> };
  isAdmin: ReturnType<typeof signal<boolean>>;
  /** Runs change detection so the component's effects (TU change, team lists) observe signal writes. */
  flush(): void;
}

interface SetupOptions {
  customers?: Customer[];
  queryParams?: Params;
  isAdmin?: boolean;
  /** Mutate the API/NLQ stubs before the component is constructed (constructor loads fire immediately). */
  arrange?: (api: ApiStub, nlq: ReturnType<typeof makeNlq>, app: AppStateStub) => void;
}

const A = customer(1);
const B = customer(2);
const C = customer(3);

function setup(opts: SetupOptions = {}): Harness {
  const api = makeApi();
  const app = makeAppState();
  const nlq = makeNlq();
  api.getCustomers.mockReturnValue(of(opts.customers ?? [A, B, C]));
  opts.arrange?.(api, nlq, app);

  const toast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
  const outlook = { addToOutlook: vi.fn((_r: Reminder, _link: string): Observable<Reminder | null> => of(null)) };
  const router = { navigate: vi.fn() };
  const isAdmin = signal(opts.isAdmin ?? false);

  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AppStateService, useValue: app },
      { provide: ToastService, useValue: toast },
      { provide: NlqFilterService, useValue: nlq },
      { provide: UsageTrackingService, useValue: { trackProfileOpened: vi.fn() } },
      { provide: UserRolesService, useValue: { isAdmin } },
      { provide: OutlookCalendarService, useValue: outlook },
      {
        provide: MsalService,
        useValue: {
          instance: {
            getActiveAccount: () => ({ name: 'Caden Egr', username: 'cegr@scoular.com' }),
            getAllAccounts: () => [],
          },
        },
      },
      { provide: ActivatedRoute, useValue: { queryParams: new BehaviorSubject<Params>(opts.queryParams ?? {}) } },
      { provide: Router, useValue: router },
    ],
  });
  // The children (list / profile / notes / reminders) each pull in their own services; everything
  // under test here is class logic, so the template is blanked rather than stubbing that tree.
  TestBed.overrideComponent(HomeComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
  const fixture = TestBed.createComponent(HomeComponent);
  fixture.detectChanges();
  return {
    fixture, c: fixture.componentInstance, api, app, toast, nlq, outlook, router, isAdmin,
    flush: () => fixture.detectChanges(),
  };
}

function callsFor(fn: ReturnType<typeof vi.fn>, id: number): number {
  return fn.mock.calls.filter(args => args[0] === id).length;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('HomeComponent', () => {
  const originalReadAhead = environment.ctrmReadAheadEnabled;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    // Dev builds log every background failure; keep the run output readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
    environment.ctrmReadAheadEnabled = originalReadAhead;
  });

  // ── Selecting a producer ─────────────────────────────────────────────────
  describe('selecting a producer', () => {
    it('loads the producer\'s contracts, tickets, stored grain, DP contracts and planting intentions into the per-customer views', () => {
      const h = setup({
        arrange: api => {
          api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1'), contract(11, 'S-1')]));
          api.getTicketsByCustomer.mockReturnValue(of([ticket(20, 'S-1')]));
          api.getStoredGrainByCustomer.mockReturnValue(of([grain('G1', 1)]));
          api.getPlantingIntentionsByCustomer.mockReturnValue(of([intention(30, 1)]));
        },
      });

      h.c.handleSelectCustomer(A);

      expect(h.c.selectedCustomer()?.id).toBe(1);
      expect(h.app.selectCustomer).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
      expect(h.c.customerContracts().map(x => x.id)).toEqual([10, 11]);
      expect(h.c.customerTickets().map(x => x.id)).toEqual([20]);
      expect(h.c.customerStoredGrain().map(x => x.id)).toEqual(['G1']);
      expect(h.c.customerPlantingIntentions().map(x => x.id)).toEqual([30]);
      expect(h.c.isLoadingContracts()).toBe(false);
      expect(h.c.isLoadingUnappliedTickets()).toBe(false);
      expect(h.c.isLoadingStoredGrain()).toBe(false);
      expect(h.c.isLoadingDpContracts()).toBe(false);
      expect(h.c.customerCodeMap().get(1)).toBe('S-1');
    });

    it('includes a split-load ticket carrying another producer\'s code when it is applied to this producer\'s contract', () => {
      const h = setup({
        arrange: api => {
          api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1', { sourceContractId: 'P10' })]));
          api.getTicketsByCustomer.mockReturnValue(of([
            ticket(20, 'S-1'),
            ticket(21, 'S-OTHER', { ctrmContractNumber: 'P10', isApplied: true }),
            ticket(22, 'S-OTHER', { ctrmContractNumber: 'P99', isApplied: true }),
          ]));
        },
      });

      h.c.handleSelectCustomer(A);

      expect(h.c.customerTickets().map(t => t.id).sort()).toEqual([20, 21]);
    });

    it('ignores a slow stored-grain response for the previously selected producer', () => {
      const aGrain = new Subject<StoredGrain[]>();
      const h = setup({
        arrange: api => api.getStoredGrainByCustomer.mockImplementation(id =>
          id === 1 ? aGrain.asObservable() : of([grain('GB', 2)])),
      });

      h.c.handleSelectCustomer(A);
      h.c.handleSelectCustomer(B);
      aGrain.next([grain('GA', 1)]);

      expect(h.c.selectedCustomer()?.id).toBe(2);
      expect(h.c.customerStoredGrain().map(g => g.id)).toEqual(['GB']);
      expect(h.c.storedGrain().some(g => g.id === 'GA')).toBe(false);
    });

    it('keeps the newest linked producer\'s planting intentions when an older request lands late (request-id guard)', () => {
      // handleSelectLinkedCustomer's planting fetch is not cancelled by the selection subject, so the
      // request-id counter is the only thing stopping B's late answer overwriting C's.
      const bIntentions = new Subject<PlantingIntention[]>();
      const h = setup({
        arrange: api => api.getPlantingIntentionsByCustomer.mockImplementation(id =>
          id === 2 ? bIntentions.asObservable() : of([intention(300 + id, id)])),
      });

      h.c.handleSelectCustomer(A);
      h.c.handleSelectLinkedCustomer(2);
      h.c.handleSelectLinkedCustomer(3);
      bIntentions.next([intention(200, 2)]);

      expect(h.c.selectedCustomer()?.id).toBe(3);
      expect(h.c.customerPlantingIntentions().map(p => p.id)).toEqual([303]);
    });

    it('serves a re-click inside 60s from memory, then refreshes behind the rows once the copy has aged out', () => {
      environment.ctrmReadAheadEnabled = false; // isolate from the 4s convergence re-read
      const h = setup({
        arrange: api => api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1')])),
      });

      h.c.handleSelectCustomer(A);
      h.c.handleSelectCustomer(B);
      h.c.handleSelectCustomer(A);
      expect(callsFor(h.api.getContractsByCustomer, 1)).toBe(1);
      expect(h.c.customerContracts().map(x => x.id)).toEqual([10]);
      expect(h.c.isLoadingContracts()).toBe(false);

      vi.advanceTimersByTime(61_000);
      h.c.handleSelectCustomer(B);
      h.c.handleSelectCustomer(A);
      expect(callsFor(h.api.getContractsByCustomer, 1)).toBe(2);
    });

    it('applies deep-link context from the query string and keeps it, while a manual click resets it', () => {
      const h = setup({ queryParams: { customerId: '2', contractId: '55', tab: 'tickets', ticketCrop: 'CORN', year: '2027' } });

      expect(h.c.selectedCustomer()?.id).toBe(2);
      expect(h.c.pendingContractId()).toBe(55);
      expect(h.c.pendingTab()).toBe('tickets');
      expect(h.c.pendingTicketCrop()).toBe('CORN');
      expect(h.c.pendingPlantingYear()).toBe(2027);

      h.c.handleSelectCustomer(A);

      expect(h.c.pendingContractId()).toBeNull();
      expect(h.c.pendingTab()).toBeNull();
      expect(h.c.pendingTicketCrop()).toBeNull();
    });

    it('loads notes for the producer and its linked group and derives the last-contacted label', () => {
      const linkedA = customer(1, { linkedProducerIds: ['S-2'] });
      const h = setup({
        customers: [linkedA, B, C],
        arrange: api => api.getNotesByCustomer.mockImplementation(id =>
          of(id === 1 ? [note(1, 1, new Date('2026-10-01T12:00:00Z'))] : id === 2 ? [note(2, 2, NOW)] : [])),
      });

      expect(h.c.lastContactedDate()).toBe('Never');
      h.c.handleSelectCustomer(linkedA);

      expect(h.api.getNotesByCustomer).toHaveBeenCalledWith(1);
      expect(h.api.getNotesByCustomer).toHaveBeenCalledWith(2);
      expect(h.c.customerNotes().map(n => n.id)).toEqual([2, 1]); // newest first
      expect(h.c.lastContactedDate()).toBe('Today');
      expect(h.c.isLoadingNotes()).toBe(false);
    });

    it('clearing the selection empties it in the page, the shared state and the URL', () => {
      const h = setup();
      h.c.handleSelectCustomer(A);

      h.c.handleClearSelection();

      expect(h.c.selectedCustomer()).toBeNull();
      expect(h.app.selectedCustomer()).toBeNull();
      expect(h.router.navigate).toHaveBeenCalledWith([], { queryParams: {}, replaceUrl: true });
    });
  });

  // ── Trade-unit changes ───────────────────────────────────────────────────
  describe('trade-unit changes', () => {
    it('clears the selection and roster, then reloads customers for the new trade units', () => {
      const h = setup();
      h.c.handleSelectCustomer(A);
      h.api.getCustomers.mockReturnValue(of([customer(50)]));

      h.app.selectedTradeUnits.set(['TU2']);
      h.flush();

      expect(h.c.selectedTradeUnits()).toEqual(['TU2']);
      expect(h.c.selectedCustomer()).toBeNull();
      expect(h.app.selectCustomer).toHaveBeenLastCalledWith(null);
      expect(h.api.getCustomers).toHaveBeenLastCalledWith(['TU2']);
      expect(h.c.customers().map(x => x.id)).toEqual([50]);
      expect(h.c.loading()).toBe(false);
    });

    it('drops per-producer caches so re-selecting a producer refetches its rows for the new scope', () => {
      environment.ctrmReadAheadEnabled = false;
      const h = setup();
      h.c.handleSelectCustomer(A);
      expect(callsFor(h.api.getContractsByCustomer, 1)).toBe(1);

      h.app.selectedTradeUnits.set(['TU1', 'TU2']);
      h.flush();
      h.c.handleSelectCustomer(A);

      expect(callsFor(h.api.getContractsByCustomer, 1)).toBe(2);
      expect(callsFor(h.api.getPlantingIntentionsByCustomer, 1)).toBe(2);
    });

    it('does not reload when the same trade units arrive in a different order', () => {
      const h = setup();
      h.app.selectedTradeUnits.set(['TU1', 'TU2']);
      h.flush();
      const calls = h.api.getCustomers.mock.calls.length;

      h.app.selectedTradeUnits.set(['TU2', 'TU1']);
      h.flush();

      expect(h.api.getCustomers.mock.calls.length).toBe(calls);
    });

    it('with no trade unit selected, refreshes only the last-contact aggregate', () => {
      const h = setup();
      const customerCalls = h.api.getCustomers.mock.calls.length;
      const lastContactCalls = h.api.getNotesLastContact.mock.calls.length;

      h.app.selectedTradeUnits.set([]);
      h.flush();

      expect(h.api.getCustomers.mock.calls.length).toBe(customerCalls);
      expect(h.api.getNotesLastContact.mock.calls.length).toBe(lastContactCalls + 1);
      expect(h.c.customers()).toEqual([]);
    });

    it('discards a customer roster from an earlier trade-unit request that resolves after a newer one', () => {
      const tu2 = new Subject<Customer[]>();
      const tu3 = new Subject<Customer[]>();
      const h = setup();
      h.api.getCustomers.mockImplementation(tus => (tus?.[0] === 'TU2' ? tu2 : tu3).asObservable());

      h.app.selectedTradeUnits.set(['TU2']);
      h.flush();
      h.app.selectedTradeUnits.set(['TU3']);
      h.flush();
      tu3.next([customer(30)]);
      tu2.next([customer(20)]);

      expect(h.c.customers().map(x => x.id)).toEqual([30]);
    });
  });

  // ── Linked producers ─────────────────────────────────────────────────────
  describe('linked producers', () => {
    it('getLinkedGroup walks forward and reverse links transitively', () => {
      const a = customer(1, { linkedProducerIds: ['S-2'] });
      const b = customer(2, { linkedProducerIds: ['S-4'] });
      const c = customer(3, { linkedProducerIds: ['S-1'] }); // reverse link into A
      const d = customer(4);
      const unrelated = customer(5);
      const h = setup({ customers: [a, b, c, d, unrelated] });

      expect(h.c.getLinkedGroup(a).map(x => x.id).sort()).toEqual([2, 3, 4]);
      expect(h.c.getLinkedGroup(unrelated)).toEqual([]);
    });

    it('fetches linked producers outside the trade unit (outgoing, incoming and transitive) once per session', () => {
      const a = customer(1, { linkedProducerIds: ['S-90'] });
      const h = setup({
        customers: [a, B],
        arrange: api => {
          api.getCustomerBySourceId.mockImplementation(src =>
            of(src === 'S-90' ? customer(90, { linkedProducerIds: ['S-91'] }) : src === 'S-91' ? customer(91) : null));
          api.getCustomersLinkedTo.mockImplementation(src => of(src === 'S-1' ? [customer(92, { linkedProducerIds: ['S-1'] })] : []));
        },
      });

      h.c.handleSelectCustomer(a);

      expect(h.c.crossTradeUnitCustomers().map(x => x.id).sort()).toEqual([90, 91, 92]);
      expect(h.c.getLinkedGroup(a).map(x => x.id).sort()).toEqual([90, 91, 92]);
      expect(h.c.customerCodeMap().get(91)).toBe('S-91');

      const fetches = h.api.getCustomerBySourceId.mock.calls.length;
      h.c.handleSelectCustomer(B);
      h.c.handleSelectCustomer(a);
      expect(h.api.getCustomerBySourceId.mock.calls.length).toBe(fetches);
    });

    it('selecting a linked producer from another trade unit fetches it and loads its data', () => {
      const a = customer(1, { linkedProducerIds: ['S-90'] });
      const h = setup({
        customers: [a, B],
        arrange: api => {
          api.getCustomerById.mockReturnValue(of(customer(90)));
          api.getContractsByCustomer.mockImplementation(id => of(id === 90 ? [contract(900, 'S-90')] : []));
        },
      });
      h.c.handleSelectCustomer(a);

      h.c.handleSelectLinkedCustomer(90);

      expect(h.api.getCustomerById).toHaveBeenCalledWith(90);
      expect(h.c.selectedCustomer()?.id).toBe(90);
      expect(h.c.customerContracts().map(x => x.id)).toEqual([900]);
      // The departing producer is still reachable through the reverse link, so the dropdown stays put.
      expect(h.c.getLinkedGroup(h.c.selectedCustomer()!).map(x => x.id)).toContain(1);
    });

    it('re-selecting the producer already shown is a no-op', () => {
      const h = setup();
      h.c.handleSelectCustomer(A);
      const calls = h.api.getContractsByCustomer.mock.calls.length;

      h.c.handleSelectLinkedCustomer(1);

      expect(h.api.getContractsByCustomer.mock.calls.length).toBe(calls);
    });
  });

  // ── Saved lists ──────────────────────────────────────────────────────────
  describe('saved lists', () => {
    it('resolves each list\'s query plus manual include/exclude overrides into customerIds', () => {
      const h = setup({
        arrange: (api, nlq) => {
          api.getSavedLists.mockReturnValue(of([savedList(7, { includedCustomerIds: [3], excludedCustomerIds: [1] })]));
          nlq.parseAndFilter.mockImplementation((_q, ctx) => ({
            customers: ctx.customers.filter(x => x.id <= 2), detectedState: null, matchedPatterns: ['crop'],
          }));
        },
      });

      expect(h.c.savedLists()[0].customerIds).toEqual([2, 3]);
      expect(h.nlq.resolveUserReferences).toHaveBeenCalledWith('corn growers', 'Caden Egr', 'cegr@scoular.com');
    });

    it('leaves a list unresolved when its query matched no pattern (rather than caching "everyone")', () => {
      const h = setup({ arrange: api => api.getSavedLists.mockReturnValue(of([savedList(7)])) });

      expect(h.c.savedLists()[0].customerIds).toBeUndefined();
    });

    it('fetches the full note set once, only when an unresolved list actually needs note content', () => {
      const h = setup({
        arrange: (api, nlq) => {
          api.getSavedLists.mockReturnValue(of([savedList(7, { query: 'notes mentioning drought' })]));
          nlq.queryNeedsFullNotes.mockImplementation(q => q.includes('notes'));
        },
      });

      expect(h.api.getNotes).toHaveBeenCalledTimes(1);
      expect(h.app.setNotes).toHaveBeenCalledTimes(1);
    });

    it('never downloads full notes when no list needs them', () => {
      const h = setup({ arrange: api => api.getSavedLists.mockReturnValue(of([savedList(7)])) });

      expect(h.api.getNotes).not.toHaveBeenCalled();
    });

    it('offers only lists that overlap the selected trade units, fully-inside lists first', () => {
      const h = setup({
        arrange: api => api.getSavedLists.mockReturnValue(of([
          savedList(1, { tradeUnits: 'TU1,TU9' }),
          savedList(2, { tradeUnits: 'TU2' }),
          savedList(3, { tradeUnits: 'TU1' }),
        ])),
      });

      expect(h.c.savedListsForSelectedCustomer().map(l => l.id)).toEqual([3, 1]);
    });

    it('adding the selected producer to a list updates it optimistically and persists it', () => {
      const h = setup({ arrange: api => api.getSavedLists.mockReturnValue(of([savedList(7, { excludedCustomerIds: [1] })])) });
      h.c.handleSelectCustomer(A);

      h.c.handleSaveSavedListMembership([{ listId: 7, add: true }]);

      expect(h.c.savedLists()[0].includedCustomerIds).toEqual([1]);
      expect(h.c.savedLists()[0].excludedCustomerIds).toEqual([]);
      expect(h.api.updateSavedList).toHaveBeenCalledWith(7, expect.objectContaining({
        includedCustomerIds: [1], excludedCustomerIds: [], query: 'corn growers',
      }));
      expect(h.toast.success).toHaveBeenCalledWith('Saved list updated');
    });

    it('reverts the membership change and says so when the save fails', () => {
      const h = setup({ arrange: api => api.getSavedLists.mockReturnValue(of([savedList(7)])) });
      h.api.updateSavedList.mockReturnValue(throwError(() => httpError(500)));
      h.c.handleSelectCustomer(A);

      h.c.handleSaveSavedListMembership([{ listId: 7, add: true }]);

      expect(h.c.savedLists()[0].includedCustomerIds).toBeUndefined();
      expect(h.app.savedLists()[0].includedCustomerIds).toBeUndefined();
      expect(h.toast.error).toHaveBeenCalledWith('Failed to save list changes');
    });

    it('loads team lists for the selected trade units only for managers', () => {
      const team = [savedList(40, { createdBy: 'Someone Else' })];
      const nonManager = setup({ arrange: api => api.getTeamSavedLists.mockReturnValue(of(team)) });
      expect(nonManager.api.getTeamSavedLists).not.toHaveBeenCalled();
      expect(nonManager.c.teamListsForSelectedCustomer()).toEqual([]);
      TestBed.resetTestingModule();

      const manager = setup({ isAdmin: true, arrange: api => api.getTeamSavedLists.mockReturnValue(of(team)) });
      expect(manager.api.getTeamSavedLists).toHaveBeenCalledWith('TU1');
      expect(manager.c.teamListsForSelectedCustomer().map(l => l.id)).toEqual([40]);
    });
  });

  // ── Background-failure toast throttle ────────────────────────────────────
  describe('background-failure toast throttle', () => {
    it('one transient failure produces exactly one toast naming what failed', () => {
      const h = setup({ arrange: api => api.getContracts.mockReturnValue(throwError(() => httpError(500))) });

      expect(h.toast.error).toHaveBeenCalledTimes(1);
      expect(h.toast.error.mock.calls[0][0]).toContain('load contracts');
    });

    it('eight sources failing at once produce a single toast', () => {
      const fail = () => throwError(() => httpError(503));
      const h = setup({
        arrange: api => {
          api.getAllProducerDetails.mockReturnValue(fail());
          api.getContracts.mockReturnValue(fail());
          api.getStoredGrain.mockReturnValue(fail());
          api.getDpContracts.mockReturnValue(fail());
          api.getSavedLists.mockReturnValue(fail());
          api.getNotesLastContact.mockReturnValue(fail());
          api.getProducerDetails.mockReturnValue(fail());
          api.getPlantingIntentionsByCustomer.mockReturnValue(fail());
        },
      });
      h.c.handleSelectCustomer(A);

      // Eight distinct sources reported (all logged in dev)...
      const reported = new Set(vi.mocked(console.error).mock.calls.map(args => String(args[0])));
      expect(reported.size).toBe(8);
      // ...but the user is told once.
      expect(h.toast.error).toHaveBeenCalledTimes(1);
    });

    it('the same source stays quiet for five minutes after it has spoken', () => {
      const h = setup({
        arrange: api => api.getPlantingIntentionsByCustomer.mockReturnValue(throwError(() => httpError(500))),
      });

      h.c.handleSelectCustomer(A);
      expect(h.toast.error).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2 * 60_000); // past the 60s global window, inside the 5-minute source window
      h.c.handleSelectCustomer(B);
      expect(h.toast.error).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(3 * 60_000 + 1_000); // now past five minutes since it last spoke
      h.c.handleSelectCustomer(C);
      expect(h.toast.error).toHaveBeenCalledTimes(2);
    });

    it('a different source still waits out the 60-second global quiet period', () => {
      const h = setup({
        arrange: api => {
          api.getPlantingIntentionsByCustomer.mockReturnValue(throwError(() => httpError(500)));
          api.getProducerDetails.mockReturnValue(throwError(() => httpError(500)));
        },
      });

      // Both fail on the click; producer details reports first and speaks, planting is held back.
      h.c.handleSelectCustomer(A);
      expect(h.toast.error).toHaveBeenCalledTimes(1);
      expect(h.toast.error.mock.calls[0][0]).toContain('refresh producer details');

      vi.advanceTimersByTime(30_000);
      h.c.handleSelectCustomer(B); // inside 60s: nothing new from either
      expect(h.toast.error).toHaveBeenCalledTimes(1);

      // Past 60s: the held-back source was never marked as having spoken, so it may speak now,
      // while producer details is still inside its own five minutes.
      vi.advanceTimersByTime(31_000);
      h.c.handleSelectCustomer(C);
      expect(h.toast.error).toHaveBeenCalledTimes(2);
      expect(h.toast.error.mock.calls[1][0]).toContain('load planting intentions');
    });
  });

  // ── CTRM read-ahead: hover prefetch + click convergence ──────────────────
  describe('CTRM read-ahead', () => {
    it('hover prefetch does nothing when read-ahead is disabled', () => {
      environment.ctrmReadAheadEnabled = false;
      const h = setup();

      h.c.handlePrefetchCustomer(B);

      expect(h.api.getContractsByCustomer).not.toHaveBeenCalled();
      expect(h.api.getTicketsByCustomer).not.toHaveBeenCalled();
      expect(h.api.getPricingLinesByCustomer).not.toHaveBeenCalled();
    });

    it('caps hover prefetch at two producers in flight and does not duplicate one already in flight', () => {
      environment.ctrmReadAheadEnabled = true;
      const h = setup({ customers: [A, B, C, customer(4)] });
      h.api.getContractsByCustomer.mockReturnValue(NEVER);

      h.c.handlePrefetchCustomer(A);
      h.c.handlePrefetchCustomer(B);
      h.c.handlePrefetchCustomer(A);
      h.c.handlePrefetchCustomer(C);

      expect(h.api.getContractsByCustomer.mock.calls.map(args => args[0])).toEqual([1, 2]);
    });

    it('a hover prefetch touches no visible state, and the click then renders from it without a round trip', () => {
      environment.ctrmReadAheadEnabled = true;
      const h = setup();
      h.api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-2')]));
      h.api.getTicketsByCustomer.mockReturnValue(of([ticket(20, 'S-2')]));

      h.c.handlePrefetchCustomer(B);
      expect(h.c.selectedCustomer()).toBeNull();
      expect(h.c.customerContracts()).toEqual([]);

      h.c.handleSelectCustomer(B);

      expect(h.api.getContractsByCustomer).toHaveBeenCalledTimes(1);
      expect(h.api.getTicketsByCustomer).toHaveBeenCalledTimes(1);
      expect(h.api.getPricingLinesByCustomer).toHaveBeenCalledTimes(1);
      expect(h.c.customerContracts().map(x => x.id)).toEqual([10]);
      expect(h.c.customerTickets().map(x => x.id)).toEqual([20]);
    });

    it('does not prefetch the producer already selected', () => {
      environment.ctrmReadAheadEnabled = true;
      const h = setup();
      h.c.handleSelectCustomer(A);
      const calls = h.api.getContractsByCustomer.mock.calls.length;

      h.c.handlePrefetchCustomer(A);

      expect(h.api.getContractsByCustomer.mock.calls.length).toBe(calls);
    });

    it('re-reads 4s after a first click and swaps in the converged rows, dropping a contract that closed', () => {
      environment.ctrmReadAheadEnabled = true;
      const h = setup();
      h.api.getContractsByCustomer
        .mockReturnValueOnce(of([contract(10, 'S-1'), contract(11, 'S-1')]))
        .mockReturnValueOnce(of([contract(11, 'S-1'), contract(12, 'S-1')]));

      h.c.handleSelectCustomer(A);
      expect(h.c.customerContracts().map(x => x.id)).toEqual([10, 11]);

      vi.advanceTimersByTime(4_000);

      expect(callsFor(h.api.getContractsByCustomer, 1)).toBe(2);
      expect(h.c.customerContracts().map(x => x.id).sort()).toEqual([11, 12]);
    });

    it('skips the convergence re-read when read-ahead is disabled', () => {
      environment.ctrmReadAheadEnabled = false;
      const h = setup();

      h.c.handleSelectCustomer(A);
      vi.advanceTimersByTime(5_000);

      expect(callsFor(h.api.getContractsByCustomer, 1)).toBe(1);
    });

    it('cancels the convergence re-read when the user moves to another producer first', () => {
      environment.ctrmReadAheadEnabled = true;
      const h = setup();

      h.c.handleSelectCustomer(A);
      vi.advanceTimersByTime(1_000);
      h.c.handleSelectCustomer(B);
      vi.advanceTimersByTime(4_000);

      expect(callsFor(h.api.getContractsByCustomer, 1)).toBe(1);
      expect(callsFor(h.api.getContractsByCustomer, 2)).toBe(2);
    });
  });

  // ── API failures leave the page sane ─────────────────────────────────────
  describe('API failures', () => {
    it('a CTRM-unavailable contract read shows the server\'s message and Retry recovers', () => {
      const h = setup({
        arrange: api => api.getContractsByCustomer.mockReturnValue(throwError(() =>
          httpError(503, { code: 'INFRASTRUCTURE_CTRM_UNAVAILABLE', message: 'CTRM is down for maintenance.' }))),
      });

      h.c.handleSelectCustomer(A);
      expect(h.c.contractsLoadError()).toBe('CTRM is down for maintenance.');
      expect(h.c.isLoadingContracts()).toBe(false);

      h.api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1')]));
      h.c.retryCustomerContracts();

      expect(h.c.contractsLoadError()).toBeNull();
      expect(h.c.isLoadingContracts()).toBe(false);
      expect(h.c.customerContracts().map(x => x.id)).toEqual([10]);
    });

    it('a 503 ticket read names the outage, leaves contracts intact, and Retry recovers', () => {
      const h = setup({
        arrange: api => {
          api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1')]));
          api.getTicketsByCustomer.mockReturnValue(throwError(() => httpError(503)));
        },
      });

      h.c.handleSelectCustomer(A);
      expect(h.c.ticketsLoadError()).toBe('The data source is temporarily unavailable. Please retry shortly.');
      expect(h.c.isLoadingUnappliedTickets()).toBe(false);
      expect(h.c.customerContracts().map(x => x.id)).toEqual([10]);

      h.api.getTicketsByCustomer.mockReturnValue(of([ticket(20, 'S-1')]));
      h.c.retryCustomerTickets();

      expect(h.c.ticketsLoadError()).toBeNull();
      expect(h.c.customerTickets().map(x => x.id)).toEqual([20]);
    });

    it('a failed pricing-line read is reported as an error, not as "no priced lines"', () => {
      const h = setup({ arrange: api => api.getPricingLinesByCustomer.mockReturnValue(throwError(() => httpError(500))) });

      h.c.handleSelectCustomer(A);

      expect(h.c.pricingLinesLoadError()).toBe('Something went wrong loading this data. Please retry.');
      expect(h.c.customerPricingLines()).toEqual([]);
      expect(h.c.isLoadingPricingLines()).toBe(false);
    });

    it('a failed customer roster load stops the spinner and leaves selection usable', () => {
      const h = setup({ arrange: api => api.getCustomers.mockReturnValue(throwError(() => httpError(500))) });

      expect(h.c.loading()).toBe(false);
      expect(h.c.customers()).toEqual([]);

      h.c.handleSelectCustomer(A);
      expect(h.c.selectedCustomer()?.id).toBe(1);
    });
  });

  // ── Reminders ────────────────────────────────────────────────────────────
  describe('reminders', () => {
    it('creating a follow-up adds it to the producer and the badge feed, and flags an Outlook failure', () => {
      const h = setup();
      h.c.handleSelectCustomer(A);

      h.c.saveReminder({ dueAt: '2026-10-20T15:00:00Z', subject: 'Call back', notes: '' });

      expect(h.api.createReminder).toHaveBeenCalledWith(1, '2026-10-20T15:00:00Z', 'Call back', '');
      expect(h.c.customerReminders().map(r => r.id)).toEqual([900]);
      expect(h.c.myReminders().map(r => r.id)).toEqual([900]);
      expect(h.app.setMyReminders).toHaveBeenLastCalledWith([expect.objectContaining({ id: 900, customerId: 1 })]);
      expect(h.c.reminderSaveSucceededCounter()).toBe(1);
      expect(h.c.isSavingReminder()).toBe(false);
      expect(h.toast.success).toHaveBeenCalledWith('Follow-up added');
      expect(h.outlook.addToOutlook).toHaveBeenCalledTimes(1);
      expect(h.toast.info).toHaveBeenCalledWith(expect.stringContaining('could not be added to Outlook'));
    });

    it('completing a follow-up removes it from the badge feed but keeps it on the producer', () => {
      const open = reminder(5, 1);
      const h = setup({ arrange: api => api.getRemindersByCustomer.mockReturnValue(of([open])) });
      h.c.handleSelectCustomer(A);
      h.app.myReminders.set([{ id: 5, customerId: 1, dueAt: open.dueAt }]);
      h.flush();

      h.c.toggleReminderComplete(open);

      expect(h.api.setReminderCompleted).toHaveBeenCalledWith(5, true);
      expect(h.c.customerReminders()[0].isCompleted).toBe(true);
      expect(h.c.myReminders()).toEqual([]);
    });
  });
});
