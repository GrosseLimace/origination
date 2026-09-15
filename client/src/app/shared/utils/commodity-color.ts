/**
 * Single source of truth for commodity/crop colors across the app (chips, dashboard charts,
 * legends). A given crop is ALWAYS the same color everywhere — Corn is amber, Soybeans green,
 * etc. — regardless of context or (for planting) irrigation type.
 *
 * Each crop maps to one color "family" exposed in the variants different UIs need:
 *   - chip: pastel badge classes (light + dark) for inline commodity chips
 *   - bar:  solid Tailwind bg for chart bars / legend dots / progress bars
 *   - hex:  raw hex for inline styles (donut gradient, timeline swatches)
 *
 * Keyed by the canonical friendly crop NAME (e.g. "Corn"), lower-cased. Callers holding a
 * commodity CODE (e.g. "YC") should resolve it to its category/name first (the Commodities
 * table — Commodity.category — is the app's code→name source). Unknown crops get a stable,
 * hashed pick from the fallback palette, so any given crop is consistent run to run.
 */
export interface CommodityColor {
  /** Pastel badge classes (bg + text, light + dark) for inline chips. */
  chip: string;
  /** Solid Tailwind background for chart bars / legend dots. */
  bar: string;
  /** Subtle table-row tint (bg only, light + dark) — e.g. Season Targets rows. */
  row: string;
  /** Raw hex for inline style bindings (gradients, SVG/legend swatches). */
  hex: string;
}

/** Fixed hues per crop — matches the grain-on-farm chip palette the app already used. */
const BY_CROP: Record<string, CommodityColor> = {
  corn:     { chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',    bar: 'bg-amber-500',  row: 'bg-amber-100 dark:bg-amber-800/35',   hex: '#f59e0b' },
  soybeans: { chip: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',        bar: 'bg-blue-500',   row: 'bg-blue-100 dark:bg-blue-800/35',     hex: '#3b82f6' },
  wheat:    { chip: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',     bar: 'bg-green-500',  row: 'bg-green-100 dark:bg-green-800/35',   hex: '#22c55e' },
  milo:     { chip: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',             bar: 'bg-red-500',    row: 'bg-red-100 dark:bg-red-800/35',       hex: '#ef4444' },
  sorghum:  { chip: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',             bar: 'bg-red-500',    row: 'bg-red-100 dark:bg-red-800/35',       hex: '#ef4444' },
  canola:   { chip: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200', bar: 'bg-yellow-500', row: 'bg-yellow-100 dark:bg-yellow-800/35', hex: '#eab308' },
  millet:   { chip: 'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-200',         bar: 'bg-lime-500',   row: 'bg-lime-100 dark:bg-lime-800/35',     hex: '#84cc16' },
};

/** Stable fallback palette for crops not in BY_CROP (hashed by name so a crop is always the same). */
const PALETTE: CommodityColor[] = [
  { chip: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',         bar: 'bg-teal-500',   row: 'bg-teal-100 dark:bg-teal-800/35',     hex: '#14b8a6' },
  { chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200', bar: 'bg-indigo-500', row: 'bg-indigo-100 dark:bg-indigo-800/35', hex: '#6366f1' },
  { chip: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200', bar: 'bg-purple-500', row: 'bg-purple-100 dark:bg-purple-800/35', hex: '#a855f7' },
  { chip: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200',         bar: 'bg-pink-500',   row: 'bg-pink-100 dark:bg-pink-800/35',     hex: '#ec4899' },
  { chip: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',         bar: 'bg-cyan-500',   row: 'bg-cyan-100 dark:bg-cyan-800/35',     hex: '#06b6d4' },
  { chip: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',         bar: 'bg-rose-500',   row: 'bg-rose-100 dark:bg-rose-800/35',     hex: '#f43f5e' },
];

/** Resolve a crop name (friendly, any case) to its color family. */
export function commodityColor(crop: string | null | undefined): CommodityColor {
  const key = (crop ?? '').trim().toLowerCase();
  if (!key) return PALETTE[0];
  if (BY_CROP[key]) return BY_CROP[key];
  let h = 0;
  // A specialty variant shares its base crop's colour: "Organic Soybeans" and "Dehulled Non-GMO
  // Soybeans" are Soybeans blue, "Waxy Corn" and "Hard Endosperm Corn" are Corn amber, and
  // "Organic Barley" gets whatever Barley gets. The planting surfaces label these separately
  // (Commodity.plantingCategory), but a crop is meant to be one colour everywhere and the label
  // already carries the distinction. Matched on the LAST word(s) so "Corn Screenings" does not
  // become corn-coloured by accident.
  const base = key.replace(/^organic\s+/, '');
  if (base !== key) return commodityColor(base);
  for (const crop of Object.keys(BY_CROP)) {
    if (key.endsWith(` ${crop}`)) return BY_CROP[crop];
  }
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Pastel chip classes for an inline commodity chip. */
export function commodityChipClass(crop: string | null | undefined): string {
  return commodityColor(crop).chip;
}

/** Solid Tailwind bg class for a chart bar / legend dot. */
export function commodityBarClass(crop: string | null | undefined): string {
  return commodityColor(crop).bar;
}

/** Subtle table-row tint class for a crop (e.g. Season Targets rows). */
export function commodityRowClass(crop: string | null | undefined): string {
  return commodityColor(crop).row;
}

/** Raw hex for inline style bindings (gradients, swatches). */
export function commodityHex(crop: string | null | undefined): string {
  return commodityColor(crop).hex;
}
