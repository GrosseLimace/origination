import { Injectable } from '@angular/core';
import { Customer, Contract, Ticket, Note, PlantingIntention, StoredGrain, RefinementFilters } from '@models';

export interface NlqFilterContext {
  customers: Customer[];
  contracts: Contract[];
  tickets: Ticket[];
  notes: Note[];
  plantingIntentions: PlantingIntention[];
  storedGrain: StoredGrain[];
}

export interface NlqFilterResult {
  customers: Customer[];
  detectedState: string | null;
  matchedPatterns: string[];
}

@Injectable({ providedIn: 'root' })
export class NlqFilterService {

  // ============================================================
  // Shared constants & utilities
  // ============================================================

  private readonly grainCrops = [
    'corn', 'soybeans', 'soybean', 'wheat', 'oats', 'barley',
    'sorghum', 'milo', 'canola', 'sunflower', 'beans'
  ];

  private stateNames: { [key: string]: string } = {
    'iowa': 'Iowa', 'nebraska': 'Nebraska', 'illinois': 'Illinois',
    'minnesota': 'Minnesota', 'wisconsin': 'Wisconsin', 'missouri': 'Missouri',
    'kansas': 'Kansas', 'south dakota': 'South Dakota', 'north dakota': 'North Dakota',
    'indiana': 'Indiana', 'ohio': 'Ohio', 'michigan': 'Michigan',
    'texas': 'Texas', 'oklahoma': 'Oklahoma', 'colorado': 'Colorado'
  };

  // Maps search crop names to commodity codes and name fragments for matching
  private readonly cropCodeMap: { [crop: string]: string[] } = {
    'wheat':    ['wheat', 'hrww', 'srww', 'sww', 'hww', 'hadw', 'dnsw', 'cwrs', 'fdwt', 'hrwo', 'whto', 'whfg'],
    'corn':     ['corn', 'yc', 'yco', 'ycng', 'ckyc', 'ycck', 'dmgc'],
    'soybeans': ['soybean', 'beans', 'sb', 'ysb', 'nysb', 'ysbo', 'dngs', 'dosb'],
    'soybean':  ['soybean', 'beans', 'sb', 'ysb', 'nysb', 'ysbo', 'dngs', 'dosb'],
    'beans':    ['soybean', 'beans', 'sb', 'ysb', 'nysb', 'ysbo', 'dngs', 'dosb'],
    'sorghum':  ['sorghum', 'milo', 'sor', 'soro', 'csor'],
    'milo':     ['sorghum', 'milo', 'sor', 'soro', 'csor', 'ro98'],
    'canola':   ['canola', 'canp', 'casm'],
    'barley':   ['barley', 'bly', 'fbau', 'base', 'blys', 'blyf'],
    'oats':     ['oat', 'oats'],
    'sunflower':['sunfl', 'sunflower'],
  };

  private matchesCommodity(value: string | undefined | null, searchCrop: string): boolean {
    if (!value) return false;
    const lower = value.toLowerCase();
    const patterns = this.cropCodeMap[searchCrop];
    if (patterns) {
      return patterns.some(p => lower === p || lower.includes(p));
    }
    return lower.includes(searchCrop);
  }

  private detectCropInQuery(query: string): string | null {
    const lower = query.toLowerCase();
    for (const crop of this.grainCrops) {
      if (lower.includes(crop)) return crop;
    }
    return null;
  }

  private parseQuantity(str: string): number {
    return parseInt(str.replace(/,/g, ''), 10);
  }

  private parseDate(dateStr: string | Date | null | undefined): Date | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  // ============================================================
  // Public API
  // ============================================================

  parseAndFilter(query: string, context: NlqFilterContext): NlqFilterResult {
    const detectedState = this.detectStateInQuery(query);
    const matchedPatterns = this.detectPatterns(query, detectedState);
    const customers = this.filterCustomers(query, context, detectedState);
    return { customers, detectedState, matchedPatterns };
  }

  detectStateInQuery(query: string): string | null {
    const lowerQuery = query.toLowerCase();

    for (const state of Object.keys(this.stateNames)) {
      if (lowerQuery.includes(state)) return state;
    }

    const stateAbbreviations: { [key: string]: string } = {
      ' ia ': 'iowa', ' ia,': 'iowa', ' ia.': 'iowa',
      ' ne ': 'nebraska', ' ne,': 'nebraska', ' ne.': 'nebraska',
      ' il ': 'illinois', ' il,': 'illinois', ' il.': 'illinois',
      ' mn ': 'minnesota', ' mn,': 'minnesota', ' mn.': 'minnesota',
      ' wi ': 'wisconsin', ' wi,': 'wisconsin', ' wi.': 'wisconsin',
      ' mo ': 'missouri', ' mo,': 'missouri', ' mo.': 'missouri',
      ' ks ': 'kansas', ' ks,': 'kansas', ' ks.': 'kansas',
      ' sd ': 'south dakota', ' sd,': 'south dakota', ' sd.': 'south dakota',
      ' nd ': 'north dakota', ' nd,': 'north dakota', ' nd.': 'north dakota',
      ',in ': 'indiana', ' in,': 'indiana', ' in.': 'indiana',
      ' oh ': 'ohio', ' oh,': 'ohio', ' oh.': 'ohio',
      ' mi ': 'michigan', ' mi,': 'michigan', ' mi.': 'michigan',
      ' tx ': 'texas', ' tx,': 'texas', ' tx.': 'texas',
      ' ok ': 'oklahoma', ' ok,': 'oklahoma', ' ok.': 'oklahoma',
      ' co ': 'colorado', ' co,': 'colorado', ' co.': 'colorado'
    };

    for (const [abbrev, state] of Object.entries(stateAbbreviations)) {
      if (lowerQuery.includes(abbrev)) return state;
    }

    return null;
  }

  getStateDisplayName(state: string): string {
    return this.stateNames[state.toLowerCase()] || state.charAt(0).toUpperCase() + state.slice(1);
  }

  /** Applies structured refinement filters on top of an already-NLQ-filtered customer list. */
  applyRefinementFilters(
    customers: Customer[],
    filters: RefinementFilters,
    contracts: Contract[],
    notes: Note[]
  ): Customer[] {
    let list = customers;

    if (filters.noActiveContracts) {
      list = list.filter(c => !contracts.some(ct =>
        ct.ctrmCustomerId === c.sourceCustomerId &&
        (ct.status === 'Active' || ct.status === 'Pending' || ct.status === 'Overdue')
      ));
    }
    if (filters.hasUnsignedContracts) {
      list = list.filter(c => contracts.some(ct =>
        ct.ctrmCustomerId === c.sourceCustomerId && ct.signed === false
      ));
    }
    if (filters.hasNegativePacing) {
      const today = new Date();
      const samePointLastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
      list = list.filter(c => {
        const customerContracts = contracts.filter(ct => ct.ctrmCustomerId === c.sourceCustomerId);
        if (customerContracts.length === 0) return false;
        // Determine most recent delivery year
        let maxYear = 0;
        for (const ct of customerContracts) {
          if (ct.deliveryStart) {
            const y = new Date(ct.deliveryStart).getFullYear();
            if (y > maxYear) maxYear = y;
          }
        }
        if (maxYear === 0) return false;
        const thisYearBu = customerContracts
          .filter(ct => ct.deliveryStart && new Date(ct.deliveryStart).getFullYear() === maxYear)
          .reduce((s, ct) => s + (ct.quantity ?? 0), 0);
        const lastYearBu = customerContracts
          .filter(ct => {
            if (!ct.deliveryStart || new Date(ct.deliveryStart).getFullYear() !== maxYear - 1) return false;
            if (!ct.contractDate) return true;
            return new Date(ct.contractDate) <= samePointLastYear;
          })
          .reduce((s, ct) => s + (ct.quantity ?? 0), 0);
        if (lastYearBu === 0) return false;
        return ((thisYearBu - lastYearBu) / lastYearBu) * 100 < 0;
      });
    }
    if (filters.neverContacted) {
      list = list.filter(c => !notes.some(n => n.customerId === c.id));
    } else if (filters.notContactedDays != null && filters.notContactedDays > 0) {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - filters.notContactedDays);
      list = list.filter(c => {
        const lastNote = notes.filter(n => n.customerId === c.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        return !lastNote || new Date(lastNote.createdAt) < threshold;
      });
    }
    if (filters.crops && filters.crops.length > 0) {
      list = list.filter(c => (c.commodities ?? []).some(crop => filters.crops!.includes(crop.trim())));
    }
    if (filters.states && filters.states.length > 0) {
      list = list.filter(c => {
        const state = c.extendedStateProvince || c.stateProvince;
        return !!state && filters.states!.includes(state);
      });
    }
    return list;
  }

