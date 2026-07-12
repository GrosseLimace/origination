// Small geodesic helpers — verbatim port of lcfs-poc/src/geo.ts (avoids pulling in turf for a
// POC), plus a canonical-serialize + SHA-256 helper for the `drawn` ExternalRef derivation
// (new — see docs/poc/field-tagging/01-data-model.md "Canonical serialization before hashing").

import type { Feature, Polygon, MultiPolygon, Position, Geometry } from 'geojson';
// `polygon-clipping`'s ESM build only provides a default export (an object with
// `.union`/`.intersection`/etc. as properties) — there is no named `union` export despite the
// package's own TypeScript types suggesting otherwise. Import the default and call `.union(...)`.
import polygonClipping from 'polygon-clipping';

const EARTH_RADIUS_M = 6378137;
const SQ_METERS_PER_ACRE = 4046.8564224;

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Spherical excess ring area in square meters (same algorithm as turf/area). Signed. */
function ringAreaM2(ring: Position[]): number {
  const len = ring.length;
  if (len < 3) return 0;
  let total = 0;
  for (let i = 0; i < len; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % len];
    const p3 = ring[(i + 2) % len];
    total += (rad(p3[0]) - rad(p1[0])) * Math.sin(rad(p2[1]));
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

/** Area of a Polygon or MultiPolygon in acres (exterior minus holes). */
export function geometryAcres(geometry: Polygon | MultiPolygon): number {
  const polys: Position[][][] =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const rings of polys) {
    if (rings.length === 0) continue;
    total += Math.abs(ringAreaM2(rings[0]));
    for (let i = 1; i < rings.length; i++) {
      total -= Math.abs(ringAreaM2(rings[i]));
    }
  }
  return total / SQ_METERS_PER_ACRE;
}

/** Planar shoelace signed area — positive means counter-clockwise. */
function signedAreaPlanar(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
  }
  return -sum / 2;
}

/**
 * Normalize winding: exterior rings counter-clockwise, holes clockwise
 * (GeoJSON RFC 7946), as required by the LandMapMagic AOI Query.
 * Returns a new geometry; does not mutate the input.
 */
export function normalizeWinding(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  const fixRings = (rings: Position[][]): Position[][] =>
    rings.map((ring, idx) => {
      const ccw = signedAreaPlanar(ring) > 0;
      const wantCcw = idx === 0; // exterior CCW, holes CW
      return ccw === wantCcw ? ring : [...ring].reverse();
    });

  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: fixRings(geometry.coordinates) };
  }
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(fixRings) };
}

/** Wrap a geometry as a GeoJSON Feature suitable for the AOI request body. */
export function toAoiFeature(geometry: Polygon | MultiPolygon): Feature {
  return {
    type: 'Feature',
    geometry: normalizeWinding(geometry),
    properties: {},
  };
}

const METERS_PER_DEGREE_LAT = 111320;

/**
 * Expand a geometry's bounding box by `marginMeters` in every direction and return it as a
 * rectangular Polygon. Used to widen the AOI query submitted for CLU selections: the vendor's
 * AOI endpoint only returns features that geographically intersect the SUBMITTED polygon, and
 * `sourceGeometry` can be as small as a single tile-clipped fragment (when client-side union
 * reconstruction — `reconstructFullFieldGeometry` — fails or the field's sibling fragments
 * aren't loaded in adjacent tiles yet). A sibling fragment sitting just across a tile boundary
 * may not geometrically touch that small fragment at all, so submitting it as-is can make the
 * AOI response miss siblings entirely — before `confirmSelection` even gets a chance to group
 * same-calcacres fragments (see the G10/G13 notes in field-tag-map.component.ts). Padding by a
 * few hundred meters reliably reaches into a neighboring MVT tile without making the query
 * absurdly large. Longitude margin is latitude-corrected (degrees-per-meter shrinks toward the
 * poles); this is a planar approximation, which is fine at field scale (same tradeoff accepted
 * by `unionGeometries` below).
 */
