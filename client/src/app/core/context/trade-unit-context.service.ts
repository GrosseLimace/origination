import { Injectable, computed, signal } from '@angular/core';

/** One of the signed-in user's trade-unit groups. tradeUnits carries each code's description/location (e.g.
 *  "Pratt, KS"); it is optional because older cached data has none. tradeUnitCodes is kept for code-only consumers. */
export type TradeUnitGroup = { groupName: string; tradeUnitCodes: string[]; tradeUnits?: { code: string; description?: string }[] };

/**
 * The trade units the app is working in: the user's groups, what they selected in the trade-unit selector, the
 * codes and group names that selection puts in scope, and the last selection saved in this browser. Every module
 * scopes its reads to this.
 */
@Injectable({
  providedIn: 'root'
})
export class TradeUnitContext {
  private static readonly PREFS_KEY = 'origination_user_prefs';

  // Writable state lives here, private. Each one is exposed below as a read-only signal next to its
  // documentation, and changes only through this service's methods.
  private readonly _userGroups = signal<TradeUnitGroup[]>([]);
  private readonly _userGroupsLoaded = signal(false);
  private readonly _noTradeUnitAssignments = signal(false);
  private readonly _selectedTradeUnits = signal<string[]>([]);
  private readonly _selectedGroupNames = signal<string[]>([]);

  constructor() {
    try {
      const raw = localStorage.getItem(TradeUnitContext.PREFS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { groups?: string[]; units?: string[] };
        if (saved.groups?.length) this._selectedGroupNames.set(saved.groups);
        if (saved.units?.length)  this._selectedTradeUnits.set(saved.units);
      }
    } catch { /* ignore parse errors */ }
  }

  savePrefsToLocalStorage(groups: string[], units: string[]): void {
    try {
      localStorage.setItem(TradeUnitContext.PREFS_KEY, JSON.stringify({ groups, units }));
    } catch { /* ignore */ }
  }

  // Trade unit groups cache — loaded once and shared globally.
  readonly userGroups = this._userGroups.asReadonly();
  readonly userGroupsLoaded = this._userGroupsLoaded.asReadonly();

  /** True once /usertradeunits has answered with NO assignments for this user. Distinct from
   *  `userGroupsLoaded` (deliberately left false in that case so a retry is natural). Lets the
   *  preference restore skip re-applying a saved selection the user is no longer entitled to. */
  readonly noTradeUnitAssignments = this._noTradeUnitAssignments.asReadonly();

  setUserGroups(groups: TradeUnitGroup[]): void {
    this._userGroups.set(groups);
    this._userGroupsLoaded.set(true);
    this._noTradeUnitAssignments.set(false);
  }

  /** /usertradeunits answered with no assignments: drop the groups and record why. Leaves
   *  userGroupsLoaded alone on purpose (see noTradeUnitAssignments). */
  markNoTradeUnitAssignments(): void {
    this._userGroups.set([]);
    this._noTradeUnitAssignments.set(true);
  }

  /** Trade-unit code → description/location (e.g. "2190" → "Pratt, KS"), from the loaded groups.
   *  Empty until groups load (or for older cached data without descriptions). */
  readonly tradeUnitDescriptions = computed(() => {
    const map = new Map<string, string>();
    for (const g of this.userGroups()) {
      for (const tu of g.tradeUnits ?? []) {
        if (tu.description && !map.has(tu.code)) map.set(tu.code, tu.description);
      }
    }
    return map;
  });

  // Selection state
  readonly selectedTradeUnits = this._selectedTradeUnits.asReadonly();
  readonly selectedGroupNames = this._selectedGroupNames.asReadonly();

  setTradeUnits(tradeUnits: string[]): void {
    this._selectedTradeUnits.set(tradeUnits);
  }

  setSelectedGroupNames(groups: string[]): void {
    this._selectedGroupNames.set(groups);
  }

  /**
   * Trade group names currently in play — used to scope the commodity pickers (Organics & IP).
   *
   * Precedence matches the rest of the app: individually selected trade units win (a group counts
   * if any of its codes is selected), then selected groups, then — per the selector's
   * _computeAvailableTradeUnits — an empty selection means ALL of the user's groups, not none.
   * Empty until userGroups loads, at which point every consumer re-filters on its own.
   *
   * Selecting an Organics unit alongside a conventional one is additive: both groups come back,
   * so the organic crops show without hiding anything else.
   */
  readonly inScopeGroupNames = computed<readonly string[]>(() => {
    const groups = this.userGroups();
    const units = this.selectedTradeUnits();
    const names = this.selectedGroupNames();

    if (units.length > 0) {
      const selected = new Set(units.map(u => u.trim()));
      return groups
        .filter(g => g.tradeUnitCodes.some(c => selected.has(c.trim())))
        .map(g => g.groupName);
    }
    // Intersect rather than echo the names back, so a stale saved selection can't invent a group.
    if (names.length > 0) {
      return groups.filter(g => names.includes(g.groupName)).map(g => g.groupName);
    }
    return groups.map(g => g.groupName);
  });

  /**
   * Trade unit codes currently in play — the unit-level counterpart to inScopeGroupNames, used to
   * scope commodities restricted to specific units rather than a whole group.
   *
   * Precedence is identical: explicit units win, then selected groups expanded to their member
   * codes, then — nothing selected means ALL of the user's units, not none. Kept separate from
   * inScopeGroupNames rather than derived from it because that computed deliberately collapses
   * units up to their group name, which loses exactly the granularity this needs: selecting 2080
   * and selecting 2291 both yield 'Organics & IP'.
   */
  readonly inScopeTradeUnitCodes = computed<readonly string[]>(() => {
    const groups = this.userGroups();
    const units = this.selectedTradeUnits();
    const names = this.selectedGroupNames();

    if (units.length > 0) return units.map(u => u.trim()).filter(Boolean);
    if (names.length > 0) {
      return groups
        .filter(g => names.includes(g.groupName))
        .flatMap(g => g.tradeUnitCodes.map(c => c.trim()))
        .filter(Boolean);
    }
    return groups.flatMap(g => g.tradeUnitCodes.map(c => c.trim())).filter(Boolean);
  });

  /** Sign-out: forget the groups and the selection (the selection saved in this browser stays). */
  clear(): void {
    this._userGroups.set([]);
    this._userGroupsLoaded.set(false);
    this._selectedTradeUnits.set([]);
    this._selectedGroupNames.set([]);
  }
}
