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
  location: 'Omaha, NE',
  phone: '402-555-0100',
  email: 'test@farm.com',
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
    expect(service.commodities()).toEqual([]);
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

  it('setCommodities() updates the reference data', () => {
    service.setCommodities([{ id: 7 } as never]);
    expect(service.commodities()).toHaveLength(1);
    expect(service.commodities()[0].id).toBe(7);
  });

  it('clearAll() resets all state to defaults, the trade-unit selection included', () => {
    service.selectCustomer(mockCustomer);
    context.setTradeUnits(['TU1']);
    service.setSearchQuery('test');
    service.setCommodities([{ id: 7 } as never]);
    service.clearAll();
    expect(service.selectedCustomer()).toBeNull();
    expect(context.selectedTradeUnits()).toEqual([]);
    expect(service.searchQuery()).toBe('');
    expect(service.commodities()).toEqual([]);
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
      // Guards the check below against passing vacuously if the surface stopped being found. (14 since the trade units'
      // contracts and tickets, their flags and the pricing lines moved to the Contracts module's stores, and their
      // planting, stored grain and DP to the Producers module's, and the notes, last contacts and follow-ups to Engagement's.)
      expect(publicSignals().length).toBeGreaterThanOrEqual(8);
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
        // @ts-expect-error commodities is read-only
        service.commodities.set([]);
        // @ts-expect-error searchQuery is read-only
        service.searchQuery.update(q => q);
        // @ts-expect-error harvestWindowsLoadFailed is read-only
        service.harvestWindowsLoadFailed.set(true);
      };
      expect(typeof neverCalled).toBe('function');
    });

    it('still drives computeds and effects through the read-only view', () => {
      const state = TestBed.inject(AppStateService);
      const count = computed(() => state.commodities().length);
      const seen: string[] = [];
      TestBed.runInInjectionContext(() => effect(() => { seen.push(state.searchQuery()); }));
      TestBed.tick();

      state.setCommodities([{ id: 7 } as never]);
      state.setSearchQuery('2040');
      TestBed.tick();

      expect(count()).toBe(1);
      expect(seen).toEqual(['', '2040']);
      // Same signal every read, so toObservable / effect subscriptions stay attached.
      expect(state.commodities).toBe(state.commodities);
    });

    it('the new setters write what they are given', () => {
      service.setCommodityConversions([{ commodityCode: 'YC', lbsPerUnit: 56 }]);
      service.setHarvestWindows([{ commodityCode: 'YC' } as never]);

      expect(service.commodityConversions()).toEqual([{ commodityCode: 'YC', lbsPerUnit: 56 }]);
      expect(service.harvestWindows()).toEqual([{ commodityCode: 'YC' }]);
    });

    it("clearLoadFailures resets the trade-unit reads' failure flags", () => {
      service.setHarvestWindowsLoadFailed(true);
      service.setCommodityConversionsLoadFailed(true);
      service.clearLoadFailures();

      expect(service.harvestWindowsLoadFailed()).toBe(false);
      // Read once per sign-in, so a trade-unit change keeps it.
      expect(service.commodityConversionsLoadFailed()).toBe(true);
    });
  });

});
