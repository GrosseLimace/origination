/**
 * Build a List result filtering: narrows the producers a prompt matched by the refine-panel
 * criteria, applies the manual member overrides and folds linked producers into one row.
 *
 * Moved verbatim out of BuildListComponent.displayedCustomers. The page's data arrives through
 * RefinementFilterSources — accessors rather than values, so when the page calls this inside its
 * computed each signal is still read (and tracked) only by the refinements that consult it.
 */
import { CommodityConversion, Contract, Customer, DpContract, Note, PlantingIntention, RefinementFilters, StoredGrain, Ticket } from '@models';
import { dpTotalBushels, dpTotalCharges } from '@shared/utils/dp-aggregate';
import { buildLbsPerBushelMap, sumInBushels } from '@shared/utils/production-coverage';
import { isIrrigated, isDryland, isDoubleCrop } from '@shared/utils/planting-chips';
import { buildCropSelection, matchesCropSelection, CropGroupLookup, CropSelection, MatchCropOptions } from '@shared/utils/crop-group-match';
import { activeGrainBinRefineCount, applyGrainBinRefinements } from '@shared/utils/grain-bin-refine';
import { isContractUnconfirmed, isContractOverdueWithUnshippedBu } from '@shared/utils/contract-status';
import { matchTicketViewModeFilters } from '@shared/utils/ticket-view-filters';

/** The page data the refinements read. Each is called lazily, only when a refinement needs it. */
export interface RefinementFilterSources {
  customers: () => Customer[];
  notes: () => Note[];
  tickets: () => Ticket[];
  plantingIntentions: () => PlantingIntention[];
  storedGrain: () => StoredGrain[];
  dpContracts: () => DpContract[];
  /** OPEN contracts grouped by ctrmCustomerId. */
  openContractsByCustomer: () => Map<string, Contract[]>;
  cropGroupLookup: () => CropGroupLookup;
  lastContactByCustomer: () => Map<number, { daysAgo: number }>;
  linkedProducerComponents: () => Map<string, Set<string>>;
  commodityConversions: () => CommodityConversion[];
  /** The signed-in account (MSAL), for the "contacted by me / someone else" refinements. */
  currentAccount: () => { name?: string; username?: string } | null | undefined;
  /** Harvest-window pacing direction for one producer ("down harvest pace"). */
  pacingDirection: (c: Customer) => 'up' | 'down' | 'flat' | null;
  /** True when the prompt is about APPLIED tickets (forces single-ticket view mode). */
  isAppliedTicketsContext: () => boolean;
  /** The dimension a crop chip scopes to for this prompt (NlqFilterService.refineDimension). */
  refineDimension: (r: RefinementFilters) => string | null;
}

/** Grain-on-farm rows hold a commodity CODE, but rows saved before 2026-09-23 hold a crop GROUP
 *  ("Corn") with no code to be precise about. groupOnlyValue lets a code chip still match those
 *  legacy rows via its group; it never fires for a code value, so code rows stay exact. */
const GROUP_ONLY: MatchCropOptions = { groupOnlyValue: true };

