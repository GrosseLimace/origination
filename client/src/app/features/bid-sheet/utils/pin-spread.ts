/**
 * Bid sheet map — overlapping pin spread.
 *
 * Pure geometry: the page passes in the map's projection for the current zoom (lat/lng ↔ screen
 * pixels), so this never touches Leaflet and can be tested on plain numbers.
 */

/** Radius each overlapping pin is pushed from the cluster centroid, in screen px. */
export const SPREAD_PX = 24;
/** Pins closer than this (screen px) are treated as overlapping. */
export const OVERLAP_PX = SPREAD_PX * 2;

export type ProjectFn = (lat: number, lng: number) => { x: number; y: number };
export type UnprojectFn = (x: number, y: number) => [number, number];

/**
 * Spreads pins whose on-screen positions would overlap so none get hidden behind another. Members
 * of an overlapping cluster are pushed out to a fixed pixel radius around the cluster centroid; the
 * spread is computed in screen pixels at the current zoom, so as you zoom in and the true positions
 * separate, the offset shrinks and each pin glides back to its real spot. Returns one [lat,lng] per
 * input point (aligned by index); points that don't overlap anything are returned unchanged.
 */
export function spreadOverlappingPins(points: [number, number][], project: ProjectFn, unproject: UnprojectFn): [number, number][] {
  if (points.length < 2) return points;
  const pts = points.map(([la, ln]) => project(la, ln));

  // Union-find: group pins that overlap (transitively) into clusters.
  const parent = points.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
      if (dx * dx + dy * dy < OVERLAP_PX * OVERLAP_PX) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < pts.length; i++) {
    const r = find(i);
    const arr = clusters.get(r) ?? [];
    arr.push(i);
    clusters.set(r, arr);
  }

  const out: [number, number][] = points.slice();
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    let cx = 0, cy = 0;
    for (const i of members) { cx += pts[i].x; cy += pts[i].y; }
    cx /= members.length; cy /= members.length;
    members.forEach((i, idx) => {
      const vx = pts[i].x - cx, vy = pts[i].y - cy;
      const d = Math.sqrt(vx * vx + vy * vy);
      let nx: number, ny: number;
      if (d < 0.001) {
        // Coincident at this zoom — fan out evenly on a circle, ordered by index.
        const ang = (2 * Math.PI * idx) / members.length;
        nx = cx + SPREAD_PX * Math.cos(ang);
        ny = cy + SPREAD_PX * Math.sin(ang);
      } else if (d < SPREAD_PX) {
        // Push outward to the spread radius (continuous: at d === SPREAD_PX this is a no-op).
        const s = SPREAD_PX / d;
        nx = cx + vx * s; ny = cy + vy * s;
      } else {
        return; // already far enough apart — keep the true position
      }
      out[i] = unproject(nx, ny);
    });
  }
  return out;
}
