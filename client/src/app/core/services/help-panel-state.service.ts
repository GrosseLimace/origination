import { Injectable, computed, signal } from '@angular/core';

/** Below this width the panel is full-screen and navigating away closes it (matches Tailwind's lg). */
const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Whether the Help panel is open, stepped aside for a spotlight, and laid out beside the page.
 *
 * Deliberately dependency-free: the app shell, the header and the Calculators button only need these
 * three facts to make room for the panel, and shouldn't pull in the router, sign-in and data services
 * that HelpPanelService needs for the conversation. HelpPanelService is the only writer.
 */
@Injectable({ providedIn: 'root' })
export class HelpPanelStateService {
  readonly open = signal(false);
  /** The data-help-anchor currently being shown, or null. */
  readonly spotlight = signal<string | null>(null);
  /** True at desktop widths, where the panel sits beside the page instead of covering it. */
  readonly desktop = signal(desktopNow());

  /** The panel is laid out beside the page (desktop) and the page should make room for it. */
  readonly pushesPage = computed(() => this.open() && this.spotlight() === null && this.desktop());

  constructor() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      window.matchMedia(DESKTOP_QUERY).addEventListener?.('change', e => this.desktop.set(e.matches));
    }
  }
}

function desktopNow(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia(DESKTOP_QUERY).matches;
}
