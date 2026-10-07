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
  // Bin sites (lat/long locations under the address) — not to be confused with bin capacity above
  hasBinSites?: boolean;
  noBinSites?: boolean;
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
  /** View mode for Net bu + quality filters. 'single' (default) treats every ticket as its
   *  own row — applied AND unapplied — so labels read "Net bu over", "Moisture %", etc., and
   *  a producer matches if at least one ticket meets the bound. 'grouped' only applies to
   *  unapplied tickets and operates on Unapplied Tickets tab groups (productCode+elevatorCode):
   *  labels read "Avg Moisture %" etc., and a producer matches if any one group's total /
   *  group-average meets the bound. Toggled by the "View by AVG" checkbox in the refine panel. */
  ticketViewMode?: 'grouped' | 'single';
  // Storage
  storageDaysOver?: number | null;
  storageQuantityOver?: number | null;
  storageReceivableOver?: number | null;
  // DP (delayed pricing) contracts. Bushel/charge totals are computed per-delivery via the
  // dp-aggregate helpers, never by summing rows — the DP view repeats a delivery's quantity on
  // every charge-type row.
  hasDpContracts?: boolean;
  dpBushelsOver?: number | null;
  dpDaysOver?: number | null;
  dpChargesOver?: number | null;
  // Planting
  plantingYear?: number | null;
  irrigatedOnly?: boolean;
  drylandOnly?: boolean;
  doubleCropOnly?: boolean;
  plantingAcresOver?: number | null;
  // Grain on farm (producer profile: bushels on hand + $/bu target price). Crop-scoped when
  // `crops` is also set (the "Grain on Farm" dimension in the crop-aware filter).
  grainOnFarmBushelsOver?: number | null;
  hasGrainTarget?: boolean;
  noGrainTarget?: boolean;
  grainTargetOver?: number | null;
  grainTargetUnder?: number | null;
  hasGrade?: boolean;        // has a free-text grade entered on a grain-on-farm row
  gradeOver?: number | null; // grade's parsed number at/above this (e.g. "4.4%" -> 4.4)
  gradeUnder?: number | null;// grade's parsed number at/below this
  // Dynamic
  crops?: string[];
  states?: string[];
  /** Scoular elevator/location a producer has delivered to, resolved from Ticket.elevatorCity
   *  (dbo.MbpLocationSynonym display name, e.g. "Madrid, NE"). Independent of crops/states —
   *  a producer matches if ANY of their tickets has a matching elevatorCity. */
  deliveryLocations?: string[];
  /** Private hint set when a list is saved — captures the prompt's library category
   *  (Contracts / Tickets / Storage / Planting / etc.) so the dimension-aware crops filter
   *  evaluates the same way on every page (build-list, home, customer-list). Without it,
   *  the saved-list path can only infer dimension from refinement flags and silently falls
   *  back to generic c.commodities matching when the prompt narrows by NLQ alone. Not a
   *  user-facing field; populated automatically. */
  _promptCategory?: string;
}
