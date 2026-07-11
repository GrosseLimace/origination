// Port of lcfs-poc/src/api/aoi-query.ts. Plain `fetch` deliberately — see lmm-point-lookup.ts.

import type { Feature, Geometry } from 'geojson';

const LMM_BASE_URL = 'https://api.landmapmagic.com/v1';

/** A single normalized feature row inside a layer's `features` array. */
export interface AoiLayerFeature {
  id: string;
  name: string;
  kind: string;
  area: {
    intersection_acres: number;
    feature_acres: number | null;
    percent_of_feature_in_aoi: number | null;
    percent_of_aoi_in_feature: number | null;
    intersection?: Record<string, number>;
    feature?: Record<string, number> | null;
  };
  properties: Record<string, unknown>;
  geometry: Geometry | null;
}

/** A layer entry in `layers.<layerName>`, e.g. `layers.clu` or `layers["cdl:2024"]`. */
export interface AoiLayer {
  type: 'vector' | 'raster_summary';
  status: string;
  feature_count: number;
  features: AoiLayerFeature[];
  metadata?: Record<string, unknown>;
}

/** The exact AOI Query response envelope, confirmed against the live API. */
export interface AoiQueryResponse {
  aoi: {
    area: {
      acres: number;
      hectares: number;
      square_meters: number;
      square_kilometers: number;
      square_miles: number;
    };
  };
  layers: Record<string, AoiLayer>;
  summary: {
    layers_queried: string[];
    total_features_found: number;
    processing_time_ms: number;
  };
  query: {
    timestamp: string;
    account_id: string;
    requested_layers: string[];
    layers: { vector: string[]; cdl_years: string[] };
  };
}

/** Crop breakdown entry derived from a CDL layer feature's `properties`. */
export interface CropBreakdownEntry {
  code: string;
  crop: string;
  intersectionAcres: number;
  percentOfAoi: number | null;
}

export interface AoiQueryResult {
  /** CLU field boundary features (empty if the "clu" layer was not requested). */
  features: Feature[];
  /** CDL crop classification breakdown for the queried year. */
  cropBreakdown: CropBreakdownEntry[];
  /** Total AOI acreage, from `aoi.area.acres`. */
  acres: number;
  /** CDL year actually used (preferred year, or the fallback year on retry). */
  cdlYear: string;
  /** Full raw API response, retained for POC inspection/debugging. */
  raw: AoiQueryResponse;
}

/**
 * LandMapMagic AOI Query — capture field geometry + CDL crop history for an
 * area of interest. 10 tokens per call. Tries the preferred CDL year first,
 * falls back to the fallback year (G8/G9 in the gotcha ledger).
 *
 * `includeCluLayer` — CLU tier only; parcel/drawn tiers must NEVER include
 * "clu" or "parcels" as an AOI layer (the live API rejects "parcels" — G9).
 */
export async function aoiQuery(
  aoi: Feature,
  includeCluLayer: boolean,
  landMapMagicKey: string,
  cdlYear: string,
  cdlFallbackYear: string,
): Promise<AoiQueryResult> {
  try {
    return await postAoi(aoi, includeCluLayer, cdlYear, landMapMagicKey);
  } catch (err) {
    console.warn(`[lmm-aoi-query] cdl:${cdlYear} query failed, retrying with cdl:${cdlFallbackYear}`, err);
    return await postAoi(aoi, includeCluLayer, cdlFallbackYear, landMapMagicKey);
  }
}

async function postAoi(
  aoi: Feature,
  includeCluLayer: boolean,
  cdlYear: string,
  landMapMagicKey: string,
): Promise<AoiQueryResult> {
  const cdlKey = `cdl:${cdlYear}`;
  const layers = includeCluLayer ? ['clu', cdlKey] : [cdlKey];
  const res = await fetch(`${LMM_BASE_URL}/data/aoi?key=${encodeURIComponent(landMapMagicKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      aoi,
      layers,
      // G8: the live API expects camelCase `includeGeometry`, not the
      // `include_geometry` shown in the vendor's own docs — snake_case here
      // silently returns geometry: null.
      options: { includeGeometry: true },
    }),
  });
  if (!res.ok) {
    throw new Error(`AOI Query failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as AoiQueryResponse;

  const cluFeatures = body.layers['clu']?.features ?? [];
  const features: Feature[] = cluFeatures
    .filter((f) => f.geometry != null)
    .map((f) => ({
      type: 'Feature',
      id: f.id,
      geometry: f.geometry as Geometry,
      properties: { ...f.properties, name: f.name, kind: f.kind, area: f.area },
    }));

  const cdlLayer = body.layers[cdlKey];
  const cropBreakdown: CropBreakdownEntry[] = (cdlLayer?.features ?? []).map((f) => ({
    code: String(f.properties['crop_code'] ?? ''),
    crop: String(f.properties['crop_name'] ?? 'Unknown'),
    intersectionAcres: f.area.intersection_acres,
    percentOfAoi: f.area.percent_of_aoi_in_feature,
  }));

  return {
    features,
    cropBreakdown,
    acres: body.aoi.area.acres,
    cdlYear,
    raw: body,
  };
}
