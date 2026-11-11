import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Contract, Ticket } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { ContractStore } from './contract.store';

describe('ContractStore', () => {
  let store: ContractStore;

  beforeEach(() => {
    localStorage.clear();
    store = TestBed.inject(ContractStore);
  });

  it('starts empty, loading nothing and with nothing failed', () => {
    expect(store.contracts()).toEqual([]);
    expect(store.todaysTickets()).toEqual([]);
    expect(store.ticketsLoaded()).toBe(false);
    expect(store.contractsLoading()).toBe(false);
    expect(store.contractsLoadFailed()).toBe(false);
    expect(store.ticketsLoadFailed()).toBe(false);
    expect(store.sourceLoadPending()).toBe(false);
  });

  it("keeps the trade unit's ticket set with the selection it was read for, until it is dropped", () => {
    TestBed.inject(TradeUnitContext).setTradeUnits(['1085', '2190']);
    store.setTickets([{ id: 1 } as Ticket]);
    expect(store.ticketsLoaded()).toBe(true);
    expect(store.ticketsTradeUnitKey()).toBe('1085,2190');

    store.clearTicketsCache();

    expect(store.tickets()).toEqual([]);
    expect(store.ticketsLoaded()).toBe(false);
    expect(store.ticketsTradeUnitKey()).toBeNull();
  });

  // A timed-out read is cleared by the next one that answers, not by a new load starting.
  it('clears the failures for a new load, but not a read still pending', () => {
    store.setContractsLoadFailed(true);
    store.setTicketsLoadFailed(true);
    store.setSourceLoadPending(true);

    store.clearLoadFailures();

    expect(store.contractsLoadFailed()).toBe(false);
    expect(store.ticketsLoadFailed()).toBe(false);
    expect(store.sourceLoadPending()).toBe(true);
  });

  it('drops everything when the session ends', () => {
    store.setContracts([{ id: 1 } as Contract]);
    store.setTodaysTickets([{ id: 2 } as Ticket]);
    store.setTickets([{ id: 3 } as Ticket]);
    store.setContractsLoading(true);
    store.setContractsLoadFailed(true);
    store.setSourceLoadPending(true);

    TestBed.inject(SessionReset).reset();

    expect(store.contracts()).toEqual([]);
    expect(store.todaysTickets()).toEqual([]);
    expect(store.ticketsLoaded()).toBe(false);
    expect(store.contractsLoading()).toBe(false);
    expect(store.contractsLoadFailed()).toBe(false);
    expect(store.sourceLoadPending()).toBe(false);
  });

  it('exposes its state read-only', () => {
    const neverCalled = () => {
      // @ts-expect-error contracts is read-only
      store.contracts.set([]);
      // @ts-expect-error contractsLoadFailed is read-only
      store.contractsLoadFailed.set(true);
    };
    expect(typeof neverCalled).toBe('function');
  });
});
