import type { Customer } from '@models';

/** Computes connected components over the linked-producer graph. Each scoularId maps to
 *  its full transitive group (including itself). Treats links as undirected — A→B and
 *  B→A both put A and B in the same component. Solves the transitive case where A→B and
 *  B→C: all three end up in the same component, so consumers (peer-row collapse, note
 *  aggregation, "last contacted" badge, etc.) can treat the chain as a single entity.
 *
 *  All members of a component share the same Set<string> reference, so callers can use
 *  set identity as a stable per-component key (e.g., Map<Set<string>, ...> for picking a
 *  representative). Customers without a scoularId are skipped — they can't participate
 *  in the link graph.
 *
 *  Cost: O(V + E) where V = customers and E = total linkedProducerIds entries. Cheap at
 *  any realistic Scoular customer count. */
export function buildLinkedProducerComponents(customers: readonly Customer[]): Map<string, Set<string>> {
  const componentMap = new Map<string, Set<string>>();
  const adj = new Map<string, Set<string>>();
  for (const c of customers) {
    if (!c.scoularId) continue;
    for (const linkedCode of (c.linkedProducerIds || [])) {
      if (!linkedCode) continue;
      if (!adj.has(c.scoularId)) adj.set(c.scoularId, new Set());
      adj.get(c.scoularId)!.add(linkedCode);
      if (!adj.has(linkedCode)) adj.set(linkedCode, new Set());
      adj.get(linkedCode)!.add(c.scoularId);
    }
  }
  const visited = new Set<string>();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const component = new Set<string>();
    const queue: string[] = [start];
    while (queue.length) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      component.add(node);
      for (const neighbor of adj.get(node) || []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    for (const member of component) componentMap.set(member, component);
  }
  return componentMap;
}
