// Port of lcfs-poc/src/map/landmapmagic.ts. Key comes from the runtime FieldTagMapConfig (fetched
// from the backend's /api/field-tag-config), not a Vite/build-time env var.

import type maplibregl from 'maplibre-gl';
import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';

const LMM_BASE_URL = 'https://api.landmapmagic.com/v1';

export interface LmmLayerIds {
  /** All merged layer ids belonging to the CLU dataset (real LMM layers + our synthetic hit/selection layers). */
  clu: string[];
  /** All merged layer ids belonging to the parcels dataset (real LMM layers + our synthetic selection layer). */
  parcels: string[];
  /** CLU layer id to use as the mousemove/click hit target. */
  cluFill: string[];
  /** Parcel layer id to use as the mousemove/click hit target. */
  parcelFill: string[];
}

// --- Confirmed against a live GET /v1/styles?target=maplibre&layers=clu,parcels response. ---
// LMM's docs describe these ids as stable; hardcoding avoids brittle substring classification of
// layer names (docs/poc/field-tagging/03-frontend-map-component.md, "Sources and layers").

/** Source ids as returned by LandMapMagic. Note: parcels, not "parcel" (singular). */
const LMM_CLU_SOURCE = 'clu';
const LMM_PARCELS_SOURCE = 'parcels';

/** Real layer ids LandMapMagic returns for the CLU group. */
const LMM_CLU_LAYER_IDS = ['clu-outline', 'clu-labels'];

/** Real layer ids LandMapMagic returns for the parcels group. */
const LMM_PARCELS_LAYER_IDS = ['parcels-fill', 'parcels-outline', 'parcels-labels'];

/** The vendor's own parcel label symbol layer — see `overrideParcelsLabelText` below. */
const PARCELS_LABELS_LAYER_ID = 'parcels-labels';

/** The vendor's own CLU acreage label symbol layer — see `overrideCluLabelText` below. */
const CLU_LABELS_LAYER_ID = 'clu-labels';

/**
 * G5: LandMapMagic's CLU group ships only a line ("clu-outline") and a label layer — there is no
 * CLU fill layer. Line geometries have a thin pixel-width hit area, which makes click/hover
 * targeting unreliable for polygon selection, so we add our own fully-transparent fill layer on
 * the same source/source-layer purely as a hit-test target.
 */
const CLU_HIT_FILL_LAYER_ID = 'clu-hit-fill';

/**
 * G4: the real LMM style only wires `["feature-state","hover"]` — it never references
 * `["feature-state","selected"]`. Add a dedicated highlight outline per dataset that renders only
 * when feature-state "selected" is true.
 */
const CLU_SELECTED_LAYER_ID = 'clu-selected-outline';
const PARCELS_SELECTED_LAYER_ID = 'parcels-selected-outline';

/**
 * A dedicated always-on highlight layer for the popup's parcel/owner list (hover a row -> light up
 * that parcel's boundary on the map), driven by its own `popupHighlight` feature-state — separate
 * from `hover`/`selected` (which are tier-gated: e.g. wireVendorLayerInteractions only wires those
 * while `currentTier() === 'parcel'`). Deliberately NOT included in `LmmLayerIds.parcels` (the
 * group `setLayerGroupVisibility` toggles per tier) so it stays visible/renderable while browsing
 * CLU or drawing, when the vendor's own parcels-fill/outline/labels are hidden.
 */
const PARCELS_POPUP_HIGHLIGHT_LAYER_ID = 'parcels-popup-highlight';

/**
 * G2: LandMapMagic's fetched style declares `glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf"`.
 * That host returns a 200 OK HTML landing page for every {fontstack}/{range} request. MapLibre
 * doesn't check content-type; it feeds those bytes straight into its PBF glyph parser, which
 * throws "Unimplemented type: 4". Worse: a single broken glyph request rejects the WHOLE tile
 * parse — every layer sourced from that tile (clu-outline, our synthetic clu-hit-fill, etc.), not
 * just the label layer, silently ends up with zero features. That's the root cause of CLU
 * rendering blank/unclickable on some views.
 *
 * Fix: point glyphs at a static mirror that actually serves the binaries. It can't compose
 * LandMapMagic's multi-font fallback stacks (comma-joined directory names don't exist on a static
 * host), so pair this with `simplifyTextFont()` below (G3).
 */
const WORKING_GLYPHS_URL = 'https://orangemug.github.io/font-glyphs/glyphs/{fontstack}/{range}.pbf';

/**
 * Fetch the LandMapMagic MapLibre style for CLU + parcel layers and merge its sources/layers into
 * the existing map, then add our own hit-test/selection layers on top. Do NOT `map.setStyle()` —
 * that would wipe the Azure imagery base AND the app's own `tagged-fields` source.
 */
