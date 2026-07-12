// Shared Azure Maps basemap plumbing for the two MapLibre map components (field-tag-map and
// bid-sheet-map). Extracted verbatim from the two components' previously-duplicated copies —
// see field-tag-map.component.ts's original basemap block for the full "why three tilesets,
// switched by visibility not setStyle()" rationale, restated briefly below.
//
// All three tilesets are added up-front, at the BOTTOM of the layer stack, and switched only via
// setLayoutProperty visibility (never map.setStyle(), which would wipe every later-added source —
// the app's tagged-fields geojson, the merged LandMapMagic CLU/parcel layers, the CDL overlay).
// The UI exposes two user-facing choices (Map / Satellite). "Satellite" = imagery + the transparent
// hybrid roads/labels/boundaries overlay; internal ids keep their "hybrid" naming because that
// transparent overlay is exactly what they model. Verified live against atlas.microsoft.com/map/tile:
// microsoft.imagery and microsoft.base.road are opaque raster PNGs; microsoft.base.hybrid.road is a
// transparent raster PNG suitable for stacking over imagery.

import type maplibregl from 'maplibre-gl';
import type { SourceSpecification, LayerSpecification } from 'maplibre-gl';

export type BasemapStyle = 'street' | 'satellite';

const AZURE_IMAGERY_TILESET = 'microsoft.imagery';
const AZURE_STREET_TILESET = 'microsoft.base.road';
const AZURE_HYBRID_TILESET = 'microsoft.base.hybrid.road';

const AZURE_ATTRIBUTION = '© Microsoft — Azure Maps';

/** The three basemap source/layer ids for a component, derived from a per-component id prefix. */
export interface AzureBasemapIds {
  street: string;
  imagery: string;
  hybridOverlay: string;
}

/**
 * Azure Maps raster tile URL for a given tileset. Identical in both components before extraction.
 * The subscription key is the runtime Azure Maps key (FieldTagMapConfig.azureMapsKey /
 * BidSheetMapComponent's azureMapsKey input), never a build-time value.
 */
export function azureTileUrl(azureMapsKey: string, tilesetId: string): string {
  return (
    `https://atlas.microsoft.com/map/tile?api-version=2.0&tilesetId=${tilesetId}` +
    `&zoom={z}&x={x}&y={y}&subscription-key=${azureMapsKey}`
  );
}

export function azureBasemapIds(prefix: string): AzureBasemapIds {
  return {
    street: `${prefix}street`,
    imagery: `${prefix}imagery`,
    hybridOverlay: `${prefix}hybrid-overlay`,
  };
}

/**
 * Build the `sources` + `layers` fragments for the three-tileset Azure basemap, using the given id
 * `prefix` so each component keeps its own historical ids (field-tag: `azure-*`; bid-sheet:
 * `bs-azure-*`). Street is the default-visible layer; imagery + hybrid overlay start hidden
 * (`visibility: 'none'`) and are revealed together for the "Satellite" choice. The caller spreads
 * these into its `new maplibregl.Map({ style: { version: 8, sources, layers } })` call (keeping
 * whatever other constructor options — center/zoom/attributionControl — it needs).
 */
export function buildAzureBasemapStyle(
  azureMapsKey: string,
  prefix: string,
): {
  ids: AzureBasemapIds;
  sources: Record<string, SourceSpecification>;
  layers: LayerSpecification[];
} {
  const ids = azureBasemapIds(prefix);
  const rasterSource = (tilesetId: string): SourceSpecification => ({
    type: 'raster',
    tiles: [azureTileUrl(azureMapsKey, tilesetId)],
    tileSize: 256,
    attribution: AZURE_ATTRIBUTION,
  });

  return {
    ids,
    sources: {
      [ids.street]: rasterSource(AZURE_STREET_TILESET),
      [ids.imagery]: rasterSource(AZURE_IMAGERY_TILESET),
      [ids.hybridOverlay]: rasterSource(AZURE_HYBRID_TILESET),
    },
    layers: [
      // Street (Map) is the default view — matches both components' street-first default.
      { id: ids.street, type: 'raster', source: ids.street },
      { id: ids.imagery, type: 'raster', source: ids.imagery, layout: { visibility: 'none' } },
      { id: ids.hybridOverlay, type: 'raster', source: ids.hybridOverlay, layout: { visibility: 'none' } },
    ],
  };
}

/**
 * Apply a basemap-style choice by toggling layer visibility only (never map.setStyle()). Guards on
 * the street layer existing so callers can invoke it before the style has finished loading (both
 * components already did this). "satellite" shows imagery + the hybrid overlay together.
 */
export function applyBasemapVisibility(map: maplibregl.Map, style: BasemapStyle, ids: AzureBasemapIds): void {
  if (!map.getLayer(ids.street)) return;
  map.setLayoutProperty(ids.street, 'visibility', style === 'street' ? 'visible' : 'none');
  map.setLayoutProperty(ids.imagery, 'visibility', style === 'satellite' ? 'visible' : 'none');
  map.setLayoutProperty(ids.hybridOverlay, 'visibility', style === 'satellite' ? 'visible' : 'none');
}