/** Narrows `list` (the prompt's matches) by the applied refinements `r`. */
export function filterByRefinements(list: Customer[], r: RefinementFilters, src: RefinementFilterSources): Customer[] {
  /** Matches a commodity string against selected crop filters. Delegates to the shared matcher
   *  (crop-group-match.ts); `opts` is only passed by the grain-on-farm call sites, whose values are
   *  crop GROUPS rather than codes. */
  const matchesCrop = (value: string, selectedCrops: CropSelection, opts?: MatchCropOptions): boolean =>
    matchesCropSelection(value, selectedCrops, src.cropGroupLookup(), opts);

  const contractMap = src.openContractsByCustomer(); // Open contracts only for refinements

  // Crop selection for contextual filtering (used by ticket/contract/storage filters) —
  // resolves each chip to its Commodities.category group, with the CROP_CODE_MAP token map as
  // a fallback tier. See crop-group-match.ts for why this replaced the old alias-only matcher.
  const selectedCrops = buildCropSelection(r.crops, src.cropGroupLookup());
  const contactMap = src.lastContactByCustomer();

  // Helper: get contracts for a customer, optionally scoped to selected crops
  const getContracts = (c: Customer): Contract[] => {
    let contracts = contractMap.get(c.scoularId!) || [];
    if (!selectedCrops.isEmpty) {
      contracts = contracts.filter(ct =>
        matchesCrop(ct.commodityCode || '', selectedCrops) ||
        matchesCrop(ct.commodityDescription || '', selectedCrops) ||
        matchesCrop(ct.commodityGroup || '', selectedCrops)
      );
    }
    return contracts;
  };

  // Contract status filters
  if (r.noActiveContracts) {
    list = list.filter(c => !getContracts(c).some(ct => ct.status === 'Active' || ct.status === 'Pending' || ct.status === 'Overdue'));
  }
  if (r.hasUnsignedContracts) {
    // "Has unconfirmed contracts" — matches Insights UnconfirmedContracts rule:
    // customerConfirmStatus !== 'confirmed' AND status not Fulfilled/Cancelled.
    list = list.filter(c => getContracts(c).some(ct => isContractUnconfirmed(ct)));
  }
  if (r.downHarvestPace) {
    list = list.filter(c => src.pacingDirection(c) === 'down');
  }
  if (r.hasUnpricedContracts) {
    list = list.filter(c => getContracts(c).some(ct => ct.priceTypeCode === 'U' || ct.priceTypeCode === 'D'));
  }
  if (r.hasOverdueContracts) {
    // "Has overdue bu contracts" — matches Insights UnshippedBushels rule. Reads
    // contract.openBalanceQuantity via the shared delivery util; no ticket dependency.
    const today = new Date();
    list = list.filter(c => getContracts(c).some(ct => isContractOverdueWithUnshippedBu(ct, today)));
  }
  if (r.noContractsAtAll) {
    list = list.filter(c => getContracts(c).length === 0);
  }
  // Contract detail filters
  if (r.contractQuantityOver != null && r.contractQuantityOver > 0) {
    // The refine is expressed in bushels, so compare in bushels — a raw sum counted tonnage at
    // face value and excluded producers who actually cleared the threshold.
    const lbsPerBushelByCode = buildLbsPerBushelMap(src.commodityConversions());
    list = list.filter(c => {
      const totalQty = sumInBushels(getContracts(c), lbsPerBushelByCode).contracted;
      return totalQty > r.contractQuantityOver!;
    });
  }
  if (r.contractsExpiringThisMonth) {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    list = list.filter(c => getContracts(c).some(ct => {
      if (!ct.deliveryEnd) return false;
      const end = new Date(ct.deliveryEnd);
      return end.getMonth() === thisMonth && end.getFullYear() === thisYear;
    }));
  }
  if (r.multipleCommoditiesContracted) {
    list = list.filter(c => {
      const commodities = new Set(getContracts(c).map(ct => ct.commodityCode || ct.commodityDescription || '').filter(Boolean));
      return commodities.size >= 2;
    });
  }
  if (r.neverContacted) {
    list = list.filter(c => !contactMap.has(c.id));
  } else if (r.notContactedDays != null && r.notContactedDays > 0) {
    list = list.filter(c => {
      const info = contactMap.get(c.id);
      if (!info) return true; // never contacted → include
      return info.daysAgo >= r.notContactedDays!;
    });
  }
  if (r.notesInLastDays != null && r.notesInLastDays > 0) {
    list = list.filter(c => {
      const info = contactMap.get(c.id);
      if (!info) return false; // no notes → exclude (positive filter)
      return info.daysAgo <= r.notesInLastDays!;
    });
  }

  // Note-aggregating filters share a per-customer "code network" (own + outgoing-linked + incoming-linked).
  // Linked-producer notes count toward the customer's totals so contact frequency, author, pinned, and
  // keyword filters all respect the same linked-as-one-entity model used elsewhere on the page.
  const wantsAggregatedNotes = r.contactedOnlyOnce || r.contactedMoreThan5
    || r.contactedByMeOnly || r.contactedBySomeoneElse
    || r.hasPinnedNotes || !!r.noteKeyword?.trim();
  let codesByCustomerId: Map<number, Set<string>> | null = null;
  if (wantsAggregatedNotes) {
    const components = src.linkedProducerComponents();
    codesByCustomerId = new Map<number, Set<string>>();
    for (const c of src.customers()) {
      if (c.scoularId) {
        const comp = components.get(c.scoularId);
        codesByCustomerId.set(c.id, comp ? new Set(comp) : new Set([c.scoularId]));
      } else {
        codesByCustomerId.set(c.id, new Set());
      }
    }
  }

  // Contact frequency — note count across the customer's network (own + linked).
  if (r.contactedOnlyOnce || r.contactedMoreThan5) {
    const countByCode = new Map<string, number>();
    for (const n of src.notes()) {
      if (!n.customerCode) continue;
      countByCode.set(n.customerCode, (countByCode.get(n.customerCode) || 0) + 1);
    }
    const totalFor = (c: Customer): number => {
      let total = 0;
      const codes = codesByCustomerId!.get(c.id);
      if (codes) for (const code of codes) total += countByCode.get(code) || 0;
      return total;
    };
    if (r.contactedOnlyOnce) list = list.filter(c => totalFor(c) === 1);
    if (r.contactedMoreThan5) list = list.filter(c => totalFor(c) > 5);
  }

  // Contact author — aggregated across the customer's network.
  if (r.contactedByMeOnly || r.contactedBySomeoneElse) {
    const account = src.currentAccount();
    const myName = (account?.name ?? '').trim().toLowerCase();
    const myUsername = (account?.username ?? '').trim().toLowerCase();
    // Empty identity claims → can't reliably attribute notes; treat as "no notes are mine".
    // This avoids the substring bug where ''.includes('') === true would mark every note as mine.
    const haveIdentity = !!myName || !!myUsername;
    const isAuthorMe = (rawAuthor: string): boolean => {
      if (!rawAuthor || !haveIdentity) return false;
      if (myUsername && rawAuthor === myUsername) return true;
      if (myName && rawAuthor === myName) return true;
      // Token-bounded match prevents "John" matching "Johnson"; works for "John Doe (jdoe@…)" too.
      const escape = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const tokenMatch = (haystack: string, needle: string): boolean => {
        if (!needle) return false;
        return new RegExp(`(?:^|[^\\w])${escape(needle)}(?:[^\\w]|$)`).test(haystack);
      };
      return tokenMatch(rawAuthor, myUsername) || tokenMatch(rawAuthor, myName);
    };

    const authorshipByCode = new Map<string, { byMe: boolean; byOthers: boolean }>();
    for (const n of src.notes()) {
      if (!n.customerCode) continue;
      const author = (n.createdBy || '').trim().toLowerCase();
      if (!author) continue;
      const entry = authorshipByCode.get(n.customerCode) || { byMe: false, byOthers: false };
      if (isAuthorMe(author)) entry.byMe = true; else entry.byOthers = true;
      authorshipByCode.set(n.customerCode, entry);
    }
    const aggregateFor = (c: Customer): { byMe: boolean; byOthers: boolean } => {
      let byMe = false, byOthers = false;
      const codes = codesByCustomerId!.get(c.id);
      if (codes) for (const code of codes) {
        const e = authorshipByCode.get(code);
        if (!e) continue;
        if (e.byMe) byMe = true;
        if (e.byOthers) byOthers = true;
      }
      return { byMe, byOthers };
    };
    if (r.contactedByMeOnly) {
      list = list.filter(c => { const a = aggregateFor(c); return a.byMe && !a.byOthers; });
    }
    if (r.contactedBySomeoneElse) {
      list = list.filter(c => aggregateFor(c).byOthers);
    }
  }

  // Notes content — pinned + keyword both check the customer's full code network.
  if (r.hasPinnedNotes) {
    const pinnedCodes = new Set<string>();
    for (const n of src.notes()) {
      if (n.isPinned && n.customerCode) pinnedCodes.add(n.customerCode);
    }
    list = list.filter(c => {
      const codes = codesByCustomerId!.get(c.id);
      if (!codes) return false;
      for (const code of codes) if (pinnedCodes.has(code)) return true;
      return false;
    });
  }
  if (r.noteKeyword?.trim()) {
    const kw = r.noteKeyword.trim().toLowerCase();
    const matchingCodes = new Set<string>();
    for (const n of src.notes()) {
      if ((n.content || '').toLowerCase().includes(kw) && n.customerCode) {
        matchingCodes.add(n.customerCode);
      }
    }
    list = list.filter(c => {
      const codes = codesByCustomerId!.get(c.id);
      if (!codes) return false;
      for (const code of codes) if (matchingCodes.has(code)) return true;
      return false;
    });
  }
  // Customer size
  if (r.acresOver != null && r.acresOver > 0) {
    list = list.filter(c => (c.totalAcres ?? 0) > r.acresOver!);
  }

  // Grain on farm (bushels on hand + $/bu target). Crop-scoped when crops are selected, so
  // "corn on farm over 10,000" / "corn target over $5" act on the producer's corn rows only.
  if (r.grainOnFarmBushelsOver != null || r.hasGrainTarget || r.noGrainTarget
      || r.grainTargetOver != null || r.grainTargetUnder != null || r.hasGrade
      || r.gradeOver != null || r.gradeUnder != null) {
    const grainRowsFor = (c: Customer) => {
      const rows = c.grainOnFarm ?? [];
      return !selectedCrops.isEmpty
        ? rows.filter(g => !!g.commodityCode && matchesCrop(g.commodityCode, selectedCrops, GROUP_ONLY))
        : rows;
    };
    // Grade is free text — pull the first number out ("4.4%" -> 4.4, "TW 58" -> 58) for over/under.
    const gradeNum = (grade?: string): number | null => {
      const m = (grade ?? '').match(/-?\d+(?:\.\d+)?/);
      return m ? parseFloat(m[0]) : null;
    };
    if (r.hasGrade) {
      list = list.filter(c => grainRowsFor(c).some(g => !!(g.grade ?? '').trim()));
    }
    if (r.gradeOver != null) {
      list = list.filter(c => grainRowsFor(c).some(g => { const n = gradeNum(g.grade); return n != null && n >= r.gradeOver!; }));
    }
    if (r.gradeUnder != null) {
      list = list.filter(c => grainRowsFor(c).some(g => { const n = gradeNum(g.grade); return n != null && n <= r.gradeUnder!; }));
    }
    if (r.grainOnFarmBushelsOver != null && r.grainOnFarmBushelsOver > 0) {
      list = list.filter(c => grainRowsFor(c).reduce((s, g) => s + (g.bushelsOnHand ?? 0), 0) > r.grainOnFarmBushelsOver!);
    }
    if (r.hasGrainTarget) {
      list = list.filter(c => grainRowsFor(c).some(g => g.targetBushels != null));
    }
    if (r.noGrainTarget) {
      // Has grain on farm but no target price set — the actionable "needs a target" list.
      list = list.filter(c => grainRowsFor(c).some(g => (g.bushelsOnHand ?? 0) > 0)
        && !grainRowsFor(c).some(g => g.targetBushels != null));
    }
    if (r.grainTargetOver != null && r.grainTargetOver > 0) {
      list = list.filter(c => grainRowsFor(c).some(g => (g.targetBushels ?? 0) >= r.grainTargetOver!));
    }
    if (r.grainTargetUnder != null && r.grainTargetUnder > 0) {
      list = list.filter(c => grainRowsFor(c).some(g => g.targetBushels != null && g.targetBushels <= r.grainTargetUnder!));
    }
  }

  // Sold, Last Bid and the bin-site fields (shared with NlqFilterService — see grain-bin-refine.ts).
  // Grain filters use the same crop-scoped rows as the block above.
  if (activeGrainBinRefineCount(r) > 0) {
    list = applyGrainBinRefinements(list, r, c => {
      const rows = c.grainOnFarm ?? [];
      return selectedCrops.isEmpty
        ? rows
        : rows.filter(g => !!g.commodityCode && matchesCrop(g.commodityCode, selectedCrops, GROUP_ONLY));
    });
  }

  // Customer info
  if (r.hasPrimaryContact) {
    list = list.filter(c => !!c.primaryContact?.trim());
  }
  if (r.noPrimaryContact) {
    list = list.filter(c => !c.primaryContact?.trim());
  }
  // User-entered contact rows count too — otherwise a producer whose only email/phone was typed
  // into Edit Producer Details (e.g. an insurance contact) reads as having none.
  if (r.hasEmail) {
    list = list.filter(c => !!c.email?.trim() || !!c.supplementalEmail?.trim()
      || !!c.contacts?.some(ct => ct.email?.trim()));
  }
  if (r.hasPhone) {
    list = list.filter(c => !!c.phone?.trim() || !!c.extendedPrimaryPhone?.trim()
      || !!c.contacts?.some(ct => ct.phone?.trim()));
  }
  if (r.hasLinkedProducers) {
    list = list.filter(c => (c.linkedProducerIds?.length ?? 0) > 0);
  }
  if (r.notEsignEnrolled) {
    list = list.filter(c => !c.eSignEnabled);
  }

  // Customer activity
  if (r.hasActiveContracts) {
    list = list.filter(c => {
      const contracts = contractMap.get(c.scoularId!) || [];
      return contracts.some(ct => ct.status === 'Active' || ct.status === 'Pending');
    });
  }
  if (r.hasDeliveriesThisYear) {
    const thisYear = new Date().getFullYear();
    const ticketCustomers = new Set<string>(
      src.tickets().filter(t => {
        if (!t.date) return false;
        // Read the year in UTC. Ticket.date is a bare yyyy-MM-dd, which the Date constructor
        // parses as UTC midnight, so the local-time getFullYear() rolled a 1 January ticket
        // back to 31 December of the prior year for every US timezone — wrongly excluding that
        // delivery from "has deliveries this year".
        const d = new Date(t.date);
        return d.getUTCFullYear() === thisYear;
      }).map(t => t.customerCode!).filter(Boolean)
    );
    list = list.filter(c => ticketCustomers.has(c.scoularId!));
  }
  if (r.hasPlantingIntentions) {
    const plantingCustomers = new Set<number>(src.plantingIntentions().map(p => p.customerId));
    list = list.filter(c => plantingCustomers.has(c.id));
  }
  if (r.hasGrainInStorage) {
    const storageCustomers = new Set<number>(src.storedGrain().map(s => s.customerId));
    list = list.filter(c => storageCustomers.has(c.id));
  }

  // Storage filters — scoped to selected crops when active
  const scopedStorage = !selectedCrops.isEmpty
    ? src.storedGrain().filter(s => s.crop && matchesCrop(s.crop, selectedCrops))
    : src.storedGrain();
  if (r.storageDaysOver != null && r.storageDaysOver > 0) {
    const minDays = r.storageDaysOver;
    const ids = new Set<number>(
      scopedStorage.filter(s => {
        if (s.storageDays != null && s.storageDays > 0) return s.storageDays >= minDays;
        if (!s.storageStartDate) return false;
        const d = new Date(s.storageStartDate);
        return d.getTime() < (Date.now() - minDays * 86400000);
      }).map(s => s.customerId)
    );
    list = list.filter(c => ids.has(c.id));
  }
  if (r.storageQuantityOver != null && r.storageQuantityOver > 0) {
    const customerTotals = new Map<number, number>();
    for (const s of scopedStorage) {
      customerTotals.set(s.customerId, (customerTotals.get(s.customerId) || 0) + s.quantity);
    }
    list = list.filter(c => (customerTotals.get(c.id) || 0) > r.storageQuantityOver!);
  }
  if (r.storageReceivableOver != null && r.storageReceivableOver > 0) {
    const customerTotals = new Map<number, number>();
    for (const s of scopedStorage) {
      customerTotals.set(s.customerId, (customerTotals.get(s.customerId) || 0) + (s.receivableAmount || 0));
    }
    list = list.filter(c => (customerTotals.get(c.id) || 0) > r.storageReceivableOver!);
  }

  // DP filters — scoped to selected crops when active. Bushel and charge totals go through the
  // dp-aggregate helpers: the DP view emits one row per charge type per delivery, each repeating
  // the same quantity, so summing rows would double-count the grain (charges ARE additive).
  if (r.hasDpContracts) {
    const dpCustomers = new Set<number>(src.dpContracts().map(d => d.customerId));
    list = list.filter(c => dpCustomers.has(c.id));
  }
  const hasDpFilter = r.dpBushelsOver != null || r.dpDaysOver != null || r.dpChargesOver != null;
  if (hasDpFilter) {
    const scopedDp = !selectedCrops.isEmpty
      ? src.dpContracts().filter(d => d.crop && matchesCrop(d.crop, selectedCrops))
      : src.dpContracts();
    const dpByCustomer = new Map<number, DpContract[]>();
    for (const d of scopedDp) {
      const rows = dpByCustomer.get(d.customerId);
      if (rows) rows.push(d); else dpByCustomer.set(d.customerId, [d]);
    }
    if (r.dpBushelsOver != null && r.dpBushelsOver > 0) {
      list = list.filter(c => dpTotalBushels(dpByCustomer.get(c.id) ?? []) > r.dpBushelsOver!);
    }
    if (r.dpDaysOver != null && r.dpDaysOver > 0) {
      list = list.filter(c => (dpByCustomer.get(c.id) ?? []).some(d => (d.storageDays ?? 0) >= r.dpDaysOver!));
    }
    if (r.dpChargesOver != null && r.dpChargesOver > 0) {
      list = list.filter(c => dpTotalCharges(dpByCustomer.get(c.id) ?? []) > r.dpChargesOver!);
    }
  }

  // Ticket filters — pre-build lookup and scope tickets to selected crops
  const hasTicketFilter = r.ticketQuantityOver != null || r.ticketsInLastDays != null ||
    r.avgMoistureOver != null || r.avgMoistureUnder != null ||
    r.avgTestWeightOver != null || r.avgTestWeightUnder != null ||
    r.avgProteinOver != null || r.avgProteinUnder != null;
  if (hasTicketFilter) {
    const codeToId = new Map<string, number>();
    for (const c of src.customers()) {
      if (c.scoularId) codeToId.set(c.scoularId, c.id);
    }
    // Scope tickets to selected crops when a crop filter is active
    const scopedTickets = !selectedCrops.isEmpty
      ? src.tickets().filter(t => t.productCode && matchesCrop(t.productCode, selectedCrops))
      : src.tickets();

    if (r.ticketsInLastDays != null && r.ticketsInLastDays > 0) {
      const cutoff = Date.now() - r.ticketsInLastDays * 86400000;
      const recentCustomers = new Set<string>();
      for (const t of scopedTickets) {
        if (!t.customerCode || !t.date) continue;
        if (new Date(t.date).getTime() >= cutoff) recentCustomers.add(t.customerCode);
      }
      list = list.filter(c => recentCustomers.has(c.scoularId!));
    }

    // Net bu + quality avg filters operate in one of two view modes:
    //  'grouped' (default) — match using UNAPPLIED ticket groups (productCode|elevatorCode),
    //                        same grouping the customer Unapplied Tickets tab uses. Any group
    //                        meeting the threshold qualifies the customer.
    //  'single'           — match using individual tickets (applied + unapplied). Any single
    //                        ticket meeting the threshold qualifies the customer.
    // Quality avg filters compute group-level averages in 'grouped' mode; in 'single' mode they
    // become per-ticket value checks (so "Avg moisture over 14" reads as "any ticket > 14").
    const viewMode: 'grouped' | 'single' = src.isAppliedTicketsContext()
      ? 'single'
      : (r.ticketViewMode ?? 'single');
    const hasNetBu = r.ticketQuantityOver != null && r.ticketQuantityOver > 0;
    const hasQualityFilter = r.avgMoistureOver != null || r.avgMoistureUnder != null ||
      r.avgTestWeightOver != null || r.avgTestWeightUnder != null ||
      r.avgProteinOver != null || r.avgProteinUnder != null;

    if (hasNetBu || hasQualityFilter) {
      const conversionMap = buildLbsPerBushelMap(src.commodityConversions());
      const matchingCustomerIds = matchTicketViewModeFilters(
        scopedTickets, codeToId, conversionMap, viewMode, r
      );
      if (matchingCustomerIds) list = list.filter(c => matchingCustomerIds.has(c.id));
    }
  }

  // Planting filters
  if (r.plantingYear) {
    const year = r.plantingYear;
    const ids = new Set<number>(src.plantingIntentions().filter(p => p.plantingYear === year).map(p => p.customerId));
    list = list.filter(c => ids.has(c.id));
  }
  // Type predicates are shared with the result-row chips (planting-chips.ts) so a producer that
  // matched on "irrigated" can't then show dryland chips.
  if (r.irrigatedOnly) {
    const ids = new Set<number>(
      src.plantingIntentions().filter(p => isIrrigated(p.type)).map(p => p.customerId)
    );
    list = list.filter(c => ids.has(c.id));
  }
  if (r.drylandOnly) {
    const ids = new Set<number>(
      src.plantingIntentions().filter(p => isDryland(p.type)).map(p => p.customerId)
    );
    list = list.filter(c => ids.has(c.id));
  }
  if (r.doubleCropOnly) {
    const ids = new Set<number>(
      src.plantingIntentions().filter(p => isDoubleCrop(p.type)).map(p => p.customerId)
    );
    list = list.filter(c => ids.has(c.id));
  }
  if (r.plantingAcresOver != null && r.plantingAcresOver > 0) {
    const customerAcres = new Map<number, number>();
    for (const p of src.plantingIntentions()) {
      customerAcres.set(p.customerId, (customerAcres.get(p.customerId) || 0) + p.acres);
    }
    list = list.filter(c => (customerAcres.get(c.id) || 0) > r.plantingAcresOver!);
  }

  if (!selectedCrops.isEmpty) {
    // Dimension-aware crop filter: when the prompt is about a specific dimension
    // (storage / tickets / planting / contracts), require the producer to have a
    // crop match in THAT dimension's data — not in their generic c.commodities list.
    // Falls back to c.commodities only when no dimension is in play.
    // Single source of dimension inference — see NlqFilterService.refineDimension(). Keeps
    // this block and applyRefinementFilters() (the saved-list / home-page copy) in sync by
    // construction rather than by copy-pasted flag lists.
    const dim = src.refineDimension(r);

    if (dim === 'DP Contracts') {
      // Crop-scope a DP prompt against DP positions, not generic customer.commodities.
      const dpByCustomer = new Map<number, DpContract[]>();
      for (const d of src.dpContracts()) {
        if (!dpByCustomer.has(d.customerId)) dpByCustomer.set(d.customerId, []);
        dpByCustomer.get(d.customerId)!.push(d);
      }
      list = list.filter(c => (dpByCustomer.get(c.id) ?? []).some(d =>
        !!d.crop && matchesCrop(d.crop, selectedCrops)
      ));
    } else if (dim === 'Storage') {
      const storageByCustomer = new Map<number, StoredGrain[]>();
      for (const s of src.storedGrain()) {
        if (!storageByCustomer.has(s.customerId)) storageByCustomer.set(s.customerId, []);
        storageByCustomer.get(s.customerId)!.push(s);
      }
      list = list.filter(c => (storageByCustomer.get(c.id) ?? []).some(s =>
        !!s.crop && matchesCrop(s.crop, selectedCrops)
      ));
    } else if (dim === 'Tickets') {
      const codeToId = new Map<string, number>();
      for (const c of src.customers()) {
        if (c.scoularId) codeToId.set(c.scoularId, c.id);
      }
      const matchingIds = new Set<number>();
      for (const t of src.tickets()) {
        if (!t.customerCode || !t.productCode) continue;
        if (matchesCrop(t.productCode, selectedCrops)) {
          const cid = codeToId.get(t.customerCode);
          if (cid != null) matchingIds.add(cid);
        }
      }
      list = list.filter(c => matchingIds.has(c.id));
    } else if (dim === 'Planting') {
      const plantingByCustomer = new Map<number, PlantingIntention[]>();
      for (const p of src.plantingIntentions()) {
        if (!plantingByCustomer.has(p.customerId)) plantingByCustomer.set(p.customerId, []);
        plantingByCustomer.get(p.customerId)!.push(p);
      }
      list = list.filter(c => (plantingByCustomer.get(c.id) ?? []).some(p =>
        !!p.crop && matchesCrop(p.crop, selectedCrops)
      ));
    } else if (dim === 'Contracts') {
      list = list.filter(c => {
        const cContracts = contractMap.get(c.scoularId!) || [];
        return cContracts.some(ct =>
          matchesCrop(ct.commodityCode || '', selectedCrops) ||
          matchesCrop(ct.commodityDescription || '', selectedCrops) ||
          matchesCrop(ct.commodityGroup || '', selectedCrops)
        );
      });
    } else if (dim === 'Grain on Farm') {
      // Scope crop matching to the crops on the producer's grain-on-farm rows — any row they entered,
      // not their contract/ticket commodities.
      list = list.filter(c => (c.grainOnFarm ?? []).some(g =>
        !!g.commodityCode && matchesCrop(g.commodityCode, selectedCrops, GROUP_ONLY)
      ));
    } else {
      list = list.filter(c => (c.commodities ?? []).some(crop => matchesCrop(crop, selectedCrops)));
    }
  }
  if (r.states && r.states.length > 0) {
    list = list.filter(c => {
      const state = c.extendedStateProvince || c.stateProvince;
      return !!state && r.states!.includes(state);
    });
  }
  if (r.deliveryLocations && r.deliveryLocations.length > 0) {
    // Independent of crops/states — a producer matches if ANY ticket has a matching
    // elevatorCity, regardless of the active prompt's dimension.
    const locationsByCode = new Map<string, Set<string>>();
    for (const t of src.tickets()) {
      if (!t.customerCode || !t.elevatorCity) continue;
      if (!locationsByCode.has(t.customerCode)) locationsByCode.set(t.customerCode, new Set());
      locationsByCode.get(t.customerCode)!.add(t.elevatorCity);
    }
    list = list.filter(c => {
      if (!c.scoularId) return false;
      const locations = locationsByCode.get(c.scoularId);
      return !!locations && r.deliveryLocations!.some(l => locations.has(l));
    });
  }
  return list;
}

