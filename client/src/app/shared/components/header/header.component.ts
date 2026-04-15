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

  readonly envName = environment.envName;
  readonly bidSheetEnabled = environment.bidSheetEnabled;
  // Gate the Usage Dashboard nav button to the single preview owner until the feature
  // is ready for everyone. The route is guarded separately — this just hides the entry.
  get usageDashboardEnabled(): boolean {
    if (!environment.usageDashboardEnabled) return false;
    const email = (this._getAccount()?.username ?? '').toLowerCase();
    const normalized = email.includes('@') ? email : (email ? `${email}@scoular.com` : '');
    return normalized === 'cegr@scoular.com';
  }

  mobileMenuOpen = signal(false);
  profileMenuOpen = signal(false);
  profilePhotoUrl = signal<string | null>(null);
  readonly isAdmin = signal(false);
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

        // Check admin role from ID token claims
        const roles = (account.idTokenClaims as any)?.roles as string[] | undefined;
        this.isAdmin.set(roles?.includes('Admin') ?? false);
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
