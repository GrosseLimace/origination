import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TradeUnitContext } from './trade-unit-context.service';

describe('TradeUnitContext', () => {
  let context: TradeUnitContext;

  beforeEach(() => {
    localStorage.removeItem('origination_user_prefs');
    TestBed.configureTestingModule({});
    context = TestBed.inject(TradeUnitContext);
  });

  afterEach(() => localStorage.removeItem('origination_user_prefs'));

  it('starts with no groups and no selection', () => {
    expect(context.userGroups()).toEqual([]);
    expect(context.userGroupsLoaded()).toBe(false);
    expect(context.selectedTradeUnits()).toEqual([]);
    expect(context.selectedGroupNames()).toEqual([]);
  });

  it('setTradeUnits() updates the selectedTradeUnits signal', () => {
    context.setTradeUnits(['TU1', 'TU2']);
    expect(context.selectedTradeUnits()).toEqual(['TU1', 'TU2']);
  });

  it('markNoTradeUnitAssignments drops the groups but leaves the loaded flag alone', () => {
    context.setUserGroups([{ groupName: 'West', tradeUnitCodes: ['1085'] }]);
    context.markNoTradeUnitAssignments();

    expect(context.userGroups()).toEqual([]);
    expect(context.noTradeUnitAssignments()).toBe(true);
    expect(context.userGroupsLoaded()).toBe(true);
  });

  it('clear() forgets the groups and the selection, but not the selection saved in this browser', () => {
    context.setUserGroups([{ groupName: 'West', tradeUnitCodes: ['1085'] }]);
    context.setTradeUnits(['1085']);
    context.setSelectedGroupNames(['West']);
    context.savePrefsToLocalStorage(['West'], ['1085']);

    context.clear();

    expect(context.userGroups()).toEqual([]);
    expect(context.userGroupsLoaded()).toBe(false);
    expect(context.selectedTradeUnits()).toEqual([]);
    expect(context.selectedGroupNames()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('origination_user_prefs')!)).toEqual({ groups: ['West'], units: ['1085'] });
  });

  it('starts from the selection saved in this browser', () => {
    localStorage.setItem('origination_user_prefs', JSON.stringify({ groups: ['West'], units: ['1085'] }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});

    const restored = TestBed.inject(TradeUnitContext);

    expect(restored.selectedGroupNames()).toEqual(['West']);
    expect(restored.selectedTradeUnits()).toEqual(['1085']);
  });

  describe('read-only public surface', () => {
    function publicSignals(): [string, unknown][] {
      return Object.entries(context).filter(([name, value]) => !name.startsWith('_') && isSignal(value));
    }

    it('exposes its state as signals', () => {
      // Guards the check below against passing vacuously if the surface stopped being found.
      expect(publicSignals().length).toBeGreaterThanOrEqual(8);
    });

    it('offers no .set or .update on any public signal — writes go through its methods', () => {
      const writable = publicSignals()
        .filter(([, value]) => 'set' in (value as object) || 'update' in (value as object))
        .map(([name]) => name);

      expect(writable).toEqual([]);
    });

    it('rejects a direct write at compile time', () => {
      // Never runs; `tsc -p tsconfig.spec.json` fails if any of these lines starts compiling again.
      const neverCalled = () => {
        // @ts-expect-error selectedTradeUnits is read-only
        context.selectedTradeUnits.update(u => u);
        // @ts-expect-error userGroups is read-only
        context.userGroups.set([]);
      };
      expect(typeof neverCalled).toBe('function');
    });
  });
});
