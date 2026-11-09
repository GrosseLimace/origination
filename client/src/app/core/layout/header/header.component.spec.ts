import { signal } from '@angular/core';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { MsalService } from '@azure/msal-angular';
import { HeaderComponent } from './header.component';
import { ModuleManifest } from '@core/modules/module-manifest';
import { APP_MODULES } from '@core/modules/module-registry';
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
  // The header knows no module: it draws whatever links the modules declare. Listed out of order on purpose.
  const modules: ModuleManifest[] = [
    {
      id: 'lists',
      nav: [{ requires: ['query-library:read'], label: 'Build a List', path: '/build-list', icon: ['M3 6h18'], order: 20, menu: 'main' }],
    },
    {
      id: 'producers',
      nav: [{ requires: ['planting-estimates:read'], label: 'Planting Intentions Dashboard', shortLabel: 'Dashboard', path: '/dashboard', icon: ['M18 20V10'], order: 10, menu: 'main' }],
    },
    {
      id: 'usage-analytics',
      nav: [{ requires: ['usage-reports:read'], label: 'Usage Dashboard', path: '/usage-dashboard', icon: ['M16 21v-2'], order: 10, menu: 'user' }],
    },
  ];

  function baseProviders(extra: any[] = [], access: PermissionStub = permissionStub()) {
    return provideTestEnvironment({
      extraProviders: [
        { provide: ThemeService, useValue: themeStub },
        { provide: APP_MODULES, useValue: modules },
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

  describe("a module's main links", () => {
    /** The desktop bar's links, in order, as "short label / full label": CSS shows one or the other by width. */
    function desktopLinks(container: Element): string[] {
      return [...container.querySelectorAll('app-button')]
        .map(button => [...button.querySelectorAll('span')].map(label => label.textContent!.trim()).join(' / '));
    }

    it('are shown in order on the desktop bar and in the mobile menu, to a user holding their permissions', async () => {
      const { container, fixture } = await render(HeaderComponent, {
        providers: baseProviders([], permissionStub(['query-library:read', 'planting-estimates:read'])),
      });

      expect(desktopLinks(container)).toEqual(['Dashboard / Planting Intentions Dashboard', 'Build a List / Build a List']);

      fixture.componentInstance.toggleMobileMenu();
      fixture.detectChanges();
      const menu = within(screen.getByRole('navigation')).getAllByRole('button').map(button => button.textContent!.trim());
      // The header's own items, home and Help, frame the modules' links.
      expect(menu).toEqual(['Producers', 'Planting Intentions Dashboard', 'Build a List', 'Help']);
    });

    it('leave out a link whose permissions the user lacks', async () => {
      const { container } = await render(HeaderComponent, { providers: baseProviders([], permissionStub(['query-library:read'])) });

      expect(desktopLinks(container)).toEqual(['Build a List / Build a List']);
    });

    it('appear once the permissions load', async () => {
      const access = permissionStub();
      const { container, fixture } = await render(HeaderComponent, { providers: baseProviders([], access) });
      expect(desktopLinks(container)).toEqual([]);

      access.grant('planting-estimates:read');
      fixture.detectChanges();

      expect(desktopLinks(container)).toEqual(['Dashboard / Planting Intentions Dashboard']);
    });
  });

  describe("a module's profile-menu link", () => {
    async function openProfileMenu(access = permissionStub()) {
      const msal = makeMsalServiceMock({ name: 'Jane Doe', username: 'jdoe@scoular.com' });
      await render(HeaderComponent, { providers: baseProviders([{ provide: MsalService, useValue: msal }], access) });
      await userEvent.click(screen.getAllByTitle('Jane Doe')[0]);
    }

    it('is shown to a user holding its permissions', async () => {
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
