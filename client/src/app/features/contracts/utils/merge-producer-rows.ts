/** Anything with a stable numeric id — contracts and tickets both qualify. */
export interface IdentifiedRow {
  id: number;
}

/**
 * Merges one producer's freshly-read rows into a pool that may already hold rows for them.
 *
 * @param existing     The current pool (all producers).
 * @param incoming     What this producer's read just returned.
 * @param previousIds  The ids this producer's PREVIOUS read contributed, if known.
 * @param isRefresh    True when this read is replacing an earlier one for the same producer.
 *
 * @remarks
 * Extracted from the home component so the rule is testable, because two of its three parts are the
 * kind that fail silently.
 *
 * **Replace, don't skip.** The first version pushed only ids it had not seen. A synthetic ticket id is
 * built from prefix/number/suffix/BL date/product/sequence — it does NOT include the contract number or
 * the status — so a ticket applied to a contract, settled, or re-graded since the last read has the SAME
 * id. Skipping it kept the stale row on screen: an applied ticket still showing as unapplied, for the
 * rest of the session.
 *
 * **Retract before merging.** Replacement alone cannot make a row disappear, and rows do disappear: a
 * contract closes out of the list, a ticket is cancelled and drops out of the server-side filter. So a
 * refresh first removes exactly the ids the previous read contributed, then merges the new set.
 *
 * **Retract by previous ids, not by producer code.** An applied split-load row can carry another
 * producer's customer code, so filtering the pool by code would drop rows this producer legitimately owns.
 * The previous read's own ids are the only safe thing to retract.
 *
 * Insertion order is preserved for rows that survive, so an unrelated producer's rows do not jump around
 * in a list the user is looking at.
 */
export function mergeProducerRows<T extends IdentifiedRow>(
  existing: readonly T[],
  incoming: readonly T[],
  previousIds: ReadonlySet<number> | undefined,
  isRefresh: boolean
): T[] {
  const byId = new Map<number, T>(existing.map(row => [row.id, row]));

  if (isRefresh && previousIds) {
    for (const id of previousIds) byId.delete(id);
  }

  for (const row of incoming) byId.set(row.id, row);

  return [...byId.values()];
}
