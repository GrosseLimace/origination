import { signal } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { MsalService } from '@azure/msal-angular';
import { HeaderComponent } from './header.component';
import { ThemeService } from '@core/services/theme.service';
import { UserRolesService } from '@core/services/user-roles.service';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';
import { provideTestEnvironment } from '@testing/test-providers';
import { makeMsalServiceMock } from '@testing/msal.mocks';

// HeaderComponent uses an external templateUrl — these tests confirm the Vitest +
// @analogjs/vite-plugin-angular pipeline AOT-inlines and renders real component DOM.
// The two root services with side-effecting constructors (ThemeService -> matchMedia,
// UserRolesService -> GET /api/me) are stubbed so the component renders in isolation.
describe('HeaderComponent', () => {
  const themeStub = { isDarkMode: signal(false), toggleTheme: () => undefined };
  const rolesStub = { isAdmin: signal(false), roles: signal<string[]>([]) };
  // The real service calls window.open — stub it so no popup is attempted under test.
  const tradeUnitsStub = { openPreferences: vi.fn() };

  function baseProviders(extra: any[] = []) {
    return provideTestEnvironment({
      extraProviders: [
        { provide: ThemeService, useValue: themeStub },
        { provide: UserRolesService, useValue: rolesStub },
        { provide: UserTradeUnitsService, useValue: tradeUnitsStub },
        ...extra,
      ],
    });
  }

  it('should render the app shell from its external template', async () => {
    await render(HeaderComponent, { providers: baseProviders() });

    // The "Origination" wordmark lives in the header template — its presence proves
    // the external templateUrl was compiled and rendered.
    expect(screen.getAllByText('Origination').length).toBeGreaterThan(0);
  });

  it('should sign out through MSAL when Sign out is clicked', async () => {
    const msal = makeMsalServiceMock({ name: 'Jane Doe', username: 'jdoe@scoular.com' });
    const logoutSpy = vi.spyOn(msal, 'logoutRedirect');

    await render(HeaderComponent, {
      providers: baseProviders([{ provide: MsalService, useValue: msal }]),
    });

    // Sign out lives in the profile dropdown — open it first (the profile button carries
    // the account name as its title), then click Sign out.
    await userEvent.click(screen.getAllByTitle('Jane Doe')[0]);
    await userEvent.click(screen.getAllByRole('button', { name: /sign out/i })[0]);

    expect(logoutSpy).toHaveBeenCalled();
  });

  it('should open Trade Unit Preferences from the profile dropdown and close the menu', async () => {
    tradeUnitsStub.openPreferences.mockClear();
    const msal = makeMsalServiceMock({ name: 'Jane Doe', username: 'jdoe@scoular.com' });

    await render(HeaderComponent, {
      providers: baseProviders([{ provide: MsalService, useValue: msal }]),
    });

    await userEvent.click(screen.getAllByTitle('Jane Doe')[0]);
    await userEvent.click(screen.getAllByRole('button', { name: /trade unit preferences/i })[0]);

    expect(tradeUnitsStub.openPreferences).toHaveBeenCalledTimes(1);
    // Menu closes after the click — the entry is no longer in the DOM.
    expect(screen.queryByRole('button', { name: /trade unit preferences/i })).toBeNull();
  });
});
