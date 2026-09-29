import { describe, it, expect } from 'vitest';
import { mergeProducerRows, IdentifiedRow } from './merge-producer-rows';

/**
 * The rule that decides whether a background refresh can actually change what a user sees.
 *
 * All three failures this covers are silent ones: a stale row that looks current, a row that should have
 * vanished but hasn't, and a row belonging to another producer being thrown away. None of them produce an
 * error — they produce a screen that is quietly wrong, which at harvest is the expensive kind.
 */
describe('mergeProducerRows', () => {
  interface Row extends IdentifiedRow { label: string }
  const row = (id: number, label: string): Row => ({ id, label });

  describe('a first read (not a refresh)', () => {
    it('adds the incoming rows to the pool', () => {
      const merged = mergeProducerRows([row(1, 'other')], [row(2, 'mine')], undefined, false);

      expect(merged.map(r => r.id).sort()).toEqual([1, 2]);
    });

    it('replaces a row that is already present rather than skipping it', () => {
      // The original bug: only ids not already seen were pushed, so a row already in the pool from a
      // trade-unit-wide load was never updated by the per-producer read.
      const merged = mergeProducerRows([row(1, 'stale')], [row(1, 'fresh')], undefined, false);

      expect(merged).toEqual([row(1, 'fresh')]);
    });

    it('does not retract anything, even when previous ids are known', () => {
      // Only a refresh retracts. A first read must not remove rows it simply did not return.
      const merged = mergeProducerRows([row(1, 'kept')], [row(2, 'new')], new Set([1]), false);

      expect(merged.map(r => r.id).sort()).toEqual([1, 2]);
    });
  });

  describe('a refresh', () => {
    it('updates a row whose id is unchanged but whose contents are not', () => {
      // A ticket's synthetic id is built from prefix/number/suffix/BL date/product/sequence - NOT the
      // contract number or status - so an applied or settled ticket keeps its id. Skipping it left the
      // row reading "unapplied" for the rest of the session.
      const merged = mergeProducerRows(
        [row(10, 'unapplied')], [row(10, 'applied')], new Set([10]), true);

      expect(merged).toEqual([row(10, 'applied')]);
    });

    it('removes a row the new read no longer returns', () => {
      // A contract that closed out of the list, or a ticket cancelled and now excluded server-side.
      const merged = mergeProducerRows(
        [row(10, 'gone'), row(11, 'still here')], [row(11, 'still here')], new Set([10, 11]), true);

      expect(merged.map(r => r.id)).toEqual([11]);
    });

    it('leaves other producers rows alone', () => {
      // Retracting by the previous read's ids rather than by customer code is what protects these.
      const merged = mergeProducerRows(
        [row(1, 'another producer'), row(10, 'mine, gone')], [], new Set([10]), true);

      expect(merged).toEqual([row(1, 'another producer')]);
    });

    it('keeps a split-load row that carries another producer code', () => {
      // An applied split-load row can be booked under a different code. Because retraction is by id and
      // this row was in the previous read, it is retracted and then re-added from the new read - present
      // either way, and never dropped for having the "wrong" code.
      const splitLoad = row(20, 'applied under another code');
      const merged = mergeProducerRows([splitLoad], [splitLoad], new Set([20]), true);

      expect(merged).toEqual([splitLoad]);
    });

    it('is a no-op on the pool when the read returns exactly what it did before', () => {
      const merged = mergeProducerRows(
        [row(1, 'other'), row(10, 'same')], [row(10, 'same')], new Set([10]), true);

      expect(merged.map(r => r.id).sort()).toEqual([1, 10]);
    });

    it('retracts nothing when no previous ids were recorded', () => {
      // Defensive: a refresh for a producer whose bookkeeping is missing should still merge, not wipe.
      const merged = mergeProducerRows([row(1, 'kept')], [row(2, 'new')], undefined, true);

      expect(merged.map(r => r.id).sort()).toEqual([1, 2]);
    });

    it('can empty a producer out entirely', () => {
      // A producer whose last contract closed genuinely has none. That has to be representable.
      const merged = mergeProducerRows([row(10, 'last one')], [], new Set([10]), true);

      expect(merged).toEqual([]);
    });
  });

  it('does not mutate its inputs', () => {
    const existing = [row(1, 'a')];
    const incoming = [row(2, 'b')];

    mergeProducerRows(existing, incoming, new Set([1]), true);

    expect(existing).toEqual([row(1, 'a')]);
    expect(incoming).toEqual([row(2, 'b')]);
  });
});
