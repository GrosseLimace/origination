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
    expect(service.notes()).toEqual([]);
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

  it('setNotes() updates the data cache signal, and marks the notes loaded', () => {
    service.setNotes([{ id: 7 } as never]);
    expect(service.notes()).toHaveLength(1);
    expect(service.notes()[0].id).toBe(7);
    expect(service.notesLoaded()).toBe(true);
  });

  it('clearAll() resets all state to defaults, the trade-unit selection included', () => {
    service.selectCustomer(mockCustomer);
    context.setTradeUnits(['TU1']);
    service.setSearchQuery('test');
    service.setNotes([{ id: 7 } as never]);
    service.clearAll();
    expect(service.selectedCustomer()).toBeNull();
    expect(context.selectedTradeUnits()).toEqual([]);
    expect(service.searchQuery()).toBe('');
    expect(service.notes()).toEqual([]);
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
      // planting, stored grain and DP to the Producers module's.)
      expect(publicSignals().length).toBeGreaterThanOrEqual(14);
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
        // @ts-expect-error notes is read-only
        service.notes.set([]);
        // @ts-expect-error searchQuery is read-only
        service.searchQuery.update(q => q);
        // @ts-expect-error noteLastContactsLoadFailed is read-only
        service.noteLastContactsLoadFailed.set(true);
      };
      expect(typeof neverCalled).toBe('function');
    });

    it('still drives computeds and effects through the read-only view', () => {
      const state = TestBed.inject(AppStateService);
      const count = computed(() => state.notes().length);
      const seen: string[] = [];
      TestBed.runInInjectionContext(() => effect(() => { seen.push(state.searchQuery()); }));
      TestBed.tick();

      state.setNotes([{ id: 7 } as never]);
      state.setSearchQuery('2040');
      TestBed.tick();

      expect(count()).toBe(1);
      expect(seen).toEqual(['', '2040']);
      // Same signal every read, so toObservable / effect subscriptions stay attached.
      expect(state.notes).toBe(state.notes);
    });

    it('the new setters write what they are given', () => {
      service.setCommodityConversions([{ commodityCode: 'YC', lbsPerUnit: 56 }]);
      service.setHarvestWindows([{ commodityCode: 'YC' } as never]);

      expect(service.commodityConversions()).toEqual([{ commodityCode: 'YC', lbsPerUnit: 56 }]);
      expect(service.harvestWindows()).toEqual([{ commodityCode: 'YC' }]);
    });

    it("clearLoadFailures resets the trade-unit reads' failure flags", () => {
      service.setNoteLastContactsLoadFailed(true);
      service.setHarvestWindowsLoadFailed(true);
      service.clearLoadFailures();

      expect(service.noteLastContactsLoadFailed()).toBe(false);
      expect(service.harvestWindowsLoadFailed()).toBe(false);
    });
  });

});
