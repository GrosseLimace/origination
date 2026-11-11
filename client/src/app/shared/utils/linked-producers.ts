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
 *  `linkedIdsOf` gives each customer's links: the producer codes their saved details link to.
 *
 *  Cost: O(V + E) where V = customers and E = total linked-producer entries. Cheap at
 *  any realistic Scoular customer count. */
export function buildLinkedProducerComponents(
  customers: readonly Customer[],
  linkedIdsOf: (c: Customer) => readonly string[],
): Map<string, Set<string>> {
  const componentMap = new Map<string, Set<string>>();
  const adj = new Map<string, Set<string>>();
  for (const c of customers) {
    if (!c.scoularId) continue;
    for (const linkedCode of linkedIdsOf(c)) {
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

/**
 * Returns every producer transitively linked to `customer` — both forward (the producers `customer`'s links name)
 * and reverse (producers whose own links include `customer.scoularId`) — walked until the connected component is
 * exhausted. `linkedIdsOf` gives a producer's links: the producer codes their saved details link to. Prevents infinite
 * loops with a visited set. Caps at 50 members to avoid worst-case fanout. Only producers in `all` can be found; one
 * not loaded yet is silently excluded until it is.
 */
export function linkedGroupOf(customer: Customer, all: Customer[], linkedIdsOf: (c: Customer) => readonly string[]): Customer[] {
  const MAX_GROUP_SIZE = 50;
  const bySourceId = new Map<string, Customer>();
  for (const c of all) {
    if (c.scoularId) bySourceId.set(c.scoularId, c);
  }

  const visited = new Set<number>([customer.id]);
  const result = new Map<number, Customer>();
  const queue: Customer[] = [customer];

  while (queue.length > 0 && visited.size < MAX_GROUP_SIZE) {
    const cur = queue.shift()!;

    // Forward: follow each producer code the current customer links to
    for (const sourceId of linkedIdsOf(cur)) {
      const neighbor = bySourceId.get(sourceId);
      if (neighbor && !visited.has(neighbor.id)) {
        visited.add(neighbor.id);
        result.set(neighbor.id, neighbor);
        queue.push(neighbor);
      }
    }

    // Reverse: find anyone whose links mention the current customer
    const curSource = cur.scoularId || '';
    if (curSource) {
      for (const other of all) {
        if (visited.has(other.id)) continue;
        if (linkedIdsOf(other).includes(curSource)) {
          visited.add(other.id);
          result.set(other.id, other);
          queue.push(other);
        }
      }
    }
  }
  return [...result.values()];
}
