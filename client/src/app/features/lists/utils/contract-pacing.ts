/**
 * Harvest-window contract pacing for Build a List: is a producer contracting more or fewer bushels
 * for this year's harvest windows than last year's? Drives the "behind / ahead on pacing" prompts
 * and the "down harvest pace" refinement.
 *
 * Pure functions moved verbatim out of BuildListComponent.
 */
import { Contract, HarvestWindow } from '@models';

/**
 * Harvest-window-based pacing direction for a customer.
 * Returns 'down' if ANY commodity's bushels declined year-over-year,
 * 'up' if at least one increased and none declined, 'flat' if no movement, null if no data.
 * Mirrors the contract-pacing-card logic so the build-a-list result matches
 * the arrow the user sees on the customer profile.
 */
export function customerPacingDirection(customerContracts: Contract[], harvestWindows: HarvestWindow[]): 'up' | 'down' | 'flat' | null {
  if (customerContracts.length === 0) return null;
  const windows = harvestWindows.filter(hw => hw.isActive !== false);
  if (windows.length === 0) return null;
  const year = new Date().getFullYear();
  let anyDown = false;
  let anyData = false;
  let anyMovement = false;
  for (const hw of windows) {
    let thisYear = 0;
    let lastYear = 0;
    for (const c of customerContracts) {
      if (!contractMatchesPacingCommodity(c, hw.commodity)) continue;
      if (contractOverlapsWindow(c, hw, year)) thisYear += c.quantity;
      if (contractOverlapsWindow(c, hw, year - 1)) lastYear += c.quantity;
    }
    if (thisYear === 0 && lastYear === 0) continue;
    anyData = true;
    if (thisYear < lastYear) { anyDown = true; anyMovement = true; }
    else if (thisYear > lastYear) { anyMovement = true; }
  }
  if (!anyData) return null;
  if (anyDown) return 'down';
  return anyMovement ? 'up' : 'flat';
}

/** Does the contract's delivery period overlap the harvest window in `cropYear`? A contract with
 *  only one delivery date is treated as a single day. */
export function contractOverlapsWindow(c: Contract, hw: Pick<HarvestWindow, 'deliveryStartMonth' | 'deliveryStartDay' | 'deliveryEndMonth' | 'deliveryEndDay'>, cropYear: number): boolean {
  if (!c.deliveryStart && !c.deliveryEnd) return false;
  const wStart = new Date(cropYear, hw.deliveryStartMonth - 1, hw.deliveryStartDay);
  const wEnd = new Date(cropYear, hw.deliveryEndMonth - 1, hw.deliveryEndDay);
  wEnd.setHours(23, 59, 59, 999);
  const dStart = c.deliveryStart ? new Date(c.deliveryStart) : new Date(c.deliveryEnd!);
  const dEnd = c.deliveryEnd ? new Date(c.deliveryEnd) : new Date(c.deliveryStart!);
  return dStart <= wEnd && dEnd >= wStart;
}

/** Does the contract belong to the harvest window's commodity (exact group, or the commodity name
 *  inside the description or code)? */
export function contractMatchesPacingCommodity(c: Contract, hwCommodity: string): boolean {
  const target = hwCommodity.trim().toUpperCase();
  if (!target) return false;
  const group = (c.commodityGroup || '').trim().toUpperCase();
  if (group && group === target) return true;
  const desc = (c.commodityDescription || '').trim().toUpperCase();
  if (desc && desc.includes(target)) return true;
  const code = (c.commodityCode || '').trim().toUpperCase();
  if (code && code.includes(target)) return true;
  return false;
}
