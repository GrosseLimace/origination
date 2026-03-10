// Angular core
import { Component, DestroyRef, HostListener, inject, signal } from '@angular/core';

// Angular common
import { CommonModule } from '@angular/common';

// Angular router
import { Router } from '@angular/router';

// Angular HTTP
import { HttpClient } from '@angular/common/http';

// MSAL
import { MsalService } from '@azure/msal-angular';

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
  templateUrl: './header.component.html'
})
export class HeaderComponent {
  themeService = inject(ThemeService);
  appState = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly msalService = inject(MsalService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly envName = environment.envName;

  mobileMenuOpen = signal(false);
  profileMenuOpen = signal(false);
  profilePhotoUrl = signal<string | null>(null);

  constructor() {
    this.http.get('https://graph.microsoft.com/v1.0/me/photo/$value', { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        this.profilePhotoUrl.set(url);
        this.destroyRef.onDestroy(() => URL.revokeObjectURL(url));
      },
      error: () => { /* No photo available — initials shown */ }
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

  getAccountName(): string {
    return this.msalService.instance.getActiveAccount()?.name ?? 'User';
  }

  getEmail(): string {
    const username = this.msalService.instance.getActiveAccount()?.username ?? '';
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
    this.msalService.logoutRedirect();
  }

  isActive(path: string): boolean {
    return this.router.url === path || this.router.url.startsWith(path + '?');
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