export async function mergeLandMapMagicLayers(
  map: maplibregl.Map,
  landMapMagicKey: string,
): Promise<LmmLayerIds> {
  const url = `${LMM_BASE_URL}/styles?key=${encodeURIComponent(landMapMagicKey)}&target=maplibre&layers=clu,parcels`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`LandMapMagic styles request failed: ${res.status} ${res.statusText}`);
  }
  const lmmStyle = (await res.json()) as StyleSpecification;

  // Symbol layers (e.g. acreage labels) need glyphs, which our minimal raster base style does not
  // define. Do NOT adopt LandMapMagic's glyphs URL — see WORKING_GLYPHS_URL above (G2).
  try {
    map.setGlyphs(WORKING_GLYPHS_URL);
    if (typeof lmmStyle.sprite === 'string') map.setSprite(lmmStyle.sprite);
  } catch (err) {
    console.warn('[lmm-styles] Failed to set glyphs/sprite:', err);
  }

  for (const [id, source] of Object.entries(lmmStyle.sources ?? {})) {
    if (!map.getSource(id)) map.addSource(id, fixSourcePromoteId(id, source as SourceSpecification));
  }
  for (const layer of lmmStyle.layers ?? []) {
    simplifyTextFont(layer);
    if (!map.getLayer(layer.id)) map.addLayer(layer as LayerSpecification);
  }

  overrideParcelsLabelText(map);
  overrideCluLabelText(map);
  addSyntheticLayers(map);

  return {
    clu: [...LMM_CLU_LAYER_IDS, CLU_HIT_FILL_LAYER_ID, CLU_SELECTED_LAYER_ID],
    parcels: [...LMM_PARCELS_LAYER_IDS, PARCELS_SELECTED_LAYER_ID],
    cluFill: [CLU_HIT_FILL_LAYER_ID],
    parcelFill: ['parcels-fill'],
  };
}

/**
 * G1: LandMapMagic's fetched `clu` source declares `promoteId: "id"`, but real CLU vector-tile
 * features have no `properties.id`. When a source's promoteId points at a missing property,
 * MapLibre assigns every one of that source's features `feature.id = undefined` client-side (it
 * does NOT fall back to the tile's native MVT feature id while promoteId is set). Since hover/
 * click wiring requires a non-null `f.id`, CLU silently never highlighted or selected — while
 * `parcels` (promoteId: "parcel_id", which genuinely exists) worked fine. Drop the broken
 * promoteId for `clu` only, so MapLibre falls back to the tile's real native id — which live-tile
 * verification confirmed is stable across adjacent tiles for the same field (this is also the
 * basis for CLU ExternalRef identity, not just hover — see 01-data-model.md).
 */
function fixSourcePromoteId(id: string, source: SourceSpecification): SourceSpecification {
  if (id === LMM_CLU_SOURCE && source.type === 'vector' && 'promoteId' in source) {
    const { promoteId: _drop, ...rest } = source;
    return rest as SourceSpecification;
  }
  return source;
}

/**
 * G3: collapse a symbol layer's `text-font` fallback stack to its first entry. WORKING_GLYPHS_URL
 * is a static per-font directory listing, not a dynamic font server, so it can only resolve a
 * single font name per {fontstack} path segment — it 404s on LandMapMagic's comma-joined fallback
 * stacks. Mutates in place; no-op for non-symbol layers or layers without a literal text-font array.
 */
function simplifyTextFont(layer: LayerSpecification): void {
  if (layer.type !== 'symbol') return;
  const textFont = layer.layout?.['text-font'];
  if (Array.isArray(textFont) && textFont.length > 1 && typeof textFont[0] === 'string') {
    layer.layout = { ...layer.layout, 'text-font': [textFont[0]] };
  }
}

/**
 * Overlay the parcel OWNER name directly on the map, mirroring how the vendor's own `clu-labels`
 * layer already overlays each CLU field's acreage while browsing (no click required) — the goal
 * is to help an originator visually locate a producer's field/parcel by scanning the map, and a
 * bare `parcel_id` (the vendor's own default `parcels-labels` text) means nothing to them, while
 * the owner name is exactly what they're scanning for. Confirmed real parcel tile property:
 * `owner` (see lmm-point-lookup.ts's live-tile-decode comment: `{ robust_id, parcel_id, owner,
 * acreage_calc }`). Falls back to an empty string via `coalesce` when the vendor didn't send an
 * owner for a given parcel, so the label just renders blank rather than something misleading like
 * the literal string "undefined".
 */
