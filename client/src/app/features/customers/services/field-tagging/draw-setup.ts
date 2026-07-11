// Verbatim port of lcfs-poc/src/map/draw.ts (Tier 4 polygon drawing on MapLibre via
// @mapbox/mapbox-gl-draw, with the G6/G7 shims already found and fixed there).

import MapboxDraw from '@mapbox/mapbox-gl-draw';
import type maplibregl from 'maplibre-gl';
import type { Feature, Polygon } from 'geojson';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

// G7: MapboxDraw targets Mapbox GL's CSS class prefixes; point it at MapLibre's so its (hidden)
// control container doesn't error/mis-render.
const drawConstants = (MapboxDraw as unknown as { constants: { classes: Record<string, string> } }).constants;
drawConstants.classes['CONTROL_BASE'] = 'maplibregl-ctrl';
drawConstants.classes['CONTROL_PREFIX'] = 'maplibregl-ctrl-';
drawConstants.classes['CONTROL_GROUP'] = 'maplibregl-ctrl-group';

export interface DrawController {
  /** Enter polygon-draw mode (Tier 4). */
  activate(): void;
  /** Leave draw mode and clear any drawn features. */
  deactivate(): void;
  /**
   * Clear the just-confirmed drawn polygon and re-arm draw mode so the user can immediately draw
   * the next field, without a double-rendered plugin polygon lingering alongside the newly saved
   * tag. Identical behavior to `activate()` today (deleteAll + changeMode('draw_polygon')) but
   * named for the confirm-path call site's intent — re-run after each `draw.create` is handled.
   */
  rearm(): void;
}

// G6: mapbox-gl-draw's built-in theme uses bare-array `line-dasharray` branches inside a `case`
// expression (e.g. `['case', [...], [0.2, 2], [2, 0]]`). MapLibre's stricter style-spec validator
// rejects that — it expects `['literal', [0.2, 2]]` for array literals inside expressions. Rather
// than patch the vendored theme, supply a minimal solid-line style set (no dasharray) sufficient
// for Tier 4 polygon drawing.
const DRAW_STYLES = [
  {
    id: 'gl-draw-polygon-fill',
    type: 'fill',
    filter: ['all', ['==', '$type', 'Polygon']],
    paint: { 'fill-color': '#3bb2d0', 'fill-opacity': 0.15 },
  },
  {
    id: 'gl-draw-polygon-stroke',
    type: 'line',
    filter: ['all', ['==', '$type', 'Polygon']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#3bb2d0', 'line-width': 2 },
  },
  {
    id: 'gl-draw-line',
    type: 'line',
    filter: ['all', ['==', '$type', 'LineString']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#3bb2d0', 'line-width': 2 },
  },
  {
    id: 'gl-draw-polygon-and-line-vertex-halo-active',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
    paint: { 'circle-radius': 6, 'circle-color': '#fff' },
  },
  {
    id: 'gl-draw-polygon-and-line-vertex-active',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
    paint: { 'circle-radius': 4, 'circle-color': '#3bb2d0' },
  },
  {
    id: 'gl-draw-polygon-midpoint',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'midpoint'], ['==', '$type', 'Point']],
    paint: { 'circle-radius': 3, 'circle-color': '#fbb03b' },
  },
];

export function setupDraw(
  map: maplibregl.Map,
  onPolygonDrawn: (feature: Feature<Polygon>) => void,
): DrawController {
  const draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: {},
    styles: DRAW_STYLES,
  });

  // mapbox-gl-draw's types expect a Mapbox map; MapLibre is API-compatible here.
  map.addControl(draw as unknown as maplibregl.IControl);

  map.on('draw.create' as never, ((e: { features: Feature<Polygon>[] }) => {
    const feature = e.features?.[0];
    if (feature?.geometry?.type === 'Polygon') {
      onPolygonDrawn(feature);
    }
  }) as never);

  return {
    activate() {
      draw.deleteAll();
      draw.changeMode('draw_polygon');
    },
    rearm() {
      draw.deleteAll();
      draw.changeMode('draw_polygon');
    },
    deactivate() {
      draw.deleteAll();
      try {
        draw.changeMode('simple_select');
      } catch {
        // ignore — mode may already be simple_select
      }
    },
  };
}
