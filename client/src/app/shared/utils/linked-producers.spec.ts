import { describe, it, expect } from 'vitest';
import type { Customer } from '@models';
import { buildLinkedProducerComponents } from './linked-producers';

/** Each producer's links, as their saved details hold them. */
const links = new Map<Customer, string[]>();

/** Minimal Customer — only scoularId matters to the graph walk, and the links recorded for it. */
function producer(scoularId: string | undefined, linkedProducerIds?: string[]): Customer {
  const customer = { scoularId } as unknown as Customer;
  if (linkedProducerIds) links.set(customer, linkedProducerIds);
  return customer;
}

const build = (customers: Customer[]) => buildLinkedProducerComponents(customers, c => links.get(c) ?? []);

describe('buildLinkedProducerComponents', () => {
  it('returns an empty map when nobody is linked', () => {
    const map = build([producer('A'), producer('B')]);

    // Unlinked producers are absent rather than mapped to a singleton set — consumers treat a
    // missing entry as "no group", so adding singletons would change every caller's meaning.
    expect(map.size).toBe(0);
  });

  it('puts both ends of a link in one component, whichever side declared it', () => {
    const map = build([producer('A', ['B']), producer('B')]);

    expect([...map.get('A')!].sort()).toEqual(['A', 'B']);
    // Links are undirected: B never declared A, but still belongs to the group.
    expect([...map.get('B')!].sort()).toEqual(['A', 'B']);
  });

  it('collapses a transitive chain into a single component', () => {
    // A→B, B→C: all three are one producer group, which is the whole reason this is a graph
    // walk rather than a one-hop lookup.
    const map = build([
      producer('A', ['B']),
      producer('B', ['C']),
      producer('C'),
    ]);

    expect([...map.get('A')!].sort()).toEqual(['A', 'B', 'C']);
    expect([...map.get('C')!].sort()).toEqual(['A', 'B', 'C']);
  });

  it('keeps separate groups separate', () => {
    const map = build([
      producer('A', ['B']),
      producer('C', ['D']),
    ]);

    expect([...map.get('A')!].sort()).toEqual(['A', 'B']);
    expect([...map.get('C')!].sort()).toEqual(['C', 'D']);
    expect(map.get('A')).not.toBe(map.get('C'));
  });

  it('shares one Set instance across a component, so set identity is a stable group key', () => {
    // Callers rely on this (Map<Set<string>, ...> to pick a representative row). Returning
    // equal-but-distinct sets would silently give every member its own bucket.
    const map = build([
      producer('A', ['B']),
      producer('B', ['C']),
    ]);

    expect(map.get('A')).toBe(map.get('B'));
    expect(map.get('B')).toBe(map.get('C'));
  });

  it('terminates on a mutual link', () => {
    // A→B and B→A. The queue would revisit forever without the visited guard.
    const map = build([
      producer('A', ['B']),
      producer('B', ['A']),
    ]);

    expect([...map.get('A')!].sort()).toEqual(['A', 'B']);
  });

  it('terminates on a cycle', () => {
    // A→B→C→A.
    const map = build([
      producer('A', ['B']),
      producer('B', ['C']),
      producer('C', ['A']),
    ]);

    expect([...map.get('B')!].sort()).toEqual(['A', 'B', 'C']);
  });

  it('terminates on a self-link', () => {
    const map = build([producer('A', ['A'])]);

    expect([...map.get('A')!]).toEqual(['A']);
  });

  it('includes a linked code that has no customer row of its own', () => {
    // Links deliberately span trade units, so the far end is often outside the loaded roster.
    // It still has to appear in the component or the group looks truncated.
    const map = build([producer('A', ['ZZ-OTHER-TU'])]);

    expect([...map.get('A')!].sort()).toEqual(['A', 'ZZ-OTHER-TU']);
    expect(map.get('ZZ-OTHER-TU')).toBe(map.get('A'));
  });

  it('skips customers with no scoularId and ignores blank link entries', () => {
    const map = build([
      producer(undefined, ['B']),          // can't participate — no id of its own
      producer('C', ['', undefined as unknown as string, 'D']),
    ]);

    expect(map.has('B')).toBe(false);
    expect([...map.get('C')!].sort()).toEqual(['C', 'D']);
  });

  it('handles a producer with no links at all', () => {
    expect(() => buildLinkedProducerComponents([producer('A')], () => [])).not.toThrow();
    expect(build([producer('A')]).size).toBe(0);
  });

  it('merges groups that are joined by a later customer', () => {
    // A-B and C-D exist independently until E links B and C; the result must be one group of
    // five, not two of three.
    const map = build([
      producer('A', ['B']),
      producer('C', ['D']),
      producer('E', ['B', 'C']),
    ]);

    expect([...map.get('A')!].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(map.get('A')).toBe(map.get('D'));
  });

  it('de-duplicates a link declared from both sides', () => {
    const map = build([
      producer('A', ['B', 'B']),
      producer('B', ['A']),
    ]);

    expect(map.get('A')!.size).toBe(2);
  });
});