function overrideParcelsLabelText(map: maplibregl.Map): void {
  if (!map.getLayer(PARCELS_LABELS_LAYER_ID)) return;
  // Vendor's own text-field already falls back `owner` -> `owner_name` -> ''; keep that fallback
  // chain rather than dropping straight to owner-or-blank.
  map.setLayoutProperty(PARCELS_LABELS_LAYER_ID, 'text-field', ['coalesce', ['get', 'owner'], ['get', 'owner_name'], '']);
  // Confirmed live (GET /v1/styles?...&layers=parcels): the vendor's own text-size is a
  // zoom-interpolated 9px (zoom 15) -> 11px (16) -> 12px (17) — small, and visibly smaller than
  // clu-labels' flat 14px acreage text. Match clu-labels for visual parity/legibility.
  map.setLayoutProperty(PARCELS_LABELS_LAYER_ID, 'text-size', 14);
  // The vendor's own paint properties were tuned for its default (short, numeric) label text —
  // an owner NAME is longer and needs to stay legible over both busy satellite imagery and the
  // street/hybrid basemaps. White text + a solid dark halo reads reliably across all three
  // basemap styles (imagery/street/hybrid — see the basemap toggle).
  map.setPaintProperty(PARCELS_LABELS_LAYER_ID, 'text-color', '#ffffff');
  map.setPaintProperty(PARCELS_LABELS_LAYER_ID, 'text-halo-color', '#000000');
  map.setPaintProperty(PARCELS_LABELS_LAYER_ID, 'text-halo-width', 1.5);
  map.setPaintProperty(PARCELS_LABELS_LAYER_ID, 'text-halo-blur', 0.5);
  // Confirmed live: the vendor's own text-opacity is
  // interpolate(linear, zoom, 15, 0, 16, 0.8, 17, 1) with the layer's own minzoom: 15 — i.e. the
  // label doesn't exist at all below zoom 15, is fully INVISIBLE right at 15, and only reaches
  // full opacity at zoom 17. That's the "fades in/out based on zoom level" behavior reported.
  // Shift the whole ramp down by one zoom level (14/15/16 instead of 15/16/17) and lower the
  // layer's own zoom floor to match, so the label starts becoming visible — and reaches full
  // darkness — one zoom level earlier than the vendor default.
  map.setLayerZoomRange(PARCELS_LABELS_LAYER_ID, 14, 24);
  map.setPaintProperty(PARCELS_LABELS_LAYER_ID, 'text-opacity', [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    0,
    15,
    0.8,
    16,
    1,
  ]);
}

/**
 * Confirmed live (GET /v1/styles?...&layers=clu): `clu-labels` ships with `text-color: #000000` +
 * a 3px `text-halo-color: #ffffff` — black text on a white halo, reported as hard to read
 * (particularly over the lighter street/hybrid basemaps and lighter cropland/soil imagery, where a
 * white halo blends into the background instead of standing out against it). Swap to the same
 * white-text/black-halo scheme used for `parcels-labels` for a consistent, higher-contrast look
 * across both tiers and all three basemap styles (imagery/street/hybrid).
 */
function overrideCluLabelText(map: maplibregl.Map): void {
  if (!map.getLayer(CLU_LABELS_LAYER_ID)) return;
  map.setPaintProperty(CLU_LABELS_LAYER_ID, 'text-color', '#ffffff');
  map.setPaintProperty(CLU_LABELS_LAYER_ID, 'text-halo-color', '#000000');
  map.setPaintProperty(CLU_LABELS_LAYER_ID, 'text-halo-width', 2);
  map.setPaintProperty(CLU_LABELS_LAYER_ID, 'text-halo-blur', 0.5);
}

/** Add the CLU hit-test fill and both selected-highlight outline layers (G4, G5). */
function addSyntheticLayers(map: maplibregl.Map): void {
  if (!map.getLayer(CLU_HIT_FILL_LAYER_ID)) {
    map.addLayer({
      id: CLU_HIT_FILL_LAYER_ID,
      type: 'fill',
      source: LMM_CLU_SOURCE,
      'source-layer': 'clu',
      paint: {
        'fill-color': '#000000',
        'fill-opacity': 0,
      },
      minzoom: 12, // G12: CLU tiles only exist at zoom >= 12
    });
  }

  if (!map.getLayer(CLU_SELECTED_LAYER_ID)) {
    map.addLayer({
      id: CLU_SELECTED_LAYER_ID,
      type: 'line',
      source: LMM_CLU_SOURCE,
      'source-layer': 'clu',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#2563eb',
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, 0],
        'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0],
      },
      minzoom: 12,
    });
  }

  if (!map.getLayer(PARCELS_SELECTED_LAYER_ID)) {
    map.addLayer({
      id: PARCELS_SELECTED_LAYER_ID,
      type: 'line',
      source: LMM_PARCELS_SOURCE,
      'source-layer': 'parcels',
      paint: {
        'line-color': '#2563eb',
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, 0],
        'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0],
      },
      minzoom: 14,
    });
  }

  if (!map.getLayer(PARCELS_POPUP_HIGHLIGHT_LAYER_ID)) {
    map.addLayer({
      id: PARCELS_POPUP_HIGHLIGHT_LAYER_ID,
      type: 'line',
      source: LMM_PARCELS_SOURCE,
      'source-layer': 'parcels',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        // Orange — distinct from the blue 'selected' outline used by the parcel-tier click flow.
        'line-color': '#f97316',
        'line-width': ['case', ['boolean', ['feature-state', 'popupHighlight'], false], 4, 0],
        'line-opacity': ['case', ['boolean', ['feature-state', 'popupHighlight'], false], 1, 0],
      },
      // Lower than parcels-fill/outline's own minzoom:14 — this must be able to render at
      // whatever zoom the CLU tier or draw tier popup is shown, independent of the vendor's own
      // parcels layers' zoom floor (this layer is never in the tier-visibility group, so it isn't
      // hidden by tier switching, but it still needs its OWN permissive zoom range).
      minzoom: 12,
    });
  }
}