export function paddedBoundingBoxPolygon(geometry: Polygon | MultiPolygon, marginMeters: number): Polygon {
  const polys: Position[][][] = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const rings of polys) {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  const centerLat = (minLat + maxLat) / 2;
  const latMargin = marginMeters / METERS_PER_DEGREE_LAT;
  const lngMargin = marginMeters / (METERS_PER_DEGREE_LAT * Math.cos(rad(centerLat)));

  const lo: Position = [minLng - lngMargin, minLat - latMargin];
  const hi: Position = [maxLng + lngMargin, maxLat + latMargin];

  return {
    type: 'Polygon',
    coordinates: [
      [
        [lo[0], lo[1]],
        [hi[0], lo[1]],
        [hi[0], hi[1]],
        [lo[0], hi[1]],
        [lo[0], lo[1]],
      ],
    ],
  };
}

// polygon-clipping represents rings/polygons/multipolygons as plain nested number-pair arrays
// (no GeoJSON `type` wrapper), so [lng, lat] Positions round-trip losslessly through it — these
// aliases just name the shapes for the conversion helpers below.
type PcRing = [number, number][];
type PcPolygon = PcRing[];
type PcMultiPolygon = PcPolygon[];

function toPcGeom(geometry: Polygon | MultiPolygon): PcPolygon | PcMultiPolygon {
  const toRing = (ring: Position[]): PcRing => ring.map((p) => [p[0], p[1]] as [number, number]);
  const toPoly = (rings: Position[][]): PcPolygon => rings.map(toRing);
  return geometry.type === 'Polygon' ? toPoly(geometry.coordinates) : geometry.coordinates.map(toPoly);
}

function fromPcMultiPolygon(multiPolygon: PcMultiPolygon): Polygon | MultiPolygon | null {
  if (multiPolygon.length === 0) return null;
  const toRings = (poly: PcPolygon): Position[][] => poly.map((ring) => ring.map((p) => [p[0], p[1]] as Position));
  if (multiPolygon.length === 1) return { type: 'Polygon', coordinates: toRings(multiPolygon[0]) };
  return { type: 'MultiPolygon', coordinates: multiPolygon.map(toRings) };
}

/**
 * Reconstruct a full field boundary from several tile-clipped fragments by computing their real
 * polygon UNION (Martinez clipping via `polygon-clipping`), not a convex hull. Used to merge:
 * (1) client-loaded MVT tile fragments sharing the same native id (see the map component's
 * `reconstructFullFieldGeometry`) — MVT tiles clip each feature to the tile it belongs to, so a
 * field spanning a tile boundary comes back as multiple disjoint fragments; and (2) LandMapMagic
 * AOI-response rows sharing the same tract-level `calcacres` (see `confirmSelection`'s AOI-fragment
 * merge) — the vendor tiles its own response the same way.
 *
 * A convex hull of the pooled fragment vertices is only an approximation — it inflates any
 * concave feature of the true boundary (an L-shape, a boundary following a creek/road, a terraced
 * edge, etc.) into a straight line across the gap. Since these fragments are literally pieces of
 * one original polygon cut along straight tile/AOI-boundary lines, union is the exact geometric
 * inverse of that clipping: it reconstructs the true (possibly concave) shape exactly, up to
 * floating-point precision, rather than merely bounding it.
 *
 * Fragments that are adjacent-but-not-perfectly-touching (floating-point seams) can legitimately
 * union into more than one polygon, so this returns `Polygon | MultiPolygon` — callers already
 * handle both (see `CustomerFieldTag.geometryJson` / `pickPolygonGeometry`). Winding is normalized
 * to RFC 7946 before returning. Returns `null` if there are no usable input geometries or the
 * union produces no output.
 */
export function unionGeometries(geoms: (Polygon | MultiPolygon)[]): Polygon | MultiPolygon | null {
  if (geoms.length === 0) return null;
  const [first, ...rest] = geoms.map(toPcGeom);
  const merged = polygonClipping.union(first, ...rest);
  const result = fromPcMultiPolygon(merged);
  return result ? normalizeWinding(result) : null;
}

