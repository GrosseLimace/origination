import { Signal, computed } from '@angular/core';

import { AppStateService } from '@core/services/app-state.service';

/**
 * The comma-separated trade-unit filter the usage endpoints expect, derived from the shared
 * trade-unit selector.
 *
 * When a *group* is selected but no individual trade unit, the group is expanded to its member
 * codes — otherwise the dashboard would fall back to "no filter" and report on every originator
 * rather than the selected group.
 */
export function tradeUnitKeySignal(appState: AppStateService): Signal<string | undefined> {
  return computed(() => {
    const selected = appState.selectedTradeUnits();
    if (selected.length > 0) return selected.join(',');

    const groupNames = appState.selectedGroupNames();
    if (groupNames.length > 0) {
      const codes = appState.userGroups()
        .filter(g => groupNames.includes(g.groupName))
        .flatMap(g => g.tradeUnitCodes);
      if (codes.length > 0) return codes.join(',');
    }
    return undefined;
  });
}