/** Manual member overrides: drop the excluded producers, then append the hand-added ones not
 *  already listed (and not excluded). */
export function applyMemberOverrides(list: Customer[], excludedIds: Set<number>, includedCustomers: Customer[]): Customer[] {
  if (excludedIds.size > 0) {
    list = list.filter(c => !excludedIds.has(c.id));
  }
  if (includedCustomers.length > 0) {
    const existingIds = new Set(list.map(c => c.id));
    const toAdd = includedCustomers.filter(c => !existingIds.has(c.id) && !excludedIds.has(c.id));
    if (toAdd.length > 0) list = [...list, ...toAdd];
  }
  return list;
}

/**
 * Collapses linked-customer groups: keeps ONE peer row per connected component (the lowest-id
 * customer in `list` that belongs to it). All other component members get folded into that
 * representative and surface inside its inline linked-producer panel. Uses the transitive component
 * closure so a chain A→B→C produces a single row with both B and C linked, not two separate rows
 * for "A linked to B" and "B linked to C".
 */
export function collapseLinkedComponents(list: Customer[], components: Map<string, Set<string>>): Customer[] {
  const repIdByComponent = new Map<Set<string>, number>(); // component identity → rep id
  for (const c of list) {
    if (!c.scoularId) continue;
    const comp = components.get(c.scoularId);
    if (!comp || comp.size <= 1) continue;
    const existing = repIdByComponent.get(comp);
    if (existing == null || c.id < existing) repIdByComponent.set(comp, c.id);
  }
  if (repIdByComponent.size > 0) {
    list = list.filter(c => {
      if (!c.scoularId) return true;
      const comp = components.get(c.scoularId);
      if (!comp || comp.size <= 1) return true; // standalone customer — keep
      return repIdByComponent.get(comp) === c.id;
    });
  }
  return list;
}