/** Toggle visibility for a group of layer ids. */
export function setLayerGroupVisibility(map: maplibregl.Map, layerIds: string[], visible: boolean): void {
  for (const id of layerIds) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

/**
 * Paint-opacity property to use per REAL vendor layer id, for consumers that toggle CLU/Parcel
 * tier prominence WITHOUT ever setting `layout.visibility` to `'none'` — see
 * `captureLayerOpacity`/`setLayerGroupOpacity` below for why. Deliberately excludes the synthetic
 * hit-test/selected-highlight layers `addSyntheticLayers` adds (`clu-hit-fill`,
 * `clu-selected-outline`, `parcels-selected-outline`, `parcels-popup-highlight`) — those either stay
 * permanently invisible by design (the hit-fill layer) or already drive their own opacity off a
 * feature-state expression (the selected/highlight outlines), so neither needs tier-based toggling.
 */
const LAYER_OPACITY_PAINT_PROP: Partial<Record<string, 'fill-opacity' | 'line-opacity' | 'text-opacity'>> = {
  'clu-outline': 'line-opacity',
  [CLU_LABELS_LAYER_ID]: 'text-opacity',
  'parcels-fill': 'fill-opacity',
  'parcels-outline': 'line-opacity',
  [PARCELS_LABELS_LAYER_ID]: 'text-opacity',
};

/** A captured "fully on" paint-opacity value for one real vendor layer — see `captureLayerOpacity`. */
export interface LmmLayerOpacitySnapshot {
  layerId: string;
  prop: 'fill-opacity' | 'line-opacity' | 'text-opacity';
  onValue: unknown;
}

/**
 * Snapshots each real vendor layer's CURRENT paint-opacity expression (i.e. captured AFTER any
 * override like `overrideParcelsLabelText`'s zoom-interpolated `text-opacity`, not some hardcoded
 * `1`) so `setLayerGroupOpacity` can restore it verbatim later. Layer ids with no known opacity
 * paint property (the synthetic hit/selected layers — see `LAYER_OPACITY_PAINT_PROP`'s doc comment)
 * are silently skipped.
 */
export function captureLayerOpacity(map: maplibregl.Map, layerIds: string[]): LmmLayerOpacitySnapshot[] {
  const out: LmmLayerOpacitySnapshot[] = [];
  for (const id of layerIds) {
    const prop = LAYER_OPACITY_PAINT_PROP[id];
    if (!prop || !map.getLayer(id)) continue;
    out.push({ layerId: id, prop, onValue: map.getPaintProperty(id, prop) ?? 1 });
  }
  return out;
}

/**
 * Toggles visual prominence for a captured layer set via PAINT opacity, never `layout.visibility`.
 *
 * Why this exists (vs. the plain `setLayerGroupVisibility` above): MapLibre stops fetching a vector
 * source's tiles once no `layout.visibility: 'visible'` layer references that source within the
 * current view. The bid-sheet map's CLU/Parcel tier toggle used to call `setLayerGroupVisibility`
 * with `layout.visibility: 'none'` on whichever tier's layer group was inactive — which silently
 * starved the 'parcels' source of any tile fetch at all while the CLU tier was the one visually
 * active, even though the source itself had already been merged into the style. That in turn broke
 * the JIT field-context lookup's client-side parcel-owner enrichment
 * (`findOverlappingParcels`/`querySourceFeatures`), which can only see tiles MapLibre has actually
 * already downloaded. Keeping `layout.visibility` permanently `'visible'` for every merged layer and
 * driving tier prominence through paint opacity instead has no effect on tile fetching, so both
 * sources keep loading tiles regardless of which tier (or neither) is visually toggled on.
 */
export function setLayerGroupOpacity(map: maplibregl.Map, snapshot: LmmLayerOpacitySnapshot[], visible: boolean): void {
  for (const { layerId, prop, onValue } of snapshot) {
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, prop, visible ? onValue : 0);
    }
  }
}
