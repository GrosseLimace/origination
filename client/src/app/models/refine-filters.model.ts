export interface RefinementFilters {
  // Contract status
  noActiveContracts?: boolean;
  hasUnsignedContracts?: boolean;
  downHarvestPace?: boolean;
  hasUnpricedContracts?: boolean;
  hasOverdueContracts?: boolean;
  noContractsAtAll?: boolean;
  // Contract details
  contractQuantityOver?: number | null;
  contractsExpiringThisMonth?: boolean;
  multipleCommoditiesContracted?: boolean;
  // Contact history
  notContactedDays?: number | null;
  notesInLastDays?: number | null;
  neverContacted?: boolean;
  // Contact frequency
  contactedOnlyOnce?: boolean;
  contactedMoreThan5?: boolean;
  // Contact author
  contactedByMeOnly?: boolean;
  contactedBySomeoneElse?: boolean;
  // Notes content
  hasPinnedNotes?: boolean;
  noteKeyword?: string | null;
  // Customer size
  acresOver?: number | null;
  hasBinCapacity?: boolean;
  noBinCapacity?: boolean;
  // Customer info
  hasPrimaryContact?: boolean;
  noPrimaryContact?: boolean;
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasLinkedProducers?: boolean;
  notEsignEnrolled?: boolean;
  // Customer activity
  hasActiveContracts?: boolean;
  hasDeliveriesThisYear?: boolean;
  hasPlantingIntentions?: boolean;
  hasGrainInStorage?: boolean;
  // Tickets
  ticketQuantityOver?: number | null;
  ticketsInLastDays?: number | null;
  avgMoistureOver?: number | null;
  avgMoistureUnder?: number | null;
  avgTestWeightOver?: number | null;
  avgTestWeightUnder?: number | null;
  avgProteinOver?: number | null;
  avgProteinUnder?: number | null;
  // Storage
  storageDaysOver?: number | null;
  storageQuantityOver?: number | null;
  storageReceivableOver?: number | null;
  // Planting
  plantingYear?: number | null;
  irrigatedOnly?: boolean;
  drylandOnly?: boolean;
  plantingAcresOver?: number | null;
  // Dynamic
  crops?: string[];
  states?: string[];
}
