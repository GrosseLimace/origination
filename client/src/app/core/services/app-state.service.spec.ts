import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, effect, isSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateService } from './app-state.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { SessionReset } from '@core/auth/session-reset.service';
import { Customer } from '@models';

const mockCustomer: Customer = {
  id: 1,
  name: 'Test Farm',
  farm: 'Test Farm LLC',
  location: 'Omaha, NE',
  phone: '402-555-0100',
  email: 'test@farm.com',
  totalAcres: 500,
  linkedProducerIds: [],
  eSignEnabled: false,
};

describe('AppStateService', () => {
  let service: AppStateService;
  let context: TradeUnitContext;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AppStateService);
    context = TestBed.inject(TradeUnitContext);
  });

  it('initialises with default signal values', () => {
    expect(service.selectedCustomer()).toBeNull();
    expect(service.searchQuery()).toBe('');
    expect(service.contracts()).toEqual([]);
  });

  it('selectCustomer() stores the selected customer', () => {
    service.selectCustomer(mockCustomer);
    expect(service.selectedCustomer()).toEqual(mockCustomer);
  });

  it('selectCustomer(null) clears the selection', () => {
    service.selectCustomer(mockCustomer);
    service.selectCustomer(null);
    expect(service.selectedCustomer()).toBeNull();
  });

  it('setSearchQuery() updates the searchQuery signal', () => {
    service.setSearchQuery('grain');
    expect(service.searchQuery()).toBe('grain');
  });

  it('setContracts() updates the data cache signal', () => {
    service.setContracts([{ id: 7 } as never]);
    expect(service.contracts()).toHaveLength(1);
    expect(service.contracts()[0].id).toBe(7);
  });

  it('clearAll() resets all state to defaults, the trade-unit selection included', () => {
    service.selectCustomer(mockCustomer);
    context.setTradeUnits(['TU1']);
    service.setSearchQuery('test');
    service.setContracts([{ id: 7 } as never]);
    service.clearAll();
    expect(service.selectedCustomer()).toBeNull();
    expect(context.selectedTradeUnits()).toEqual([]);
    expect(service.searchQuery()).toBe('');
    expect(service.contracts()).toEqual([]);
  });

  it('clearAll() also clears every module store registered with SessionReset', () => {
    const clearStore = vi.fn();
    TestBed.inject(SessionReset).onReset(clearStore);

    service.clearAll();

    expect(clearStore).toHaveBeenCalledTimes(1);
  });

  describe('read-only public surface', () => {
    /** Every signal the service exposes, by property name. */
    function publicSignals(): [string, unknown][] {
      return Object.entries(service).filter(([name, value]) => !name.startsWith('_') && isSignal(value));
    }

    it('exposes its state as signals', () => {
      // Guards the check below against passing vacuously if the surface stopped being found. (35 since the producers'
      // details moved to the Producers module's ProducerProfileStore.)
      expect(publicSignals().length).toBeGreaterThanOrEqual(35);
    });

    it('offers no .set or .update on any public signal — writes go through the service\'s methods', () => {
      const writable = publicSignals()
        .filter(([, value]) => 'set' in (value as object) || 'update' in (value as object))
        .map(([name]) => name);

      expect(writable).toEqual([]);
    });

    it('rejects a direct write at compile time', () => {
      // Never runs; `tsc -p tsconfig.spec.json` fails if any of these lines starts compiling again.
      const neverCalled = () => {
        // @ts-expect-error contracts is read-only
        service.contracts.set([]);
        // @ts-expect-error searchQuery is read-only
        service.searchQuery.update(q => q);
        // @ts-expect-error contractsLoadFailed is read-only
        service.contractsLoadFailed.set(true);
      };
      expect(typeof neverCalled).toBe('function');
    });

    it('still drives computeds and effects through the read-only view', () => {
      const state = TestBed.inject(AppStateService);
      const count = computed(() => state.contracts().length);
      const seen: string[] = [];
      TestBed.runInInjectionContext(() => effect(() => { seen.push(state.searchQuery()); }));
      TestBed.tick();

      state.setContracts([{ id: 7 } as never]);
      state.setSearchQuery('2040');
      TestBed.tick();

      expect(count()).toBe(1);
      expect(seen).toEqual(['', '2040']);
      // Same signal every read, so toObservable / effect subscriptions stay attached.
      expect(state.contracts).toBe(state.contracts);
    });

    it('the new setters write what they are given', () => {
      service.setContractsLoading(true);
      service.setTodaysTicketsLoading(true);
      service.setCommodityConversions([{ commodityCode: 'YC', lbsPerUnit: 56 }]);
      service.setHarvestWindows([{ commodityCode: 'YC' } as never]);
      service.setQueryLibrary([{ queryText: 'q' } as never]);

      expect(service.contractsLoading()).toBe(true);
      expect(service.todaysTicketsLoading()).toBe(true);
      expect(service.commodityConversions()).toEqual([{ commodityCode: 'YC', lbsPerUnit: 56 }]);
      expect(service.harvestWindows()).toEqual([{ commodityCode: 'YC' }]);
      expect(service.queryLibrary()).toEqual([{ queryText: 'q' }]);
    });

    it('clearLoadFailures resets both trade-unit failure flags', () => {
      service.setContractsLoadFailed(true);
      service.setTicketsLoadFailed(true);
      service.clearLoadFailures();

      expect(service.contractsLoadFailed()).toBe(false);
      expect(service.ticketsLoadFailed()).toBe(false);
    });
  });

});
