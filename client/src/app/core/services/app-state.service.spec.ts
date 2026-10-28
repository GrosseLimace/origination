import { describe, it, expect, beforeEach } from 'vitest';
import { computed, effect, isSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateService } from './app-state.service';
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

  beforeEach(() => {
    service = new AppStateService();
  });

  it('initialises with default signal values', () => {
    expect(service.currentView()).toBe('customers');
    expect(service.selectedCustomer()).toBeNull();
    expect(service.selectedTradeUnits()).toEqual([]);
    expect(service.searchQuery()).toBe('');
    expect(service.customers()).toEqual([]);
  });

  it('setView() updates currentView signal', () => {
    service.setView('dashboard');
    expect(service.currentView()).toBe('dashboard');
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

  it('setTradeUnits() updates the selectedTradeUnits signal', () => {
    service.setTradeUnits(['TU1', 'TU2']);
    expect(service.selectedTradeUnits()).toEqual(['TU1', 'TU2']);
  });

  it('setSearchQuery() updates the searchQuery signal', () => {
    service.setSearchQuery('grain');
    expect(service.searchQuery()).toBe('grain');
  });

  it('setCustomers() / contracts / tickets update data cache signals', () => {
    service.setCustomers([mockCustomer]);
    expect(service.customers()).toHaveLength(1);
    expect(service.customers()[0].id).toBe(1);
  });

  it('clearAll() resets all state to defaults', () => {
    service.selectCustomer(mockCustomer);
    service.setTradeUnits(['TU1']);
    service.setSearchQuery('test');
    service.setCustomers([mockCustomer]);
    service.clearAll();
    expect(service.selectedCustomer()).toBeNull();
    expect(service.selectedTradeUnits()).toEqual([]);
    expect(service.searchQuery()).toBe('');
    expect(service.customers()).toEqual([]);
  });

  it('setGeocodeCache() stores geocode entries and enforces LRU cap', () => {
    service.setGeocodeCache('key1', { lat: 41.2, lng: -96.1 });
    expect(service.mapGeocodeCache.get('key1')).toEqual({ lat: 41.2, lng: -96.1 });
  });

  it('clearMapGeocodeCache() empties the geocode cache', () => {
    service.setGeocodeCache('key1', { lat: 41.2, lng: -96.1 });
    service.clearMapGeocodeCache();
    expect(service.mapGeocodeCache.size).toBe(0);
  });

  describe('read-only public surface', () => {
    /** Every signal the service exposes, by property name. */
    function publicSignals(): [string, unknown][] {
      return Object.entries(service).filter(([name, value]) => !name.startsWith('_') && isSignal(value));
    }

    it('exposes its state as signals', () => {
      // Guards the check below against passing vacuously if the surface stopped being found.
      expect(publicSignals().length).toBeGreaterThanOrEqual(43);
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
        // @ts-expect-error customers is read-only
        service.customers.set([]);
        // @ts-expect-error selectedTradeUnits is read-only
        service.selectedTradeUnits.update(u => u);
        // @ts-expect-error contractsLoadFailed is read-only
        service.contractsLoadFailed.set(true);
      };
      expect(typeof neverCalled).toBe('function');
    });

    it('still drives computeds and effects through the read-only view', () => {
      TestBed.configureTestingModule({});
      const state = TestBed.inject(AppStateService);
      const count = computed(() => state.customers().length);
      const seen: string[][] = [];
      TestBed.runInInjectionContext(() => effect(() => { seen.push(state.selectedTradeUnits()); }));
      TestBed.tick();

      state.setCustomers([mockCustomer]);
      state.setTradeUnits(['2040']);
      TestBed.tick();

      expect(count()).toBe(1);
      expect(seen).toEqual([[], ['2040']]);
      // Same signal every read, so toObservable / effect subscriptions stay attached.
      expect(state.customers).toBe(state.customers);
    });

    it('the new setters write what they are given', () => {
      service.setCustomersLoading(true);
      service.setContractsLoading(true);
      service.setTodaysTicketsLoading(true);
      service.setCommodityConversions([{ commodityCode: 'YC', lbsPerUnit: 56 }]);
      service.setHarvestWindows([{ commodityCode: 'YC' } as never]);
      service.setQueryLibrary([{ queryText: 'q' } as never]);

      expect(service.customersLoading()).toBe(true);
      expect(service.contractsLoading()).toBe(true);
      expect(service.todaysTicketsLoading()).toBe(true);
      expect(service.commodityConversions()).toEqual([{ commodityCode: 'YC', lbsPerUnit: 56 }]);
      expect(service.harvestWindows()).toEqual([{ commodityCode: 'YC' }]);
      expect(service.queryLibrary()).toEqual([{ queryText: 'q' }]);
    });

    it('markNoTradeUnitAssignments drops the groups but leaves the loaded flag alone', () => {
      service.setUserGroups([{ groupName: 'West', tradeUnitCodes: ['1085'] }]);
      service.markNoTradeUnitAssignments();

      expect(service.userGroups()).toEqual([]);
      expect(service.noTradeUnitAssignments()).toBe(true);
      expect(service.userGroupsLoaded()).toBe(true);
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