/**
 * Round every coordinate in a geometry to 6 decimal places (~0.11 m — well
 * below any meaningful boundary difference, well above float jitter). Step 2
 * of the drawn-tier ExternalRef canonicalization
 * (docs/poc/field-tagging/01-data-model.md).
 */
function roundCoordinates(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  const round = (p: Position): Position => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
  const roundRings = (rings: Position[][]): Position[][] => rings.map((ring) => ring.map(round));
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: roundRings(geometry.coordinates) };
  }
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(roundRings) };
}

/**
 * Canonical minimal-JSON serialization of a normalized, coordinate-rounded
 * geometry — `{"type":...,"coordinates":[...]}` with no whitespace, matching
 * standard `JSON.stringify` key order for these two fixed keys. Step 3 of the
 * drawn-tier ExternalRef canonicalization.
 */
export function canonicalGeometryJson(geometry: Polygon | MultiPolygon): string {
  const normalized = normalizeWinding(geometry);
  const rounded = roundCoordinates(normalized);
  return JSON.stringify({ type: rounded.type, coordinates: rounded.coordinates });
}

/**
 * SHA-256 hex digest (lowercase) via the browser's `crypto.subtle` — available
 * on `localhost`/HTTPS secure contexts. Used to derive the `drawn:` ExternalRef
 * (the only selection method that hashes; CLU/parcel key off real vendor ids —
 * see 01-data-model.md).
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Derive the `drawn:<sha256>` ExternalRef for a hand-drawn polygon. */
export async function drawnExternalRef(geometry: Polygon | MultiPolygon): Promise<string> {
  const canonical = canonicalGeometryJson(geometry);
  return `drawn:${await sha256Hex(canonical)}`;
}

export function pickPolygonGeometry(geometry: Geometry | undefined | null): Polygon | MultiPolygon | null {
  if (geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
    return geometry;
  }
  return null;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Even-odd ray-casting containment test for a single ring. */
function ringContainsPoint(ring: Position[], point: Position): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon test (even-odd ray casting), respecting holes — a point inside the exterior
 * ring but also inside any interior (hole) ring is NOT contained. Used to test whether a CLU-tier
 * map click falls within an already-loaded parcel fragment (see field-tag-map.component.ts's
 * `findOverlappingParcels`) — the vendor's Point Lookup endpoint never actually returns parcel
 * data (confirmed live — see lmm-point-lookup.ts), so parcel/owner lookups for a click must be
 * done against already-loaded MVT tile geometry client-side instead.
 */
export function pointInPolygon(point: Position, geometry: Polygon | MultiPolygon): boolean {
  const polys: Position[][][] = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const rings of polys) {
    if (rings.length === 0) continue;
    if (!ringContainsPoint(rings[0], point)) continue;
    let inHole = false;
    for (let i = 1; i < rings.length; i++) {
      if (ringContainsPoint(rings[i], point)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Whether two polygon geometries share any area, via real polygon intersection (`polygon-clipping`
 * — same library `unionGeometries` already uses). Used to find every already-loaded parcel
 * fragment overlapping a hand-drawn (Tier 4) polygon: the vendor's AOI endpoint flatly rejects
 * "parcels" as a layer (confirmed live: 400 "Invalid layers requested: parcels. Available layers:
 * states, counties, plss, townships, sections, clu, cdl, ssurgo"), so there is no vendor-API path
 * to "list every parcel under this polygon" — client-side geometric intersection against whatever
 * parcel tiles are already loaded is the only feasible mechanism.
 */
export function polygonsIntersect(a: Polygon | MultiPolygon, b: Polygon | MultiPolygon): boolean {
  try {
    const result = polygonClipping.intersection(toPcGeom(a) as never, toPcGeom(b) as never);
    return result.length > 0;
  } catch {
    return false;
  }
}
