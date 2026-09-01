import { Injectable, inject, DestroyRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, debounceTime, filter, switchMap, take } from 'rxjs/operators';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { ApiService } from './api.service';
import { AppStateService } from './app-state.service';

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly destroyRef = inject(DestroyRef);

  // Guard: don't save back to the API until we've loaded the initial prefs from the DB.
  // Without this, the debounced observers fire with empty initial signal values (~800ms)
  // and overwrite previously-saved preferences before the GET response returns.
  private prefsLoaded = false;

  constructor() {
    const msalBroadcast = inject(MsalBroadcastService);
    const msalService = inject(MsalService);

    // Wait for the user to be authenticated before loading preferences.
    // Without this guard, the GET fires before MSAL has a token (401 on first load).
    msalBroadcast.inProgress$.pipe(
      filter(s => s === InteractionStatus.None && msalService.instance.getAllAccounts().length > 0),
      take(1),
      switchMap(() => this.apiService.getUserPreference()),
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(pref => {
      this.prefsLoaded = true;
      if (!pref) return;
      // This GET races /usertradeunits. If the groups already came back EMPTY, the saved selection
      // is for trade units the user no longer has — re-applying it would make the preload request
      // them, the server would strip them to "no filter", and they'd see every producer. Skip it.
      if (this.appState.noTradeUnitAssignments()) return;
      // If the groups already came back populated, keep only what's still assigned (same pruning
      // UserTradeUnitsService does when the groups land after the preference).
      const groups = this.appState.userGroups();
      const groupNames = groups.length
        ? pref.selectedGroupNames.filter(g => groups.some(x => x.groupName === g))
        : pref.selectedGroupNames;
      const available = new Set(groups.flatMap(g => g.tradeUnitCodes));
      const units = groups.length
        ? pref.selectedTradeUnits.filter(u => available.has(u))
        : pref.selectedTradeUnits;
      if (groupNames.length) this.appState.selectedGroupNames.set(groupNames);
      if (units.length)      this.appState.selectedTradeUnits.set(units);
      this.appState.savePrefsToLocalStorage(groupNames, units);
    });

    // Save to localStorage + API whenever trade units change (debounced).
    // Skip while in "All Producers" mode — that mode clears the selection in-memory but must
    // never overwrite the saved preference (which stays the user's real trade group).
    toObservable(this.appState.selectedTradeUnits).pipe(
      debounceTime(800),
      filter(() => this.prefsLoaded && !this.appState.allProducersMode()),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(units => {
      const groups = this.appState.selectedGroupNames();
      this.appState.savePrefsToLocalStorage(groups, units);
      this.apiService.saveUserPreference(groups, units).pipe(catchError(() => of(null))).subscribe();
    });

    // Save to localStorage + API whenever group names change (debounced).
    // Skip while in "All Producers" mode (see note above) so the saved preference is preserved.
    toObservable(this.appState.selectedGroupNames).pipe(
      debounceTime(800),
      filter(() => this.prefsLoaded && !this.appState.allProducersMode()),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(groups => {
      const units = this.appState.selectedTradeUnits();
      this.appState.savePrefsToLocalStorage(groups, units);
      this.apiService.saveUserPreference(groups, units).pipe(catchError(() => of(null))).subscribe();
    });
  }
}
