import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, Subject, of, throwError } from 'rxjs';
import { Contract, ContractPricingLine, Customer, Ticket } from '@models';
import { environment } from '@env/environment';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { ContractStore } from './contract.store';
import { ContractsApiService } from './contracts-api.service';
import { CustomerActivityStore } from './customer-activity.store';

const NOW = new Date('2026-10-13T12:00:00');

const customer = (id: number): Customer =>
  ({ id, scoularId: `S-${id}`, name: `Producer ${id}`, location: '', phone: '', email: '', eSignEnabled: false, achEnabled: false });
const contract = (id: number, code: string, over: Partial<Contract> = {}) =>
  ({ id, ctrmCustomerId: code, contractNumber: `P${id}`, status: 'Active', ...over }) as Contract;
const ticket = (id: number, code: string, over: Partial<Ticket> = {}) =>
  ({ id, customerCode: code, ticketNumber: `${id}`, isApplied: false, ...over }) as Ticket;
const httpError = (status: number, error: unknown = null) => ({ status, error });

const A = customer(1);
const B = customer(2);
const C = customer(3);

/**
 * The selected producer's contracts, tickets and pricing lines (SelectedProducerActivity): what a selection reads, how
 * long it is kept, the hover prefetch and the convergence re-read, and failures and retries. Formerly the home page's
 * HomeProducerActivityStore, whose spec these come from.
 */
