import { describe, expect, it, vi } from 'vitest';
import { OVERLAP_PX, SPREAD_PX, spreadOverlappingPins } from './pin-spread';

// Identity projection: a point's [lat, lng] is used directly as screen (y, x) pixels, so the
// expected offsets can be read straight off the inputs.
const project = (lat: number, lng: number) => ({ x: lng, y: lat });
const unproject = (x: number, y: number): [number, number] => [y, x];
const spread = (points: [number, number][]) => spreadOverlappingPins(points, project, unproject);
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('spreadOverlappingPins', () => {
  it('returns the input untouched for fewer than two pins (no projection needed)', () => {
    const p = vi.fn(project);
    const one: [number, number][] = [[1, 2]];
    expect(spreadOverlappingPins(one, p, unproject)).toBe(one);
    expect(p).not.toHaveBeenCalled();
  });

  it('leaves pins at least OVERLAP_PX apart where they are', () => {
    expect(spread([[0, 0], [0, OVERLAP_PX]])).toEqual([[0, 0], [0, OVERLAP_PX]]);
  });

  it('pushes two close pins out to SPREAD_PX from their centroid along their own direction', () => {
    const out = spread([[0, 0], [0, 10]]);
    expect(out[0][0]).toBeCloseTo(0);
    expect(out[0][1]).toBeCloseTo(5 - SPREAD_PX);
    expect(out[1][1]).toBeCloseTo(5 + SPREAD_PX);
  });

  it('pushes pins that overlap but are already more than half the spread apart all the way out', () => {
    const out = spread([[0, 0], [0, 30]]); // each 15px from the centroid
    expect(out[0][1]).toBeCloseTo(15 - SPREAD_PX);
    expect(out[1][1]).toBeCloseTo(15 + SPREAD_PX);
  });

  it('keeps a pin already SPREAD_PX or more from the centroid at its true position', () => {
    // One cluster centred on x = 30: the outer pins are 30px out (kept), the middle pin sits ON the
    // centroid, so it is fanned out at its index's angle (idx 1 of 3 → 2π/3).
    const out = spread([[0, 0], [0, 30], [0, 60]]);
    expect(out[0]).toEqual([0, 0]);
    expect(out[2]).toEqual([0, 60]);
    expect(out[1][1]).toBeCloseTo(30 + SPREAD_PX * Math.cos((2 * Math.PI) / 3));
    expect(out[1][0]).toBeCloseTo(SPREAD_PX * Math.sin((2 * Math.PI) / 3));
  });

  it('fans coincident pins evenly round a circle, ordered by index', () => {
    const out = spread([[10, 10], [10, 10], [10, 10], [10, 10]]);
    // angle 0 → +x, π/2 → +y, π → −x, 3π/2 → −y (x = lng, y = lat in this projection)
    expect(out[0][0]).toBeCloseTo(10); expect(out[0][1]).toBeCloseTo(10 + SPREAD_PX);
    expect(out[1][0]).toBeCloseTo(10 + SPREAD_PX); expect(out[1][1]).toBeCloseTo(10);
    expect(out[2][0]).toBeCloseTo(10); expect(out[2][1]).toBeCloseTo(10 - SPREAD_PX);
    expect(out[3][0]).toBeCloseTo(10 - SPREAD_PX); expect(out[3][1]).toBeCloseTo(10);
  });

  it('clusters transitively: A–B and B–C overlap, so A, B and C share one centroid', () => {
    const out = spread([[0, 0], [0, 40], [0, 80], [500, 500]]);
    // Centroid x = 40: A and C are 40px out (kept), B sits on it (fanned).
    expect(out[0]).toEqual([0, 0]);
    expect(out[2]).toEqual([0, 80]);
    expect(dist(out[1], [0, 40])).toBeCloseTo(SPREAD_PX);
    expect(out[3]).toEqual([500, 500]); // an isolated pin is never moved
  });
});
