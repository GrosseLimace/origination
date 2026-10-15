import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

/**
 * Light or dark. Same `.dark` class convention as the desktop app so the shared brand tokens and
 * Tailwind `dark:` variants behave identically. First launch follows the phone's preference; after
 * that the explicit choice is remembered. The preference is not sensitive, so localStorage is fine
 * here (tokens never are — see app.config.ts).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private static readonly Key = 'mob.theme';

  readonly mode = signal<ThemeMode>(readMode());
  readonly isDark = computed(() => this.mode() === 'dark');

  constructor() {
    effect(() => {
      document.documentElement.classList.toggle('dark', this.isDark());
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.isDark() ? '#111827' : '#00875F');
    });
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(ThemeService.Key, mode);
    } catch { /* ignore */ }
  }
}

function readMode(): ThemeMode {
  try {
    const stored = localStorage.getItem('mob.theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* ignore */ }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
