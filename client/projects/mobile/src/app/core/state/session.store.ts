import { Injectable, computed, inject, signal } from '@angular/core';

import { MobileApiService, Session, TradeUnit, TradeUnitGroup } from '../api/mobile-api.service';

/**
 * The small amount of app-wide state the phone app needs. Deliberately NOT the desktop's
 * AppStateService/DataPreloadService: those bulk-load a whole trade unit on selection, which needs
 * the wide API surface and is hostile to LTE. Pages load per route with resource().
 *
 * Flow (agreed 2026-09-23): sign in → see your groups and trade units → pick one or more → producers
 * for that selection (browse, search) → one producer. The selection is remembered for the session.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private static readonly SelectedKey = 'mob.selectedTradeUnits';
  private static readonly GroupKey = 'mob.selectedGroup';

  private readonly api = inject(MobileApiService);

  private readonly _session = signal<Session | null>(null);
  private readonly _selected = signal<string[]>(readStored(SessionStore.SelectedKey));
  private readonly _selectedGroup = signal<string | null>(readStoredString(SessionStore.GroupKey));
  private readonly _loading = signal(false);

  /** The group chosen in the first dropdown; null until the user picks one (or the only group, auto-picked). */
  readonly selectedGroup = computed<TradeUnitGroup | null>(() => {
    const groups = this.groups();
    const name = this._selectedGroup();
    return groups.find((g) => g.name === name) ?? (groups.length === 1 ? groups[0]! : null);
  });

  readonly session = this._session.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly tradeUnits = computed<TradeUnit[]>(() => this._session()?.tradeUnits ?? []);
  readonly groups = computed<TradeUnitGroup[]>(() => this._session()?.groups ?? []);

  /** Selected trade-unit codes, restricted to what the caller is currently entitled to. */
  readonly selectedTradeUnits = computed<string[]>(() => {
    const entitled = new Set(this.tradeUnits().map((t) => t.code));
    return this._selected().filter((c) => entitled.has(c));
  });

  readonly hasSelection = computed(() => this.selectedTradeUnits().length > 0);


  async ensureLoaded(): Promise<Session | null> {
    if (this._session()) return this._session();
    this._loading.set(true);
    try {
      const session = await this.api.getSession();
      this._session.set(session);
      return session;
    } finally {
      this._loading.set(false);
    }
  }

  /** Choosing a group starts a fresh trade-unit selection within it. */
  selectGroup(name: string | null): void {
    this._selectedGroup.set(name);
    this.setSelection([]);
    try {
      if (name) sessionStorage.setItem(SessionStore.GroupKey, name);
      else sessionStorage.removeItem(SessionStore.GroupKey);
    } catch { /* ignore */ }
  }

  isSelected(code: string): boolean {
    return this._selected().includes(code);
  }

  toggleTradeUnit(code: string): void {
    this.setSelection(this.isSelected(code) ? this._selected().filter((c) => c !== code) : [...this._selected(), code]);
  }

  /** Select every trade unit in a group (or clear them all if every one is already selected). */
  toggleGroup(group: TradeUnitGroup): void {
    const allSelected = group.tradeUnitCodes.every((c) => this.isSelected(c));
    const without = this._selected().filter((c) => !group.tradeUnitCodes.includes(c));
    this.setSelection(allSelected ? without : [...without, ...group.tradeUnitCodes]);
  }

  groupState(group: TradeUnitGroup): 'none' | 'some' | 'all' {
    const n = group.tradeUnitCodes.filter((c) => this.isSelected(c)).length;
    return n === 0 ? 'none' : n === group.tradeUnitCodes.length ? 'all' : 'some';
  }

  setSelection(codes: string[]): void {
    const unique = [...new Set(codes)];
    this._selected.set(unique);
    try {
      sessionStorage.setItem(SessionStore.SelectedKey, JSON.stringify(unique));
    } catch { /* storage unavailable; selection still works for this page load */ }
  }

  tradeUnitName(code: string): string {
    return this.tradeUnits().find((t) => t.code === code)?.name ?? code;
  }

}

function readStoredString(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function readStored(key: string): string[] {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
