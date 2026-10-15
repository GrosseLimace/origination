import { PlantingIntention } from './model';

/**
 * How a field plan rolls up into planting intentions. The server applies the same rules when it
 * saves a plan; these are pure so both sides can be tested against the same cases.
 *
 * An intention's Acres is the total: acres in fields plus "other acres" not yet placed in a field.
 * Other acres are derived (total − field acres), never stored, so an intention entered before fields
 * existed is simply 100% other acres.
 */

/** The grouping an intention row represents: the same key the add dialog accumulates on. */
export interface PlanKey {
  crop: string;
  type: string;
  year: number;
  tradeUnit: string;
}

export function planKeyId(k: PlanKey): string {
  return `${k.year}|${k.tradeUnit}|${k.crop}|${k.type}`;
}

/** Acres not yet placed in a field. Never negative. */
export function otherAcres(total: number, fieldAcres: number): number {
  return Math.max(total - fieldAcres, 0);
}

/**
 * The intention's new total after its field acres change from `before` to `after`.
 *
 * Adding field acres first uses up the other acres — those acres were already planned, the field
 * just says where — so the total only rises by what the other acres can't cover. Moving 80 ac of a
 * 220 ac corn plan into a field leaves 220. Removing field acres (the field is now soybeans, or
 * fallow) takes them off the total: they were real acres of this crop and no longer are.
 */
export function nextTotal(total: number, before: number, after: number): number {
  if (after >= before) {
    const added = after - before;
    const fromOther = Math.min(added, otherAcres(total, before));
    return total + added - fromOther;
  }
  return Math.max(total - (before - after), 0);
}

/**
 * The existing intention a field season belongs to: an exact (crop, type, year, trade unit) match,
 * else a same-crop row with no type. Rows entered without Irrigated/Dryland are common, and a field
 * always has one, so without the fallback a dryland corn field would start a second corn row and
 * count its acres twice.
 */
export function matchIntention(intentions: readonly PlantingIntention[], key: PlanKey): PlantingIntention | undefined {
  const same = intentions.filter(pi =>
    pi.crop === key.crop && pi.plantingYear === key.year && (pi.tradeUnit || '') === key.tradeUnit);
  return same.find(pi => (pi.type || '') === key.type) ?? same.find(pi => !pi.type);
}

/** The key a season rolls up under: its matching intention's key when there is one, else its own. */
export function resolveKey(intentions: readonly PlantingIntention[], key: PlanKey): PlanKey {
  const match = matchIntention(intentions, key);
  return match ? { crop: match.crop, type: match.type || '', year: match.plantingYear, tradeUnit: match.tradeUnit || '' } : key;
}

/**
 * Next year's suggested crop for a field: corn → soybeans, soybeans → corn, anything else repeats.
 * Labels are planting categories ("Corn", "Organic Soybeans"); returns the label to look up.
 */
export function rotationSuggestion(lastYearLabel: string): 'Corn' | 'Soybeans' | null {
  const label = lastYearLabel.toLowerCase();
  if (label.includes('popcorn')) return null;
  if (label.includes('corn')) return 'Soybeans';
  if (label.includes('soy')) return 'Corn';
  return null;
}
