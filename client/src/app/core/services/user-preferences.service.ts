import { Injectable, inject, DestroyRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, debounceTime } from 'rxjs/operators';
import { ApiService } from './api.service';
import { AppStateService } from './app-state.service';

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Sync from DB on startup — DB wins over localStorage for cross-device support
    this.apiService.getUserPreference().pipe(
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(pref => {
      if (!pref) return;
      if (pref.selectedGroupNames.length) this.appState.selectedGroupNames.set(pref.selectedGroupNames);
      if (pref.selectedTradeUnits.length)  this.appState.selectedTradeUnits.set(pref.selectedTradeUnits);
      this.appState.savePrefsToLocalStorage(pref.selectedGroupNames, pref.selectedTradeUnits);
    });

    // Save to localStorage + API whenever trade units change (debounced)
    toObservable(this.appState.selectedTradeUnits).pipe(
      debounceTime(800),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(units => {
      const groups = this.appState.selectedGroupNames();
      this.appState.savePrefsToLocalStorage(groups, units);
      this.apiService.saveUserPreference(groups, units).pipe(catchError(() => of(null))).subscribe();
    });

    // Save to localStorage + API whenever group names change (debounced)
    toObservable(this.appState.selectedGroupNames).pipe(
      debounceTime(800),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(groups => {
      const units = this.appState.selectedTradeUnits();
      this.appState.savePrefsToLocalStorage(groups, units);
      this.apiService.saveUserPreference(groups, units).pipe(catchError(() => of(null))).subscribe();
    });
  }
}
