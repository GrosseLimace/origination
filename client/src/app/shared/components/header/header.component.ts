// Angular core
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, inject, signal } from '@angular/core';

// Angular common
import { CommonModule } from '@angular/common';

// Angular router
import { NavigationEnd, Router } from '@angular/router';

// Angular HTTP
import { HttpClient } from '@angular/common/http';

// MSAL
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';

// RxJS
import { EMPTY, filter, from, switchMap, take } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// Project services
import { ThemeService } from '@core/services/theme.service';
import { AppStateService } from '@core/services/app-state.service';
import { UserRolesService } from '@core/services/user-roles.service';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';
import { WhatsNewService } from '@core/services/whats-new.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { HelpPanelService } from '@core/services/help-panel.service';

// Shared components
import { ButtonComponent } from '@shared/components/button/button.component';

// Environment
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  host: { class: 'block sticky top-0 z-50' },
  templateUrl: './header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent {
  themeService = inject(ThemeService);
  appState = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly msalService = inject(MsalService);
  private readonly msalBroadcast = inject(MsalBroadcastService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userRoles = inject(UserRolesService);
  private readonly userTradeUnits = inject(UserTradeUnitsService);
  /** Public: the template reads hasUnseen() and version() straight off it. */
  readonly whatsNew = inject(WhatsNewService);
  private readonly usageTracking = inject(UsageTrackingService);
  /** Public: the template reads open() for the Help button's pressed state. */
  readonly helpPanel = inject(HelpPanelService);

  readonly envName = environment.envName;
  readonly bidSheetEnabled = environment.bidSheetEnabled;
  // Groups (daily recap + @-mentionable in notes). On in every environment — see
  // environment.dailyDigestEnabled, which still carries the original Daily Digest name.
  readonly dailyDigestEnabled = environment.dailyDigestEnabled;
  // Gate the Usage Dashboard nav button to users who can actually open it: the `Admin` app role.
  // Group membership is never checked directly — each environment has its own Super Users security
  // group (Origination App Dev / QA / Prod Super Users), where managers and IT/admin are both
  // added, that's assigned the Admin role on that env's API Enterprise Application, and membership
  // flows into the access token's roles claim. Route re-enforces via `usageDashboardGuard`, and
  // every dashboard endpoint re-enforces the same policy server-side. Everyone who gets in sees the
  // whole organisation and may filter it by any manager.
  get usageDashboardEnabled(): boolean {
    return environment.usageDashboardEnabled && this.userRoles.canViewUsageDashboard();
  }

  mobileMenuOpen = signal(false);
  profileMenuOpen = signal(false);
  profilePhotoUrl = signal<string | null>(null);
  // Delegates to UserRolesService.isAdmin — the SPA's ID token has no `roles`
  // claim, so we read from /api/me instead (populated by UserRolesService).
  readonly isAdmin = this.userRoles.isAdmin;
  private readonly currentUrl = signal(this.router.url);

  constructor() {
    // Track URL via NavigationEnd so OnPush re-renders correctly after every navigation
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((e: NavigationEnd) => {
      this.currentUrl.set(e.urlAfterRedirects);
    });

    this.msalBroadcast.inProgress$.pipe(
      filter(status => status === InteractionStatus.None),
      take(1),
      switchMap(() => {
        const account = this._getAccount();
        if (!account) return EMPTY;

        // Admin role is populated by UserRolesService via /api/me — no need to
        // read idTokenClaims.roles here (SPA ID token doesn't carry it).
        return from(this.msalService.instance.acquireTokenSilent({
          scopes: ['User.Read'],
          account
        })).pipe(
          catchError(() => EMPTY),
          switchMap(result => this.http.get('https://graph.microsoft.com/v1.0/me/photo/$value', {
            responseType: 'blob',
            headers: { Authorization: `Bearer ${result.accessToken}` }
          }).pipe(catchError(() => EMPTY)))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((blob: Blob) => {
      const url = URL.createObjectURL(blob);
      this.profilePhotoUrl.set(url);
      this.destroyRef.onDestroy(() => URL.revokeObjectURL(url));
    });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.profileMenuOpen()) {
      this.profileMenuOpen.set(false);
    }
  }

  toggleProfileMenu(): void {
    this.profileMenuOpen.update(v => !v);
  }

  closeProfileMenu(): void {
    this.profileMenuOpen.set(false);
  }

  private _getAccount() {
    return this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0]
      ?? null;
  }

  getAccountName(): string {
    return this._getAccount()?.name ?? 'User';
  }

  getEmail(): string {
    const username = this._getAccount()?.username ?? '';
    if (username && !username.includes('@')) {
      return `${username}@scoular.com`;
    }
    return username;
  }

  getInitials(): string {
    const name = this.getAccountName();
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  /** Opens the release notes. Counts as an acknowledgment, so the unread dot clears. */
  openWhatsNew(): void {
    this.usageTracking.trackWhatsNewOpened();
    this.router.navigate(['/whats-new']);
  }

  /** The header "?" button: opens the Help panel, or closes it if it's open. */
  toggleHelp(): void {
    this.profileMenuOpen.set(false);
    this.helpPanel.toggle('header');
  }

  /**
   * The header "?" button. `compact` is the phone header, where space is tight. Measured with the
   * 186px logo at 16px text: the phone bar needs 358px in production with a 36px button, which fits
   * every common phone (360px+). Dev and QA also show the environment pill, which pushes it to ~404px,
   * so there the button hides below 410px — Help stays reachable from the menu drawer.
   */
  helpButtonClass(compact: boolean): string {
    const size = compact ? 'w-9 h-9' : 'w-10 h-10';
    const narrowNonProd = compact && this.envName ? 'max-[409px]:hidden' : '';
    const state = this.helpPanel.open()
      ? 'border-scoular-blue bg-scoular-blue/10 dark:bg-scoular-blue/20 text-scoular-blue-medium dark:text-[#7CC4EC]'
      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-scoular-blue/5 hover:text-scoular-blue-medium dark:hover:bg-scoular-blue/20 dark:hover:text-[#7CC4EC]';
    return `flex items-center justify-center ${size} ${narrowNonProd} rounded-full border ${state} focus:outline-none focus-visible:ring-2 focus-visible:ring-scoular-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 transition-colors`;
  }

  /** Profile menu → Help: the full Help library page. The "?" button is the way into the chat. */
  openHelpLibrary(): void {
    this.router.navigate(['/help']);
  }

  /**
   * Mobile drawer → Help: opens the chat. Kept on the chat (not the library) because on narrow Dev/QA
   * phones the "?" button is hidden to make room for the environment pill, so this is the only way in.
   */
  openHelp(source: 'drawer'): void {
    this.helpPanel.openPanel(source);
  }

  /** The build line at the foot of the profile menu, or null before the version call lands. */
  buildLine(): string | null {
    const v = this.whatsNew.version();
    if (v === null) return null;

    const release = v.releaseVersion ? 'Release ' + v.releaseVersion : 'Unreleased';
    return release + ' · Build ' + v.shortSha;
  }

  /** Trade-unit / group assignments are managed in the separate Trade Unit Preferences app.
   *  It refuses to be iframed, so this opens it in a popup window and the service refreshes
   *  the user's groups when that window closes. */
  openTradeUnitPreferences(): void {
    this.userTradeUnits.openPreferences();
  }

  signOut(): void {
    this.profileMenuOpen.set(false);
    this.appState.clearAll();
    this.msalService.logoutRedirect();
  }

  isActive(path: string): boolean {
    const url = this.currentUrl();
    return url === path || url.startsWith(path + '?');
  }

  navigate(path: string): void {
    if (this.isActive(path)) {
      this.router.navigate(['/']);
    } else {
      this.router.navigate([path]);
    }
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update(v => !v);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  mobileNavigate(path: string): void {
    this.router.navigate([path]);
    this.closeMobileMenu();
  }

  toggleThemeAndClose(): void {
    this.themeService.toggleTheme();
    this.closeMobileMenu();
  }

  getMobileNavClass(path: string): string {
    const baseClass = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors';
    const isCurrentPath = path === '/' ? this.router.url === '/' : this.isActive(path);
    const activeClass = isCurrentPath
      ? 'bg-scoular-green/5 dark:bg-scoular-green/20 text-scoular-green-accessible dark:text-scoular-green'
      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700';
    return `${baseClass} ${activeClass}`;
  }
}
