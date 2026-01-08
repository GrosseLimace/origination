import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeService } from '../../../services/theme.service';
import { AppStateService } from '../../../services/app-state.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
      <div class="container mx-auto px-4">
        <div class="flex items-center justify-between h-16">
          <!-- Logo and Title -->
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 9 12 5 2 9l10 4 10-4v6"/>
                <path d="m6 11 6 2.5 6-2.5"/>
                <path d="M6 15.5 12 18l6-2.5"/>
              </svg>
            </div>
            <h1 class="text-xl font-semibold text-gray-900 dark:text-white">Grain Originator Portal</h1>
          </div>

          <!-- Navigation -->
          <nav class="hidden md:flex items-center gap-1">
            <a routerLink="/" routerLinkActive="bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400" [routerLinkActiveOptions]="{exact: true}"
               class="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              Customers
            </a>
            <a routerLink="/build-list" routerLinkActive="bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400"
               class="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              Build List
            </a>
            <a routerLink="/insights" routerLinkActive="bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400"
               class="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              Insights
            </a>
            <a routerLink="/dashboard" routerLinkActive="bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400"
               class="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              Dashboard
            </a>
          </nav>

          <!-- Theme Toggle -->
          <button
            (click)="themeService.toggleTheme()"
            class="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            [attr.aria-label]="themeService.isDarkMode() ? 'Switch to light mode' : 'Switch to dark mode'"
          >
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
            } @else {
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
              </svg>
            }
          </button>
        </div>
      </div>
    </header>
  `
})
export class HeaderComponent {
  themeService = inject(ThemeService);
  appState = inject(AppStateService);
}
