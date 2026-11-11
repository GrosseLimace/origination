import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { BehaviorSubject, NEVER, Observable, Subject, of, throwError } from 'rxjs';
import { tap } from 'rxjs/operators';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import {
  ProducerFixture, ProducerProfilesFake, producerProfilesFake, profilesOf, provideProducerProfiles, withFixtureProfile,
} from '@testing/producer-profiles.fake';
import { SelectedProducerActivityFake, provideSelectedProducerActivity, selectedProducerActivityFake } from '@testing/selected-producer-activity.fake';
import { SelectedProducerProductionFake, provideSelectedProducerProduction, selectedProducerProductionFake } from '@testing/selected-producer-production.fake';
import { SelectedProducerEngagementFake, provideSelectedProducerEngagement, selectedProducerEngagementFake } from '@testing/selected-producer-engagement.fake';
import { environment } from '@env/environment';
import { Commodity, CommodityConversion, Contract, ContractPricingLine, Customer, ProducerDetails, Ticket } from '@models';

import { HomeComponent } from './home.component';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { CustomerStore } from '../../data-access/customer.store';
import { CustomersApiService } from '../../data-access/customers-api.service';
import { LinkedProducersStore } from '../../data-access/linked-producers.store';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { ProducerEditing } from '@core/context/producer-editing';

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

/** The page's ProducerProfiles in the running test (set by setup), so a producer built later in the test with saved
 *  details is known too: the store holds every producer's details, not only the trade unit's. */
let liveProfiles: ProducerProfilesFake | null = null;

