import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of, throwError, Observable } from 'rxjs';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { UserPreferencesService } from './user-preferences.service';
import { ApiService } from './api.service';
import { AppStateService } from './app-state.service';

/**
 * The saved trade-unit selection round-trip. Pins the guards that each exist because of a real bug:
 *  - the GET waits for MSAL to be idle WITH an account (firing earlier 401s on first load),
 *  - nothing is saved back until the GET has answered (the debounced save used to overwrite the saved
 *    preference with the empty initial selection),
 *  - a user whose trade-unit assignments came back EMPTY does not get the stale selection re-applied,
 *  - a saved selection is pruned to what the user is still assigned,
 *  - "All Producers" mode never overwrites the saved preference,
 *  - saves are debounced (800ms) and a failing save is swallowed.
 */

type Pref = { selectedGroupNames: string[]; selectedTradeUnits: string[] };
type Group = { groupName: string; tradeUnitCodes: string[] };

const GROUPS: Group[] = [
  { groupName: 'West', tradeUnitCodes: ['1085', '2190'] },
  { groupName: 'East', tradeUnitCodes: ['3000'] },
];

describe('UserPreferencesService', () => {
  let inProgress$: Subject<InteractionStatus>;
  let accounts: { username: string }[];
  let getUserPreference: ReturnType<typeof vi.fn<() => Observable<Pref>>>;
  let saveUserPreference: ReturnType<typeof vi.fn<(g: string[], u: string[]) => Observable<void>>>;
  let appState: {
    userGroups: ReturnType<typeof signal<Group[]>>;
    noTradeUnitAssignments: ReturnType<typeof signal<boolean>>;
    selectedGroupNames: ReturnType<typeof signal<string[]>>;
    selectedTradeUnits: ReturnType<typeof signal<string[]>>;
    allProducersMode: ReturnType<typeof signal<boolean>>;
    savePrefsToLocalStorage: ReturnType<typeof vi.fn>;
  };

  function create(): void {
    TestBed.inject(UserPreferencesService);
    TestBed.tick(); // let toObservable emit the initial selection
  }

  /** MSAL finishes its redirect handling with a signed-in account. */
  function signIn(): void {
    accounts = [{ username: 'originator@scoular.example' }];
    inProgress$.next(InteractionStatus.None);
  }

  /** Sign in and let the applied preference's own debounced echo-save run out, so a test starts
   *  from a quiet "loaded" state. */
  function signInAndSettle(): void {
    signIn();
    TestBed.tick();
    vi.advanceTimersByTime(800);
    saveUserPreference.mockClear();
    appState.savePrefsToLocalStorage.mockClear();
  }

  /** Change a selection signal, let toObservable see it, then run out the debounce. */
  function select(sig: 'selectedTradeUnits' | 'selectedGroupNames', value: string[]): void {
    appState[sig].set(value);
    TestBed.tick();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    inProgress$ = new Subject<InteractionStatus>();
    accounts = [];
    getUserPreference = vi.fn(() => of({ selectedGroupNames: ['West'], selectedTradeUnits: ['1085'] }));
    saveUserPreference = vi.fn(() => of(undefined));
    appState = {
      userGroups: signal<Group[]>([]),
      noTradeUnitAssignments: signal(false),
      selectedGroupNames: signal<string[]>([]),
      selectedTradeUnits: signal<string[]>([]),
      allProducersMode: signal(false),
      savePrefsToLocalStorage: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getUserPreference, saveUserPreference } },
        { provide: AppStateService, useValue: appState },
        { provide: MsalBroadcastService, useValue: { inProgress$ } },
        { provide: MsalService, useValue: { instance: { getAllAccounts: () => accounts } } },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loading the saved preference', () => {
    it('waits until MSAL is idle and an account exists', () => {
      create();

      inProgress$.next(InteractionStatus.HandleRedirect);
      inProgress$.next(InteractionStatus.None); // idle but no account yet
      expect(getUserPreference).not.toHaveBeenCalled();

      signIn();
      expect(getUserPreference).toHaveBeenCalledTimes(1);
    });

    it('loads only once even if MSAL goes idle again later', () => {
      create();
      signIn();
      inProgress$.next(InteractionStatus.AcquireToken);
      inProgress$.next(InteractionStatus.None);

      expect(getUserPreference).toHaveBeenCalledTimes(1);
    });

    it('applies the saved selection as-is while the trade-unit groups have not arrived yet', () => {
      create();
      signIn();

      expect(appState.selectedGroupNames()).toEqual(['West']);
      expect(appState.selectedTradeUnits()).toEqual(['1085']);
      expect(appState.savePrefsToLocalStorage).toHaveBeenCalledWith(['West'], ['1085']);
    });

    it('prunes groups and trade units the user is no longer assigned', () => {
      appState.userGroups.set(GROUPS);
      getUserPreference.mockReturnValue(of({ selectedGroupNames: ['West', 'Gone'], selectedTradeUnits: ['1085', '9999'] }));
      create();
      signIn();

      expect(appState.selectedGroupNames()).toEqual(['West']);
      expect(appState.selectedTradeUnits()).toEqual(['1085']);
      expect(appState.savePrefsToLocalStorage).toHaveBeenCalledWith(['West'], ['1085']);
    });

    it('does not re-apply a saved selection when the user has no trade-unit assignments', () => {
      appState.noTradeUnitAssignments.set(true);
      create();
      signIn();

      expect(appState.selectedGroupNames()).toEqual([]);
      expect(appState.selectedTradeUnits()).toEqual([]);
      expect(appState.savePrefsToLocalStorage).not.toHaveBeenCalled();
    });

    it('leaves the current selection alone when pruning removes everything', () => {
      appState.userGroups.set(GROUPS);
      appState.selectedTradeUnits.set(['3000']);
      getUserPreference.mockReturnValue(of({ selectedGroupNames: ['Gone'], selectedTradeUnits: ['9999'] }));
      create();
      signIn();

      expect(appState.selectedTradeUnits()).toEqual(['3000']);
    });
  });

  describe('saving changes', () => {
    it('does not save anything before the saved preference has loaded', () => {
      create();
      select('selectedTradeUnits', ['1085']);
      vi.advanceTimersByTime(5_000);

      expect(saveUserPreference).not.toHaveBeenCalled();
    });

    it('saves once the preference has loaded, debounced to the last change', () => {
      create();
      signInAndSettle();

      select('selectedTradeUnits', ['2190']);
      vi.advanceTimersByTime(400);
      select('selectedTradeUnits', ['2190', '3000']);
      vi.advanceTimersByTime(799);
      expect(saveUserPreference).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(saveUserPreference).toHaveBeenCalledTimes(1);
      expect(saveUserPreference).toHaveBeenCalledWith(['West'], ['2190', '3000']);
      expect(appState.savePrefsToLocalStorage).toHaveBeenLastCalledWith(['West'], ['2190', '3000']);
    });

    it('saves group-name changes together with the current trade units', () => {
      create();
      signInAndSettle();

      select('selectedGroupNames', ['East']);
      vi.advanceTimersByTime(800);

      expect(saveUserPreference).toHaveBeenCalledWith(['East'], ['1085']);
    });

    it('a failed GET still unlocks saving (treated as "no saved preference")', () => {
      getUserPreference.mockReturnValue(throwError(() => new Error('500')));
      create();
      signIn();

      select('selectedTradeUnits', ['3000']);
      vi.advanceTimersByTime(800);

      expect(saveUserPreference).toHaveBeenCalledWith([], ['3000']);
    });

    it('never overwrites the saved preference while in All Producers mode', () => {
      create();
      signInAndSettle();
      appState.allProducersMode.set(true);

      select('selectedTradeUnits', []);
      select('selectedGroupNames', []);
      vi.advanceTimersByTime(5_000);

      expect(saveUserPreference).not.toHaveBeenCalled();
    });

    it('swallows a failing save', () => {
      create();
      signInAndSettle();
      saveUserPreference.mockReturnValue(throwError(() => new Error('500')));

      select('selectedTradeUnits', ['3000']);
      expect(() => vi.advanceTimersByTime(800)).not.toThrow();
      expect(saveUserPreference).toHaveBeenCalled();
    });
  });
});
