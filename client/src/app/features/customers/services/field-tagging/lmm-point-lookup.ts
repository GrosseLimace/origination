// Port of lcfs-poc/src/api/point-lookup.ts. Uses plain `fetch` deliberately (not Angular
// HttpClient) so the app's auth interceptor never attaches a bearer token to a vendor host — see
// docs/poc/field-tagging/03-frontend-map-component.md "Vendor service layer files".

import type { Feature } from 'geojson';

const LMM_BASE_URL = 'https://api.landmapmagic.com/v1';

/**
 * A single field/parcel identified by the LandMapMagic Point Lookup endpoint.
 * `fieldId` and `acreage` are extracted using the real, confirmed property
 * names for each layer (see notes on `pointLookup` below) rather than a
 * guessing chain across speculative property names.
 */
export interface LookupField {
  layer: 'clu' | 'parcels';
  fieldId: string;
  acreage: number | null;
  feature: Feature;
}

interface LmmPointLayerFeature {
  id: string;
  name?: string;
  kind?: string;
  properties?: Record<string, unknown>;
  geometry?: Feature['geometry'] | null;
}

interface LmmPointResponse {
  layers?: {
    clu?: { features?: LmmPointLayerFeature[] };
    parcels?: { features?: LmmPointLayerFeature[] };
  };
}

/**
 * LandMapMagic Point Lookup — identify CLU/parcel features at a clicked
 * coordinate. 1 token per call.
 *
 * Response envelope confirmed against the live API:
 *   { layers: { clu: { features: [{ id, name, kind, properties, geometry }] } }, summary, query }
 * This is NOT a bare FeatureCollection / `{ features: [...] }` wrapper —
 * features are nested per layer under `layers.<name>` (G11 in the gotcha
 * ledger).
 *
 * CLU features: acreage is `properties.calcacres`. The top-level `id` on a
 * CLU point-lookup feature is consistently the literal string "unknown" — a
 * real API limitation (G11); CLU identity instead comes from the vector tile
 * feature's own native MVT id (`tileFeature.id`), never from here.
 *
 * Parcel features: the live point-lookup endpoint never actually returns a
 * "parcels" entry under `layers` for any tested location — parcel data
 * exists only as a map-rendering vector tile source. Decoding a real parcels
 * .mvt tile directly shows each feature's properties as
 * `{ robust_id, parcel_id, owner, acreage_calc }` — `parcel_id` is the field
 * id and `acreage_calc` is the acreage. Parsing below uses those real names in
 * case a future API version starts surfacing parcels through this endpoint;
 * today this branch simply never populates and callers fall back to the tile
 * feature's own properties (see the map component's click handler).
 */
export async function pointLookup(
  lat: number,
  lng: number,
  landMapMagicKey: string,
): Promise<LookupField[]> {
  const url =
    `${LMM_BASE_URL}/data/point?key=${encodeURIComponent(landMapMagicKey)}` +
    `&lat=${lat}&lng=${lng}&layers=clu,parcels`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Point Lookup failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as LmmPointResponse;

  const results: LookupField[] = [];

  for (const raw of body.layers?.clu?.features ?? []) {
    results.push({
      layer: 'clu',
      fieldId: raw.id,
      acreage: toAcreage(raw.properties?.['calcacres']),
      feature: toGeoJsonFeature(raw),
    });
  }

  for (const raw of body.layers?.parcels?.features ?? []) {
    results.push({
      layer: 'parcels',
      fieldId: String(raw.properties?.['parcel_id'] ?? raw.id),
      acreage: toAcreage(raw.properties?.['acreage_calc']),
      feature: toGeoJsonFeature(raw),
    });
  }

  return results;
}

function toAcreage(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toGeoJsonFeature(raw: LmmPointLayerFeature): Feature {
  return {
    type: 'Feature',
    id: raw.id,
    properties: raw.properties ?? {},
    geometry: raw.geometry ?? null,
  } as Feature;
}
