import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { UserTradeUnitsService } from './user-trade-units.service';
import { ApiService } from './api.service';
import { AppStateService } from './app-state.service';
import { DataPreloadService } from './data-preload.service';
import { environment } from '../../../environments/environment';

const GROUPS = [
  { groupName: 'West', tradeUnitCodes: ['1085', '2190'], tradeUnits: [{ code: '1085' }, { code: '2190', description: 'Pratt, KS' }] },
  { groupName: 'East', tradeUnitCodes: ['3000'], tradeUnits: [{ code: '3000' }] },
];

describe('UserTradeUnitsService', () => {
  let service: UserTradeUnitsService;
  let api: { getUserTradeUnits: ReturnType<typeof vi.fn> };
  let appState: {
    userGroups: ReturnType<typeof signal<typeof GROUPS>>;
    noTradeUnitAssignments: ReturnType<typeof signal<boolean>>;
    selectedGroupNames: ReturnType<typeof signal<string[]>>;
    selectedTradeUnits: ReturnType<typeof signal<string[]>>;
    allProducersMode: ReturnType<typeof signal<boolean>>;
    setUserGroups: ReturnType<typeof vi.fn>;
    setSelectedGroupNames: ReturnType<typeof vi.fn>;
    setTradeUnits: ReturnType<typeof vi.fn>;
  };
  let dataPreload: { forceReload: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    sessionStorage.removeItem(UserTradeUnitsService.WATCH_MARKER_KEY);
    api = { getUserTradeUnits: vi.fn(() => of(GROUPS)) };
    const selectedTradeUnits = signal<string[]>([]);
    appState = {
      userGroups: signal<typeof GROUPS>([]),
      noTradeUnitAssignments: signal(false),
      selectedGroupNames: signal<string[]>([]),
      selectedTradeUnits,
      allProducersMode: signal(false),
      setUserGroups: vi.fn(),
      setSelectedGroupNames: vi.fn(),
      // Mirror the real setter so the "did the selection change" comparison sees the pruned value.
      setTradeUnits: vi.fn((units: string[]) => selectedTradeUnits.set(units)),
    };
    dataPreload = { forceReload: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        UserTradeUnitsService,
        { provide: ApiService, useValue: api },
        { provide: AppStateService, useValue: appState },
        { provide: DataPreloadService, useValue: dataPreload },
      ],
    });
    service = TestBed.inject(UserTradeUnitsService);
  });

  afterEach(() => {
    sessionStorage.removeItem(UserTradeUnitsService.WATCH_MARKER_KEY);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── load() ─────────────────────────────────────────────────────────────────

  it('load() applies the groups to app state and defaults tradeUnits to []', () => {
    api.getUserTradeUnits.mockReturnValue(of([{ groupName: 'Solo', tradeUnitCodes: ['1'] }]));

    let result: unknown;
    service.load().subscribe(r => (result = r));

    expect(result).toEqual([{ groupName: 'Solo', tradeUnitCodes: ['1'], tradeUnits: [] }]);
    expect(appState.setUserGroups).toHaveBeenCalledWith([{ groupName: 'Solo', tradeUnitCodes: ['1'], tradeUnits: [] }]);
  });

  it('load() prunes the selected groups and trade units that no longer exist', () => {
    appState.selectedGroupNames.set(['West', 'Gone']);
    appState.selectedTradeUnits.set(['1085', '9999']);

    service.load().subscribe();

    expect(appState.setSelectedGroupNames).toHaveBeenCalledWith(['West']);
    expect(appState.setTradeUnits).toHaveBeenCalledWith(['1085']);
  });

  it('load() with no assignments clears a stale selection instead of marking groups loaded', () => {
    api.getUserTradeUnits.mockReturnValue(of([]));
    appState.userGroups.set([GROUPS[0]]);
    appState.selectedGroupNames.set(['West']);
    appState.selectedTradeUnits.set(['1085']);

    let result: unknown;
    service.load().subscribe(r => (result = r));

    expect(result).toEqual([]);
    expect(appState.setUserGroups).not.toHaveBeenCalled(); // userGroupsLoaded stays false → retries later
    expect(appState.userGroups()).toEqual([]);
    expect(appState.noTradeUnitAssignments()).toBe(true);
    expect(appState.setSelectedGroupNames).toHaveBeenCalledWith([]);
    expect(appState.setTradeUnits).toHaveBeenCalledWith([]);
  });

  it('load() with no assignments and nothing selected leaves the selection setters alone', () => {
    api.getUserTradeUnits.mockReturnValue(of([]));

    service.load().subscribe();

    expect(appState.setSelectedGroupNames).not.toHaveBeenCalled();
    expect(appState.setTradeUnits).not.toHaveBeenCalled();
  });

  // ── computeAvailableTradeUnits() ───────────────────────────────────────────

  it('computeAvailableTradeUnits() returns the single group untouched, else the sorted union of selected groups', () => {
    expect(service.computeAvailableTradeUnits([GROUPS[0]], [])).toEqual(['1085', '2190']);
    expect(service.computeAvailableTradeUnits(GROUPS, [])).toEqual(['1085', '2190', '3000']);
    expect(service.computeAvailableTradeUnits(GROUPS, ['East'])).toEqual(['3000']);
  });

  // ── openPreferences() ──────────────────────────────────────────────────────

  it('openPreferences() opens the environment URL in a named popup window', () => {
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);

    service.openPreferences();

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, name, features] = openSpy.mock.calls[0];
    expect(url).toBe(environment.tradeUnitPreferencesUrl);
    expect(name).toBe(UserTradeUnitsService.WINDOW_NAME);
    expect(features).toContain('popup=yes');
    expect(features).toContain('width=1000');
    expect(fakeWin.opener).toBeNull();
  });

  it('openPreferences() falls back to a new tab when the popup is refused', () => {
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    const openSpy = vi.spyOn(window, 'open')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(fakeWin as unknown as Window);

    service.openPreferences();

    expect(openSpy).toHaveBeenCalledTimes(2);
    expect(openSpy.mock.calls[1][1]).toBe('_blank');
  });

  it('openPreferences() does nothing further when both attempts are blocked', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'open').mockReturnValue(null);

    expect(() => service.openPreferences()).not.toThrow();
    vi.advanceTimersByTime(5_000);

    expect(api.getUserTradeUnits).not.toHaveBeenCalled();
  });

  it('openPreferences() reloads the groups once the window closes', () => {
    vi.useFakeTimers();
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    appState.selectedTradeUnits.set(['1085', '9999']);

    service.openPreferences();
    vi.advanceTimersByTime(2_000);
    expect(api.getUserTradeUnits).not.toHaveBeenCalled();

    fakeWin.closed = true;
    vi.advanceTimersByTime(600);

    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1);
    expect(appState.setUserGroups).toHaveBeenCalledWith(GROUPS);
    expect(appState.setTradeUnits).toHaveBeenCalledWith(['1085']);
    // The pruned selection is itself a TU change, which drives the preload — no forced reload on top.
    expect(dataPreload.forceReload).not.toHaveBeenCalled();

    // Polling is torn down — no further poll-driven reloads
    vi.advanceTimersByTime(5_000);
    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1);
  });

  it('forces a full data reload after close when the selection is unchanged', () => {
    vi.useFakeTimers();
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    appState.selectedTradeUnits.set(['1085']);

    service.openPreferences();
    fakeWin.closed = true;
    vi.advanceTimersByTime(600);

    expect(dataPreload.forceReload).toHaveBeenCalledTimes(1);
  });

  it('selects nothing for a user who just gained their first groups — they pick group, then units', () => {
    // Covers both the genuinely-new user and the user who left every group and rejoined (the
    // two are indistinguishable here). Auto-selecting a group's every unit reads as the app
    // choosing for you — the selector's prompts guide the pick instead.
    vi.useFakeTimers();
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);

    service.openPreferences();
    fakeWin.closed = true;
    vi.advanceTimersByTime(600);

    expect(appState.setUserGroups).toHaveBeenCalledWith(GROUPS); // dropdowns fill in…
    expect(appState.setSelectedGroupNames).not.toHaveBeenCalled(); // …but nothing gets picked
    expect(appState.setTradeUnits).not.toHaveBeenCalled();
    expect(dataPreload.forceReload).not.toHaveBeenCalled();
  });

  it('leaves an existing user whose selection was pruned away to re-pick a group and trade units', () => {
    // They removed the group holding their selected trade units in Trade Unit Preferences.
    // Pruning empties the selection — and it must STAY empty ("Select a Group" → "Select Trade
    // Units"), not silently become every unit of whichever group happens to survive.
    vi.useFakeTimers();
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    appState.userGroups.set(GROUPS);
    appState.selectedGroupNames.set(['West']);
    appState.selectedTradeUnits.set(['1085', '2190']);
    const westRemoved = [GROUPS[1]]; // only East is left
    api.getUserTradeUnits.mockReturnValue(of(westRemoved));

    service.openPreferences();
    fakeWin.closed = true;
    vi.advanceTimersByTime(600);

    expect(appState.setSelectedGroupNames).toHaveBeenCalledWith([]); // pruned, not re-picked
    expect(appState.setTradeUnits).toHaveBeenCalledWith([]);         // pruned, not auto-filled
    expect(appState.setTradeUnits).not.toHaveBeenCalledWith(['3000']);
    expect(dataPreload.forceReload).not.toHaveBeenCalled();
  });

  it('does not override All Producers mode after close', () => {
    vi.useFakeTimers();
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    appState.allProducersMode.set(true);

    service.openPreferences();
    fakeWin.closed = true;
    vi.advanceTimersByTime(600);

    expect(appState.setTradeUnits).not.toHaveBeenCalled();
    expect(dataPreload.forceReload).not.toHaveBeenCalled();
  });

  it('openPreferences() logs, but survives, a failed reload after close', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    api.getUserTradeUnits.mockReturnValue(throwError(() => new Error('boom')));

    service.openPreferences();
    fakeWin.closed = true;

    expect(() => vi.advanceTimersByTime(600)).not.toThrow();
    expect(appState.setUserGroups).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not reload anything when the groups come back unchanged', () => {
    vi.useFakeTimers();
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    appState.userGroups.set(GROUPS);            // already had these before opening
    appState.selectedTradeUnits.set(['1085']);

    service.openPreferences();
    fakeWin.closed = true;
    vi.advanceTimersByTime(600);

    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1);
    expect(dataPreload.forceReload).not.toHaveBeenCalled();
  });

  it('refreshes when Origination regains focus while the window is still open, and again after close', () => {
    vi.useFakeTimers();
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    appState.selectedTradeUnits.set(['1085']);

    service.openPreferences();
    window.dispatchEvent(new Event('focus'));           // user clicks back to Origination
    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1);
    expect(dataPreload.forceReload).toHaveBeenCalledTimes(1); // groups changed ([] → GROUPS), selection same

    fakeWin.closed = true;
    vi.advanceTimersByTime(600);
    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(2);
    expect(dataPreload.forceReload).toHaveBeenCalledTimes(1); // second refresh saw no change

    // `closed` can be a lie (severed handle) — focus keeps refreshing until the deadline
    window.dispatchEvent(new Event('focus'));
    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(3);
  });

  it('still refreshes on the real close when a severed handle reported closed from the start', () => {
    // A popup that navigates through a Cross-Origin-Opener-Policy page loses its handle:
    // `closed` reads true while the window is still open. The early poll-driven refresh finds
    // nothing changed — the user hasn't done anything yet — and must NOT end the watch.
    vi.useFakeTimers();
    const fakeWin = { closed: true, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    appState.userGroups.set(GROUPS);
    appState.selectedTradeUnits.set(['1085']);

    service.openPreferences();
    vi.advanceTimersByTime(600);                        // poll believes the lie, refreshes early
    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1);
    expect(dataPreload.forceReload).not.toHaveBeenCalled(); // nothing changed yet

    // Minutes later the user finishes in Trade Unit Preferences, really closes it, and focus
    // returns to Origination — the surviving focus listener picks the change up.
    const changed = [{ ...GROUPS[0], tradeUnitCodes: ['1085', '2190', '4000'] }, GROUPS[1]];
    api.getUserTradeUnits.mockReturnValue(of(changed));
    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event('focus'));

    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(2);
    expect(appState.setUserGroups).toHaveBeenCalledWith(changed);
    expect(dataPreload.forceReload).toHaveBeenCalledTimes(1); // selection unchanged → forced reload
  });

  it('retires the focus watch at the deadline', () => {
    vi.useFakeTimers();
    const fakeWin = { closed: true, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    appState.userGroups.set(GROUPS);

    service.openPreferences();
    vi.advanceTimersByTime(600);
    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31 * 60_000);                // past FOCUS_WATCH_MAX_MS
    window.dispatchEvent(new Event('focus'));
    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1); // watch expired — no refresh

    window.dispatchEvent(new Event('focus'));           // and the listener is gone entirely
    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1);
  });

  it('re-arms the focus watch after a page reload while a preferences window was open', () => {
    // The watch's listeners die with the document on reload, but the popup lives on. A fresh
    // service instance must pick the watch back up from the sessionStorage marker so closing
    // the popup still refreshes the groups.
    sessionStorage.setItem(UserTradeUnitsService.WATCH_MARKER_KEY, String(Date.now() + 60_000));
    TestBed.runInInjectionContext(() => new UserTradeUnitsService());

    window.dispatchEvent(new Event('focus'));

    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1);
    expect(appState.setUserGroups).toHaveBeenCalledWith(GROUPS);
  });

  it('after a reload re-arm, the first fetch only establishes the baseline — no forced reload', () => {
    // The page load already fetched fresh data; reacting to the first focus-refresh as a
    // "change" would spin every loading state for nothing. The SECOND refresh, with a real
    // baseline to compare against, reacts normally.
    sessionStorage.setItem(UserTradeUnitsService.WATCH_MARKER_KEY, String(Date.now() + 60_000));
    TestBed.runInInjectionContext(() => new UserTradeUnitsService());
    appState.selectedTradeUnits.set(['1085']);

    window.dispatchEvent(new Event('focus'));
    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1);
    expect(dataPreload.forceReload).not.toHaveBeenCalled();

    const changed = [{ ...GROUPS[0], tradeUnitCodes: ['1085', '4000'] }, GROUPS[1]];
    api.getUserTradeUnits.mockReturnValue(of(changed));
    window.dispatchEvent(new Event('focus'));
    expect(dataPreload.forceReload).toHaveBeenCalledTimes(1); // real change, selection unchanged
  });

  it('ignores an expired watch marker on startup', () => {
    sessionStorage.setItem(UserTradeUnitsService.WATCH_MARKER_KEY, String(Date.now() - 1));
    TestBed.runInInjectionContext(() => new UserTradeUnitsService());

    window.dispatchEvent(new Event('focus'));

    expect(api.getUserTradeUnits).not.toHaveBeenCalled();
  });

  it('openPreferences() twice keeps a single close-watch', () => {
    vi.useFakeTimers();
    const fakeWin = { closed: false, opener: {}, focus: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);

    service.openPreferences();
    service.openPreferences();
    fakeWin.closed = true;
    vi.advanceTimersByTime(600);

    expect(api.getUserTradeUnits).toHaveBeenCalledTimes(1);
  });
});
