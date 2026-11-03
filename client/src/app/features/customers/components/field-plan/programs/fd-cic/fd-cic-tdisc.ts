import { TDiscDesignation, TDiscOptions, TDiscPass, TDiscResult, TDiscWindowKey, Tillage } from '@models';

/**
 * The USDA T-DISC check a no-till or reduced-till 45Z field needs before its CI is confirmed (7 CFR 2100.051).
 * The rating mirrors USDA T-DISC v1.1.1 ('User Input' rows 8-29) for the review's live preview; the server's
 * TDiscCalculator.cs rates the passes again at confirm, and that one counts. Not needed for an estimate.
 *
 * 1. Every pass is sorted by depth, then mixing efficiency, both ascending.
 * 2. Within each window, in that order, a pass adds ME × (depth − the window's earlier intensities).
 * 3. A window's index is its total ÷ 30 cm; the rating is the highest index.
 * 4. The designation is the smallest limit at or above the rating: NT ≤ 0.075, RT ≤ 0.252, CT ≤ 1.
 */

/** Whether this tillage needs T-DISC to be confirmed. */
export function tDiscNeeded(tillage: Tillage): boolean {
  return tillage === 'NoTill' || tillage === 'ReducedTill';
}

/** The FD-CIC tillage each T-DISC designation is: conventional till is FD-CIC's None of the above. */
export const TDISC_TILLAGE: Record<TDiscDesignation, Tillage> = { NT: 'NoTill', RT: 'ReducedTill', CT: 'NoneOfTheAbove' };

export const DESIGNATION_LABELS: Record<TDiscDesignation, string> = { NT: 'No till', RT: 'Reduced till', CT: 'Conventional till' };

/** The designation for an FD-CIC tillage (None of the above is conventional till). */
export function designationOf(tillage: Tillage): TDiscDesignation {
  return tillage === 'NoTill' ? 'NT' : tillage === 'ReducedTill' ? 'RT' : 'CT';
}

const RANK: Record<Tillage, number> = { NoTill: 2, ReducedTill: 1, NoneOfTheAbove: 0 };

/**
 * The tillage the field is confirmed at: the one selected when the designation supports it, otherwise the
 * designation's own. Only ever steps down (no till → reduced till → none), never up to a practice not selected.
 */
export function supportedTillage(selected: Tillage, designation: TDiscDesignation): Tillage {
  const supported = TDISC_TILLAGE[designation];
  return RANK[supported] >= RANK[selected] ? selected : supported;
}

/** NT, RT or CT: the smallest limit at or above the value (the workbook's MATCH(…, -1)). */
export function designate(options: TDiscOptions, value: number): TDiscDesignation {
  const fits = options.designations.filter(d => d.max >= value).sort((a, b) => a.max - b.max);
  return fits[0]?.designation ?? 'CT';
}

/** Why the passes can't be rated, or null when they can. */
export function passesProblem(options: TDiscOptions, passes: readonly TDiscPass[]): string | null {
  if (!passes.length) return 'Add the field\'s passes from last harvest through this one.';
  if (passes.length > options.maxPasses) return `T-DISC takes at most ${options.maxPasses} passes.`;
  for (const p of passes) {
    const window = options.windows.find(w => w.key === p.window);
    if (!window) return `"${p.window}" isn't a T-DISC tillage window.`;
    if (!window.implements.includes(p.implement)) return `T-DISC doesn't allow "${p.implement}" in ${window.label.toLowerCase()}.`;
  }
  return null;
}

/** The T-DISC worksheet for the passes, or null when they can't be rated. */
export function rateTDisc(options: TDiscOptions, passes: readonly TDiscPass[]): TDiscResult | null {
  if (passesProblem(options, passes)) return null;
  const implement = new Map(options.implements.map(i => [i.name, i]));
  // Array.sort is stable, as SORTBY is: passes with the same depth and efficiency keep their order.
  const sorted = passes
    .map(p => ({ ...p, ...implement.get(p.implement)! }))
    .sort((a, b) => a.depthCm - b.depthCm || a.mixingEfficiency - b.mixingEfficiency);

  const totals = new Map<TDiscWindowKey, number>();
  const rated = sorted.map(p => {
    const earlier = totals.get(p.window) ?? 0;
    const tillageIntensity = p.mixingEfficiency * (p.depthCm - earlier);
    totals.set(p.window, earlier + tillageIntensity);
    return { window: p.window, implement: p.implement, mixingEfficiency: p.mixingEfficiency, depthCm: p.depthCm, tillageIntensity };
  });

  const windows = options.windows.map(w => {
    const total = totals.get(w.key);
    const index = total === undefined ? null : total / options.indexDepthCm;
    return { key: w.key, label: w.label, index, designation: index === null ? null : designate(options, index) };
  });
  const rating = Math.max(0, ...windows.map(w => w.index ?? 0));
  return { rating, designation: designate(options, rating), windows, passes: rated };
}

/** USDA's operations that can be entered in a window: every implement they map to is allowed there. */
export function operationsFor(options: TDiscOptions, window: TDiscWindowKey): TDiscOptions['operations'] {
  const allowed = new Set(options.windows.find(w => w.key === window)?.implements ?? []);
  return options.operations.filter(o => o.implements.every(i => allowed.has(i)));
}
