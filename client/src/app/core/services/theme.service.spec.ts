import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

/**
 * Dark mode: a saved choice always wins over the OS preference, the OS preference is only the
 * first-visit default, every explicit change is persisted, and the `dark` class on <html> (which
 * Tailwind's dark: variants key off) follows the signal.
 */
const KEY = 'theme';

describe('ThemeService', () => {
  let prefersDark: boolean;
  const realMatchMedia = window.matchMedia.bind(window);

  function create(): ThemeService {
    const service = TestBed.inject(ThemeService);
    TestBed.tick(); // flush the root effect that writes the <html> class
    return service;
  }

  const htmlIsDark = (): boolean => document.documentElement.classList.contains('dark');

  beforeEach(() => {
    localStorage.removeItem(KEY);
    document.documentElement.classList.remove('dark');
    prefersDark = false;
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const mql = realMatchMedia(query);
      Object.defineProperty(mql, 'matches', { get: () => query.includes('dark') && prefersDark });
      return mql;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(KEY);
    document.documentElement.classList.remove('dark');
  });

  it('defaults to the OS preference on a first visit', () => {
    prefersDark = true;
    const service = create();

    expect(service.isDarkMode()).toBe(true);
    expect(htmlIsDark()).toBe(true);
  });

  it('defaults to light when the OS has no dark preference', () => {
    const service = create();

    expect(service.isDarkMode()).toBe(false);
    expect(htmlIsDark()).toBe(false);
  });

  it('a saved "light" choice beats an OS dark preference', () => {
    localStorage.setItem(KEY, 'light');
    prefersDark = true;

    expect(create().isDarkMode()).toBe(false);
    expect(htmlIsDark()).toBe(false);
  });

  it('a saved "dark" choice beats an OS light preference', () => {
    localStorage.setItem(KEY, 'dark');

    expect(create().isDarkMode()).toBe(true);
    expect(htmlIsDark()).toBe(true);
  });

  it('toggleTheme flips the mode, persists it, and updates the <html> class', () => {
    const service = create();

    service.toggleTheme();
    TestBed.tick();
    expect(service.isDarkMode()).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('dark');
    expect(htmlIsDark()).toBe(true);

    service.toggleTheme();
    TestBed.tick();
    expect(service.isDarkMode()).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('light');
    expect(htmlIsDark()).toBe(false);
  });

  it('setDarkMode sets and persists an explicit choice', () => {
    prefersDark = true;
    const service = create();

    service.setDarkMode(false);
    TestBed.tick();

    expect(localStorage.getItem(KEY)).toBe('light');
    expect(htmlIsDark()).toBe(false);
  });

  it('just loading the OS default does not persist anything', () => {
    prefersDark = true;
    create();

    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