  private getStateAbbreviation(state: string): string {
    const abbrevs: { [key: string]: string } = {
      'iowa': 'ia', 'illinois': 'il', 'nebraska': 'ne', 'minnesota': 'mn',
      'wisconsin': 'wi', 'missouri': 'mo', 'kansas': 'ks', 'south dakota': 'sd',
      'north dakota': 'nd', 'indiana': 'in', 'ohio': 'oh', 'michigan': 'mi',
      'texas': 'tx', 'oklahoma': 'ok', 'colorado': 'co'
    };
    return abbrevs[state.toLowerCase()] || '';
  }

  // ============================================================
  // Pattern Detection (for "unrecognized query" UI feedback)
  // ============================================================

  detectPatterns(query: string, detectedState?: string | null): string[] {
    const lowerQuery = query.toLowerCase();
    const matched: string[] = [];

    // --- Location ---
    if (detectedState !== null && detectedState !== undefined) matched.push('state_filter');
    if (/(?:zip|postal)\s*(?:code)?\s*\d{5}/.test(lowerQuery)) matched.push('postal_code');

    // --- Acreage ---
    if (/(?:more than|over|at least|greater than|above|exceeding)\s*\d/.test(lowerQuery) &&
        (lowerQuery.includes('acre') || !lowerQuery.includes('deliver') && !lowerQuery.includes('bushel') && !lowerQuery.includes('contract'))) {
      matched.push('acres_more');
    }
    if (/(?:less than|under|fewer than|below)\s*\d/.test(lowerQuery) && lowerQuery.includes('acre')) matched.push('acres_less');
    if (/between\s*\d+.*acres?/.test(lowerQuery)) matched.push('acres_between');
    if ((lowerQuery.includes('large') || lowerQuery.includes('big')) &&
        (lowerQuery.includes('operation') || lowerQuery.includes('farm'))) matched.push('large_farm');
    if (lowerQuery.includes('small') &&
        (lowerQuery.includes('operation') || lowerQuery.includes('farm'))) matched.push('small_farm');

    // --- Contact history ---
    if (lowerQuery.includes('have not contacted') || lowerQuery.includes("haven't contacted") ||
        lowerQuery.includes('not contacted') || lowerQuery.includes('never contacted')) matched.push('not_contacted');
    if (lowerQuery.includes('contacted in') || lowerQuery.includes('contacted within') ||
        lowerQuery.includes('contacted last') || lowerQuery.includes('contacted this') ||
        lowerQuery.includes('recently contacted')) matched.push('recently_contacted');

    // --- Storage ---
    if (lowerQuery.includes('in storage') || lowerQuery.includes('stored grain') ||
        lowerQuery.includes('storing grain') || lowerQuery.includes('have storage') ||
        lowerQuery.includes('with storage') || lowerQuery.includes('grain stored')) matched.push('storage');
    if (lowerQuery.includes('no storage') || lowerQuery.includes('without storage') ||
        lowerQuery.includes('not storing')) matched.push('no_storage');

    // --- Planting (existing + enhanced) ---
    if ((lowerQuery.includes('planting') || lowerQuery.includes('growing') || lowerQuery.includes('plant ') ||
         lowerQuery.includes('plans to plant') || lowerQuery.includes('plans to grow')) &&
        this.grainCrops.some(crop => lowerQuery.includes(crop))) matched.push('planting');
    if (lowerQuery.includes('planting intention') || lowerQuery.includes('planting plan') ||
        lowerQuery.includes('planning to plant') || lowerQuery.includes('plans to grow')) matched.push('planting');
    if (lowerQuery.includes('no planting') || lowerQuery.includes('without planting') ||
        lowerQuery.includes('not planting') || lowerQuery.includes('no plans to plant')) matched.push('no_planting');
    if (/plant(?:ing|ed)?\s*(?:in|for)\s*\d{4}/.test(lowerQuery) ||
        /\d{4}\s*plant(?:ing)?/.test(lowerQuery)) matched.push('planting_year');
    if (lowerQuery.includes('irrigated') || lowerQuery.includes('dryland') ||
        lowerQuery.includes('dry land')) matched.push('planting_type');

    // --- Contracts (existing + enhanced) ---
    if (lowerQuery.includes('active contract') || lowerQuery.includes('have contract') ||
        lowerQuery.includes('with active contract') || lowerQuery.includes('has contract')) matched.push('active_contract');
    if (lowerQuery.includes('no active contract') || lowerQuery.includes('no contract') ||
        lowerQuery.includes('without contract')) matched.push('no_contract');
    if (lowerQuery.includes('unsigned contract') || lowerQuery.includes('not signed')) matched.push('unsigned_contract');
    if (lowerQuery.includes('pacing') || lowerQuery.includes('contract pace') || lowerQuery.includes('contract pacing')) {
      matched.push(
        (lowerQuery.includes('negative') || lowerQuery.includes('behind') || lowerQuery.includes('below') || lowerQuery.includes('slower'))
          ? 'negative_pacing' : 'positive_pacing'
      );
    }
    if (lowerQuery.includes('fulfilled contract') || lowerQuery.includes('completed contract')) matched.push('contract_status_fulfilled');
    if (lowerQuery.includes('cancelled contract') || lowerQuery.includes('canceled contract')) matched.push('contract_status_cancelled');
    if (lowerQuery.includes('overdue contract') || lowerQuery.includes('past due contract') ||
        lowerQuery.includes('overdue')) matched.push('contract_status_overdue');
    if (lowerQuery.includes('pending contract')) matched.push('contract_status_pending');
    if (lowerQuery.includes('unpriced') || lowerQuery.includes('not priced') ||
        lowerQuery.includes('not fully priced')) matched.push('contract_priced');
    if (/contract\s*(?:s)?\s*(?:more than|over|above|exceeding|at least)\s*[\d,]+\s*(?:bushels?|bu)/i.test(lowerQuery) ||
        /(?:more than|over|above)\s*[\d,]+\s*(?:bushels?|bu)\s*(?:under\s+)?contract/i.test(lowerQuery)) matched.push('contract_quantity');
    if (/contract\s*(?:value|worth)\s*(?:over|above|more than|exceeding)\s*\$?[\d,]+/i.test(lowerQuery)) matched.push('contract_value');
    if (/(?:contract\s*)?price\s*(?:over|above|more than|below|under)\s*\$?[\d.]+/i.test(lowerQuery)) matched.push('contract_price');
    if (/contract\s*(?:delivering|delivery|expir|ending)\s*(?:in|before|after|by|this|next|soon)/i.test(lowerQuery)) matched.push('contract_delivery_date');
    if (/crop\s*year\s*\d{4}|cy\s*\d{4}|\d{4}\s*crop\s*year/i.test(lowerQuery)) matched.push('contract_crop_year');
    if (/open\s*balance|unshipped\s*bushels?|remaining\s*bushels?/i.test(lowerQuery)) matched.push('contract_open_balance');
    if (/booked\s*(?:in|since|after|before|this|last)|contracted\s*(?:in|since|after|before|this|last)/i.test(lowerQuery)) matched.push('contract_booked_date');

    // Commodity contracts (contract/sell/sold/market language)
    for (const commodity of this.grainCrops) {
      if (lowerQuery.includes(`${commodity} contract`) || lowerQuery.includes(`contracts for ${commodity}`) ||
          lowerQuery.includes(`contract ${commodity}`) ||
          lowerQuery.includes(`sell ${commodity}`) || lowerQuery.includes(`selling ${commodity}`) ||
          lowerQuery.includes(`sold ${commodity}`) || lowerQuery.includes(`market ${commodity}`) ||
          lowerQuery.includes(`marketing ${commodity}`)) {
        matched.push('commodity_contract');
        break;
      }
    }

    // --- Tickets/Deliveries (all new) ---
    if (/(?:has|have|with)\s+(?:deliveries|tickets|delivery)/.test(lowerQuery) ||
        (lowerQuery.includes('delivered') && !lowerQuery.includes('never') && !lowerQuery.includes('not ') && !lowerQuery.includes("n't "))) {
      matched.push('has_deliveries');
    }
    if (/(?:no|without|zero)\s+(?:deliveries|tickets|delivery)/.test(lowerQuery) ||
        lowerQuery.includes('never delivered') || lowerQuery.includes('no tickets') ||
        lowerQuery.includes("hasn't delivered") || lowerQuery.includes("haven't delivered")) {
      matched.push('no_deliveries');
    }
    if (/deliver(?:ed|ies|y)?\s+(?:corn|soybeans?|wheat|oats|barley|sorghum|milo|beans)/i.test(lowerQuery) ||
        /(?:corn|soybeans?|wheat|oats|barley|sorghum|milo|beans)\s+deliver/i.test(lowerQuery) ||
        /(?:corn|soybeans?|wheat|oats|barley|sorghum|milo|beans)\s+ticket/i.test(lowerQuery)) {
      matched.push('delivery_commodity');
    }
    if (/deliver(?:ed|ies|y)?\s*(?:more than|over|above|exceeding|at least)\s*[\d,]+\s*(?:bushels?|bu)/i.test(lowerQuery)) {
      matched.push('delivery_quantity');
    }
    if (/deliver(?:ed|ies|y)?\s*(?:this|in|during|last)\s*(?:year|month|week|season|\d{4})/i.test(lowerQuery)) {
      matched.push('delivery_date');
    }
    if (/moisture\s*(?:over|above|more than|greater than|exceeding|below|under|less than)\s*[\d.]+/i.test(lowerQuery) ||
        lowerQuery.includes('high moisture') || lowerQuery.includes('wet grain')) {
      matched.push('moisture_threshold');
    }
    if (/test\s*weight\s*(?:over|above|more than|greater than|below|under|less than)\s*[\d.]+/i.test(lowerQuery) ||
        lowerQuery.includes('low test weight')) {
      matched.push('test_weight_threshold');
    }
    if (/protein\s*(?:over|above|more than|greater than|below|under|less than)\s*[\d.]+/i.test(lowerQuery) ||
        lowerQuery.includes('high protein') || lowerQuery.includes('low protein')) {
      matched.push('protein_threshold');
    }
    if (/grade\s*(?:#?\s*)?(?:\d|one|two|three)/i.test(lowerQuery) ||
        lowerQuery.includes('sample grade')) {
      matched.push('grade_filter');
    }

    // --- Customer info (all new) ---
    // Phone detection — natural language: "have phone numbers", "with a phone", "who have phone", etc.
    const hasPhonePattern = /(?:has|have|with)\s+(?:a\s+)?phone|phone\s*(?:number|#)/i.test(lowerQuery);
    const noPhonePattern = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:a\s+)?phone|no\s+phone\s*(?:number|#)?/i.test(lowerQuery);
    if (hasPhonePattern && !noPhonePattern) matched.push('has_phone');
    if (noPhonePattern) matched.push('no_phone');

    // Email detection — "have email", "with an email", "email address", etc.
    const hasEmailPattern = /(?:has|have|with)\s+(?:an?\s+)?email|email\s*address/i.test(lowerQuery);
    const noEmailPattern = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:an?\s+)?email|no\s+email/i.test(lowerQuery);
    if (hasEmailPattern && !noEmailPattern) matched.push('has_email');
    if (noEmailPattern) matched.push('no_email');

    // Primary contact detection — "have a contact", "with contact", "primary contact", "contact person", "contact info"
    const hasContactPattern = /(?:has|have|with)\s+(?:a\s+)?(?:primary\s+)?contact|contact\s*(?:person|info|name|details)/i.test(lowerQuery);
    const noContactPattern = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:a\s+)?(?:primary\s+)?contact|no\s+contact\s*(?:person|info|name)?/i.test(lowerQuery);
    if (hasContactPattern && !noContactPattern) matched.push('has_primary_contact');
    if (noContactPattern) matched.push('no_primary_contact');

    if (/bin\s*(?:storage\s*)?capacity\s*(?:over|above|more than|greater than|exceeding|at least)\s*[\d,]+/i.test(lowerQuery) ||
        /(?:more than|over)\s*[\d,]+\s*(?:bushels?\s+)?(?:bin|storage)\s*capacity/i.test(lowerQuery)) matched.push('bin_capacity');
    if (lowerQuery.includes('esign') || lowerQuery.includes('e-sign') ||
        lowerQuery.includes('electronic sign')) {
      matched.push(lowerQuery.includes('not') || lowerQuery.includes('no ') || lowerQuery.includes('without')
        ? 'esign_disabled' : 'esign_enabled');
    }
    if (/(?:trad|deal|work|grow|produc|rais|farm)\w*\s*(?:in|with|of)?\s*(?:corn|soybeans?|wheat|oats|barley|sorghum|milo|beans|canola|sunflower)/i.test(lowerQuery) ||
        /(?:corn|soybeans?|wheat|oats|barley|sorghum|milo|beans|canola|sunflower)\s*(?:customers?|producers?|growers?|farmers?)/i.test(lowerQuery)) {
      matched.push('commodities_match');
    }
    if (lowerQuery.includes('linked producer') || lowerQuery.includes('linked customer') ||
        lowerQuery.includes('has linked') || lowerQuery.includes('with linked')) matched.push('has_linked_producers');
    if (lowerQuery.includes('no linked') || lowerQuery.includes('without linked') ||
        lowerQuery.includes('not linked')) matched.push('no_linked_producers');

    // City/location search
    if (/(?:in|from|near|around)\s+[a-z][a-z\s]{1,30}?(?:\s+(?:customers?|producers?|farmers?|growers?|area|region)|$)/.test(lowerQuery)) {
      // Only if it's not a state name match (already handled)
      const cityTestMatch = lowerQuery.match(/(?:in|from|near|around)\s+([a-z][a-z\s]{1,30}?)(?:\s+(?:customers?|producers?|farmers?|growers?|area|region)|$)/);
      if (cityTestMatch && !this.stateNames[cityTestMatch[1].trim()]) matched.push('city_filter');
    }

    // Has/no bin capacity (boolean) — "has bin capacity", "with bin storage", "have bin capacity"
    const hasBin = /(?:has|have|with)\s+(?:a\s+)?(?:bin|storage)\s*(?:capacity|space)?/i.test(lowerQuery);
    const noBin = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:a\s+)?(?:bin|storage)\s*(?:capacity|space)?/i.test(lowerQuery);
    if (hasBin && !noBin) matched.push('has_bin_capacity');
    if (noBin) matched.push('no_bin_capacity');

