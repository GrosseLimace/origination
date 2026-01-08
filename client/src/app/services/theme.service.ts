import { Injectable, signal, effect } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly STORAGE_KEY = 'theme';
  isDarkMode = signal(false);

  constructor() {
    this.loadTheme();

    // Apply theme changes to document
    effect(() => {
      if (this.isDarkMode()) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    });
  }

  private loadTheme(): void {
    const savedTheme = localStorage.getItem(this.STORAGE_KEY);
    if (savedTheme) {
      this.isDarkMode.set(savedTheme === 'dark');
    } else {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.isDarkMode.set(prefersDark);
    }
  }

  toggleTheme(): void {
    this.isDarkMode.update(value => !value);
    localStorage.setItem(this.STORAGE_KEY, this.isDarkMode() ? 'dark' : 'light');
  }

  setDarkMode(isDark: boolean): void {
    this.isDarkMode.set(isDark);
    localStorage.setItem(this.STORAGE_KEY, isDark ? 'dark' : 'light');
  }
}