describe('CustomerActivityStore', () => {
  let api: {
    getContractsByCustomer: ReturnType<typeof vi.fn<(id: number, code?: string) => Observable<Contract[]>>>;
    getTicketsByCustomer: ReturnType<typeof vi.fn<(id: number, code?: string) => Observable<Ticket[]>>>;
    getPricingLinesByCustomer: ReturnType<typeof vi.fn<(code: string) => Observable<ContractPricingLine[]>>>;
  };
  let store: CustomerActivityStore;
  let contracts: ContractStore;
  const readAhead = environment.ctrmReadAheadEnabled;

  /** How many times the call was made for producer `id`. */
  const callsFor = (fn: { mock: { calls: unknown[][] } }, id: number) => fn.mock.calls.filter(args => args[0] === id).length;
  const ids = (rows: { id: number }[]) => rows.map(row => row.id);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
    environment.ctrmReadAheadEnabled = false;
    api = {
      getContractsByCustomer: vi.fn(() => of<Contract[]>([])),
      getTicketsByCustomer: vi.fn(() => of<Ticket[]>([])),
      getPricingLinesByCustomer: vi.fn(() => of<ContractPricingLine[]>([])),
    };
    TestBed.configureTestingModule({ providers: [{ provide: ContractsApiService, useValue: api }] });
    store = TestBed.inject(CustomerActivityStore);
    contracts = TestBed.inject(ContractStore);
    TestBed.tick();
  });

  afterEach(() => {
    environment.ctrmReadAheadEnabled = readAhead;
    vi.useRealTimers();
  });

  describe('a selection', () => {
    it("reads the producer's contracts, tickets and pricing lines", () => {
      api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1'), contract(11, 'S-1')]));
      api.getTicketsByCustomer.mockReturnValue(of([ticket(20, 'S-1')]));
      api.getPricingLinesByCustomer.mockReturnValue(of([{ sourceContractId: 'P10' } as unknown as ContractPricingLine]));

      store.select(A);

      expect(api.getContractsByCustomer).toHaveBeenCalledWith(1, 'S-1');
      expect(ids(store.contracts())).toEqual([10, 11]);
      expect(ids(store.tickets())).toEqual([20]);
      expect(store.pricingLines()).toHaveLength(1);
      expect(store.isLoadingContracts()).toBe(false);
      expect(store.isLoadingTickets()).toBe(false);
      expect(store.isLoadingPricingLines()).toBe(false);
    });

    // Lists' screens and saved lists read them there.
    it("merges the producer's live contracts into the trade units' contracts", () => {
      contracts.setContracts([contract(5, 'S-9')]);
      api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1')]));

      store.select(A);

      expect(ids(contracts.contracts()).sort((a, b) => a - b)).toEqual([5, 10]);
    });

    it("includes a split-load ticket carrying another producer's code when it is applied to this producer's contract", () => {
      api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1', { sourceContractId: 'P10' })]));
      api.getTicketsByCustomer.mockReturnValue(of([
        ticket(20, 'S-1'),
        ticket(21, 'S-OTHER', { ctrmContractNumber: 'P10', isApplied: true }),
        ticket(22, 'S-OTHER', { ctrmContractNumber: 'P99', isApplied: true }),
      ]));

      store.select(A);

      expect(ids(store.tickets()).sort()).toEqual([20, 21]);
    });

    it('shows nothing, and loads nothing, with no producer selected', () => {
      api.getContractsByCustomer.mockReturnValue(NEVER);
      store.select(A);
      expect(store.isLoadingContracts()).toBe(true);

      store.select(null);

      expect(store.contracts()).toEqual([]);
      expect(store.isLoadingContracts()).toBe(false);
      expect(store.isLoadingTickets()).toBe(false);
    });

    it('serves a re-selection inside 60s from memory, then refreshes behind the rows once the copy has aged out', () => {
      api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1')]));

      store.select(A);
      store.select(B);
      store.select(A);
      expect(callsFor(api.getContractsByCustomer, 1)).toBe(1);
      expect(ids(store.contracts())).toEqual([10]);
      expect(store.isLoadingContracts()).toBe(false);

      vi.advanceTimersByTime(61_000);
      store.select(B);
      store.select(A);
      expect(callsFor(api.getContractsByCustomer, 1)).toBe(2);
    });

    it('cancels the reads still running for a producer selected before', () => {
      const late = new Subject<Contract[]>();
      api.getContractsByCustomer.mockImplementation(id => id === 1 ? late : of([contract(30, 'S-2')]));
      store.select(A);
      store.select(B);

      late.next([contract(10, 'S-1')]);

      expect(ids(store.contracts())).toEqual([30]);
      expect(ids(contracts.contracts())).toEqual([30]);
      expect(store.isLoadingContracts()).toBe(false);
    });

    it('reads a producer again after the trade units change, for the new scope', () => {
      store.select(A);
      expect(callsFor(api.getContractsByCustomer, 1)).toBe(1);

      TestBed.inject(TradeUnitContext).setTradeUnits(['TU1', 'TU2']);
      TestBed.tick();
      store.select(A);

      expect(callsFor(api.getContractsByCustomer, 1)).toBe(2);
    });
  });

  describe('CTRM read-ahead', () => {
    it('hover prefetch does nothing when read-ahead is disabled', () => {
      store.prefetch(B);

      expect(api.getContractsByCustomer).not.toHaveBeenCalled();
      expect(api.getTicketsByCustomer).not.toHaveBeenCalled();
      expect(api.getPricingLinesByCustomer).not.toHaveBeenCalled();
    });

    it('caps hover prefetch at two producers in flight and does not duplicate one already in flight', () => {
      environment.ctrmReadAheadEnabled = true;
      api.getContractsByCustomer.mockReturnValue(NEVER);

      store.prefetch(A);
      store.prefetch(B);
      store.prefetch(A);
      store.prefetch(C);

      expect(api.getContractsByCustomer.mock.calls.map(args => args[0])).toEqual([1, 2]);
    });

    it('a hover prefetch touches no visible state, and the selection then renders from it without a round trip', () => {
      environment.ctrmReadAheadEnabled = true;
      api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-2')]));
      api.getTicketsByCustomer.mockReturnValue(of([ticket(20, 'S-2')]));

      store.prefetch(B);
      expect(store.contracts()).toEqual([]);

      store.select(B);

      expect(api.getContractsByCustomer).toHaveBeenCalledTimes(1);
      expect(api.getTicketsByCustomer).toHaveBeenCalledTimes(1);
      expect(api.getPricingLinesByCustomer).toHaveBeenCalledTimes(1);
      expect(ids(store.contracts())).toEqual([10]);
      expect(ids(store.tickets())).toEqual([20]);
    });

    it('does not prefetch the producer already selected', () => {
      environment.ctrmReadAheadEnabled = true;
      store.select(A);
      const calls = api.getContractsByCustomer.mock.calls.length;

      store.prefetch(A);

      expect(api.getContractsByCustomer.mock.calls.length).toBe(calls);
    });

    it('re-reads 4s after a first selection and swaps in the converged rows, dropping a contract that closed', () => {
      environment.ctrmReadAheadEnabled = true;
      api.getContractsByCustomer
        .mockReturnValueOnce(of([contract(10, 'S-1'), contract(11, 'S-1')]))
        .mockReturnValueOnce(of([contract(11, 'S-1'), contract(12, 'S-1')]));

      store.select(A);
      expect(ids(store.contracts())).toEqual([10, 11]);

      vi.advanceTimersByTime(4_000);

      expect(callsFor(api.getContractsByCustomer, 1)).toBe(2);
      expect(ids(store.contracts()).sort()).toEqual([11, 12]);
    });

    it('skips the convergence re-read when read-ahead is disabled', () => {
      store.select(A);
      vi.advanceTimersByTime(5_000);

      expect(callsFor(api.getContractsByCustomer, 1)).toBe(1);
    });

    it('cancels the convergence re-read when another producer is selected first', () => {
      environment.ctrmReadAheadEnabled = true;

      store.select(A);
      vi.advanceTimersByTime(1_000);
      store.select(B);
      vi.advanceTimersByTime(4_000);

      expect(callsFor(api.getContractsByCustomer, 1)).toBe(1);
      expect(callsFor(api.getContractsByCustomer, 2)).toBe(2);
    });
  });

  describe('failures', () => {
    it("a CTRM-unavailable contract read shows the server's message and Retry recovers", () => {
      api.getContractsByCustomer.mockReturnValue(throwError(() =>
        httpError(503, { code: 'INFRASTRUCTURE_CTRM_UNAVAILABLE', message: 'CTRM is down for maintenance.' })));

      store.select(A);
      expect(store.contractsLoadError()).toBe('CTRM is down for maintenance.');
      expect(store.isLoadingContracts()).toBe(false);

      api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1')]));
      store.retryContracts();

      expect(store.contractsLoadError()).toBeNull();
      expect(store.isLoadingContracts()).toBe(false);
      expect(ids(store.contracts())).toEqual([10]);
    });

    it('a 503 ticket read names the outage, leaves contracts intact, and Retry recovers', () => {
      api.getContractsByCustomer.mockReturnValue(of([contract(10, 'S-1')]));
      api.getTicketsByCustomer.mockReturnValue(throwError(() => httpError(503)));

      store.select(A);
      expect(store.ticketsLoadError()).toBe('The data source is temporarily unavailable. Please retry shortly.');
      expect(store.isLoadingTickets()).toBe(false);
      expect(ids(store.contracts())).toEqual([10]);

      api.getTicketsByCustomer.mockReturnValue(of([ticket(20, 'S-1')]));
      store.retryTickets();

      expect(store.ticketsLoadError()).toBeNull();
      expect(ids(store.tickets())).toEqual([20]);
    });

    it('a failed pricing-line read is reported as an error, not as "no priced lines"', () => {
      api.getPricingLinesByCustomer.mockReturnValue(throwError(() => httpError(500)));

      store.select(A);

      expect(store.pricingLinesLoadError()).toBe('Something went wrong loading this data. Please retry.');
      expect(store.pricingLines()).toEqual([]);
      expect(store.isLoadingPricingLines()).toBe(false);
    });

    it('a new selection clears the last one\'s failures', () => {
      api.getContractsByCustomer.mockReturnValueOnce(throwError(() => httpError(500)));
      store.select(A);
      expect(store.contractsLoadError()).not.toBeNull();

      store.select(B);

      expect(store.contractsLoadError()).toBeNull();
    });
  });
});
