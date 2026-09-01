import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AppStateService } from './app-state.service';

const ORGANICS = { groupName: 'Organics & IP', tradeUnitCodes: ['2080', '2090', '2093', '2094', '2291', '2295'] };
const CORN_BELT = { groupName: 'Corn Belt', tradeUnitCodes: ['2115', '2190'] };

/**
 * inScopeGroupNames decides whether the Organics & IP crops (HRWO/WHTO/YCO/YSBO) reach the
 * commodity pickers. The rule the app agreed on is additive: any Organics unit in play is enough,
 * and an empty selection means ALL of the user's groups — matching what the trade-unit selector
 * already does when it computes available units.
 */
describe('AppStateService.inScopeGroupNames', () => {
  let state: AppStateService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    state = TestBed.inject(AppStateService);
  });

  it('is empty until the groups load, so nothing scoped leaks in early', () => {
    expect(state.inScopeGroupNames()).toEqual([]);
  });

  it('treats an empty selection as ALL of the user\'s groups, not none', () => {
    // A user entitled to Organics sees organic crops before touching the selector.
    state.setUserGroups([CORN_BELT, ORGANICS]);
    expect(state.inScopeGroupNames()).toEqual(['Corn Belt', 'Organics & IP']);
  });

  it('narrows to the selected group', () => {
    state.setUserGroups([CORN_BELT, ORGANICS]);
    state.setSelectedGroupNames(['Corn Belt']);
    expect(state.inScopeGroupNames()).toEqual(['Corn Belt']);
  });

  it('lets individually selected trade units win over the group selection', () => {
    state.setUserGroups([CORN_BELT, ORGANICS]);
    state.setSelectedGroupNames(['Corn Belt']);
    state.setTradeUnits(['2090']);
    expect(state.inScopeGroupNames()).toEqual(['Organics & IP']);
  });

  it('resolves a bare trade unit to its owning group', () => {
    state.setUserGroups([CORN_BELT, ORGANICS]);
    state.setTradeUnits(['2115']);
    expect(state.inScopeGroupNames()).toEqual(['Corn Belt']);
  });

  it('is additive across groups — an Organics unit alongside a Corn Belt one keeps both', () => {
    state.setUserGroups([CORN_BELT, ORGANICS]);
    state.setTradeUnits(['2115', '2090']);
    expect(state.inScopeGroupNames()).toEqual(['Corn Belt', 'Organics & IP']);
  });

  it('drops Organics again when the user narrows to conventional units', () => {
    state.setUserGroups([CORN_BELT, ORGANICS]);
    state.setTradeUnits(['2115', '2090']);
    state.setTradeUnits(['2115']);
    expect(state.inScopeGroupNames()).toEqual(['Corn Belt']);
  });

  it('ignores a saved group name the user no longer belongs to', () => {
    state.setUserGroups([CORN_BELT]);
    state.setSelectedGroupNames(['Organics & IP']);
    expect(state.inScopeGroupNames()).toEqual([]);
  });

  it('tolerates whitespace around persisted trade unit codes', () => {
    state.setUserGroups([CORN_BELT, ORGANICS]);
    state.setTradeUnits([' 2090 ']);
    expect(state.inScopeGroupNames()).toEqual(['Organics & IP']);
  });
});
