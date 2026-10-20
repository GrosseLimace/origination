/**
 * Build a List: which customer-profile tab a result opens on, from the active prompt and
 * refinements. Pure function moved verbatim out of BuildListComponent.
 */
import { RefinementFilters } from '@models';

export type ProfileFocusTab = 'dpContracts' | 'storage' | 'contracts' | 'tickets' | 'planting';

/** Map the active prompt/filter context to a customer-profile tab so that
 *  clicking a producer lands on the section relevant to why they're in the
 *  result list. Returns null when there's no clear focus (e.g., notes are
 *  always visible in the sidebar, so no tab override is needed).
 *
 *  `noteFilterActive` is the page's note-prompt flag; `queryInvolvesDpContracts` is the NLQ
 *  engine's DP detector (NlqFilterService), passed in so this stays pure. */
export function detectFocusTab(
  r: RefinementFilters,
  queryText: string,
  noteFilterActive: boolean,
  queryInvolvesDpContracts: (lowerQuery: string) => boolean,
): ProfileFocusTab | null {
  const q = queryText.toLowerCase();

  // Notes already visible in the sidebar — no tab override needed.
  if (noteFilterActive) return null;

  // DP contracts. Checked BEFORE storage: DP prompts share storage vocabulary (both talk about
  // days accruing and charges), so a storage-first test would swallow "on dp over 90 days" and
  // land the user on the Storage tab instead.
  if (queryInvolvesDpContracts(q) ||
      r.hasDpContracts ||
      (r.dpBushelsOver != null && r.dpBushelsOver > 0) ||
      (r.dpDaysOver != null && r.dpDaysOver > 0) ||
      (r.dpChargesOver != null && r.dpChargesOver > 0)) {
    return 'dpContracts';
  }

  // Storage
  if (q.includes('storage') || q.includes('stored grain') ||
      (r.storageDaysOver != null && r.storageDaysOver > 0) ||
      (r.storageQuantityOver != null && r.storageQuantityOver > 0) ||
      (r.storageReceivableOver != null && r.storageReceivableOver > 0) ||
      r.hasGrainInStorage) {
    return 'storage';
  }

  // Tickets — quantity, recency, or quality metrics.
  // Customer profile has only ONE ticket tab and it's "Unapplied Tickets" — applied
  // tickets are surfaced inside Contracts (expand a contract row to see its applied
  // tickets). So an "applied tickets" prompt should land on the contracts tab, not
  // the unapplied-tickets tab. Only route to the tickets tab when the prompt is
  // explicitly about unapplied tickets (or is generic about tickets with no
  // applied/unapplied qualifier).
  const isAppliedTicketsQuery = q.includes('applied ticket') && !q.includes('unapplied');
  if (isAppliedTicketsQuery) {
    return 'contracts';
  }
  if (q.includes('ticket') || q.includes('unapplied') ||
      (r.ticketQuantityOver != null && r.ticketQuantityOver > 0) ||
      (r.ticketsInLastDays != null && r.ticketsInLastDays > 0) ||
      r.avgMoistureOver != null || r.avgMoistureUnder != null ||
      r.avgTestWeightOver != null || r.avgTestWeightUnder != null ||
      r.avgProteinOver != null || r.avgProteinUnder != null) {
    return 'tickets';
  }

  // Planting intentions
  if (q.includes('planting') || q.includes('intention') ||
      r.plantingYear != null || r.irrigatedOnly || r.drylandOnly || r.doubleCropOnly ||
      (r.plantingAcresOver != null && r.plantingAcresOver > 0) ||
      r.hasPlantingIntentions) {
    return 'planting';
  }

  // Contracts — explicit signals or contract-flavored query
  if (q.includes('contract') || q.includes('unsigned') || q.includes('expir') ||
      q.includes('unpriced') || q.includes('overdue') ||
      r.noActiveContracts || r.hasUnsignedContracts || r.downHarvestPace ||
      r.hasUnpricedContracts || r.hasOverdueContracts ||
      (r.contractQuantityOver != null && r.contractQuantityOver > 0) ||
      r.contractsExpiringThisMonth || r.multipleCommoditiesContracted ||
      r.hasActiveContracts) {
    return 'contracts';
  }

  return null;
}
