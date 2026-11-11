/**
 * Whether the user closed one of the producer profile's foldable sections, remembered in localStorage under `key`.
 * The sections are open by default, and an explicit close stays closed across producers and reloads (user
 * 2026-10-12). False when storage is unavailable.
 */
export function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

/** Remembers that the user closed (or reopened) a section. Without storage (private browsing) the toggle still works for the session. */
export function writeCollapsed(key: string, collapsed: boolean): void {
  try {
    localStorage.setItem(key, collapsed ? 'true' : 'false');
  } catch {
    // Storage is off: nothing to remember it in.
  }
}
