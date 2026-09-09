import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { of, throwError } from 'rxjs';
import { TradeUnitSelectorComponent } from './trade-unit-selector.component';
import { AppStateService } from '@core/services/app-state.service';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';

const GROUP = { groupName: 'West', tradeUnitCodes: ['1085'], tradeUnits: [{ code: '1085' }] };

describe('TradeUnitSelectorComponent — empty / error states', () => {
  let tradeUnits: {
    load: ReturnType<typeof vi.fn>;
    openPreferences: ReturnType<typeof vi.fn>;
    computeAvailableTradeUnits: (g: { tradeUnitCodes: string[] }[]) => string[];
  };

  beforeEach(() => {
    tradeUnits = {
      // Mirror the real service: an empty result flags "no assignments" in app state.
      load: vi.fn(() => {
        TestBed.inject(AppStateService).noTradeUnitAssignments.set(true);
        return of([]);
      }),
      openPreferences: vi.fn(),
      computeAvailableTradeUnits: (g) => g.flatMap(x => x.tradeUnitCodes),
    };
  });

  function renderSelector(stacked = false) {
    return render(TradeUnitSelectorComponent, {
      inputs: { stacked },
      providers: [AppStateService, { provide: UserTradeUnitsService, useValue: tradeUnits }],
    });
  }

  it('points a user with no assignments at Trade Unit Preferences instead of a bare Retry', async () => {
    await renderSelector();

    expect(screen.getByText('No trade units assigned')).toBeTruthy();
    expect(screen.queryByText('Trade units unavailable')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /set up in trade unit preferences/i }));
    expect(tradeUnits.openPreferences).toHaveBeenCalledTimes(1);
  });

  it('drops the empty-state callout as soon as groups arrive (e.g. after the popup closes)', async () => {
    const { fixture } = await renderSelector();
    expect(screen.getByText('No trade units assigned')).toBeTruthy();

    TestBed.inject(AppStateService).setUserGroups([GROUP]);
    fixture.detectChanges();

    expect(screen.queryByText('No trade units assigned')).toBeNull();
    expect(screen.getByRole('button', { name: /select a group|west/i })).toBeTruthy();
  });

  it('Retry in the empty state re-requests the groups', async () => {
    await renderSelector();
    expect(tradeUnits.load).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(tradeUnits.load).toHaveBeenCalledTimes(2);
  });

  it('a failed request still shows the unavailable + Retry state', async () => {
    tradeUnits.load.mockReturnValue(throwError(() => new Error('boom')));
    await renderSelector();

    expect(screen.getByText('Trade units unavailable')).toBeTruthy();
    expect(screen.queryByText('No trade units assigned')).toBeNull();
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeTruthy();
  });
});
