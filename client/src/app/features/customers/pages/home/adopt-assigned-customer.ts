/**
 * Follows the customer id the server actually assigned trade units to.
 *
 * @param data      The save payload, carrying the id the client requested.
 * @param returned  The customer the assign-trade-units call returned.
 *
 * @remarks
 * The server may adopt an existing row for the same producer (matched by ScoularId) instead of inserting
 * the requested one. Details, links and planting-intention moves must then be written under the returned
 * id, otherwise they land on a stale row or are dropped silently.
 *
 * Returns `data` itself when there is nothing to change; otherwise a copy with `customerId` replaced.
 */
export function applyAdoptedCustomerId<T extends { customerId: number }>(
  data: T,
  returned: { id: number } | null | undefined
): T {
  if (!returned || returned.id === data.customerId) {
    return data;
  }
  return { ...data, customerId: returned.id };
}
