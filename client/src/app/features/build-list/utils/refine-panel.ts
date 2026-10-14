/**
 * Build a List refine panel: how many refinements are active, whether any are, and which
 * checkboxes a prompt makes redundant.
 *
 * Pure functions over a RefinementFilters / prompt text — moved out of BuildListComponent so the
 * page only wires them to its signals.
 */
import { RefinementFilters } from '@models';
import { activeGrainBinRefineCount } from '@shared/utils/grain-bin-refine';

/** Number of active refinements — drives the "(N filters applied)" badge. Empty / zero criteria
 *  don't count. */
export function countActiveRefinements(r: RefinementFilters): number {
  return [
    r.noActiveContracts, r.hasUnsignedContracts, r.downHarvestPace,
    r.hasUnpricedContracts, r.hasOverdueContracts, r.noContractsAtAll,
    r.contractQuantityOver != null && r.contractQuantityOver > 0,
    r.contractsExpiringThisMonth, r.multipleCommoditiesContracted,
    r.neverContacted, r.notContactedDays != null && r.notContactedDays > 0,
    r.notesInLastDays != null && r.notesInLastDays > 0,
    r.contactedOnlyOnce, r.contactedMoreThan5,
    r.contactedByMeOnly, r.contactedBySomeoneElse,
    r.hasPinnedNotes, r.noteKeyword?.trim(),
    r.acresOver != null && r.acresOver > 0,
    r.hasPrimaryContact, r.noPrimaryContact, r.hasEmail, r.hasPhone, r.hasLinkedProducers, r.notEsignEnrolled,
    r.hasActiveContracts, r.hasDeliveriesThisYear, r.hasPlantingIntentions, r.hasGrainInStorage,
    r.ticketQuantityOver != null && r.ticketQuantityOver > 0,
    r.ticketsInLastDays != null && r.ticketsInLastDays > 0,
    r.avgMoistureOver != null, r.avgMoistureUnder != null,
    r.avgTestWeightOver != null, r.avgTestWeightUnder != null,
    r.avgProteinOver != null, r.avgProteinUnder != null,
    r.storageDaysOver != null && r.storageDaysOver > 0,
    r.storageQuantityOver != null && r.storageQuantityOver > 0,
    r.storageReceivableOver != null && r.storageReceivableOver > 0,
    r.hasDpContracts,
    r.dpBushelsOver != null && r.dpBushelsOver > 0,
    r.dpDaysOver != null && r.dpDaysOver > 0,
    r.dpChargesOver != null && r.dpChargesOver > 0,
    r.plantingYear != null, r.irrigatedOnly, r.drylandOnly, r.doubleCropOnly,
    r.plantingAcresOver != null && r.plantingAcresOver > 0,
    r.grainOnFarmBushelsOver != null && r.grainOnFarmBushelsOver > 0,
    r.hasGrainTarget, r.noGrainTarget, r.hasGrade,
    r.grainTargetOver != null && r.grainTargetOver > 0,
    r.grainTargetUnder != null && r.grainTargetUnder > 0,
    r.gradeOver != null, r.gradeUnder != null,
    r.crops && r.crops.length > 0, r.states && r.states.length > 0,
    r.deliveryLocations && r.deliveryLocations.length > 0
  ].filter(Boolean).length + activeGrainBinRefineCount(r);
}

/** True when any refinement is set. Unlike countActiveRefinements this also counts has/no bin
 *  sites directly (saved-list badges call it with a list's stored filters). */
export function hasAnyRefinement(filters: RefinementFilters): boolean {
  return !!(
    filters.noActiveContracts ||
    filters.hasUnsignedContracts ||
    filters.downHarvestPace ||
    filters.hasUnpricedContracts ||
    filters.hasOverdueContracts ||
    filters.noContractsAtAll ||
    (filters.contractQuantityOver != null && filters.contractQuantityOver > 0) ||
    filters.contractsExpiringThisMonth ||
    filters.multipleCommoditiesContracted ||
    filters.neverContacted ||
    (filters.notContactedDays != null && filters.notContactedDays > 0) ||
    (filters.notesInLastDays != null && filters.notesInLastDays > 0) ||
    filters.contactedOnlyOnce ||
    filters.contactedMoreThan5 ||
    filters.contactedByMeOnly ||
    filters.contactedBySomeoneElse ||
    filters.hasPinnedNotes ||
    filters.noteKeyword?.trim() ||
    (filters.acresOver != null && filters.acresOver > 0) ||
    filters.hasBinSites || filters.noBinSites ||
    filters.hasPrimaryContact || filters.noPrimaryContact ||
    filters.hasEmail || filters.hasPhone || filters.hasLinkedProducers || filters.notEsignEnrolled ||
    filters.hasActiveContracts || filters.hasDeliveriesThisYear ||
    filters.hasPlantingIntentions || filters.hasGrainInStorage ||
    (filters.ticketQuantityOver != null && filters.ticketQuantityOver > 0) ||
    (filters.ticketsInLastDays != null && filters.ticketsInLastDays > 0) ||
    filters.avgMoistureOver != null || filters.avgMoistureUnder != null ||
    filters.avgTestWeightOver != null || filters.avgTestWeightUnder != null ||
    filters.avgProteinOver != null || filters.avgProteinUnder != null ||
    (filters.storageDaysOver != null && filters.storageDaysOver > 0) ||
    (filters.storageQuantityOver != null && filters.storageQuantityOver > 0) ||
    (filters.storageReceivableOver != null && filters.storageReceivableOver > 0) ||
    filters.plantingYear != null || filters.irrigatedOnly || filters.drylandOnly || filters.doubleCropOnly ||
    (filters.plantingAcresOver != null && filters.plantingAcresOver > 0) ||
    (filters.grainOnFarmBushelsOver != null && filters.grainOnFarmBushelsOver > 0) ||
    filters.hasGrainTarget || filters.noGrainTarget || filters.hasGrade ||
    (filters.grainTargetOver != null && filters.grainTargetOver > 0) ||
    (filters.grainTargetUnder != null && filters.grainTargetUnder > 0) ||
    filters.gradeOver != null || filters.gradeUnder != null ||
    (filters.crops && filters.crops.length > 0) ||
    (filters.states && filters.states.length > 0) ||
    (filters.deliveryLocations && filters.deliveryLocations.length > 0) ||
    activeGrainBinRefineCount(filters) > 0
  );
}

