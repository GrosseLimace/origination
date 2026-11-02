/**
 * Bushels by CI: a producer's scored fields for one crop, lowest CI first, each with a running total of
 * the bushels at or below its CI. Downstream opportunities each set their own CI target, so the question
 * is "how many bushels are at or below X?", which the ladder answers for any X without agreeing CI
 * bands first. Kept pure so reporting can be built and tested against the same rules.
 */

export interface LadderInput<T> {
  item: T;
  /** The field's CI. */
  value: number;
  /** The field's bushels; 0 when unknown. */
  bushels: number;
}

export interface LadderRow<T> extends LadderInput<T> {
  /** Bushels in this row and every row at or below its CI. */
  atOrBelow: number;
}

/** Lowest CI first. Fields with the same CI share one running total, since a target can't tell them apart. */
export function ciLadder<T>(rows: readonly LadderInput<T>[]): LadderRow<T>[] {
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  return sorted.map(row => ({
    ...row,
    atOrBelow: sorted.filter(r => r.value <= row.value).reduce((sum, r) => sum + r.bushels, 0),
  }));
}

/** The bushels and fields at or below a CI target. */
export function atOrBelowTarget<T>(rows: readonly LadderInput<T>[], target: number): { bushels: number; fields: number } {
  const within = rows.filter(r => r.value <= target);
  return { bushels: within.reduce((sum, r) => sum + r.bushels, 0), fields: within.length };
}
