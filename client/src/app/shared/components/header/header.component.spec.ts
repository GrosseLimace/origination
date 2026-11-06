import { signal } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { MsalService } from '@azure/msal-angular';
import { HeaderComponent } from './header.component';
import { ThemeService } from '@core/services/theme.service';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';
import { WhatsNewService } from '@core/services/whats-new.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { provideTestEnvironment } from '@testing/test-providers';
import { makeMsalServiceMock } from '@testing/msal.mocks';

// HeaderComponent uses an external templateUrl — these tests confirm the Vitest +
// @analogjs/vite-plugin-angular pipeline AOT-inlines and renders real component DOM.
// The two root services with side-effecting constructors (ThemeService -> matchMedia,
// PermissionService -> GET /api/me/permissions) are stubbed so the component renders in isolation.
describe('HeaderComponent', () => {
  const themeStub = { isDarkMode: signal(false), toggleTheme: () => undefined };
  // The real service calls window.open — stub it so no popup is attempted under test.
  const tradeUnitsStub = { openPreferences: vi.fn() };
  // The header reads hasUnseen() for the unread dot and version() for the build line; the real
  // service fetches both over HTTP on construction.
  const whatsNewStub = { hasUnseen: signal(false), version: signal<any>(null) };
  const usageTrackingStub = { trackWhatsNewOpened: vi.fn() };

  function baseProviders(extra: any[] = [], access: PermissionStub = permissionStub()) {
    return provideTestEnvironment({
      extraProviders: [
        { provide: ThemeService, useValue: themeStub },
        providePermissions(access),
        { provide: UserTradeUnitsService, useValue: tradeUnitsStub },
        { provide: WhatsNewService, useValue: whatsNewStub },
        { provide: UsageTrackingService, useValue: usageTrackingStub },
        ...extra,
      ],
    });
  }

  it('should render the app shell from its external template', async () => {
    await render(HeaderComponent, { providers: baseProviders() });

    // The "Origination Workbench" wordmark lives in the header template — its presence
    // proves the external templateUrl was compiled and rendered.
    expect(screen.getAllByText('Origination Workbench').length).toBeGreaterThan(0);
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

  describe('Usage Dashboard menu item', () => {
    async function openProfileMenu(access = permissionStub()) {
      const msal = makeMsalServiceMock({ name: 'Jane Doe', username: 'jdoe@scoular.com' });
      await render(HeaderComponent, { providers: baseProviders([{ provide: MsalService, useValue: msal }], access) });
      await userEvent.click(screen.getAllByTitle('Jane Doe')[0]);
    }

    it('is shown to a holder of usage-reports:read, the permission the route and the API check', async () => {
      await openProfileMenu(permissionStub(['usage-reports:read']));

      expect(screen.getAllByRole('button', { name: /usage dashboard/i }).length).toBeGreaterThan(0);
    });

    it('is hidden from everyone else', async () => {
      await openProfileMenu(permissionStub(['usage-exclusions:manage']));

      expect(screen.queryByRole('button', { name: /usage dashboard/i })).toBeNull();
    });
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
