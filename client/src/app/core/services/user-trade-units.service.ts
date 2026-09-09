import { Injectable, inject } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AppStateService } from './app-state.service';
import { DataPreloadService } from './data-preload.service';
import { environment } from '../../../environments/environment';

export interface UserTradeUnitGroup {
  groupName: string;
  tradeUnitCodes: string[];
  tradeUnits: { code: string; description?: string }[];
}

/**
 * The signed-in user's trade-unit groups, and the hand-off to the Trade Unit Preferences app
 * where those assignments are actually managed (this app only reads the result).
 *
 * Why a popup window and not a dialog: tradeunitprefs{-dev,-qa,}.scoular.com answers with
 * `X-Frame-Options: DENY` / `frame-ancestors 'none'`, so it can't be iframed. A named popup
 * is the closest thing — and when it closes we re-fetch the groups so the selector reflects
 * whatever the user just changed without a page reload.
 */
@Injectable({ providedIn: 'root' })
export class UserTradeUnitsService {
  private readonly api = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly dataPreload = inject(DataPreloadService);

  /** Close-watch for the currently open preferences window, if any. */
  private closeWatch: ReturnType<typeof setInterval> | null = null;
  /** Focus listener active while a preferences window is open. */
  private focusHandler: (() => void) | null = null;
  /** Groups as last seen, so a refresh can tell "nothing changed" from "changed". */
  private lastGroupsKey: string | null = null;
  private refreshInFlight = false;

  static readonly WINDOW_NAME = 'scoular-trade-unit-prefs';
  private static readonly CLOSE_POLL_MS = 500;
  /** How long after opening the preferences window focus events keep triggering a refresh. */
  private static readonly FOCUS_WATCH_MAX_MS = 30 * 60_000;
  /** sessionStorage marker: a preferences window was opened and its watch runs until this epoch ms. */
  static readonly WATCH_MARKER_KEY = 'scoular-tup-watch-until';

  constructor() {
    // A page reload while the preferences window is open orphans the watch: the popup lives on,
    // but the listeners died with the previous document. If a recent openPreferences() left its
    // marker in this tab, re-arm the focus half (the window handle itself is unrecoverable, so
    // there is no close-poll — the refresh fires when focus returns to Origination).
    let watchUntil = 0;
    try { watchUntil = Number(sessionStorage.getItem(UserTradeUnitsService.WATCH_MARKER_KEY) ?? 0); } catch { /* storage unavailable */ }
    if (watchUntil > Date.now()) this.watchFocus(watchUntil);
  }

  /**
   * Fetch the user's groups and apply them to app state.
   *
   * An empty result means the user has no assignments (a TradeUnitPreferences outage is a 503, i.e.
   * the error path — never an empty 200). We clear any selection restored from localStorage /
   * server preferences, otherwise the preload keeps requesting trade units they're no longer
   * entitled to, the server strips those to "no filter", and they see EVERY producer plus a
   * spinner that never settles. `userGroupsLoaded` is left false so a later attempt retries.
   * Callers own the loading / error UI.
   */
  load(): Observable<UserTradeUnitGroup[]> {
    return this.api.getUserTradeUnits().pipe(
      map(groups => groups.map(g => ({
        groupName: g.groupName,
        tradeUnitCodes: g.tradeUnitCodes,
        tradeUnits: g.tradeUnits ?? []
      }))),
      tap(groups => {
        if (groups.length > 0) this.applyGroups(groups);
        else this.clearForNoAssignments();
      })
    );
  }

  private clearForNoAssignments(): void {
    this.appState.userGroups.set([]);
    this.appState.noTradeUnitAssignments.set(true);
    if (this.appState.selectedGroupNames().length > 0) this.appState.setSelectedGroupNames([]);
    if (this.appState.selectedTradeUnits().length > 0) this.appState.setTradeUnits([]);
  }

  /** Open the Trade Unit Preferences app in a popup window (new tab if the browser refuses a
   *  popup) and refresh the user's groups once it closes. Re-clicking focuses the same window. */
  openPreferences(): void {
    const url = environment.tradeUnitPreferencesUrl;
    const width = 1000;
    const height = 800;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;

    // `noopener` is deliberately absent: it makes window.open return null and we'd lose the
    // close-watch. Instead we sever the reverse handle ourselves before the app loads.
    const win = window.open(url, UserTradeUnitsService.WINDOW_NAME, features) ?? window.open(url, '_blank');
    if (!win) return;
    try { win.opener = null; } catch { /* already cross-origin — nothing to sever */ }
    try { win.focus(); } catch { /* not all browsers allow it; cosmetic */ }

    this.watchForClose(win);
  }

  /** Trade-unit codes available for the given group selection (all groups when none selected). */
  computeAvailableTradeUnits(
    groups: { groupName: string; tradeUnitCodes: string[] }[],
    selectedGroups: string[]
  ): string[] {
    if (groups.length <= 1) return groups[0]?.tradeUnitCodes ?? [];
    const filterGroups = selectedGroups.length === 0 ? groups : groups.filter(g => selectedGroups.includes(g.groupName));
    const units = new Set<string>();
    for (const g of filterGroups) {
      g.tradeUnitCodes.forEach(u => units.add(u));
    }
    return [...units].sort();
  }

