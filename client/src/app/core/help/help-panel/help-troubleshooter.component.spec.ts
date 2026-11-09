import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/angular';
import { Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import type { Customer } from '@models';
import { HelpTroubleshooterComponent } from './help-troubleshooter.component';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { HelpPanelService } from '@core/help/help-panel.service';
import { HelpPanelStateService } from '@core/help/help-panel-state.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';
import { provideTestEnvironment } from '@testing/test-providers';

// The user's groups. West lists its code padded, as some trade-unit feeds do.
const groups = [
  { groupName: 'Central', tradeUnitCodes: ['2040'], tradeUnits: [{ code: '2040', description: 'Pratt, KS' }] },
  { groupName: 'West', tradeUnitCodes: ['2190 '], tradeUnits: [{ code: '2190', description: 'Garden City, KS' }] }
];

function producer(activeTradeUnits: string[]): Customer {
  return { id: 42, name: 'SMITH FARMS LLC', activeTradeUnits } as Customer;
}

async function renderTroubleshooter(options: { assigned?: boolean } = {}) {
  const api = {
    searchCustomers: vi.fn<(searchTerm: string, tradeUnits?: string[]) => Observable<Customer[]>>().mockReturnValue(of([])),
    searchOdsCustomers: vi.fn<(searchTerm: string) => Observable<Customer[]>>().mockReturnValue(of([]))
  };
  const tracking = { trackHelpTroubleshoot: vi.fn() };
  const openPreferences = vi.fn();
  const result = await render(HelpTroubleshooterComponent, {
    inputs: { tree: 'missing-producer', index: 0 },
    providers: provideTestEnvironment({
      extraProviders: [
        { provide: ApiService, useValue: api },
        { provide: UsageTrackingService, useValue: tracking },
        { provide: UserTradeUnitsService, useValue: { openPreferences } }
      ]
    })
  });
  const injector = result.fixture.debugElement.injector;
  const appState = injector.get(AppStateService);
  const tradeUnitContext = injector.get(TradeUnitContext);
  if (options.assigned === false) {
    tradeUnitContext.markNoTradeUnitAssignments();
  } else {
    tradeUnitContext.setUserGroups(groups);
    tradeUnitContext.setTradeUnits(['2040']);
  }
  const panel = injector.get(HelpPanelService);
  result.fixture.detectChanges();

  /** Types a name, selects Check, and waits for the answer to render. */
  async function lookUp(name: string): Promise<void> {
    fireEvent.input(screen.getByLabelText(/producer's name/), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await vi.waitFor(() => expect(tracking.trackHelpTroubleshoot).toHaveBeenCalled());
    result.fixture.detectChanges();
  }

  /** Step 3's text, whitespace collapsed. */
  function answer(): string {
    return (document.getElementById('help-trouble-0-result')?.textContent ?? '').replace(/\s+/g, ' ');
  }

  return { ...result, api, tracking, openPreferences, appState, tradeUnitContext, panel, lookUp, answer };
}

describe('HelpTroubleshooterComponent', () => {
  it('fills in step 1 from the trade units the user has selected, and can point at the selector', async () => {
    const { panel } = await renderTroubleshooter();
    const showOnScreen = vi.spyOn(panel, 'showOnScreen').mockImplementation(() => undefined);

    expect(screen.getByText('2040 · Pratt, KS', { selector: 'strong' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show me the selector' }));

    expect(showOnScreen).toHaveBeenCalledWith('trade-unit-selector');
  });

  it('sends a user with no trade units to Trade Unit Preferences first', async () => {
    const { openPreferences } = await renderTroubleshooter({ assigned: false });

    expect(screen.getByText(/You don't have any trade units assigned yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open Trade Unit Preferences/ }));

    expect(openPreferences).toHaveBeenCalled();
  });

  it('asks for at least 3 letters before searching', async () => {
    const { fixture, api, tracking } = await renderTroubleshooter();

    fireEvent.input(screen.getByLabelText(/producer's name/), { target: { value: ' Sm ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fixture.detectChanges();

    expect(screen.getByText('Type at least 3 letters.')).toBeTruthy();
    expect(screen.getByLabelText(/producer's name/).getAttribute('aria-invalid')).toBe('true');
    expect(api.searchCustomers).not.toHaveBeenCalled();
    expect(tracking.trackHelpTroubleshoot).not.toHaveBeenCalled();
  });

  it('says the producer is already in a selected trade unit and opens them, closing the panel on a phone', async () => {
    const { api, tracking, panel, fixture, lookUp, answer } = await renderTroubleshooter();
    fixture.debugElement.injector.get(HelpPanelStateService).desktop.set(false);
    const close = vi.spyOn(panel, 'close');
    const navigate = vi.spyOn(fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    api.searchCustomers.mockReturnValue(of([producer([' 2040 '])]));

    await lookUp('  Smith Farms  ');

    // The trimmed name, across every trade unit (none passed).
    expect(api.searchCustomers).toHaveBeenCalledWith('Smith Farms');
    expect(answer()).toContain('SMITH FARMS LLC is in trade unit 2040 · Pratt, KS, which you have selected.');
    // Telemetry gets the outcome only, never the name.
    expect(tracking.trackHelpTroubleshoot).toHaveBeenCalledWith('in-selection');

    fireEvent.click(screen.getByRole('button', { name: 'Open producer' }));

    expect(navigate).toHaveBeenCalledWith(['/'], { queryParams: { customerId: 42 } });
    expect(close).toHaveBeenCalled();
  });

  it('offers to switch to one of the user\'s other trade units, selecting the code exactly as its group lists it', async () => {
    const { appState, tradeUnitContext, tracking, fixture, api, lookUp, answer } = await renderTroubleshooter();
    api.searchCustomers.mockReturnValue(of([producer(['2190'])]));

    await lookUp('Smith');

    expect(tracking.trackHelpTroubleshoot).toHaveBeenCalledWith('other-trade-unit');
    expect(answer()).toContain('Found SMITH FARMS LLC in trade unit 2190 · Garden City, KS, which isn\'t selected.');
    expect(screen.queryByRole('button', { name: 'Open producer' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to 2190' }));
    fixture.detectChanges();

    expect(appState.allProducersMode()).toBe(false);
    expect(tradeUnitContext.selectedGroupNames()).toEqual(['West']);
    // Padded, as the group has it: a trimmed copy would show as unselected in the selector.
    expect(tradeUnitContext.selectedTradeUnits()).toEqual(['2190 ']);
    expect(answer()).toContain('Switched to trade unit 2190 · Garden City, KS.');
    expect(screen.queryByRole('button', { name: 'Switch to 2190' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open producer' })).toBeTruthy();
  });

  it('counts nothing as selected in All Producers mode, so a producer in the user\'s own unit can still be switched to', async () => {
    const { appState, tradeUnitContext, fixture, api, lookUp } = await renderTroubleshooter();
    appState.setAllProducersMode(true);
    fixture.detectChanges();
    api.searchCustomers.mockReturnValue(of([producer(['2040'])]));

    expect(screen.getByText(/You're in/)).toBeTruthy();

    await lookUp('Smith');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to 2040' }));

    expect(appState.allProducersMode()).toBe(false);
    expect(tradeUnitContext.selectedGroupNames()).toEqual(['Central']);
    expect(tradeUnitContext.selectedTradeUnits()).toEqual(['2040']);
  });

  it('points to Trade Unit Preferences when the producer is only in a trade unit the user doesn\'t have', async () => {
    const { api, openPreferences, lookUp, answer } = await renderTroubleshooter();
    api.searchCustomers.mockReturnValue(of([producer(['9999'])]));

    await lookUp('Smith');

    expect(answer()).toContain('Found SMITH FARMS LLC in trade unit 9999, which isn\'t one of yours.');
    expect(screen.queryByRole('button', { name: /Switch to/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Open Trade Unit Preferences/ }));

    expect(openPreferences).toHaveBeenCalled();
  });

  it('falls back to the customer master and sets up onboarding in All Producers mode', async () => {
    const { api, appState, tradeUnitContext, panel, tracking, lookUp, answer } = await renderTroubleshooter();
    const showOnScreen = vi.spyOn(panel, 'showOnScreen').mockImplementation(() => undefined);
    api.searchOdsCustomers.mockReturnValue(of([{ id: 0, name: 'SMITH FARMS INC' } as Customer]));

    await lookUp('Smith');

    expect(api.searchOdsCustomers).toHaveBeenCalledWith('Smith');
    expect(tracking.trackHelpTroubleshoot).toHaveBeenCalledWith('not-added');
    expect(answer()).toContain('SMITH FARMS INC is in Scoular\'s customer list but hasn\'t been added to a trade unit');

    fireEvent.click(screen.getByRole('button', { name: 'Open and add' }));

    expect(appState.allProducersMode()).toBe(true);
    expect(tradeUnitContext.selectedGroupNames()).toEqual([]);
    expect(tradeUnitContext.selectedTradeUnits()).toEqual([]);
    expect(showOnScreen).toHaveBeenCalledWith('producer-search');
  });

  it('says when the producer isn\'t anywhere and offers the help desk', async () => {
    const { panel, tracking, lookUp, answer } = await renderTroubleshooter();
    const escalate = vi.spyOn(panel, 'escalate');

    await lookUp('Nobody Farms');

    expect(tracking.trackHelpTroubleshoot).toHaveBeenCalledWith('not-found');
    expect(answer()).toContain('I couldn\'t find a producer called Nobody Farms anywhere.');

    fireEvent.click(screen.getByRole('button', { name: 'Still need help?' }));

    expect(escalate).toHaveBeenCalled();
  });

  it('shows a retry message when the search fails, and lets the user check again', async () => {
    const { api, tracking, lookUp } = await renderTroubleshooter();
    api.searchCustomers.mockReturnValue(throwError(() => new Error('500')));

    await lookUp('Smith');

    expect(tracking.trackHelpTroubleshoot).toHaveBeenCalledWith('error');
    expect(screen.getByRole('alert').textContent).toContain('The search didn\'t work just now.');
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
