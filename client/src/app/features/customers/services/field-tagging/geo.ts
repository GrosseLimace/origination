// Small geodesic helpers — verbatim port of lcfs-poc/src/geo.ts (avoids pulling in turf for a
// POC), plus a canonical-serialize + SHA-256 helper for the `drawn` ExternalRef derivation
// (new — see docs/poc/field-tagging/01-data-model.md "Canonical serialization before hashing").

import type { Feature, Polygon, MultiPolygon, Position, Geometry } from 'geojson';

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

/**
 * Andrew's monotone chain convex hull. Treats [lng, lat] as planar, which is
 * fine at field scale (a few hundred meters — geodesic distortion is
 * negligible). Used to reconstruct a full CLU field boundary from several
 * tile-clipped fragments grouped by native MVT id (see the map component's
 * reconstructFullCluGeometry): MVT tiles clip each feature to the tile it
 * belongs to, so a field that spans a tile boundary comes back as multiple
 * disjoint fragments sharing the same native id. The hull of their pooled
 * vertices approximates the true field boundary well for the convex/near-convex
 * shapes typical of agricultural CLU fields.
 */
export function convexHull(points: Position[]): Position[] {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
  if (pts.length < 3) return pts;

  const cross = (o: Position, a: Position, b: Position): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const buildHalf = (points: Position[]): Position[] => {
    const hull: Position[] = [];
    for (const p of points) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
        hull.pop();
      }
      hull.push(p);
    }
    return hull;
  };

  const lower = buildHalf(pts);
  const upper = buildHalf([...pts].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
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