    // Has/no commodities (boolean) — "has commodities", "with commodities set up", "have commodities"
    const hasCommodities = /(?:has|have|with)\s+(?:a\s+)?commodit(?:y|ies)|commodit(?:y|ies)\s+(?:set|listed|on file)/i.test(lowerQuery);
    const noCommodities = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:a\s+)?commodit(?:y|ies)/i.test(lowerQuery);
    if (hasCommodities && !noCommodities) matched.push('has_commodities');
    if (noCommodities) matched.push('no_commodities');

    // Has/no acreage (boolean) — "has acres", "with acreage", "have acreage"
    const hasAcreage = /(?:has|have|with)\s+(?:any\s+)?(?:acres?|acreage)/i.test(lowerQuery);
    const noAcreage = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:any\s+)?(?:acres?|acreage)/i.test(lowerQuery);
    if (hasAcreage && !noAcreage) matched.push('has_acreage');
    if (noAcreage) matched.push('no_acreage');

    // Farm name search
    if (/farm\s+(?:named?\s+)?[a-z]/.test(lowerQuery) || /on\s+[a-z].+farm/.test(lowerQuery)) matched.push('farm_name');

    // --- Notes (enhanced) ---
    if (lowerQuery.includes('pinned note') || lowerQuery.includes('pinned')) matched.push('has_pinned_notes');
    if (/note(?:s)?\s*(?:about|mentioning|containing|with)\s+/i.test(lowerQuery)) matched.push('note_contains');

    // --- Ranking ---
    if (/top\s*\d+/.test(lowerQuery)) matched.push('top_n');
    if (/(?:bottom|smallest)\s*\d+/.test(lowerQuery)) matched.push('bottom_n');
    if (lowerQuery.includes('largest') || lowerQuery.includes('biggest')) matched.push('largest');

    return matched;
  }

  // ============================================================
  // Main filter orchestrator
  // ============================================================

  private filterCustomers(query: string, context: NlqFilterContext, detectedState: string | null): Customer[] {
    const lowerQuery = query.toLowerCase();
    let result = [...context.customers];

    result = this.applyStateFilter(result, detectedState);
    result = this.applyAcresFilter(lowerQuery, result);
    result = this.applyCustomerInfoFilters(lowerQuery, result, context.tickets);
    result = this.applyContactFilters(lowerQuery, result, context.notes);
    result = this.applyNoteFilters(lowerQuery, result, context.notes);
    result = this.applyStorageFilters(lowerQuery, result, context.storedGrain);
    result = this.applyPlantingFilters(lowerQuery, result, context.plantingIntentions);
    result = this.applyContractFilters(lowerQuery, result, context.contracts);
    result = this.applyTicketFilters(lowerQuery, result, context.tickets);
    result = this.applyRankingFilters(lowerQuery, result);

    return result;
  }

  // ============================================================
  // LOCATION / STATE FILTER
  // ============================================================

  private applyStateFilter(result: Customer[], detectedState: string | null): Customer[] {
    if (!detectedState) return result;
    const stateAbbrev = this.getStateAbbreviation(detectedState);
    return result.filter(c => {
      const stateVal = (c.stateProvince || c.extendedStateProvince || c.location || '').toLowerCase();
      return stateVal.includes(detectedState!) || stateVal.includes(stateAbbrev);
    });
  }

  // ============================================================
  // ACRES FILTER
  // ============================================================

  private applyAcresFilter(lowerQuery: string, result: Customer[]): Customer[] {
    const moreAcresMatch = lowerQuery.match(/(?:more than|over|at least|greater than|above|exceeding)\s*(\d+(?:,\d+)?)\s*acres?/);
    if (moreAcresMatch) {
      const minAcres = this.parseQuantity(moreAcresMatch[1]);
      result = result.filter(c => c.totalAcres >= minAcres);
    }

    const lessAcresMatch = lowerQuery.match(/(?:less than|under|fewer than|below)\s*(\d+(?:,\d+)?)\s*acres?/);
    if (lessAcresMatch) {
      const maxAcres = this.parseQuantity(lessAcresMatch[1]);
      result = result.filter(c => c.totalAcres < maxAcres);
    }

    const betweenAcresMatch = lowerQuery.match(/between\s*(\d+(?:,\d+)?)\s*(?:and|to|-)\s*(\d+(?:,\d+)?)\s*acres?/);
    if (betweenAcresMatch) {
      const minAcres = this.parseQuantity(betweenAcresMatch[1]);
      const maxAcres = this.parseQuantity(betweenAcresMatch[2]);
      result = result.filter(c => c.totalAcres >= minAcres && c.totalAcres <= maxAcres);
    }

    const isTopQuery = /top\s*\d+/.test(lowerQuery);
    if ((lowerQuery.includes('large') || lowerQuery.includes('big')) &&
        (lowerQuery.includes('operation') || lowerQuery.includes('farm')) && !isTopQuery) {
      if (!moreAcresMatch) result = result.filter(c => c.totalAcres >= 1500);
    }

    if (lowerQuery.includes('small') && (lowerQuery.includes('operation') || lowerQuery.includes('farm'))) {
      if (!lessAcresMatch) result = result.filter(c => c.totalAcres < 500);
    }

    return result;
  }

  // ============================================================
  // CUSTOMER INFO FILTERS (email, phone, esign, bin, linked, zip, commodities)
  // ============================================================

  private applyCustomerInfoFilters(lowerQuery: string, result: Customer[], tickets: Ticket[]): Customer[] {
    // Email — "has email", "with an email", "have email addresses", etc.
    const hasEmail = /(?:has|have|with)\s+(?:an?\s+)?email|email\s*address/i.test(lowerQuery);
    const noEmail = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:an?\s+)?email|no\s+email/i.test(lowerQuery);
    if (hasEmail && !noEmail) {
      result = result.filter(c => c.email?.trim() || c.supplementalEmail?.trim());
    }
    if (noEmail) {
      result = result.filter(c => !c.email?.trim() && !c.supplementalEmail?.trim());
    }

    // Phone — "has phone", "with a phone number", "who have phone numbers", etc.
    const hasPhone = /(?:has|have|with)\s+(?:a\s+)?phone|phone\s*(?:number|#)/i.test(lowerQuery);
    const noPhone = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:a\s+)?phone|no\s+phone\s*(?:number|#)?/i.test(lowerQuery);
    if (hasPhone && !noPhone) {
      result = result.filter(c => c.phone?.trim() || c.extendedPrimaryPhone?.trim());
    }
    if (noPhone) {
      result = result.filter(c => !c.phone?.trim() && !c.extendedPrimaryPhone?.trim());
    }

    // Primary contact — "has a contact", "with primary contact", "contact person", "contact info", etc.
    const hasContact = /(?:has|have|with)\s+(?:a\s+)?(?:primary\s+)?contact|contact\s*(?:person|info|name|details)/i.test(lowerQuery);
    const noContact = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:a\s+)?(?:primary\s+)?contact|no\s+contact\s*(?:person|info|name)?/i.test(lowerQuery);
    if (hasContact && !noContact) {
      result = result.filter(c => c.primaryContact?.trim());
    }
    if (noContact) {
      result = result.filter(c => !c.primaryContact?.trim());
    }

    // Bin capacity
    const binCapMatch = lowerQuery.match(/(?:bin|storage)\s*capacity\s*(?:over|above|more than|greater than|exceeding|at least)\s*(\d+(?:,\d+)?)/);
    const binCapMatch2 = lowerQuery.match(/(?:more than|over)\s*(\d+(?:,\d+)?)\s*(?:bushels?\s+)?(?:bin|storage)\s*capacity/);
    const binThreshold = binCapMatch?.[1] || binCapMatch2?.[1];
    if (binThreshold) {
      const minBin = this.parseQuantity(binThreshold);
      result = result.filter(c => (c.binCapacity ?? 0) >= minBin);
    }

    // E-sign
    if (lowerQuery.includes('esign') || lowerQuery.includes('e-sign') || lowerQuery.includes('electronic sign')) {
      const isNegative = lowerQuery.includes('not') || lowerQuery.includes('no ') || lowerQuery.includes('without');
      result = result.filter(c => isNegative ? !c.eSignEnabled : c.eSignEnabled);
    }

    // Commodities match (from customer's commodity list + ticket product codes — grow/produce/raise language)
    const commodityTradeMatch = lowerQuery.match(/(?:trad|deal|work|grow|produc|rais|farm)\w*\s*(?:in|with|of)?\s*(corn|soybeans?|wheat|oats|barley|sorghum|milo|beans|canola|sunflower)/);
    const commodityProducerMatch = lowerQuery.match(/(corn|soybeans?|wheat|oats|barley|sorghum|milo|beans|canola|sunflower)\s*(?:customers?|producers?|growers?|farmers?)/);
    const commodityCrop = commodityTradeMatch?.[1] || commodityProducerMatch?.[1];
    if (commodityCrop) {
      // Build customer → ticket product codes map for efficient lookup
      const ticketCommoditiesByCustomer = new Map<string, Set<string>>();
      for (const t of tickets) {
        if (!t.customerCode || !t.productCode) continue;
        if (!ticketCommoditiesByCustomer.has(t.customerCode)) {
          ticketCommoditiesByCustomer.set(t.customerCode, new Set());
        }
        ticketCommoditiesByCustomer.get(t.customerCode)!.add(t.productCode);
      }

      result = result.filter(c => {
        // Check manually-set commodities from ProducerDetails
        const hasInDetails = c.commodities?.some(cm => this.matchesCommodity(cm, commodityCrop)) ?? false;
        if (hasInDetails) return true;
        // Check ticket-derived commodities
        const ticketCodes = ticketCommoditiesByCustomer.get(c.sourceCustomerId ?? '');
        return ticketCodes ? [...ticketCodes].some(code => this.matchesCommodity(code, commodityCrop)) : false;
      });
    }

    // Linked producers
    if (lowerQuery.includes('has linked') || lowerQuery.includes('with linked') ||
        lowerQuery.includes('linked producer') || lowerQuery.includes('linked customer')) {
      if (!lowerQuery.includes('no linked') && !lowerQuery.includes('without linked') && !lowerQuery.includes('not linked')) {
        result = result.filter(c => (c.linkedProducerIds?.length ?? 0) > 0);
      }
    }
    if (lowerQuery.includes('no linked') || lowerQuery.includes('without linked') || lowerQuery.includes('not linked')) {
      result = result.filter(c => !c.linkedProducerIds?.length);
    }

    // Zip/postal code — check both merchandising and extended postal codes
    const zipMatch = lowerQuery.match(/(?:zip|postal)\s*(?:code)?\s*(\d{5})/);
    if (zipMatch) {
      const zip = zipMatch[1];
      result = result.filter(c => c.postalCode?.startsWith(zip) || c.extendedPostalCode?.startsWith(zip));
    }

    // City/location search — "in [city]", "from [city]", "near [city]", "[city] customers"
    const cityMatch = lowerQuery.match(/(?:in|from|near|around)\s+([a-z][a-z\s]{1,30}?)(?:\s+(?:customers?|producers?|farmers?|growers?|area|region)|$)/);
    if (cityMatch && !this.stateNames[cityMatch[1].trim()]) {
      const city = cityMatch[1].trim();
      result = result.filter(c => {
        const loc = (c.location || '').toLowerCase();
        const extCity = (c.extendedCity || '').toLowerCase();
        return loc.includes(city) || extCity.includes(city);
      });
    }

    // Has/no bin capacity (boolean — any value set vs. none)
    const hasBinFilter = /(?:has|have|with)\s+(?:a\s+)?(?:bin|storage)\s*(?:capacity|space)?/i.test(lowerQuery);
    const noBinFilter = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:a\s+)?(?:bin|storage)\s*(?:capacity|space)?/i.test(lowerQuery);
    if (hasBinFilter && !noBinFilter) {
      if (!(/(?:bin|storage)\s*capacity\s*(?:over|above|more than)/i.test(lowerQuery))) {
        result = result.filter(c => (c.binCapacity ?? 0) > 0);
      }
    }
    if (noBinFilter) {
      result = result.filter(c => !c.binCapacity || c.binCapacity === 0);
    }

    // Has/no commodities (any commodities set up vs. none)
    const hasCommoditiesFilter = /(?:has|have|with)\s+(?:a\s+)?commodit(?:y|ies)|commodit(?:y|ies)\s+(?:set|listed|on file)/i.test(lowerQuery);
    const noCommoditiesFilter = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:a\s+)?commodit(?:y|ies)/i.test(lowerQuery);
    if (hasCommoditiesFilter && !noCommoditiesFilter) {
      result = result.filter(c => (c.commodities?.length ?? 0) > 0);
    }
    if (noCommoditiesFilter) {
      result = result.filter(c => !c.commodities?.length);
    }

    // Has/no acreage (any acreage set vs. zero/unset)
    const hasAcreageFilter = /(?:has|have|with)\s+(?:any\s+)?(?:acres?|acreage)/i.test(lowerQuery);
    const noAcreageFilter = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:any\s+)?(?:acres?|acreage)/i.test(lowerQuery);
    if (hasAcreageFilter && !noAcreageFilter) {
      result = result.filter(c => (c.totalAcres ?? 0) > 0);
    }
    if (noAcreageFilter) {
      result = result.filter(c => !c.totalAcres || c.totalAcres === 0);
    }

    // Farm name search — "farm [name]", "on [name] farm"
    const farmNameMatch = lowerQuery.match(/(?:farm\s+(?:named?\s+)?|on\s+)([a-z][a-z\s]{1,40}?)(?:\s+farm)?(?:\s+|$)/);
    if (farmNameMatch && !this.grainCrops.includes(farmNameMatch[1].trim()) && !this.stateNames[farmNameMatch[1].trim()]) {
      const farmName = farmNameMatch[1].trim();
      // Avoid false matches on common query words
      if (farmName.length > 2 && !['the', 'this', 'that', 'with', 'without', 'and', 'more', 'less', 'over', 'under'].includes(farmName)) {
        result = result.filter(c => (c.farm || '').toLowerCase().includes(farmName));
      }
    }

    return result;
  }

  // ============================================================
  // CONTACT HISTORY FILTER
  // ============================================================

  private applyContactFilters(lowerQuery: string, result: Customer[], notes: Note[]): Customer[] {
    const isNotContactedQuery = lowerQuery.includes('have not contacted') ||
                                lowerQuery.includes("haven't contacted") ||
                                lowerQuery.includes('not contacted') ||
                                lowerQuery.includes('never contacted') ||
                                (lowerQuery.includes('contacted') && lowerQuery.includes('over') && lowerQuery.includes('days'));

    if (isNotContactedQuery) {
      const notContactedMatch = lowerQuery.match(/(\d+)\s*days?/);
      if (notContactedMatch) {
        const notContactedDays = parseInt(notContactedMatch[1]);
        const cutoffDate = new Date(Date.now() - notContactedDays * 24 * 60 * 60 * 1000);
        result = result.filter(c => {
          const lastNote = notes
            .filter(n => n.customerId === c.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
          return !lastNote || new Date(lastNote.createdAt) < cutoffDate;
        });
      } else if (lowerQuery.includes('never contacted') || lowerQuery.includes('no contact history')) {
        result = result.filter(c => !notes.some(n => n.customerId === c.id));
      }
      return result;
    }

    // Recently contacted
    const recentlyContactedMatch = lowerQuery.match(/contacted\s*(?:in|within)?\s*(?:the)?\s*(?:last|past)?\s*(\d+)\s*days?/);
    if (recentlyContactedMatch) {
      const recentDays = parseInt(recentlyContactedMatch[1]);
      const cutoffDate = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
      result = result.filter(c => {
        const lastNote = notes
          .filter(n => n.customerId === c.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        return lastNote && new Date(lastNote.createdAt) >= cutoffDate;
      });
    } else if (lowerQuery.includes('recently contacted') || lowerQuery.includes('contacted recently')) {
      const cutoffDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      result = result.filter(c => {
        const lastNote = notes
          .filter(n => n.customerId === c.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        return lastNote && new Date(lastNote.createdAt) >= cutoffDate;
      });
    }

    if (lowerQuery.includes('contacted last week') || lowerQuery.includes('contacted this week')) {
      const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      result = result.filter(c => {
        const lastNote = notes
          .filter(n => n.customerId === c.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        return lastNote && new Date(lastNote.createdAt) >= cutoffDate;
      });
    }

    if (lowerQuery.includes('contacted last month') || lowerQuery.includes('contacted this month')) {
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      result = result.filter(c => {
        const lastNote = notes
          .filter(n => n.customerId === c.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        return lastNote && new Date(lastNote.createdAt) >= cutoffDate;
      });
    }

    return result;
  }

  // ============================================================
  // NOTE FILTERS (pinned, content search)
  // ============================================================

  private applyNoteFilters(lowerQuery: string, result: Customer[], notes: Note[]): Customer[] {
    // Pinned notes
    if (lowerQuery.includes('pinned note') || lowerQuery.includes('with pinned') || lowerQuery.includes('has pinned')) {
      const customersWithPinned = new Set<number>(
        notes.filter(n => n.isPinned).map(n => n.customerId)
      );
      result = result.filter(c => customersWithPinned.has(c.id));
    }

    // Note content search: "notes about pricing", "notes mentioning delivery"
    const noteContentMatch = lowerQuery.match(/note(?:s)?\s*(?:about|mentioning|containing|with)\s+(.+?)(?:\s+and\s+|\s+in\s+|\s+from\s+|$)/);
    if (noteContentMatch) {
      const searchTerm = noteContentMatch[1].trim();
      const customersWithContent = new Set<number>(
        notes.filter(n => n.content.toLowerCase().includes(searchTerm)).map(n => n.customerId)
      );
      result = result.filter(c => customersWithContent.has(c.id));
    }

    return result;
  }

  // ============================================================
  // STORAGE FILTER
  // ============================================================

  private applyStorageFilters(lowerQuery: string, result: Customer[], storedGrain: StoredGrain[]): Customer[] {
    // Has storage (general)
    if (lowerQuery.includes('in storage') || lowerQuery.includes('stored grain') ||
        lowerQuery.includes('storing grain') || lowerQuery.includes('have storage') ||
        lowerQuery.includes('with storage') || lowerQuery.includes('grain stored')) {
      const customersWithStorage = new Set<number>(storedGrain.map(s => s.customerId));
      result = result.filter(c => customersWithStorage.has(c.id));
    }

    // Specific grain in storage
    for (const grain of this.grainCrops) {
      if (lowerQuery.includes(`${grain} in storage`) || lowerQuery.includes(`storing ${grain}`) ||
          lowerQuery.includes(`stored ${grain}`) || lowerQuery.includes(`${grain} stored`)) {
        const ids = new Set<number>(
          storedGrain.filter(s => this.matchesCommodity(s.crop, grain)).map(s => s.customerId)
        );
        result = result.filter(c => ids.has(c.id));
        break;
      }
    }

    // Storage quantity threshold
    const storageQuantityMatch = lowerQuery.match(/(?:storage|stored|storing)\s*(?:over|more than|above|exceeding)?\s*(\d+(?:,\d+)?)\s*(?:bushels?|bu)/);
    if (storageQuantityMatch) {
      const minQuantity = this.parseQuantity(storageQuantityMatch[1]);
      const customerTotals = new Map<number, number>();
      for (const sg of storedGrain) {
        customerTotals.set(sg.customerId, (customerTotals.get(sg.customerId) || 0) + sg.quantity);
      }
      const ids = new Set<number>(
        Array.from(customerTotals.entries()).filter(([_, total]) => total >= minQuantity).map(([id]) => id)
      );
      result = result.filter(c => ids.has(c.id));
    }

    // No storage
    if (lowerQuery.includes('no storage') || lowerQuery.includes('without storage') ||
        lowerQuery.includes('not storing')) {
      const customersWithStorage = new Set<number>(storedGrain.map(s => s.customerId));
      result = result.filter(c => !customersWithStorage.has(c.id));
    }

    return result;
  }

  // ============================================================
  // PLANTING INTENTIONS FILTER (existing + year, type)
  // ============================================================

  private applyPlantingFilters(lowerQuery: string, result: Customer[], plantingIntentions: PlantingIntention[]): Customer[] {
    let filteredIntentions = [...plantingIntentions];

    // Filter by planting year if specified
    const yearMatch = lowerQuery.match(/plant(?:ing|ed)?\s*(?:in|for)\s*(\d{4})/);
    const yearMatch2 = lowerQuery.match(/(\d{4})\s*plant(?:ing)?/);
    const plantingYear = yearMatch?.[1] || yearMatch2?.[1];
    if (plantingYear) {
      const year = parseInt(plantingYear);
      filteredIntentions = filteredIntentions.filter(p => p.plantingYear === year);
      // If year specified alone (no crop), filter customers with any planting in that year
      const customersWithYear = new Set<number>(filteredIntentions.map(p => p.customerId));
      result = result.filter(c => customersWithYear.has(c.id));
    }

    // Filter by planting type (irrigated/dryland)
    if (lowerQuery.includes('irrigated')) {
      filteredIntentions = filteredIntentions.filter(p => p.type?.toLowerCase().includes('irrigat'));
      const ids = new Set<number>(filteredIntentions.map(p => p.customerId));
      result = result.filter(c => ids.has(c.id));
    }
    if (lowerQuery.includes('dryland') || lowerQuery.includes('dry land')) {
      filteredIntentions = filteredIntentions.filter(p => p.type?.toLowerCase().includes('dryland') || p.type?.toLowerCase().includes('dry land'));
      const ids = new Set<number>(filteredIntentions.map(p => p.customerId));
      result = result.filter(c => ids.has(c.id));
    }

    // Specific crop planting
    for (const crop of this.grainCrops) {
      if (lowerQuery.includes(`planting ${crop}`) || lowerQuery.includes(`growing ${crop}`) ||
          lowerQuery.includes(`plant ${crop}`) || lowerQuery.includes(`plans to plant ${crop}`) ||
          lowerQuery.includes(`${crop} planting`) || lowerQuery.includes(`${crop} this season`)) {
        const ids = new Set<number>(
          filteredIntentions.filter(p => this.matchesCommodity(p.crop, crop)).map(p => p.customerId)
        );
        result = result.filter(c => ids.has(c.id));
        break;
      }
    }

    // General planting (has any planting intention)
    if (lowerQuery.includes('planting intention') || lowerQuery.includes('planting plan') ||
        lowerQuery.includes('planning to plant') || lowerQuery.includes('plans to grow')) {
      const ids = new Set<number>(filteredIntentions.map(p => p.customerId));
      result = result.filter(c => ids.has(c.id));
    }

    // Planting acres threshold
    const plantingAcresMatch = lowerQuery.match(/planting\s*(?:over|more than|above)?\s*(\d+(?:,\d+)?)\s*acres?/);
    if (plantingAcresMatch) {
      const minAcres = this.parseQuantity(plantingAcresMatch[1]);
      const customerTotals = new Map<number, number>();
      for (const pi of filteredIntentions) {
        customerTotals.set(pi.customerId, (customerTotals.get(pi.customerId) || 0) + pi.acres);
      }
      const ids = new Set<number>(
        Array.from(customerTotals.entries()).filter(([_, total]) => total >= minAcres).map(([id]) => id)
      );
      result = result.filter(c => ids.has(c.id));
    }

    // No planting
    if (lowerQuery.includes('no planting') || lowerQuery.includes('without planting') ||
        lowerQuery.includes('not planting') || lowerQuery.includes('no plans to plant')) {
      const ids = new Set<number>(filteredIntentions.map(p => p.customerId));
      result = result.filter(c => !ids.has(c.id));
    }

    return result;
  }

  // ============================================================
  // CONTRACT FILTER (existing + quantity, value, price, status, dates)
  // ============================================================

  private applyContractFilters(lowerQuery: string, result: Customer[], contracts: Contract[]): Customer[] {
    // Build customer-to-contracts map (via string matching)
    const contractsByCustomer = new Map<string, Contract[]>();
    for (const c of contracts) {
      if (!c.ctrmCustomerId) continue;
      const existing = contractsByCustomer.get(c.ctrmCustomerId) || [];
      existing.push(c);
      contractsByCustomer.set(c.ctrmCustomerId, existing);
    }

    const getCustomerContracts = (c: Customer): Contract[] =>
      c.sourceCustomerId ? contractsByCustomer.get(c.sourceCustomerId) ?? [] : [];

    // --- No active contracts ---
    if (lowerQuery.includes('no active contract') || lowerQuery.includes('no contract') ||
        lowerQuery.includes('without contract') || lowerQuery.includes('no contracts')) {
      result = result.filter(c =>
        !getCustomerContracts(c).some(ct => ct.status === 'Active' || ct.status === 'Pending')
      );
    }

    // --- Has active contracts ---
    if ((lowerQuery.includes('with active contract') || lowerQuery.includes('have contract') ||
         lowerQuery.includes('has contract') || lowerQuery.includes('active contract')) &&
        !lowerQuery.includes('no active') && !lowerQuery.includes('no contract') && !lowerQuery.includes('without contract')) {
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => ct.status === 'Active' || ct.status === 'Pending')
      );
    }

    // --- Unsigned contracts ---
    if (lowerQuery.includes('unsigned contract') || lowerQuery.includes('not signed')) {
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => !ct.signed)
      );
    }

    // --- Status-specific filters ---
    if (lowerQuery.includes('fulfilled contract') || lowerQuery.includes('completed contract')) {
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => ct.status === 'Fulfilled')
      );
    }
    if (lowerQuery.includes('cancelled contract') || lowerQuery.includes('canceled contract')) {
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => ct.status === 'Cancelled')
      );
    }
    if (lowerQuery.includes('overdue contract') || lowerQuery.includes('past due contract') ||
        (lowerQuery.includes('overdue') && !lowerQuery.includes('deliver'))) {
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => ct.status === 'Overdue')
      );
    }
    if (lowerQuery.includes('pending contract')) {
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => ct.status === 'Pending')
      );
    }

    // --- Unpriced contracts ---
    if (lowerQuery.includes('unpriced') || lowerQuery.includes('not priced') || lowerQuery.includes('not fully priced')) {
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => !ct.pricedQuantity || ct.pricedQuantity < ct.quantity)
      );
    }

    // --- Contract quantity threshold ---
    const contractQtyMatch = lowerQuery.match(/contract(?:ed|s)?\s*(?:more than|over|above|exceeding|at least)\s*([\d,]+)\s*(?:bushels?|bu)/);
    const contractQtyMatch2 = lowerQuery.match(/(?:more than|over|above)\s*([\d,]+)\s*(?:bushels?|bu)\s*(?:under\s+)?contract/);
    const contractQty = contractQtyMatch?.[1] || contractQtyMatch2?.[1];
    if (contractQty) {
      const minQty = this.parseQuantity(contractQty);
      result = result.filter(c => {
        const total = getCustomerContracts(c).reduce((sum, ct) => sum + (ct.quantity || 0), 0);
        return total >= minQty;
      });
    }

    // --- Contract value threshold ---
    const contractValueMatch = lowerQuery.match(/contract\s*(?:value|worth)\s*(?:over|above|more than|exceeding)\s*\$?([\d,]+)/);
    if (contractValueMatch) {
      const minValue = this.parseQuantity(contractValueMatch[1]);
      result = result.filter(c => {
        const total = getCustomerContracts(c).reduce((sum, ct) => sum + (ct.totalValue || 0), 0);
        return total >= minValue;
      });
    }

    // --- Contract price threshold ---
    const contractPriceOverMatch = lowerQuery.match(/(?:contract\s*)?price\s*(?:over|above|more than)\s*\$?([\d.]+)/);
    if (contractPriceOverMatch) {
      const minPrice = parseFloat(contractPriceOverMatch[1]);
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => (ct.price || 0) >= minPrice)
      );
    }
    const contractPriceUnderMatch = lowerQuery.match(/(?:contract\s*)?price\s*(?:below|under|less than)\s*\$?([\d.]+)/);
    if (contractPriceUnderMatch) {
      const maxPrice = parseFloat(contractPriceUnderMatch[1]);
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => ct.price != null && ct.price > 0 && ct.price <= maxPrice)
      );
    }

    // --- Contract delivery date window ---
    if (lowerQuery.includes('contracts expiring') || lowerQuery.includes('contracts ending')) {
      if (lowerQuery.includes('this month') || lowerQuery.includes('soon')) {
        const now = new Date();
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        result = result.filter(c =>
          getCustomerContracts(c).some(ct => {
            const end = this.parseDate(ct.deliveryEnd);
            return end && end >= now && end <= endOfMonth;
          })
        );
      } else if (lowerQuery.includes('next month')) {
        const now = new Date();
        const startNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const endNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        result = result.filter(c =>
          getCustomerContracts(c).some(ct => {
            const end = this.parseDate(ct.deliveryEnd);
            return end && end >= startNextMonth && end <= endNextMonth;
          })
        );
      }
    }

    // --- Commodity-specific contracts (contract/sell/sold/market language) ---
    for (const commodity of this.grainCrops) {
      if (lowerQuery.includes(`${commodity} contract`) || lowerQuery.includes(`contracts for ${commodity}`) ||
          lowerQuery.includes(`contract ${commodity}`) ||
          lowerQuery.includes(`sell ${commodity}`) || lowerQuery.includes(`selling ${commodity}`) ||
          lowerQuery.includes(`sold ${commodity}`) || lowerQuery.includes(`market ${commodity}`) ||
          lowerQuery.includes(`marketing ${commodity}`)) {
        result = result.filter(c =>
          getCustomerContracts(c).some(ct =>
            this.matchesCommodity(ct.commodityDescription, commodity) ||
            this.matchesCommodity(ct.commodityCode, commodity)
          )
        );
        break;
      }
    }

    // --- Crop year filter: "crop year 2026", "CY2025", "2026 crop year" ---
    const cropYearMatch = lowerQuery.match(/(?:crop\s*year\s*|cy\s*)(\d{4})|(\d{4})\s*crop\s*year/i);
    if (cropYearMatch) {
      const year = parseInt(cropYearMatch[1] || cropYearMatch[2]);
      if (!isNaN(year)) {
        result = result.filter(c =>
          getCustomerContracts(c).some(ct => ct.cropYear === year)
        );
      }
    }

    // --- Open balance / unshipped bushels threshold ---
    // "open balance over 5000 bushels", "more than 10,000 unshipped bushels", "remaining bushels over 2000"
    const openBalOverMatch = lowerQuery.match(/(?:open\s*balance|unshipped\s*bushels?|remaining\s*bushels?)\s*(?:over|above|more than|greater than|exceeding|at least)\s*([\d,]+)/i);
    const openBalOverMatch2 = lowerQuery.match(/(?:more than|over|above)\s*([\d,]+)\s*(?:bushels?|bu)\s*(?:open|unshipped|remaining)/i);
    const openBalThreshold = openBalOverMatch?.[1] || openBalOverMatch2?.[1];
    if (openBalThreshold) {
      const minBal = this.parseQuantity(openBalThreshold);
      result = result.filter(c => {
        const total = getCustomerContracts(c).reduce((sum, ct) => sum + (ct.openBalanceQuantity || 0), 0);
        return total >= minBal;
      });
    }

    // "has open balance", "with unshipped bushels" (boolean — any open balance > 0)
    const hasOpenBal = /(?:has|have|with)\s+(?:an?\s+)?(?:open\s*balance|unshipped\s*bushels?|remaining\s*bushels?)/i.test(lowerQuery);
    const noOpenBal = /(?:no|without|zero)\s+(?:open\s*balance|unshipped\s*bushels?|remaining\s*bushels?)/i.test(lowerQuery);
    if (hasOpenBal && !noOpenBal && !openBalThreshold) {
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => (ct.openBalanceQuantity || 0) > 0)
      );
    }
    if (noOpenBal) {
      result = result.filter(c =>
        !getCustomerContracts(c).some(ct => (ct.openBalanceQuantity || 0) > 0)
      );
    }

    // --- Contract booked date: "booked this year", "contracted since January", "booked in 2025" ---
    const bookedThisYearMatch = /(?:booked|contracted)\s*(?:this\s+year|in\s+\d{4})/i.test(lowerQuery);
    if (bookedThisYearMatch) {
      const yearMatch = lowerQuery.match(/(?:booked|contracted)\s*in\s*(\d{4})/i);
      const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
      result = result.filter(c =>
        getCustomerContracts(c).some(ct => {
          if (!ct.contractDate) return false;
          const d = this.parseDate(ct.contractDate);
          return d && d.getFullYear() === year;
        })
      );
    }

    // "booked since [date]", "contracted after [month]"
    const bookedSinceMatch = lowerQuery.match(/(?:booked|contracted)\s*since\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i);
    if (bookedSinceMatch) {
      const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      const monthIdx = monthNames.indexOf(bookedSinceMatch[1].toLowerCase());
      if (monthIdx >= 0) {
        const cutoff = new Date(new Date().getFullYear(), monthIdx, 1);
        result = result.filter(c =>
          getCustomerContracts(c).some(ct => {
            const d = this.parseDate(ct.contractDate);
            return d && d >= cutoff;
          })
        );
      }
    }

    // --- Contract pacing ---
    const hasPacingQuery = lowerQuery.includes('pacing') || lowerQuery.includes('contract pace') || lowerQuery.includes('contract pacing');
    if (hasPacingQuery) {
      const isNegative = lowerQuery.includes('negative') || lowerQuery.includes('behind') ||
                         lowerQuery.includes('below') || lowerQuery.includes('slower');
      const today = new Date();
      const samePointLastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
      result = result.filter(c => {
        const cContracts = getCustomerContracts(c);
        if (cContracts.length === 0) return false;
        let maxYear = 0;
        for (const ct of cContracts) {
          if (ct.deliveryStart) {
            const y = new Date(ct.deliveryStart).getFullYear();
            if (y > maxYear) maxYear = y;
          }
        }
        if (maxYear === 0) return false;
        const thisYearBu = cContracts
          .filter(ct => ct.deliveryStart && new Date(ct.deliveryStart).getFullYear() === maxYear)
          .reduce((s, ct) => s + (ct.quantity ?? 0), 0);
        // Only count prior-year contracts booked on or before this calendar date last year
        // (same-point-last-year comparison, matching the pacing card logic).
        const lastYearBu = cContracts
          .filter(ct => {
            if (!ct.deliveryStart || new Date(ct.deliveryStart).getFullYear() !== maxYear - 1) return false;
            if (!ct.contractDate) return true;
            return new Date(ct.contractDate) <= samePointLastYear;
          })
          .reduce((s, ct) => s + (ct.quantity ?? 0), 0);
        if (lastYearBu === 0) return false;
        const pacing = ((thisYearBu - lastYearBu) / lastYearBu) * 100;
        return isNegative ? pacing < 0 : pacing >= 0;
      });
    }

    return result;
  }

  // ============================================================
  // TICKET / DELIVERY FILTER (all new)
  // ============================================================

  private applyTicketFilters(lowerQuery: string, result: Customer[], tickets: Ticket[]): Customer[] {
    // Build customerCode -> tickets map for efficient lookups
    const ticketsByCustomer = new Map<string, Ticket[]>();
    for (const t of tickets) {
      if (!t.customerCode) continue;
      const existing = ticketsByCustomer.get(t.customerCode) || [];
      existing.push(t);
      ticketsByCustomer.set(t.customerCode, existing);
    }

    const getCustomerTickets = (c: Customer): Ticket[] =>
      c.sourceCustomerId ? ticketsByCustomer.get(c.sourceCustomerId) ?? [] : [];

    // --- Has deliveries ---
    if (/(?:has|have|with)\s+(?:deliveries|tickets|delivery)/.test(lowerQuery) ||
        (lowerQuery.includes('delivered') && !lowerQuery.includes('never') &&
         !lowerQuery.includes('not ') && !lowerQuery.includes("n't ") && !lowerQuery.includes('no '))) {
      // Only apply as a standalone filter if no more specific delivery filter is present
      const hasSpecificDeliveryFilter =
        /deliver(?:ed|ies|y)?\s+(?:corn|soybeans?|wheat|oats|barley|sorghum|milo|beans)/i.test(lowerQuery) ||
        /deliver(?:ed|ies|y)?\s*(?:more than|over|above|exceeding|at least)\s*[\d,]+/i.test(lowerQuery) ||
        /deliver(?:ed|ies|y)?\s*(?:this|in|during|last)\s*(?:year|month|week)/i.test(lowerQuery);
      if (!hasSpecificDeliveryFilter) {
        result = result.filter(c => getCustomerTickets(c).length > 0);
      }
    }

    // --- No deliveries ---
    if (/(?:no|without|zero)\s+(?:deliveries|tickets|delivery)/.test(lowerQuery) ||
        lowerQuery.includes('never delivered') || lowerQuery.includes('no tickets') ||
        lowerQuery.includes("hasn't delivered") || lowerQuery.includes("haven't delivered")) {
      result = result.filter(c => getCustomerTickets(c).length === 0);
      return result; // No further ticket filters apply
    }

    // --- Delivered specific commodity ---
    const deliveryCropMatch = lowerQuery.match(/(?:deliver(?:ed|ies|y)?|hauled)\s+(corn|soybeans?|wheat|oats|barley|sorghum|milo|beans)/);
    const cropDeliveryMatch = lowerQuery.match(/(corn|soybeans?|wheat|oats|barley|sorghum|milo|beans)\s+(?:deliver|ticket)/);
    const deliveryCrop = deliveryCropMatch?.[1] || cropDeliveryMatch?.[1];
    if (deliveryCrop) {
      result = result.filter(c =>
        getCustomerTickets(c).some(t => this.matchesCommodity(t.productCode, deliveryCrop))
      );
    }

    // --- Delivery quantity threshold ---
    const deliveryQtyMatch = lowerQuery.match(
      /deliver(?:ed|ies|y)?\s*(?:more than|over|above|exceeding|at least)\s*([\d,]+)\s*(?:bushels?|bu)/
    );
    if (deliveryQtyMatch) {
      const minQty = this.parseQuantity(deliveryQtyMatch[1]);
      result = result.filter(c => {
        const total = getCustomerTickets(c).reduce((sum, t) => sum + (t.appliedDockQuantity || 0), 0);
        return total >= minQty;
      });
    }

    // --- Delivered this year ---
    if (/deliver(?:ed|ies|y)?\s*(?:this|in\s+(?:the\s+)?current)\s*year/.test(lowerQuery)) {
      const currentYear = new Date().getFullYear();
      result = result.filter(c =>
        getCustomerTickets(c).some(t => {
          const d = this.parseDate(t.date);
          return d && d.getFullYear() === currentYear;
        })
      );
    }

    // --- Delivered in specific year (e.g. "delivered in 2025") ---
    const deliveryYearMatch = lowerQuery.match(/deliver(?:ed|ies|y)?\s*(?:in|during)\s*(\d{4})/);
    if (deliveryYearMatch) {
      const year = parseInt(deliveryYearMatch[1]);
      result = result.filter(c =>
        getCustomerTickets(c).some(t => {
          const d = this.parseDate(t.date);
          return d && d.getFullYear() === year;
        })
      );
    }

    // --- Delivered this month ---
    if (/deliver(?:ed|ies|y)?\s*(?:this|in\s+(?:the\s+)?current)\s*month/.test(lowerQuery)) {
      const now = new Date();
      result = result.filter(c =>
        getCustomerTickets(c).some(t => {
          const d = this.parseDate(t.date);
          return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        })
      );
    }

    // --- Delivered last month ---
    if (/deliver(?:ed|ies|y)?\s*last\s*month/.test(lowerQuery)) {
      const now = new Date();
      const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      result = result.filter(c =>
        getCustomerTickets(c).some(t => {
          const d = this.parseDate(t.date);
          return d && d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
        })
      );
    }

    // --- Moisture threshold ---
    const moistureOverMatch = lowerQuery.match(/moisture\s*(?:over|above|more than|greater than|exceeding)\s*([\d.]+)/);
    if (moistureOverMatch) {
      const threshold = parseFloat(moistureOverMatch[1]);
      result = result.filter(c =>
        getCustomerTickets(c).some(t => (t.moisture ?? 0) > threshold)
      );
    }
    const moistureUnderMatch = lowerQuery.match(/moisture\s*(?:below|under|less than)\s*([\d.]+)/);
    if (moistureUnderMatch) {
      const threshold = parseFloat(moistureUnderMatch[1]);
      result = result.filter(c =>
        getCustomerTickets(c).some(t => t.moisture != null && t.moisture < threshold)
      );
    }
    if (lowerQuery.includes('high moisture') || lowerQuery.includes('wet grain')) {
      result = result.filter(c =>
        getCustomerTickets(c).some(t => (t.moisture ?? 0) > 15)
      );
    }

    // --- Test weight threshold ---
    const testWeightOverMatch = lowerQuery.match(/test\s*weight\s*(?:over|above|more than|greater than)\s*([\d.]+)/);
    if (testWeightOverMatch) {
      const threshold = parseFloat(testWeightOverMatch[1]);
      result = result.filter(c =>
        getCustomerTickets(c).some(t => (t.testWeight ?? 0) > threshold)
      );
    }
    const testWeightUnderMatch = lowerQuery.match(/test\s*weight\s*(?:below|under|less than)\s*([\d.]+)/);
    if (testWeightUnderMatch) {
      const threshold = parseFloat(testWeightUnderMatch[1]);
      result = result.filter(c =>
        getCustomerTickets(c).some(t => t.testWeight != null && t.testWeight < threshold)
      );
    }
    if (lowerQuery.includes('low test weight')) {
      result = result.filter(c =>
        getCustomerTickets(c).some(t => t.testWeight != null && t.testWeight < 54)
      );
    }

    // --- Protein threshold ---
    const proteinOverMatch = lowerQuery.match(/protein\s*(?:over|above|more than|greater than)\s*([\d.]+)/);
    if (proteinOverMatch) {
      const threshold = parseFloat(proteinOverMatch[1]);
      result = result.filter(c =>
        getCustomerTickets(c).some(t => (t.proteinPercent ?? 0) > threshold)
      );
    }
    const proteinUnderMatch = lowerQuery.match(/protein\s*(?:below|under|less than)\s*([\d.]+)/);
    if (proteinUnderMatch) {
      const threshold = parseFloat(proteinUnderMatch[1]);
      result = result.filter(c =>
        getCustomerTickets(c).some(t => t.proteinPercent != null && t.proteinPercent < threshold)
      );
    }
    if (lowerQuery.includes('high protein')) {
      result = result.filter(c =>
        getCustomerTickets(c).some(t => (t.proteinPercent ?? 0) > 12)
      );
    }
    if (lowerQuery.includes('low protein')) {
      result = result.filter(c =>
        getCustomerTickets(c).some(t => t.proteinPercent != null && t.proteinPercent < 10)
      );
    }

    // --- Grade filter ---
    const gradeMatch = lowerQuery.match(/grade\s*(?:#?\s*)?(\d|one|two|three)/);
    if (gradeMatch) {
      const gradeMap: Record<string, string> = { 'one': '1', 'two': '2', 'three': '3' };
      const gradeNum = gradeMap[gradeMatch[1]] || gradeMatch[1];
      result = result.filter(c =>
        getCustomerTickets(c).some(t => t.gradeCode?.includes(gradeNum))
      );
    }
    if (lowerQuery.includes('sample grade')) {
      result = result.filter(c =>
        getCustomerTickets(c).some(t => t.gradeCode?.toLowerCase().includes('sample'))
      );
    }

    return result;
  }

  // ============================================================
  // RANKING FILTER (top/bottom/largest/smallest)
  // ============================================================

  private applyRankingFilters(lowerQuery: string, result: Customer[]): Customer[] {
    const topMatch = lowerQuery.match(/top\s*(\d+)\s*(?:largest|biggest|customers?|farms?|operations?|producers?|growers?|farmers?)?/);
    if (topMatch) {
      const topN = parseInt(topMatch[1]);
      result = result.sort((a, b) => b.totalAcres - a.totalAcres).slice(0, topN);
    } else if (lowerQuery.includes('largest') || lowerQuery.includes('biggest')) {
      result = result.sort((a, b) => b.totalAcres - a.totalAcres).slice(0, 10);
    }

    const bottomMatch = lowerQuery.match(/(?:bottom|smallest)\s*(\d+)/);
    if (bottomMatch) {
      const bottomN = parseInt(bottomMatch[1]);
      result = result.sort((a, b) => a.totalAcres - b.totalAcres).slice(0, bottomN);
    } else if (lowerQuery.includes('smallest') && !bottomMatch) {
      result = result.sort((a, b) => a.totalAcres - b.totalAcres).slice(0, 10);
    }

    return result;
  }
}
