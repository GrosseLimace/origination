import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ThemeService } from '../../../services/theme.service';
import { AppStateService } from '../../../services/app-state.service';
import { ButtonComponent } from '../../ui/button/button.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [ButtonComponent],
  host: { class: 'block sticky top-0 z-50' },
  template: `
    <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <!-- Wheat Icon -->
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 dark:text-green-500">
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
              <h1 class="text-gray-900 dark:text-white font-semibold">Grain Originator Portal</h1>
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
                <line x1="18" x2="18" y1="20" y2="10"/>
                <line x1="12" x2="12" y1="20" y2="4"/>
                <line x1="6" x2="6" y1="20" y2="14"/>
              </svg>
              <span>{{ isActive('/dashboard') ? 'Back to Customers' : 'Dashboard' }}</span>
            </app-button>

            <app-button
              [variant]="isActive('/build-list') ? 'default' : 'outline'"
              (onClick)="navigate('/build-list')"
              class="gap-2 hidden lg:inline-flex"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1">
                <path d="M3 6h18"/>
                <path d="M7 12h10"/>
                <path d="M10 18h4"/>
              </svg>
              <span>{{ isActive('/build-list') ? 'Back to Customers' : 'Build a List' }}</span>
            </app-button>

            <app-button
              [variant]="isActive('/insights') ? 'default' : 'outline'"
              (onClick)="navigate('/insights')"
              class="gap-2 hidden lg:inline-flex"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1">
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
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
  `
})
export class HeaderComponent {
  themeService = inject(ThemeService);
  appState = inject(AppStateService);
  private router = inject(Router);

  isActive(path: string): boolean {
    return this.router.url === path;
  }

  navigate(path: string): void {
    if (this.isActive(path)) {
      this.router.navigate(['/']);
    } else {
      this.router.navigate([path]);
    }
  }
}
