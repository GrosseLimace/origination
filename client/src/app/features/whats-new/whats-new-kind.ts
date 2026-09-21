import type { WhatsNewItemKind } from '@models';

/** What each kind is called on screen. The JSON values are developer words; these are not. */
export const WHATS_NEW_KIND_LABELS: Record<WhatsNewItemKind, string> = {
  added: 'New',
  changed: 'Improved',
  fixed: 'Fixed'
};

/**
 * Pill styling per kind. `green-*` is remapped to the Scoular greens in styles.css, so "New"
 * carries the brand colour and the other two stay neutral against it.
 */
export const WHATS_NEW_KIND_PILL_CLASSES: Record<WhatsNewItemKind, string> = {
  added:
    'inline-flex shrink-0 items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300',
  changed:
    'inline-flex shrink-0 items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  fixed:
    'inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
};