/** A producer. Their acres, commodities and links are their saved details, which ProducerProfiles holds. */
function customer(id: number, { totalAcres, commodities, linkedProducerIds, ...over }: Partial<Customer> & ProducerFixture = {}): Customer {
  const built: Customer = {
    id,
    scoularId: `S-${id}`,
    name: `Producer ${id}`,
    location: 'Omaha, NE',
    phone: '',
    email: '',
    eSignEnabled: false,
    achEnabled: false,
    ...over,
  };
  if (totalAcres === undefined && !commodities && !linkedProducerIds) return built;
  withFixtureProfile(built, { totalAcres, commodities, linkedProducerIds });
  const saved = profilesOf([built]).get(id);
  if (saved) liveProfiles?.put(saved);
  return built;
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

function httpError(status: number, error: unknown = null): { status: number; error: unknown } {
  return { status, error };
}

// ── Service stubs ───────────────────────────────────────────────────────────

function makeApi() {
  return {
    getCustomers: vi.fn((_tu?: string[]): Observable<Customer[]> => of([])),
    getContracts: vi.fn((_tu?: string[]): Observable<Contract[]> => of([])),
    getAllProducerDetails: vi.fn((): Observable<ProducerDetails[]> => of([])),
    getProducerDetails: vi.fn((id: number): Observable<ProducerDetails> => of(details(id))),
    // Answers with what was saved, as the server does.
    saveProducerDetails: vi.fn((id: number, body?: Partial<ProducerDetails>): Observable<ProducerDetails> => of(details(id, body))),
    getCommodities: vi.fn((): Observable<Commodity[]> => of([])),
    getCustomerBySourceId: vi.fn((_sourceId: string): Observable<Customer | null> => of(null)),
    getCustomersLinkedTo: vi.fn((_sourceId: string): Observable<Customer[]> => of([])),
    getCustomerById: vi.fn((id: number): Observable<Customer> => of(customer(id))),
    getPricingLinesByCustomer: vi.fn((_scoularId: string): Observable<ContractPricingLine[]> => of([])),
    getContractsByCustomer: vi.fn((_id: number, _scoularId?: string): Observable<Contract[]> => of([])),
    getTicketsByCustomer: vi.fn((_id: number, _scoularId?: string): Observable<Ticket[]> => of([])),
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
    commodities: signal<Commodity[]>([]),
    commodityConversions: signal<CommodityConversion[]>([]),
    pricingLines: signal<ContractPricingLine[]>([]),
    selectCustomer: vi.fn((c: Customer | null) => s.selectedCustomer.set(c)),
    setCustomers: vi.fn((v: Customer[]) => s.customers.set(v)),
    setContracts: vi.fn((v: Contract[]) => s.contracts.set(v)),
    setPricingLines: vi.fn((v: ContractPricingLine[]) => s.pricingLines.set(v)),
    customersLoadFailed: signal(false),
    setCustomersLoadFailed: vi.fn((v: boolean) => s.customersLoadFailed.set(v)),
  };
  return s;
}
type AppStateStub = ReturnType<typeof makeAppState>;

interface Harness {
  activity: SelectedProducerActivityFake;
  /** The selected producer's production: the Producers module's, which the page tells who is selected. */
  production: SelectedProducerProductionFake;
  /** The selected producer's notes and the user's follow-ups: the Engagement module's, which the page tells who is
   *  selected. */
  engagement: SelectedProducerEngagementFake;
  /** The producers linked from outside the trade units, which the page's walk fetches. */
  linked: LinkedProducersStore;
  fixture: ComponentFixture<HomeComponent>;
  c: HomeComponent;
  api: ApiStub;
  app: AppStateStub;
  toast: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  router: { navigate: ReturnType<typeof vi.fn> };
  access: PermissionStub;
  /** Every producer's details, as the page reads and updates them. */
  profiles: ProducerProfilesFake;
  /** Runs change detection so the component's effects (TU change, team lists) observe signal writes. */
  flush(): void;
}

interface SetupOptions {
  customers?: Customer[];
  queryParams?: Params;
  /** Mutate the API/NLQ stubs before the component is constructed (constructor loads fire immediately). */
  arrange?: (api: ApiStub, app: AppStateStub) => void;
}

const A = customer(1);
const B = customer(2);
const C = customer(3);

function setup(opts: SetupOptions = {}): Harness {
  const api = makeApi();
  // Every producer's details, read through the API stub and kept, as the Producers module's store does.
  const profiles = producerProfilesFake();
  profiles.load.mockImplementation(() => api.getAllProducerDetails().pipe(tap(list => profiles.set(list ?? []))));
  liveProfiles = profiles;
  const app = makeAppState();
  const roster = opts.customers ?? [A, B, C];
  api.getCustomers.mockReturnValue(of(roster));
  // What the server holds: the roster's saved details, and a producer's own when it is read on its own.
  api.getAllProducerDetails.mockImplementation(() => of([...profilesOf(roster).values()]));
  api.getProducerDetails.mockImplementation((id: number) => of(profiles.profileOf(id) ?? details(id)));
  opts.arrange?.(api, app);

  const toast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
  const router = { navigate: vi.fn() };
  const access = permissionStub([]);
  // The selected producer's contracts, tickets and pricing lines are the Contracts module's; the page tells it who is
  // selected and reads them back.
  const activity = selectedProducerActivityFake();
  const production = selectedProducerProductionFake();
  const engagement = selectedProducerEngagementFake();

  TestBed.configureTestingModule({
    providers: [
      provideSelectedProducerActivity(activity),
      provideSelectedProducerProduction(production),
      provideSelectedProducerEngagement(engagement),
      { provide: CustomersApiService, useExisting: ApiService },
      { provide: ApiService, useValue: api },
      { provide: CustomerStore, useExisting: AppStateService },
      { provide: AppStateService, useValue: app },
      { provide: TradeUnitContext, useValue: app },
      { provide: ToastService, useValue: toast },
      { provide: UsageTrackingService, useValue: { trackProfileOpened: vi.fn() } },
      providePermissions(access),
      provideProducerProfiles(profiles),
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
    fixture, c: fixture.componentInstance, api, app, toast, router, access, profiles, activity, production, engagement,
    linked: TestBed.inject(LinkedProducersStore),
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
    it('tells the Contracts, Producers and Engagement modules who is selected', () => {
      const h = setup();

      h.c.handleSelectCustomer(A);

      expect(h.c.selectedCustomer()?.id).toBe(1);
      expect(h.app.selectCustomer).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
      expect(h.activity.select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1 }));
      // Their planting from what was read before, on the newest crop year: no deep link asked for one.
      expect(h.production.select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1 }), { plantingYear: null });
      // Their notes and their linked group's, and the user's follow-ups for them.
      expect(h.engagement.select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1 }));
    });

    it("a linked producer's selection reads their planting again", () => {
      const h = setup();

      h.c.handleSelectCustomer(A);
      h.c.handleSelectLinkedCustomer(2);

      expect(h.c.selectedCustomer()?.id).toBe(2);
      expect(h.production.select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2 }), { plantingYear: null, reread: true });
      expect(h.engagement.select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2 }));
    });

    it('applies deep-link context from the query string and keeps it, while a manual click resets it', () => {
      const h = setup({ queryParams: { customerId: '2', contractId: '55', tab: 'tickets', ticketCrop: 'CORN', year: '2027' } });

      expect(h.c.selectedCustomer()?.id).toBe(2);
      expect(h.c.pendingContractId()).toBe(55);
      expect(h.c.pendingTab()).toBe('tickets');
      expect(h.c.pendingTicketCrop()).toBe('CORN');
      expect(h.c.pendingPlantingYear()).toBe(2027);
      expect(h.production.select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2 }), { plantingYear: 2027 });

      h.c.handleSelectCustomer(A);

      expect(h.c.pendingContractId()).toBeNull();
      expect(h.c.pendingTab()).toBeNull();
      expect(h.c.pendingTicketCrop()).toBeNull();
    });

    it('clearing the selection empties it in the page, the shared state and the URL', () => {
      const h = setup();
      h.c.handleSelectCustomer(A);

      h.c.handleClearSelection();

      expect(h.c.selectedCustomer()).toBeNull();
      expect(h.app.selectedCustomer()).toBeNull();
      expect(h.activity.select).toHaveBeenLastCalledWith(null);
      expect(h.production.select).toHaveBeenLastCalledWith(null);
      expect(h.engagement.select).toHaveBeenLastCalledWith(null);
      expect(h.router.navigate).toHaveBeenCalledWith([], { queryParams: {}, replaceUrl: true });
    });

    // The page is built again on every visit; the producer picked before is still selected.
    it('coming back to the page re-selects the producer, reading their planting again', () => {
      const h = setup({
        arrange: (_api, app) => {
          app.customers.set([A, B]);
          app.selectedCustomer.set(A);
        },
      });

      expect(h.c.selectedCustomer()?.id).toBe(1);
      expect(h.activity.select).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
      expect(h.production.select).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), { reread: true });
      expect(h.engagement.select).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
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

    // Each module forgets its own reads of the producers on a trade-unit change.
    it('drops the selection for the Contracts, Producers and Engagement modules too', () => {
      const h = setup();
      h.c.handleSelectCustomer(A);

      h.app.selectedTradeUnits.set(['TU1', 'TU2']);
      h.flush();

      expect(h.activity.select).toHaveBeenLastCalledWith(null);
      expect(h.production.select).toHaveBeenLastCalledWith(null);
      expect(h.engagement.select).toHaveBeenLastCalledWith(null);
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

    // The list's last-contacted badges read the summary, which covers every trade unit, themselves.
    it('with no trade unit selected, reads no customers', () => {
      const h = setup();
      const customerCalls = h.api.getCustomers.mock.calls.length;

      h.app.selectedTradeUnits.set([]);
      h.flush();

      expect(h.api.getCustomers.mock.calls.length).toBe(customerCalls);
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

      expect(h.linked.crossTradeUnitCustomers().map(x => x.id).sort()).toEqual([90, 91, 92]);
      expect(h.c.getLinkedGroup(a).map(x => x.id).sort()).toEqual([90, 91, 92]);

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
        },
      });
      h.c.handleSelectCustomer(a);

      h.c.handleSelectLinkedCustomer(90);

      expect(h.api.getCustomerById).toHaveBeenCalledWith(90);
      expect(h.c.selectedCustomer()?.id).toBe(90);
      expect(h.activity.select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 90 }));
      expect(h.engagement.select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 90 }));
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

  // ── Background-failure toast throttle ────────────────────────────────────
  describe('background-failure toast throttle', () => {
    it('one transient failure produces exactly one toast naming what failed', () => {
      const h = setup({ arrange: api => api.getAllProducerDetails.mockReturnValue(throwError(() => httpError(500))) });

      expect(h.toast.error).toHaveBeenCalledTimes(1);
      expect(h.toast.error.mock.calls[0][0]).toContain('load producer details');
    });

    it('several sources failing at once produce a single toast', () => {
      const fail = () => throwError(() => httpError(503));
      const h = setup({
        arrange: api => {
          api.getAllProducerDetails.mockReturnValue(fail());
          api.getProducerDetails.mockReturnValue(fail());
        },
      });
      h.c.handleSelectCustomer(A);

      // Two distinct sources reported (all logged in dev)...
      const reported = new Set(vi.mocked(console.error).mock.calls.map(args => String(args[0])));
      expect(reported.size).toBe(2);
      // ...but the user is told once.
      expect(h.toast.error).toHaveBeenCalledTimes(1);
    });

    it('the same source stays quiet for five minutes after it has spoken', () => {
      const h = setup({
        arrange: api => api.getProducerDetails.mockReturnValue(throwError(() => httpError(500))),
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
          api.getProducerDetails.mockReturnValue(throwError(() => httpError(500)));
          // A linked producer from another trade unit.
          api.getCustomerById.mockReturnValue(throwError(() => httpError(500)));
        },
      });

      // Producer details fail on the click and speak.
      h.c.handleSelectCustomer(A);
      expect(h.toast.error).toHaveBeenCalledTimes(1);
      expect(h.toast.error.mock.calls[0][0]).toContain('refresh producer details');

      vi.advanceTimersByTime(30_000);
      h.c.handleSelectLinkedCustomer(90); // inside 60s: the linked producer's failure is held back
      expect(h.toast.error).toHaveBeenCalledTimes(1);

      // Past 60s: the held-back source was never marked as having spoken, so it may speak now,
      // while producer details is still inside its own five minutes.
      vi.advanceTimersByTime(31_000);
      h.c.handleSelectLinkedCustomer(91);
      expect(h.toast.error).toHaveBeenCalledTimes(2);
      expect(h.toast.error.mock.calls[1][0]).toContain('load the selected producer');
    });
  });

  // ── CTRM read-ahead: hover prefetch + click convergence ──────────────────
  // The prefetch, its cap and the convergence re-read are the Contracts module's (CustomerActivityStore spec).
  describe('CTRM read-ahead', () => {
    it('hands the hover prefetch to the Contracts module', () => {
      const h = setup();

      h.c.handlePrefetchCustomer(B);

      expect(h.activity.prefetch).toHaveBeenCalledWith(B);
      expect(h.c.selectedCustomer()).toBeNull();
    });
  });

  // ── API failures leave the page sane ─────────────────────────────────────
  describe('API failures', () => {
    it("shows the selected producer's contracts, tickets and pricing as the Contracts module reads them", () => {
      const h = setup();
      h.c.handleSelectCustomer(A);

      h.activity.contracts.set([contract(10, 'S-1')]);
      h.activity.tickets.set([ticket(20, 'S-1')]);
      h.activity.contractsLoadError.set('CTRM is down.');

      expect(h.c.customerContracts().map(x => x.id)).toEqual([10]);
      expect(h.c.customerTickets().map(x => x.id)).toEqual([20]);
      expect(h.c.contractsLoadError()).toBe('CTRM is down.');
    });

    it('a failed customer roster load stops the spinner and leaves selection usable', () => {
      const h = setup({ arrange: api => api.getCustomers.mockReturnValue(throwError(() => httpError(500))) });

      expect(h.c.loading()).toBe(false);
      expect(h.c.customers()).toEqual([]);

      h.c.handleSelectCustomer(A);
      expect(h.c.selectedCustomer()?.id).toBe(1);
    });
  });

  // ── Planting intentions: the Producers module's, which a trade-unit save asks to move ──
  describe('planting intentions', () => {
    const save = (over: Record<string, unknown>) => ({
      customerId: 1, acres: 0, commodities: [], primaryContact: '', primaryPhone: '', contacts: [], binSites: [],
      linkedProducerIds: [], removedIncomingIds: [], eSignEnabled: false, tradeUnitCodes: ['TU2'], reconcileTradeUnits: true,
      grainOnFarm: [], intentionMoves: [{ from: 'TU1', to: 'TU2' }], ...over,
    });

    it("a trade-unit save moves the producer's intentions off a removed trade unit, once the trade units are saved", () => {
      const h = setup();
      const assign = vi.fn((id: number, _codes: string[]): Observable<Customer> => of(customer(id)));
      Object.assign(h.api, { assignTradeUnits: assign });
      h.c.handleSelectCustomer(A);

      h.c.handleSaveCustomer(save({}));

      // Third argument: the producer code, sent only for an onboarding candidate (plan E4); an
      // existing producer's save carries none.
      expect(assign).toHaveBeenCalledWith(1, ['TU2'], undefined);
      expect(h.production.movePlantingIntentions).toHaveBeenCalledWith(1, [{ from: 'TU1', to: 'TU2' }]);
    });

    it('a details-only save moves them too', () => {
      const h = setup();
      h.c.handleSelectCustomer(A);

      h.c.handleSaveCustomer(save({ tradeUnitCodes: [], reconcileTradeUnits: false }));

      expect(h.production.movePlantingIntentions).toHaveBeenCalledWith(1, [{ from: 'TU1', to: 'TU2' }]);
    });
  });

  // ── Linked producers, more (characterisation, written against the pre-extraction page) ──
  describe('linked producers (cache lifetime and enrichment)', () => {
    const a = customer(1, { linkedProducerIds: ['S-90'] });
    const arrangeLinks = (api: ApiStub) => {
      api.getCustomerBySourceId.mockImplementation(src => of(src === 'S-90' ? customer(90) : null));
      api.getCustomersLinkedTo.mockReturnValue(of([]));
    };

    // Its details are ProducerProfiles', where every piece of the screen reads them.
    it('keeps a linked producer fetched from another trade unit as the API gives it', () => {
      const h = setup({ customers: [a, B], arrange: arrangeLinks });
      h.c.handleSelectCustomer(a);
      expect(h.linked.crossTradeUnitCustomers().find(x => x.id === 90)).toEqual(customer(90));
    });

    it('makes no linked-producer calls for a producer with no scoularId and no links', () => {
      const lone = customer(5, { scoularId: undefined });
      const h = setup({ customers: [lone, B] });
      h.c.handleSelectCustomer(lone);
      expect(h.api.getCustomersLinkedTo).not.toHaveBeenCalled();
      expect(h.api.getCustomerBySourceId).not.toHaveBeenCalled();
    });

    it('a trade-unit change empties the cross-trade-unit cache and the next visit walks again', () => {
      const h = setup({ customers: [a, B], arrange: arrangeLinks });
      h.c.handleSelectCustomer(a);
      expect(h.linked.crossTradeUnitCustomers().map(x => x.id)).toEqual([90]);
      const walks = h.api.getCustomersLinkedTo.mock.calls.filter(args => args[0] === 'S-1').length;

      h.api.getCustomers.mockReturnValue(of([a, B]));
      h.app.selectedTradeUnits.set(['TU2']);
      h.flush();
      expect(h.linked.crossTradeUnitCustomers()).toEqual([]);

      h.c.handleSelectCustomer(a);
      expect(h.api.getCustomersLinkedTo.mock.calls.filter(args => args[0] === 'S-1').length).toBe(walks + 1);
    });

    it('saving a producer\'s links makes the next visit walk the graph again', () => {
      const h = setup({ customers: [a, B], arrange: arrangeLinks });
      h.c.handleSelectCustomer(a);
      h.c.handleSelectCustomer(B);
      const walks = h.api.getCustomersLinkedTo.mock.calls.filter(args => args[0] === 'S-1').length;

      h.c.handleSaveCustomer({
        customerId: 2, acres: 0, commodities: [], primaryContact: '', primaryPhone: '', contacts: [], binSites: [],
        linkedProducerIds: [], removedIncomingIds: [], eSignEnabled: false, tradeUnitCodes: [], reconcileTradeUnits: false,
        grainOnFarm: [],
      });
      h.c.handleSelectCustomer(a);

      expect(h.api.getCustomersLinkedTo.mock.calls.filter(args => args[0] === 'S-1').length).toBe(walks + 1);
    });
  });

  // These reads used to fail silently into an empty list; the shared flags are what the producer
  // list and Build-a-List read to say "couldn't load" instead of "none".
  describe('trade-unit read failures', () => {
    const fail = () => throwError(() => new Error('500'));

    it('records a failed producer read, and clears it when the read succeeds', () => {
      const failed = setup({ arrange: api => api.getCustomers.mockReturnValue(fail()) });
      expect(failed.app.customersLoadFailed()).toBe(true);
      TestBed.resetTestingModule();

      const ok = setup();
      expect(ok.app.setCustomersLoadFailed).toHaveBeenCalledWith(false);
      expect(ok.app.customersLoadFailed()).toBe(false);
    });

  });
});

