// Shared client-side parcel-owner lookup for the two MapLibre map components. There is NO
// vendor-API equivalent: the AOI endpoint flatly rejects "parcels" as a layer (confirmed live —
// see geo.ts's `polygonsIntersect`), and Point Lookup never returns parcel data either (confirmed
// live — see lmm-point-lookup.ts). Ownership therefore comes from a purely client-side spatial
// query against whatever "parcels" MVT tiles MapLibre has already fetched.
//
// This adopts field-tag-map.component.ts's more-robust implementation as the single shared version:
// it groups every already-loaded parcel fragment by the source's own promoted `parcel_id` and
// UNION-MERGES their geometries before the containment/intersection test (the same tile-seam merge
// used by reconstructFullFieldGeometry), so a field spanning a tile boundary is tested against its
// true reconstructed shape rather than one clipped fragment at a time. bid-sheet-map previously used
// a simpler per-fragment point test (dedup by id, no union); the union approach is a strict superset
// for a point query (union can only ADD coverage at seams, never remove a real containment), and it
// additionally supports the polygon-intersection query field-tag-map's draw tier needs.

import type maplibregl from 'maplibre-gl';
import type { Geometry, Polygon, MultiPolygon, Position } from 'geojson';
import { pickPolygonGeometry, unionGeometries, pointInPolygon, polygonsIntersect } from './geo';
import { toNumber, toDisplayString } from './lmm-popup';

/**
 * One already-loaded parcel fragment-group overlapping a click point or a drawn polygon. `id` is the
 * parcels source's own promoted feature id (real `parcel_id`), reused directly for feature-state
 * lookups (hover-highlight, selection) without any extra conversion.
 */
export interface ParcelOwnerMatch {
  id: string | number;
  parcelId: string;
  owner: string | null;
  acreage: number | null;
}

/** Union-merge a set of possibly-fragmentary geometries into one boundary (or null if none usable). */
function unionMergeGeometries(geoms: (Geometry | null | undefined)[]): Polygon | MultiPolygon | null {
  const polys: (Polygon | MultiPolygon)[] = [];
  for (const geom of geoms) {
    const poly = pickPolygonGeometry(geom);
    if (poly) polys.push(poly);
  }
  if (polys.length === 0) return null;
  return unionGeometries(polys);
}

/**
 * Find every already-loaded "parcels" fragment-group (grouped by promoted `parcel_id`, geometries
 * union-merged) whose boundary CONTAINS `target.point` or INTERSECTS `target.polygon`. Returns `[]`
 * if the parcels source was never merged into the style (e.g. the vendor layers were never loaded
 * this session) — this is best-effort enrichment, not a hard requirement. Matches are grouped by
 * parcel id and never deduplicated by owner name, so multiple parcels owned by the same person still
 * each produce their own row.
 */
export function findOverlappingParcels(
  map: maplibregl.Map,
  target: { point: Position } | { polygon: Polygon | MultiPolygon },
): ParcelOwnerMatch[] {
  if (!map.getSource('parcels')) return [];

  const fragments = map.querySourceFeatures('parcels', { sourceLayer: 'parcels' });
  const byId = new Map<
    string | number,
    { id: string | number; geoms: Geometry[]; owner: string | null; acreage: number | null }
  >();
  for (const f of fragments) {
    if (f.id == null) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const entry = byId.get(f.id) ?? { id: f.id, geoms: [], owner: null, acreage: null };
    entry.geoms.push(f.geometry as Geometry);
    if (entry.owner == null) entry.owner = toDisplayString(props['owner']);
    if (entry.acreage == null) entry.acreage = toNumber(props['acreage_calc']);
    byId.set(f.id, entry);
  }

  const matches: ParcelOwnerMatch[] = [];
  for (const entry of byId.values()) {
    const merged = unionMergeGeometries(entry.geoms);
    if (!merged) continue;
    const hit = 'point' in target ? pointInPolygon(target.point, merged) : polygonsIntersect(target.polygon, merged);
    if (!hit) continue;
    matches.push({ id: entry.id, parcelId: String(entry.id), owner: entry.owner, acreage: entry.acreage });
  }
  return matches;
}