  private applyGroups(groups: UserTradeUnitGroup[]): void {
    this.appState.setUserGroups(groups);

    // Keep the group selection, minus groups that no longer exist
    const prevGroups = this.appState.selectedGroupNames();
    if (prevGroups.length > 0) {
      this.appState.setSelectedGroupNames(prevGroups.filter(g => groups.some(m => m.groupName === g)));
    }
    // Keep the trade-unit selection, minus units no longer available
    const prevUnits = this.appState.selectedTradeUnits();
    if (prevUnits.length > 0) {
      const available = this.computeAvailableTradeUnits(groups, this.appState.selectedGroupNames());
      this.appState.setTradeUnits(prevUnits.filter(u => available.includes(u)));
    }
  }

  /**
   * Watch the preferences window and refresh when the user comes back. Two triggers, because
   * neither is reliable alone:
   *  - `window` focus: closing the popup (or just clicking back) returns focus to Origination.
   *    This is the primary trigger and works even when the browser mis-reports `closed`.
   *  - polling `win.closed` (the only cross-origin-readable property): the prompt trigger for
   *    a real close, so the refresh doesn't wait for the user to click anything.
   *
   * `win.closed` cannot end the focus watch: if the popup navigates through a page that sends
   * Cross-Origin-Opener-Policy (the Microsoft login redirect can), the browser severs our handle
   * and it reports `closed: true` while the window is still on screen. Tearing the focus listener
   * down on that lie ends the watch before the user has changed anything, and the real close then
   * goes unnoticed. So `closed` only stops the polling; the focus listener retires itself at a
   * deadline instead. Refreshes are no-ops unless the groups actually changed, so the extra
   * focus-triggered fetches in the meantime are cheap.
   */
  private watchForClose(win: Window): void {
    this.stopWatching();
    this.lastGroupsKey = this.groupsKey(this.appState.userGroups());
    const watchUntil = Date.now() + UserTradeUnitsService.FOCUS_WATCH_MAX_MS;
    try { sessionStorage.setItem(UserTradeUnitsService.WATCH_MARKER_KEY, String(watchUntil)); } catch { /* storage unavailable */ }

    this.watchFocus(watchUntil);

    this.closeWatch = setInterval(() => {
      if (!win.closed) return;
      clearInterval(this.closeWatch!);
      this.closeWatch = null;
      this.refreshIfChanged();
    }, UserTradeUnitsService.CLOSE_POLL_MS);
  }

  private watchFocus(watchUntil: number): void {
    this.focusHandler = () => {
      if (Date.now() > watchUntil) {
        this.stopWatching();
        return;
      }
      this.refreshIfChanged();
    };
    window.addEventListener('focus', this.focusHandler);
  }

  private stopWatching(): void {
    if (this.closeWatch !== null) {
      clearInterval(this.closeWatch);
      this.closeWatch = null;
    }
    if (this.focusHandler) {
      window.removeEventListener('focus', this.focusHandler);
      this.focusHandler = null;
    }
  }

  /**
   * Re-fetch the groups and, if Trade Unit Preferences changed them, make the app follow without
   * a page reload:
   *  - stale selections are pruned by `load()`; if that changed the selection, the normal
   *    TU-change pipeline in DataPreloadService reloads the data by itself;
   *  - if the selection is unchanged, force a full data reload (entitlements changed underneath);
   *  - if the selection is (or was pruned to) empty, leave it empty: the selector prompts them to
   *    pick a group and then trade units, the same flow as first sign-in or changing groups by
   *    hand. Nothing is ever selected on the user's behalf — an earlier version scoped first-time
   *    users to their first group with every unit selected, but rejoining after leaving all
   *    groups looks identical to first-time setup and reads as the app choosing for you;
   *  - if they removed everything, `load()` already cleared the selection and the preload
   *    short-circuits; the selector shows the "no trade units assigned" callout.
   * Best effort: a failure keeps what we already had and is logged for diagnosis.
   */
  private refreshIfChanged(): void {
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    const selectionBefore = this.selectionKey();
    this.load().subscribe({
      next: groups => {
        this.refreshInFlight = false;
        const key = this.groupsKey(groups);
        if (key === this.lastGroupsKey) return; // nothing changed in Trade Unit Preferences
        const hadBaseline = this.lastGroupsKey !== null;
        this.lastGroupsKey = key;
        // Re-armed after a page reload: there is no pre-popup snapshot to compare against, and the
        // page load itself already fetched fresh data — this fetch only establishes the baseline.
        if (!hadBaseline) return;
        if (groups.length === 0) return;

        const selection = this.appState.selectedTradeUnits();
        if (selection.length === 0) return; // they pick a group, then trade units — never us
        if (this.selectionKey() === selectionBefore) this.dataPreload.forceReload();
      },
      error: err => {
        this.refreshInFlight = false;
        console.warn('[TradeUnitPreferences] refresh after returning from the preferences window failed', err);
      }
    });
  }

  private selectionKey(): string {
    return [...this.appState.selectedTradeUnits()].sort().join(',');
  }

  private groupsKey(groups: { groupName: string; tradeUnitCodes: string[] }[]): string {
    return groups
      .map(g => `${g.groupName}:${[...g.tradeUnitCodes].sort().join(',')}`)
      .sort()
      .join('|');
  }
}
