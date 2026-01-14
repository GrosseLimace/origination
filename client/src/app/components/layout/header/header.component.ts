import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ThemeService } from '../../../services/theme.service';
import { AppStateService } from '../../../services/app-state.service';
import { ButtonComponent } from '../../ui/button/button.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  host: { class: 'block sticky top-0 z-50' },
  template: `
    <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <!-- Mobile menu button -->
            <button
              type="button"
              class="lg:hidden p-2 -ml-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              (click)="toggleMobileMenu()"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="4" x2="20" y1="12" y2="12"/>
                <line x1="4" x2="20" y1="6" y2="6"/>
                <line x1="4" x2="20" y1="18" y2="18"/>
              </svg>
            </button>
            <!-- Wheat Icon -->
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 dark:text-green-500 hidden sm:block">
              <path d="M2 22 16 8"/>
              <path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
              <path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
              <path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
              <path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z"/>
              <path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>
              <path d="M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>
              <path d="M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>
            </svg>
            <div>
              <h1 class="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">Grain Originator Portal</h1>
              <p class="text-sm text-gray-500 dark:text-gray-400 hidden sm:block">Customer & Contract Management</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <!-- Desktop navigation buttons -->
            <app-button
              [variant]="isActive('/dashboard') ? 'default' : 'outline'"
              (onClick)="navigate('/dashboard')"
              class="gap-2 hidden lg:inline-flex"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1">
                @if (isActive('/dashboard')) {
                  <path d="m12 19-7-7 7-7"/>
                  <path d="M19 12H5"/>
                } @else {
                  <line x1="18" x2="18" y1="20" y2="10"/>
                  <line x1="12" x2="12" y1="20" y2="4"/>
                  <line x1="6" x2="6" y1="20" y2="14"/>
                }
              </svg>
              <span>{{ isActive('/dashboard') ? 'Back to Customers' : 'Dashboard' }}</span>
            </app-button>

            <app-button
              [variant]="isActive('/build-list') ? 'default' : 'outline'"
              (onClick)="navigate('/build-list')"
              class="gap-2 hidden lg:inline-flex"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1">
                @if (isActive('/build-list')) {
                  <path d="m12 19-7-7 7-7"/>
                  <path d="M19 12H5"/>
                } @else {
                  <path d="M3 6h18"/>
                  <path d="M7 12h10"/>
                  <path d="M10 18h4"/>
                }
              </svg>
              <span>{{ isActive('/build-list') ? 'Back to Customers' : 'Build a List' }}</span>
            </app-button>

            <app-button
              [variant]="isActive('/insights') ? 'default' : 'outline'"
              (onClick)="navigate('/insights')"
              class="gap-2 hidden lg:inline-flex"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1">
                @if (isActive('/insights')) {
                  <path d="m12 19-7-7 7-7"/>
                  <path d="M19 12H5"/>
                } @else {
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                  <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
                }
              </svg>
              <span>{{ isActive('/insights') ? 'Back to Customers' : 'Actionable Insights' }}</span>
            </app-button>

            <!-- Theme toggle -->
            <app-button variant="outline" size="icon" (onClick)="themeService.toggleTheme()" class="hidden sm:inline-flex">
              @if (themeService.isDarkMode()) {
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                </svg>
              } @else {
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="4"/>
                  <path d="M12 2v2"/>
                  <path d="M12 20v2"/>
                  <path d="m4.93 4.93 1.41 1.41"/>
                  <path d="m17.66 17.66 1.41 1.41"/>
                  <path d="M2 12h2"/>
                  <path d="M20 12h2"/>
                  <path d="m6.34 17.66-1.41 1.41"/>
                  <path d="m19.07 4.93-1.41 1.41"/>
                </svg>
              }
            </app-button>
          </div>
        </div>
      </div>
    </header>

    <!-- Mobile Navigation Overlay -->
    @if (mobileMenuOpen) {
      <div class="fixed inset-0 bg-black/50 z-40 lg:hidden" (click)="closeMobileMenu()"></div>
      <div class="fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-800 z-50 lg:hidden shadow-xl">
        <div class="flex flex-col h-full">
          <!-- Header -->
          <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600">
                <path d="M2 22 16 8"/>
                <path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
                <path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>
              </svg>
              <span class="font-semibold text-gray-900 dark:text-white">Menu</span>
            </div>
            <button type="button" class="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" (click)="closeMobileMenu()">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </div>

          <!-- Navigation Links -->
          <nav class="flex-1 p-4 space-y-2">
            <button type="button" [class]="getMobileNavClass('/')" (click)="mobileNavigate('/')">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <span>Customers</span>
            </button>

            <button type="button" [class]="getMobileNavClass('/dashboard')" (click)="mobileNavigate('/dashboard')">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" x2="18" y1="20" y2="10"/>
                <line x1="12" x2="12" y1="20" y2="4"/>
                <line x1="6" x2="6" y1="20" y2="14"/>
              </svg>
              <span>Dashboard</span>
            </button>

            <button type="button" [class]="getMobileNavClass('/insights')" (click)="mobileNavigate('/insights')">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
              </svg>
              <span>Actionable Insights</span>
            </button>

            <button type="button" [class]="getMobileNavClass('/build-list')" (click)="mobileNavigate('/build-list')">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/>
                <path d="M7 12h10"/>
                <path d="M10 18h4"/>
              </svg>
              <span>Build a List</span>
            </button>
          </nav>

          <!-- Footer -->
          <div class="p-4 border-t border-gray-200 dark:border-gray-700">
            <button type="button" class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" (click)="toggleThemeAndClose()">
              @if (themeService.isDarkMode()) {
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="4"/>
                  <path d="M12 2v2"/>
                  <path d="M12 20v2"/>
                  <path d="m4.93 4.93 1.41 1.41"/>
                  <path d="m17.66 17.66 1.41 1.41"/>
                  <path d="M2 12h2"/>
                  <path d="M20 12h2"/>
                  <path d="m6.34 17.66-1.41 1.41"/>
                  <path d="m19.07 4.93-1.41 1.41"/>
                </svg>
                <span>Light Mode</span>
              } @else {
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                </svg>
                <span>Dark Mode</span>
              }
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class HeaderComponent {
  themeService = inject(ThemeService);
  appState = inject(AppStateService);
  private router = inject(Router);

  mobileMenuOpen = false;

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
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen = false;
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
      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700';
    return `${baseClass} ${activeClass}`;
  }
}