/** Refine checkboxes that are redundant given the prompt text — hidden from the panel. `q` is the
 *  explicit library prompt's text or the active saved list's query, already lower-cased. */
export function hiddenRefineFilters(q: string): Set<string> {
  const hidden = new Set<string>();
  // Contract filters
  if (q.includes('active contract'))      { hidden.add('noActiveContracts'); hidden.add('hasActiveContracts'); }
  // "no contracts" prompts already mean "nothing live", so the status checkboxes are redundant.
  // 'noContractsAtAll' stays visible on purpose — it's a STRICTER narrowing (zero contracts of any
  // kind vs. none currently open), so it's still a useful refinement on top of the prompt.
  if (q.includes('no contract'))          { hidden.add('noActiveContracts'); hidden.add('hasActiveContracts'); }
  if (q.includes('unsigned') || q.includes('unconfirmed')) hidden.add('hasUnsignedContracts');
  if (q.includes('unpriced'))             hidden.add('hasUnpricedContracts');
  if (q.includes('pacing') || q.includes('contract pace')) hidden.add('downHarvestPace');
  if (q.includes('overdue'))              hidden.add('hasOverdueContracts');
  if (q.includes('no deliver'))           hidden.add('hasDeliveriesThisYear');
  if (q.includes('expiring'))             hidden.add('contractsExpiringThisMonth');
  // Contact filters
  if (q.includes('never contacted'))      hidden.add('neverContacted');
  if (/not contacted.*\d+\s*days/.test(q)) hidden.add('notContactedDays');
  if (/notes?\s+(?:added|made|entered|written|created|left).*(?:\d+\s*days?|today|yesterday|this\s+week)/.test(q)) hidden.add('notesInLastDays');
  if (q.includes('i contacted') || q.includes('i have contacted')) { hidden.add('contactedByMeOnly'); hidden.add('neverContacted'); }
  if (q.includes('i have never'))         { hidden.add('contactedByMeOnly'); hidden.add('neverContacted'); }
  if (q.includes('contacted this week'))  hidden.add('neverContacted');
  // Notes
  if (q.includes('with notes'))           { hidden.add('hasPinnedNotes'); hidden.add('neverContacted'); }
  if (q.includes('notes mentioning'))     { hidden.add('noteKeyword'); hidden.add('neverContacted'); }
  // General
  if (q.includes('linked producer'))      hidden.add('hasLinkedProducers');
  if (/bin\s*(?:sites?|locations?|coordinates|gps)/.test(q)) { hidden.add('hasBinSites'); hidden.add('noBinSites'); }
  if (q.includes('no primary contact'))   { hidden.add('noPrimaryContact'); hidden.add('hasPrimaryContact'); }
  if (q.includes('without esign') || q.includes('not esign')) hidden.add('notEsignEnrolled');
  if (q.includes('largest') || q.includes('by acres')) hidden.add('acresOver');
  if (q.includes('planting'))             hidden.add('hasPlantingIntentions');
  if (/planting.*\d{4}|\d{4}.*planting/.test(q)) hidden.add('plantingYear');
  if (q.includes('irrigat'))              hidden.add('irrigatedOnly');
  if (q.includes('dryland'))              hidden.add('drylandOnly');
  if (q.includes('double crop'))          hidden.add('doubleCropOnly');
  if (q.includes('corn') && q.includes('planting')) hidden.add('plantingCrop');
  if (q.includes('wheat') && q.includes('planting')) hidden.add('plantingCrop');
  if (q.includes('in storage') || q.includes('stored')) hidden.add('hasGrainInStorage');
  if (/stored.*over.*\d+\s*days|storage.*over.*\d+\s*days/.test(q)) hidden.add('storageDaysOver');
  if (/\bon dp\b/.test(q) || /\bdp contract/.test(q) || q.includes('delayed pricing')) hidden.add('hasDpContracts');
  if (/dp.*over.*\d+\s*days/.test(q)) hidden.add('dpDaysOver');
  if (/dp\s*(?:charges?|cost)\s*(?:over|above|more than)/.test(q)) hidden.add('dpChargesOver');
  if (q.includes('unapplied') || q.includes('applied ticket')) hidden.add('hasDeliveriesThisYear');
  return hidden;
}