// A slow trade-unit save used to look like a dead one: the dialog closes at once and nothing on screen
// changed, so the rep saved again - four saves of one onboarding in PROD on 2026-10-28.
describe('HomeComponent — a trade-unit save still in flight', () => {
  afterEach(() => vi.useRealTimers());

  const save = (customerId: number) => ({
    customerId, acres: 0, commodities: [], primaryContact: '', primaryPhone: '', contacts: [], binSites: [],
    linkedProducerIds: [], removedIncomingIds: [], eSignEnabled: false, tradeUnitCodes: ['1340'],
    reconcileTradeUnits: true, grainOnFarm: [],
  });

  it('marks the producer as saving until the save ends, and says it is still working when it runs long', () => {
    vi.useFakeTimers();
    const h = setup();
    const pending = new Subject<Customer>();
    Object.assign(h.api, { assignTradeUnits: vi.fn((_id: number, _codes: string[], _code?: string): Observable<Customer> => pending) });
    h.c.handleSelectCustomer(A);
    expect(h.c.isSavingTradeUnits()).toBe(false);

    h.c.handleSaveCustomer(save(1));
    expect(h.c.isSavingTradeUnits()).toBe(true);
    vi.advanceTimersByTime(HomeComponent.SLOW_TRADE_UNIT_SAVE_MS - 1);
    expect(h.toast.info).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.toast.info).toHaveBeenCalledWith(expect.stringContaining('Still saving trade units'), 8000);

    pending.next(customer(1));
    pending.complete();
    expect(h.c.isSavingTradeUnits()).toBe(false);
  });

  it('clears the flag on failure, and a quick answer never shows the slow notice', () => {
    vi.useFakeTimers();
    const h = setup();
    Object.assign(h.api, { assignTradeUnits: vi.fn((): Observable<Customer> => throwError(() => new Error('500'))) });
    h.c.handleSelectCustomer(A);

    h.c.handleSaveCustomer(save(1));

    expect(h.c.isSavingTradeUnits()).toBe(false);
    expect(h.toast.error).toHaveBeenCalledWith('Failed to update trade units');
    vi.advanceTimersByTime(HomeComponent.SLOW_TRADE_UNIT_SAVE_MS * 2);
    expect(h.toast.info).not.toHaveBeenCalled();
  });

  it('only the producer being saved shows as saving', () => {
    const h = setup();
    Object.assign(h.api, { assignTradeUnits: vi.fn((): Observable<Customer> => NEVER) });
    h.c.handleSelectCustomer(A);
    h.c.handleSaveCustomer(save(1));

    h.c.handleSelectCustomer(B);
    expect(h.c.isSavingTradeUnits()).toBe(false);
    h.c.handleSelectCustomer(A);
    expect(h.c.isSavingTradeUnits()).toBe(true);
  });

  // The Edit Producer Details dialog is Producers'; it saves through the page as ProducerEditing.
  it('is what the Edit dialog saves through: its producers, trade units, this flag and this save', () => {
    const h = setup();
    const editing = h.fixture.debugElement.injector.get(ProducerEditing);
    const handle = vi.spyOn(h.c, 'handleSaveCustomer').mockImplementation(() => undefined);

    expect(editing.producers).toBe(h.c.customers);
    expect(editing.producersTradeUnits).toBe(h.c.selectedTradeUnits);
    expect(editing.saving).toBe(h.c.isSavingTradeUnits);
    const edit = save(1);
    editing.save(edit);
    expect(handle).toHaveBeenCalledWith(edit);
  });

  it('a details-only save is not a trade-unit save', () => {
    const h = setup();
    const assign = vi.fn((): Observable<Customer> => NEVER);
    Object.assign(h.api, { assignTradeUnits: assign });
    h.c.handleSelectCustomer(A);

    h.c.handleSaveCustomer({ ...save(1), reconcileTradeUnits: false });

    expect(assign).not.toHaveBeenCalled();
    expect(h.c.isSavingTradeUnits()).toBe(false);
  });

  // The Producers panels read the producer's details from ProducerProfiles, not the page's copy of the producer.
  it("shows an edit wherever the producer's details are read while its save is still running", () => {
    const h = setup();
    Object.assign(h.api, { saveProducerDetails: vi.fn(() => NEVER) });
    h.profiles.set([details(1, { totalAcres: 100, linkedProducerIds: 'S-2' })]);
    h.c.handleSelectCustomer(A);

    h.c.handleSaveCustomer({ ...save(1), acres: 640, commodities: ['YC'], reconcileTradeUnits: false });

    expect(h.profiles.profileOf(1)).toMatchObject({ totalAcres: 640, commodities: 'YC', linkedProducerIds: undefined });
  });

  it('gives a producer with no saved details theirs on the first edit, without waiting for the save', () => {
    const h = setup();
    // Neither the read on selection nor the save answers.
    Object.assign(h.api, { getProducerDetails: vi.fn(() => NEVER), saveProducerDetails: vi.fn(() => NEVER) });
    h.c.handleSelectCustomer(A);
    expect(h.profiles.profileOf(1)).toBeUndefined();

    h.c.handleSaveCustomer({ ...save(1), acres: 640, reconcileTradeUnits: false });

    expect(h.profiles.profileOf(1)).toMatchObject({ customerId: 1, customerName: A.name, totalAcres: 640 });
  });
});

