// Shared USDA Cropland Data Layer (CDL) translucent raster overlay for the two MapLibre map
// components. Purely an informational reference layer (like the basemap itself) — NOT a
// selection/click mechanism: no hit-testing, no popups, no feature-state. Wired identically into
// both field-tag-map and bid-sheet-map.
//
// Endpoint shape (a plain XYZ raster PNG tile source):
//   GET https://api.landmapmagic.com/v1/tiles/cdl/{z}/{x}/{y}.png?key=<landMapMagicKey>&year=<year>
//
// Verified live against this project's real LandMapMagic key (central Iowa 41.878,-93.097):
//   * Years 2020–2025 all return HTTP 200 PNGs with real crop-color data (2019 also serves).
//   * Zoom: tiles exist z4–z15 (z16 returns HTTP 204 / empty). The vendor-sample demo claimed
//     minZoom 5 / maxZoom 14; live serves one zoom level higher (15). We set the raster source's
//     maxzoom to 15 so MapLibre overzoom-scales the z15 tiles beyond that instead of requesting
//     the empty z16 tiles; minzoom 5 matches the sample's floor (CDL below z5 is a national blur
//     of little use for field/parcel work, which happens at z>=12).

import type maplibregl from 'maplibre-gl';

const CDL_TILE_BASE_URL = 'https://api.landmapmagic.com';

export const CDL_SOURCE_ID = 'cdl-crop';
export const CDL_LAYER_ID = 'cdl-crop';

const CDL_MIN_ZOOM = 5;
const CDL_MAX_ZOOM = 15;

/** Default overlay opacity (percent). The vendor sample uses 75%; translucent enough to read the
 *  basemap/field boundaries through, opaque enough for the crop colors to register. */
export const DEFAULT_CDL_OPACITY_PCT = 75;

/** Selectable overlay years — every value here returns real tiles from the live API (see module
 *  comment). Newest first; the component defaults the selection to the backend-configured CDL year. */
export const CDL_OVERLAY_YEARS = ['2025', '2024', '2023', '2022', '2021', '2020'];

/**
 * Legend: the official USDA CDL palette values for the crops that dominate this app's growing
 * regions (reused verbatim from the vendor sample / USDA standard palette). Shown only while the
 * overlay is toggled on. This is a representative subset of the full ~130-class CDL palette, not an
 * exhaustive key — the overlay renders every CDL class regardless of what the legend lists.
 */
export const CDL_LEGEND: ReadonlyArray<{ color: string; label: string }> = [
  { color: '#ffd300', label: 'Corn' },
  { color: '#267000', label: 'Soybeans' },
  { color: '#a57000', label: 'Winter Wheat' },
  { color: '#70a500', label: 'Alfalfa' },
  { color: '#00a8e5', label: 'Cotton' },
  { color: '#e2007c', label: 'Rice' },
  { color: '#896054', label: 'Fallow/Idle' },
  { color: '#d3ffbe', label: 'Grassland/Pasture' },
];

function cdlTileUrl(landMapMagicKey: string, year: string): string {
  return `${CDL_TILE_BASE_URL}/v1/tiles/cdl/{z}/{x}/{y}.png?key=${landMapMagicKey}&year=${year}`;
}

/**
 * Id of the layer the CDL overlay must be inserted BEFORE so it lands directly above the basemap and
 * below everything else (vendor CLU/parcel layers, tagged-fields, selection/highlight outlines).
 * That z-order must hold regardless of WHEN the overlay is toggled on relative to those other layers
 * being added, so we don't hardcode a beforeId — we find the layer immediately above the topmost
 * basemap layer in the CURRENT style order. Returns undefined (append) when the basemap layers are
 * currently the topmost layers, which is correct: anything added later (vendor merge, etc.) appends
 * on top of the CDL layer anyway.
 */
function insertionBeforeId(map: maplibregl.Map, basemapLayerIds: string[]): string | undefined {
  const layers = map.getStyle().layers ?? [];
  let lastBasemapIdx = -1;
  for (let i = 0; i < layers.length; i++) {
    if (basemapLayerIds.includes(layers[i].id)) lastBasemapIdx = i;
  }
  return layers[lastBasemapIdx + 1]?.id;
}

export interface CdlOverlayOptions {
  landMapMagicKey: string;
  year: string;
  opacityPct: number;
  /** The three Azure basemap layer ids (see maplibre-basemap.ts) — used to compute z-placement. */
  basemapLayerIds: string[];
}

/** Add (or no-op if already present) the CDL raster overlay just above the basemap. */
export function addCdlOverlay(map: maplibregl.Map, opts: CdlOverlayOptions): void {
  if (map.getLayer(CDL_LAYER_ID)) return;
  if (!map.getSource(CDL_SOURCE_ID)) {
    map.addSource(CDL_SOURCE_ID, {
      type: 'raster',
      tiles: [cdlTileUrl(opts.landMapMagicKey, opts.year)],
      tileSize: 256,
      minzoom: CDL_MIN_ZOOM,
      maxzoom: CDL_MAX_ZOOM,
      attribution: 'USDA NASS Cropland Data Layer',
    });
  }
  map.addLayer(
    {
      id: CDL_LAYER_ID,
      type: 'raster',
      source: CDL_SOURCE_ID,
      paint: { 'raster-opacity': clampOpacity(opts.opacityPct) },
    },
    insertionBeforeId(map, opts.basemapLayerIds),
  );
}

/** Remove the CDL overlay layer + source, if present. */
export function removeCdlOverlay(map: maplibregl.Map): void {
  if (map.getLayer(CDL_LAYER_ID)) map.removeLayer(CDL_LAYER_ID);
  if (map.getSource(CDL_SOURCE_ID)) map.removeSource(CDL_SOURCE_ID);
}

/** Update the overlay's opacity live (0–100 percent). No-op if the overlay isn't currently added. */
export function setCdlOpacity(map: maplibregl.Map, opacityPct: number): void {
  if (!map.getLayer(CDL_LAYER_ID)) return;
  map.setPaintProperty(CDL_LAYER_ID, 'raster-opacity', clampOpacity(opacityPct));
}

/**
 * Switch the overlay to a different CDL year. A raster tile source's URL can't be mutated in place
 * portably, so this removes and re-adds the overlay — cheap (rare, user-driven action) and it
 * re-computes z-placement so the overlay stays correctly under the vendor/tag layers. No-op if the
 * overlay isn't currently added.
 */
export function setCdlYear(map: maplibregl.Map, opts: CdlOverlayOptions): void {
  if (!map.getLayer(CDL_LAYER_ID)) return;
  removeCdlOverlay(map);
  addCdlOverlay(map, opts);
}

function clampOpacity(opacityPct: number): number {
  return Math.min(1, Math.max(0, opacityPct / 100));
}
