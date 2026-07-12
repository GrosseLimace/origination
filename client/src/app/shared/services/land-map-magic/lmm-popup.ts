// Shared read-only popup primitives + small value formatters for the two MapLibre map components.
// Extracted verbatim from the identical private copies in field-tag-map.component.ts and
// bid-sheet-map.component.ts.
//
// Dark-mode note (unchanged from the components' original module comment): MapLibre's
// `.maplibregl-popup-content` box is ALWAYS a plain white background (from maplibre-gl.css, never
// overridden for dark mode). Popup content therefore uses fixed, non-dark-mode-conditional colors
// chosen for contrast against that guaranteed-white box — `dark:` variants would render near-white
// text on white and were the cause of the earlier "unreadable popup in dark mode" bug.

import maplibregl from 'maplibre-gl';

/** A `text-sm text-gray-900` popup content wrapper with a configurable min-width utility class. */
export function createPopupContainer(minWidthClass = 'min-w-[200px]'): HTMLDivElement {
  const container = document.createElement('div');
  container.className = `text-sm text-gray-900 ${minWidthClass}`;
  return container;
}

/** Append a labelled "LABEL value" row (uppercase muted label + medium value) to a rows container. */
export function appendInfoRow(rows: HTMLElement, label: string, value: string): void {
  const row = document.createElement('div');
  row.className = 'flex items-baseline gap-1.5';
  const labelEl = document.createElement('span');
  labelEl.className = 'text-gray-500 text-xs uppercase tracking-wide shrink-0';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'text-gray-900 font-medium';
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  rows.append(row);
}

/** The spinner + "Loading field details…" popup shown while a point-lookup/AOI round trip is in flight. */
export function showLoadingPopup(map: maplibregl.Map, lngLat: maplibregl.LngLatLike): maplibregl.Popup {
  const container = createPopupContainer('min-w-[180px]');
  container.classList.add('flex', 'items-center', 'gap-2', 'py-0.5');
  const spinner = document.createElement('span');
  spinner.className = 'inline-block w-3.5 h-3.5 shrink-0 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin';
  const label = document.createElement('span');
  label.className = 'text-gray-700';
  label.textContent = 'Loading field details…';
  container.append(spinner, label);
  return new maplibregl.Popup({ closeButton: true, maxWidth: '240px' }).setLngLat(lngLat).setDOMContent(container).addTo(map);
}

/** Coerce an unknown tile/vendor property to a finite number, or null. */
export function toNumber(value: unknown): number | null {
  const n = Number(value);
  return value != null && Number.isFinite(n) ? n : null;
}

/** Coerce an unknown tile/vendor property to a non-empty trimmed string, or null. */
export function toDisplayString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Highest-percentage CDL crop in a breakdown, or null if none carry a usable percentage. */
export function topCrop(
  breakdown: ReadonlyArray<{ crop: string; percentOfAoi: number | null }>,
): { name: string; pct: number } | null {
  let best: { crop: string; percentOfAoi: number } | null = null;
  for (const entry of breakdown) {
    if (entry.percentOfAoi == null) continue;
    if (!best || entry.percentOfAoi > best.percentOfAoi) best = { crop: entry.crop, percentOfAoi: entry.percentOfAoi };
  }
  return best ? { name: best.crop, pct: best.percentOfAoi } : null;
}