// A producer's commodities and links are their saved details, read and saved through ProducerProfiles.
describe("HomeComponent — the producer's saved details", () => {
  const edit = (customerId: number) => ({
    customerId, acres: 0, commodities: [], primaryContact: '', primaryPhone: '', contacts: [], binSites: [],
    linkedProducerIds: [], removedIncomingIds: [], eSignEnabled: false, tradeUnitCodes: [],
    reconcileTradeUnits: false, grainOnFarm: [],
  });

  // The notes card refuses a note for a customer not added yet; after the save it must see the customer as they now are.
  it('tells Engagement the producer as they are after a save', () => {
    const h = setup();
    h.c.handleSelectCustomer(A);

    h.c.handleSaveCustomer({ ...edit(1), eSignEnabled: true });

    expect(h.engagement.select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1, eSignEnabled: true }));
  });

  it("removing an incoming link saves the other producer's links, from their saved details, without this one", () => {
    const b = customer(2, { linkedProducerIds: ['S-1', 'S-3'] });
    const h = setup({ customers: [A, b] });
    h.c.handleSelectCustomer(A);

    h.c.handleSaveCustomer({ ...edit(1), removedIncomingIds: ['S-2'] });

    expect(h.api.saveProducerDetails).toHaveBeenCalledWith(2, expect.objectContaining({ linkedProducerIds: 'S-3' }));
    expect(h.profiles.profileOf(2)?.linkedProducerIds).toBe('S-3');
  });

  // The selection's first walk is still out, so it isn't marked done yet.
  it('walks the links that arrive with the selected producer\'s details after they were picked', () => {
    const details$ = new Subject<ProducerDetails>();
    const h = setup({
      arrange: api => {
        api.getProducerDetails.mockReturnValue(details$);
        api.getCustomersLinkedTo.mockReturnValue(NEVER);
        api.getCustomerBySourceId.mockImplementation(src => of(src === 'S-90' ? customer(90) : null));
      },
    });
    h.c.handleSelectCustomer(A);
    expect(h.api.getCustomerBySourceId).not.toHaveBeenCalled();

    details$.next(details(1, { linkedProducerIds: 'S-90' }));

    expect(h.api.getCustomerBySourceId).toHaveBeenCalledWith('S-90');
  });
});
