import { Injectable } from '@angular/core';
import { Customer, Contract, Ticket, Note, PlantingIntention, StoredGrain, RefinementFilters, Commodity, CommodityConversion } from '@models';
import { isContractUnconfirmed, isContractOverdueWithUnshippedBu, buildConversionMap } from '@shared/utils/contract-status';
import { matchTicketViewModeFilters } from '@shared/utils/ticket-view-filters';

export interface NlqFilterContext {
  customers: Customer[];
  contracts: Contract[];
  tickets: Ticket[];
  notes: Note[];
  plantingIntentions: PlantingIntention[];
  storedGrain: StoredGrain[];
  commodities?: Commodity[];
  /** Current user's MSAL display name (e.g. "Caden Egr"). Optional — used by author-scoped
   *  contact / note filters to recognize "by me" notes regardless of whether the API resolved
   *  CreatedBy from UPN to display name. */
  currentUserDisplayName?: string;
  /** Current user's MSAL username / UPN (e.g. "CEgr@scoular.com"). Optional — paired with
   *  currentUserDisplayName so the FE matcher can recognize notes whose CreatedBy was left
   *  as the raw email when ResolveDisplayNamesAsync couldn't find the user in the snapshot. */
  currentUserUsername?: string;
}

export interface NlqFilterResult {
  customers: Customer[];
  detectedState: string | null;
  matchedPatterns: string[];
}

@Injectable({ providedIn: 'root' })
export class NlqFilterService {

  /**
   * Resolves first-person references ("me", "my", "I") in a query to the user's
   * display name so note author searches and contact queries work on saved lists
   * loaded outside Build A List (e.g., on the home page customer list).
   */
  /**
   * Builds the set of lowercase strings that should be treated as "the current user" when
   * matching against a note's `createdBy`/`modifiedBy` field. The DB stores CreatedBy as the
   * full UPN ("CEgr@scoular.com"); the API tries to resolve to display name ("Caden Egr") via
   * UserTradeUnitSnapshot, but falls back to the unmodified UPN when the user isn't in that
   * table. So the matcher needs to recognize both forms — plus the parsed first-name from the
   * resolved NLQ query — to reliably catch "by me" notes regardless of which form survived.
   *
   * Input ordering note: `parsedAuthor` is whatever the NLQ regex captured from the resolved
   * query (typically the user's first name after `resolveUserReferences`). Callers should pass
   * it explicitly so we don't drop it when displayName/username are missing.
   */
  buildAuthorCandidates(parsedAuthor: string | null, displayName?: string, username?: string): string[] {
    const candidates = new Set<string>();
    const add = (s: string | null | undefined) => {
      if (!s) return;
      const trimmed = s.trim().toLowerCase();
      if (trimmed) candidates.add(trimmed);
    };
    add(parsedAuthor);
    add(displayName);
    add(displayName?.split(' ')[0]);
    add(username);
    add(username?.split('@')[0]);
    return [...candidates];
  }

  /** Returns true if any of the author candidates appears as a substring in the supplied field. */
  matchesAuthor(fieldValue: string | null | undefined, candidates: string[]): boolean {
    if (!fieldValue || candidates.length === 0) return false;
    const lower = fieldValue.toLowerCase();
    return candidates.some(c => lower.includes(c));
  }

  resolveUserReferences(query: string, displayName?: string, username?: string): string {
    const firstName = (displayName ?? '').split(' ')[0] || '';
    const userPrefix = (username ?? '').split('@')[0] || '';
    const replacement = firstName || userPrefix;
    if (!replacement) return query;

    return query
      .replace(/\bby me\b/gi, `by ${replacement}`)
      .replace(/\bmy notes?\b/gi, `${replacement}'s notes`)
      .replace(/\bmy customers?\b/gi, `${replacement}'s customers`)
      .replace(/\bnotes?\s+I\s+(?:have\s+)?(?:wrote|left|made|placed|entered|created|added)\b/gi, `notes entered by ${replacement}`)
      .replace(/\bI\s+(?:have\s+)?(?:wrote|left|made|placed|entered|created|added)\b/gi, `entered by ${replacement}`)
      .replace(/\bwho\s+have\s+I\s+(?:contacted|called|reached|noted)\b/gi, `who has ${replacement} contacted`)
      .replace(/\bI\s+(?:have\s+)?(?:contacted|called|reached|noted)\b/gi, `contacted by ${replacement}`)
      .replace(/\bI have\b/gi, `${replacement} has`)
      .replace(/\bI've\b/gi, `${replacement} has`)
      .replace(/\bwho\s+have\s+I\s+(?:entered|placed|written|left|made)\s+(?:a\s+)?notes?\s+for\b/gi, `customers ${replacement} has entered a note for`)
      .replace(/\bnoted by me\b/gi, `noted by ${replacement}`)
      .replace(/\bcontacted by me\b/gi, `contacted by ${replacement}`)
      .replace(/\bplaced by me\b/gi, `entered by ${replacement}`)
      .replace(/\bentered by me\b/gi, `entered by ${replacement}`)
      .replace(/\bwritten by me\b/gi, `entered by ${replacement}`)
      .replace(/\bmade by me\b/gi, `entered by ${replacement}`)
      .replace(/\bleft by me\b/gi, `entered by ${replacement}`);
  }

  /** Returns true if the query involves ticket-related patterns that require ticket data. */
  queryInvolvesTickets(query: string): boolean {
    const q = query.toLowerCase();
    return q.includes('unapplied') || q.includes('ticket') || q.includes('delivered')
      || q.includes('delivery') || q.includes('deliveries') || q.includes('spot load')
      || q.includes('unsettled') || q.includes('settled') || q.includes('unmatched');
  }

  /** Returns true if the query involves storage-related patterns that require stored grain data. */
  queryInvolvesStorage(query: string): boolean {
    const q = query.toLowerCase();
    return q.includes('storage') || q.includes('stored') || q.includes('storing')
      || q.includes('grain on hand') || q.includes('in storage');
  }

  /** Returns true if the query involves contact-related patterns that require notes data. */
  queryInvolvesContact(query: string): boolean {
    const q = query.toLowerCase();
    return q.includes('contacted') || q.includes('called') || q.includes('reached')
      || q.includes('follow up') || q.includes('follow-up') || q.includes('touchpoint')
      || q.includes('never contacted') || q.includes('not contacted');
  }

  /**
   * Returns true if this query's RESULTS can depend on note data — i.e. parseAndFilter will
   * read context.notes. That's broader than queryInvolvesContact: besides explicit contact
   * and "notes mentioning X" queries, the supplementary note-keyword merge runs for general
   * keyword queries too (everything EXCEPT ranking "top N", planting, ticket, and grain-on-farm
   * prompts — mirrors the skip conditions in parseAndFilter). Callers use this to make sure the
   * lazily-loaded note set is present before running a query, so it never evaluates against an
   * empty note array and paints a false "no results".
   */
  queryInvolvesNotes(query: string): boolean {
    const q = query.toLowerCase();
    if (this.queryInvolvesContact(q) || this._isNoteSearchQuery(q)) return true;
    // Otherwise the supplementary keyword merge runs unless the query is one of these types.
    return !/^top\s*\d+/.test(q)
      && !this.queryInvolvesPlanting(q)
      && !this.queryInvolvesTickets(q)
      && !this.queryInvolvesGrainOnFarm(q);
  }

  /** Returns true if the query involves planting-related patterns that require planting intentions data. */
  queryInvolvesPlanting(query: string): boolean {
    const q = query.toLowerCase();
    return q.includes('planting') || q.includes('planted') || q.includes('planting intention')
      || q.includes('projected') || q.includes('irrigated') || q.includes('dryland');
  }

  /** Returns true if the query is about grain on farm / target price (producer profile data).
   *  Used to skip the supplementary note-keyword merge — otherwise "grain on farm" would also
   *  pull in producers whose NOTES mention "grain"/"farm", adding producers with no grain on hand. */
  queryInvolvesGrainOnFarm(query: string): boolean {
    const q = query.toLowerCase();
    return /\bgrain\s+on\s+(?:the\s+)?farm\b/.test(q) || /\bon\s+(?:the\s+)?farm\b/.test(q) || q.includes('target')
      || (/\bgrade\b/.test(q) && !this.queryInvolvesTickets(q) && !/grade\s*(?:#?\s*)?(?:\d|one|two|three)/.test(q));
  }

  /** Returns true if the query is a ranking query (top/bottom/largest/biggest/smallest).
   *  Callers use this to PRESERVE the NLQ's ranked order instead of re-sorting alphabetically —
   *  for a "Top by …" prompt the order is the whole point. Mirrors applyRankingFilters' gate,
   *  including a bare "top … by …" with no explicit count. */
  isRankingQuery(query: string): boolean {
    const q = query.toLowerCase();
    const topMatch = /top\s*\d+/.test(q);
    const bottomMatch = /(?:bottom|smallest)\s*\d+/.test(q);
    const bareTop = /\btop\b/.test(q) && /\bby\b/.test(q);
    return topMatch || bottomMatch || bareTop
      || q.includes('largest') || q.includes('biggest') || q.includes('smallest');
  }

  /** Returns true if the query involves contract-related patterns that require contracts data.
   *  Used by the saved-list customer-list path to wait for contracts before running NLQ —
   *  without it, a "with active contracts" query that ran before contracts loaded would
   *  return 0 producers (the openByCustomer map is empty) while a commodity-specific query
   *  silently falls back to the legacy customer.commodities CSV and still returns producers,
   *  making the failure look intermittent and inconsistent. */
  queryInvolvesContracts(query: string): boolean {
    const q = query.toLowerCase();
    return q.includes('contract') || q.includes('priced') || q.includes('pricing')
      || q.includes('unpriced') || q.includes('signed') || q.includes('unsigned')
      || q.includes('confirmed') || q.includes('unconfirmed') || q.includes('pacing')
      || q.includes('expiring') || q.includes('overdue') || q.includes('fulfilled')
      || q.includes('cancelled') || q.includes('canceled');
  }

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

  // Region → state mappings for multi-state queries
  private readonly regionMap: { [key: string]: string[] } = {
    'corn belt':    ['iowa', 'illinois', 'indiana', 'ohio', 'minnesota', 'nebraska', 'missouri', 'wisconsin', 'michigan', 'south dakota'],
    'great plains': ['kansas', 'nebraska', 'south dakota', 'north dakota', 'oklahoma', 'texas', 'colorado'],
    'midwest':      ['iowa', 'illinois', 'indiana', 'ohio', 'minnesota', 'wisconsin', 'michigan', 'missouri', 'nebraska', 'kansas', 'south dakota', 'north dakota'],
    'northern plains': ['north dakota', 'south dakota', 'minnesota', 'nebraska'],
    'southern plains': ['kansas', 'oklahoma', 'texas'],
    'western corn belt': ['iowa', 'nebraska', 'minnesota', 'south dakota'],
  };

  /** Detect ALL crops mentioned in a query (supports multi-commodity AND/OR). */
  private detectAllCropsInQuery(query: string): string[] {
    const lower = query.toLowerCase();
    const found: string[] = [];
    // Check hardcoded grain crops first
    for (const crop of this.grainCrops) {
      if (lower.includes(crop)) {
        const normalized = (crop === 'soybean' || crop === 'beans') ? 'soybeans' : crop;
        // Skip 'beans' if 'soybeans' was already matched — avoid double-counting
        if (crop === 'beans' && found.includes('soybeans')) continue;
        if (!found.includes(normalized)) found.push(normalized);
      }
    }
    // Check dynamic commodity terms (codes/names from DB) — use word boundaries
    // to avoid matching substrings of common English words (e.g. "act" inside "active").
    for (const term of this._allCommodityTerms) {
      if (term.length > 2 && new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower) && !found.includes(term)) {
        // Don't add if it's a substring of an already-found crop (e.g. "corn" already found, skip "cor")
        if (!found.some(f => f.includes(term) || term.includes(f))) {
          found.push(term);
        }
      }
    }
    return found;
  }

  // ── Dynamic commodity lookup (built from Commodities table) ────────────
  // Maps a category (lowered) → set of codes/names that belong to it.
  // Rebuilt when setCommodityLookup() is called with fresh data.
  private _codesByCategory = new Map<string, Set<string>>();
  // Maps a code or name (lowered) → its category (lowered).
  private _categoryByCodeOrName = new Map<string, string>();
  // All known commodity names/codes (lowered) for query detection.
  private _allCommodityTerms: string[] = [];
  // Track commodity fingerprint to detect when the lookup needs rebuilding (e.g., TU switch).
  private _lastCommodityFingerprint = '';

  /** Call once when commodities are available to build the dynamic lookup. */
  private _buildCommodityLookup(commodities: Commodity[]): void {
    if (commodities.length === 0) return;
    this._codesByCategory.clear();
    this._categoryByCodeOrName.clear();
    const terms = new Set<string>();

    for (const c of commodities) {
      if (!c.isActive) continue;
      const code = c.code.toLowerCase().trim();
      const name = c.name.toLowerCase().trim();
      const category = (c.category || c.name).toLowerCase().trim();

      // Map code → category
      if (code) {
        this._categoryByCodeOrName.set(code, category);
        terms.add(code);
      }
      // Map name → category (if different from code)
      if (name && name !== code) {
        this._categoryByCodeOrName.set(name, category);
        if (name.length > 2) terms.add(name); // skip very short names to avoid false matches
      }

      // Build category → codes set
      if (!this._codesByCategory.has(category)) {
        this._codesByCategory.set(category, new Set());
      }
      this._codesByCategory.get(category)!.add(code);
      if (name) this._codesByCategory.get(category)!.add(name);
    }
    this._allCommodityTerms = [...terms].sort((a, b) => b.length - a.length); // longest first for greedy match
  }

  /**
   * Matches a commodity value (code/description from a contract or ticket) against a search term.
   * Uses the dynamic commodities table lookup first, then falls back to hardcoded cropCodeMap.
   */
  private matchesCommodity(value: string | undefined | null, searchCrop: string): boolean {
    if (!value) return false;
    const lower = value.toLowerCase().trim();
    const search = searchCrop.toLowerCase().trim();

    // 1. If search is a known category, check if value's code/name belongs to that category
    const categorySet = this._codesByCategory.get(search);
    if (categorySet) {
      if (categorySet.has(lower)) return true;
      // Also check if value contains any code in that category
      for (const code of categorySet) {
        if (lower === code || lower.includes(code)) return true;
      }
    }

    // 2. If search is a known code/name, resolve its category and check if value belongs
    const resolvedCategory = this._categoryByCodeOrName.get(search);
    if (resolvedCategory) {
      const catSet = this._codesByCategory.get(resolvedCategory);
      if (catSet && (catSet.has(lower) || [...catSet].some(c => lower === c || lower.includes(c)))) return true;
    }

    // 3. Fallback: hardcoded cropCodeMap (covers common grain names)
    const patterns = this.cropCodeMap[search];
    if (patterns) {
      return patterns.some(p => lower === p || lower.includes(p));
    }

    // 4. Simple substring match
    return lower.includes(search);
  }

  /**
   * Detects a commodity mentioned in the query by checking against:
   * 1. Hardcoded grain crop names (corn, soybeans, wheat, etc.)
   * 2. Dynamic commodity codes/names from the Commodities table
   * Returns the matched term (lowered) or null.
   */
  private detectCropInQuery(query: string): string | null {
    const lower = query.toLowerCase();
    // Check hardcoded crops first (fast, common case)
    for (const crop of this.grainCrops) {
      if (lower.includes(crop)) {
        // Normalize: return 'soybeans' for any soybean variant; skip 'beans' if 'soybeans' already matched
        if (crop === 'beans' && lower.includes('soybeans')) continue;
        return (crop === 'soybean' || crop === 'beans') ? 'soybeans' : crop;
      }
    }
    // Check dynamic commodity terms (codes and names from the DB)
    for (const term of this._allCommodityTerms) {
      if (term.length > 2 && lower.includes(term)) return term;
    }
    return null;
  }

  private parseQuantity(str: string): number {
    const cleaned = str.replace(/,/g, '');
    if (/[\d.]+k$/i.test(cleaned)) {
      return Math.round(parseFloat(cleaned) * 1000);
    }
    return parseInt(cleaned, 10);
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
    // Rebuild dynamic commodity lookup when commodities change (e.g., TU switch).
    // _buildCommodityLookup clears and rebuilds all maps, so it's safe to call repeatedly.
    if (context.commodities && context.commodities.length > 0) {
      const fingerprint = context.commodities.map(c => c.code).sort().join(',');
      if (fingerprint !== this._lastCommodityFingerprint) {
        this._buildCommodityLookup(context.commodities);
        this._lastCommodityFingerprint = fingerprint;
      }
    }
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
      // Note: ' in ' omitted (too common as preposition). ' in,' and ' in.' only match
      // when the query ends with them or they're followed by a digit (zip code), to avoid
      // false positives like "customers in, say, Iowa".
      // See _matchIndianaAbbrev() below for the tighter check.

      ' oh ': 'ohio', ' oh,': 'ohio', ' oh.': 'ohio',
      ' mi ': 'michigan', ' mi,': 'michigan', ' mi.': 'michigan',
      ' tx ': 'texas', ' tx,': 'texas', ' tx.': 'texas',
      ' ok ': 'oklahoma', ' ok,': 'oklahoma', ' ok.': 'oklahoma',
      ' co ': 'colorado', ' co,': 'colorado', ' co.': 'colorado'
    };

    for (const [abbrev, state] of Object.entries(stateAbbreviations)) {
      if (lowerQuery.includes(abbrev)) return state;
    }

    // Indiana special case: ' in,' and ' in.' are too easily confused with the preposition.
    // Only match when preceded by a location-context word (from/near/around) or at end of query,
    // and NOT when followed by a letter (which indicates it's part of a phrase like "in, say, Iowa").
    if (/(?:from|near|around)\s+in[,.]/.test(lowerQuery) || /\bin[,.]$/.test(lowerQuery.trim())) {
      return 'indiana';
    }

    return null;
  }

  getStateDisplayName(state: string): string {
    return this.stateNames[state.toLowerCase()] || state.charAt(0).toUpperCase() + state.slice(1);
  }

  /** Applies manual customer overrides: (baseIds + included) - excluded. */
  applyCustomerOverrides(baseIds: number[], included?: number[], excluded?: number[]): number[] {
    const excludedSet = new Set(excluded || []);
    let ids = excludedSet.size > 0 ? baseIds.filter(id => !excludedSet.has(id)) : [...baseIds];
    if (included?.length) {
      const existingSet = new Set(ids);
      for (const id of included) {
        if (!existingSet.has(id) && !excludedSet.has(id)) ids.push(id);
      }
    }
    return ids;
  }

  /** Applies structured refinement filters on top of an already-NLQ-filtered customer list.
   *  When `dimensionContext` is provided AND a crop filter is active, the crop match is scoped
   *  to the dimension implied by the active filter flags (storage / tickets / planting /
   *  contracts) — so refining a storage-prompt by YSB returns producers with YSB IN STORAGE,
   *  not producers whose generic customer.commodities happens to list YSB. Callers that don't
   *  pass the context fall back to the legacy customer.commodities check. */
  applyRefinementFilters(
    customers: Customer[],
    filters: RefinementFilters,
    contracts: Contract[],
    notes: Note[],
    dimensionContext?: {
      tickets?: Ticket[];
      storedGrain?: StoredGrain[];
      plantingIntentions?: PlantingIntention[];
      commodityConversions?: CommodityConversion[];
    }
  ): Customer[] {
    let list = customers;

    if (filters.noActiveContracts) {
      list = list.filter(c => !contracts.some(ct =>
        ct.ctrmCustomerId === c.scoularId &&
        (ct.status === 'Active' || ct.status === 'Pending' || ct.status === 'Overdue')
      ));
    }
    if (filters.hasUnsignedContracts) {
      // "Has unconfirmed contracts" — matches Insights UnconfirmedContracts rule.
      list = list.filter(c => contracts.some(ct =>
        ct.ctrmCustomerId === c.scoularId && isContractUnconfirmed(ct)
      ));
    }
    if (filters.hasOverdueContracts) {
      // "Has overdue bu contracts" — matches Insights UnshippedBushels rule. Reads
      // contract.openBalanceQuantity via the shared delivery util; no ticket dependency.
      const today = new Date();
      list = list.filter(c => contracts.some(ct =>
        ct.ctrmCustomerId === c.scoularId && isContractOverdueWithUnshippedBu(ct, today)
      ));
    }
    if (filters.downHarvestPace) {
      const today = new Date();
      const samePointLastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
      list = list.filter(c => {
        const customerContracts = contracts.filter(ct => ct.ctrmCustomerId === c.scoularId);
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
    if (filters.neverContacted
        || (filters.notContactedDays != null && filters.notContactedDays > 0)
        || (filters.notesInLastDays != null && filters.notesInLastDays > 0)) {
      // Pre-index latest note per customer — O(notes) build instead of O(customers × notes) scan
      const latestNoteTime = new Map<number, number>();
      const customerIdsWithNotes = new Set<number>();
      for (const n of notes) {
        customerIdsWithNotes.add(n.customerId);
        const time = new Date(n.createdAt).getTime();
        const existing = latestNoteTime.get(n.customerId);
        if (!existing || time > existing) latestNoteTime.set(n.customerId, time);
      }
      if (filters.neverContacted) {
        list = list.filter(c => !customerIdsWithNotes.has(c.id));
      } else if (filters.notContactedDays != null && filters.notContactedDays > 0) {
        const cutoffTime = Date.now() - filters.notContactedDays! * 86400000;
        list = list.filter(c => {
          const time = latestNoteTime.get(c.id);
          return !time || time < cutoffTime;
        });
      }
      if (filters.notesInLastDays != null && filters.notesInLastDays > 0) {
        const cutoffTime = Date.now() - filters.notesInLastDays * 86400000;
        list = list.filter(c => {
          const time = latestNoteTime.get(c.id);
          return !!time && time >= cutoffTime;
        });
      }
    }

    // Ticket-aggregate filters (quantity, recency, quality averages) — mirror the build-list
    // behavior: each filter aggregates over the customer's tickets, scoped to selected crops
    // when a crop refinement is also active. Skipped silently when the saved-list caller didn't
    // pass tickets in dimensionContext (rather than producing wrong results).
    const hasTicketAggregateFilter =
      (filters.ticketQuantityOver != null && filters.ticketQuantityOver > 0) ||
      (filters.ticketsInLastDays != null && filters.ticketsInLastDays > 0) ||
      filters.avgMoistureOver != null || filters.avgMoistureUnder != null ||
      filters.avgTestWeightOver != null || filters.avgTestWeightUnder != null ||
      filters.avgProteinOver != null || filters.avgProteinUnder != null;
    if (hasTicketAggregateFilter && dimensionContext?.tickets) {
      const tickets = dimensionContext.tickets;
      const codeToId = new Map<string, number>();
      for (const c of customers) {
        if (c.scoularId) codeToId.set(c.scoularId, c.id);
      }
      // Scope tickets to selected crops, matching build-list._matchesCropFilter (bi-directional includes).
      let scopedTickets = tickets;
      if (filters.crops && filters.crops.length > 0) {
        const cropsLower = filters.crops.map(c => c.trim().toLowerCase());
        scopedTickets = tickets.filter(t => {
          if (!t.productCode) return false;
          const v = t.productCode.trim().toLowerCase();
          return cropsLower.some(crop => v.includes(crop) || crop.includes(v));
        });
      }

      if (filters.ticketsInLastDays != null && filters.ticketsInLastDays > 0) {
        const cutoff = Date.now() - filters.ticketsInLastDays * 86400000;
        const recent = new Set<string>();
        for (const t of scopedTickets) {
          if (!t.customerCode || !t.date) continue;
          if (new Date(t.date).getTime() >= cutoff) recent.add(t.customerCode);
        }
        list = list.filter(c => !!c.scoularId && recent.has(c.scoularId));
      }

      // Net bu + quality avg filters share view-mode semantics ('grouped' on unapplied
      // groups vs 'single' on individual tickets). Delegated to the shared helper used
      // by build-list so behavior agrees.
      if (dimensionContext.commodityConversions) {
        const conversionMap = buildConversionMap(dimensionContext.commodityConversions);
        const viewMode: 'grouped' | 'single' = filters.ticketViewMode ?? 'single';
        const matchingIds = matchTicketViewModeFilters(scopedTickets, codeToId, conversionMap, viewMode, filters);
        if (matchingIds) list = list.filter(c => matchingIds.has(c.id));
      }
    }

    // Grain on farm (bushels on hand + $/bu target price), read off the customer object.
    // Crop-scoped when filters.crops is set. Mirrors build-list's grain refine block.
    if (filters.grainOnFarmBushelsOver != null || filters.hasGrainTarget || filters.noGrainTarget
        || filters.grainTargetOver != null || filters.grainTargetUnder != null || filters.hasGrade
        || filters.gradeOver != null || filters.gradeUnder != null) {
      const cropSet = (filters.crops ?? []).map(c => c.trim().toLowerCase());
      const grainRowsFor = (c: Customer) => {
        const rows = c.grainOnFarm ?? [];
        if (cropSet.length === 0) return rows;
        return rows.filter(g => {
          const v = (g.commodityGroup ?? '').trim().toLowerCase();
          return cropSet.some(crop => v.includes(crop) || crop.includes(v));
        });
      };
      // Grade is free text — pull the first number out of it ("4.4%" -> 4.4, "TW 58" -> 58) for over/under.
      const gradeNum = (grade?: string): number | null => {
        const m = (grade ?? '').match(/-?\d+(?:\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
      };
      if (filters.hasGrade) {
        list = list.filter(c => grainRowsFor(c).some(g => !!(g.grade ?? '').trim()));
      }
      if (filters.gradeOver != null) {
        list = list.filter(c => grainRowsFor(c).some(g => { const n = gradeNum(g.grade); return n != null && n >= filters.gradeOver!; }));
      }
      if (filters.gradeUnder != null) {
        list = list.filter(c => grainRowsFor(c).some(g => { const n = gradeNum(g.grade); return n != null && n <= filters.gradeUnder!; }));
      }
      if (filters.grainOnFarmBushelsOver != null && filters.grainOnFarmBushelsOver > 0) {
        list = list.filter(c => grainRowsFor(c).reduce((s, g) => s + (g.bushelsOnHand ?? 0), 0) > filters.grainOnFarmBushelsOver!);
      }
      if (filters.hasGrainTarget) {
        list = list.filter(c => grainRowsFor(c).some(g => (g.targetBushels ?? 0) > 0));
      }
      if (filters.noGrainTarget) {
        list = list.filter(c => grainRowsFor(c).some(g => (g.bushelsOnHand ?? 0) > 0)
          && !grainRowsFor(c).some(g => (g.targetBushels ?? 0) > 0));
      }
      if (filters.grainTargetOver != null && filters.grainTargetOver > 0) {
        list = list.filter(c => grainRowsFor(c).some(g => (g.targetBushels ?? 0) >= filters.grainTargetOver!));
      }
      if (filters.grainTargetUnder != null && filters.grainTargetUnder > 0) {
        list = list.filter(c => grainRowsFor(c).some(g => (g.targetBushels ?? 0) > 0 && (g.targetBushels ?? 0) <= filters.grainTargetUnder!));
      }
    }

    if (filters.crops && filters.crops.length > 0) {
      const cropsLower = new Set(filters.crops.map(c => c.trim().toLowerCase()));
      const matchesCrop = (value: string | null | undefined): boolean => {
        if (!value) return false;
        const v = value.trim().toLowerCase();
        return [...cropsLower].some(crop => v.includes(crop) || crop.includes(v));
      };

      // Prefer the prompt category hint stored at save time so the dimension-aware crops
      // filter agrees with build-list. Falls back to flag-only inference for lists saved
      // before _promptCategory was introduced (those need a one-time re-save to fix).
      const cat = filters._promptCategory;
      const isStorage = cat === 'Storage' || filters.hasGrainInStorage
        || filters.storageDaysOver != null || filters.storageQuantityOver != null
        || filters.storageReceivableOver != null;
      const isTickets = cat === 'Tickets' || filters.hasDeliveriesThisYear
        || filters.ticketQuantityOver != null || filters.ticketsInLastDays != null
        || filters.avgMoistureOver != null || filters.avgMoistureUnder != null
        || filters.avgTestWeightOver != null || filters.avgTestWeightUnder != null
        || filters.avgProteinOver != null || filters.avgProteinUnder != null;
      const isPlanting = cat === 'Planting' || filters.hasPlantingIntentions
        || filters.plantingYear != null || filters.irrigatedOnly || filters.drylandOnly || filters.doubleCropOnly
        || (filters.plantingAcresOver != null && filters.plantingAcresOver > 0);
      const isContracts = cat === 'Contracts'
        || filters.hasActiveContracts || filters.hasUnsignedContracts
        || filters.hasUnpricedContracts || filters.hasOverdueContracts
        || filters.contractsExpiringThisMonth || filters.multipleCommoditiesContracted
        || (filters.contractQuantityOver != null && filters.contractQuantityOver > 0);
      const isGrainOnFarm = cat === 'Grain on Farm'
        || filters.grainOnFarmBushelsOver != null || filters.hasGrainTarget || filters.noGrainTarget
        || filters.grainTargetOver != null || filters.grainTargetUnder != null || filters.hasGrade
        || filters.gradeOver != null || filters.gradeUnder != null;

      if (isStorage && dimensionContext?.storedGrain) {
        const byCust = new Map<number, StoredGrain[]>();
        for (const s of dimensionContext.storedGrain) {
          if (!byCust.has(s.customerId)) byCust.set(s.customerId, []);
          byCust.get(s.customerId)!.push(s);
        }
        list = list.filter(c => (byCust.get(c.id) ?? []).some(s => matchesCrop(s.crop)));
      } else if (isTickets && dimensionContext?.tickets) {
        const codeToId = new Map<string, number>();
        for (const c of customers) {
          if (c.scoularId) codeToId.set(c.scoularId, c.id);
        }
        const matching = new Set<number>();
        for (const t of dimensionContext.tickets) {
          if (!t.customerCode) continue;
          if (matchesCrop(t.productCode)) {
            const cid = codeToId.get(t.customerCode);
            if (cid != null) matching.add(cid);
          }
        }
        list = list.filter(c => matching.has(c.id));
      } else if (isPlanting && dimensionContext?.plantingIntentions) {
        const byCust = new Map<number, PlantingIntention[]>();
        for (const p of dimensionContext.plantingIntentions) {
          if (!byCust.has(p.customerId)) byCust.set(p.customerId, []);
          byCust.get(p.customerId)!.push(p);
        }
        list = list.filter(c => (byCust.get(c.id) ?? []).some(p => matchesCrop(p.crop)));
      } else if (isContracts) {
        // Only OPEN contracts count toward dimension-aware crop matching — mirrors build-list
        // which uses _openContractsByCustomer. Otherwise a customer with a closed historical
        // YC contract would slip past a "producers with YC contracts" filter even though
        // they have no current YC business.
        list = list.filter(c => contracts.some(ct =>
          !ct.closedDate &&
          ct.ctrmCustomerId === c.scoularId && (
            matchesCrop(ct.commodityCode) ||
            matchesCrop(ct.commodityDescription) ||
            matchesCrop(ct.commodityGroup)
          )
        ));
      } else if (isGrainOnFarm) {
        list = list.filter(c => (c.grainOnFarm ?? []).some(g =>
          matchesCrop(g.commodityGroup) && (g.bushelsOnHand ?? 0) > 0
        ));
      } else {
        list = list.filter(c => (c.commodities ?? []).some(crop => filters.crops!.includes(crop.trim())));
      }
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

  /** Returns true if the query is a note-focused search (content or author), so other filters (commodity, city) don't misinterpret search terms. */
  private _isNoteSearchQuery(lowerQuery: string): boolean {
    return /note(?:s)?\s*(?:about|mentioning|containing|with|saying|that\s+(?:say|mention|include|contain))|search\s+notes?\s+for|note\s*search|whose\s+notes?/.test(lowerQuery) ||
      /note(?:s)?\s+(?:entered|created|added|written|made|left|from|by)\s+/i.test(lowerQuery) ||
      /(?:everyone|customers?)\s+\w+\s+(?:has|have)\s+(?:entered|noted|contacted)/i.test(lowerQuery) ||
      /who\s+(?:has|have)\s+\w+\s+(?:noted|contacted)/i.test(lowerQuery) ||
      /(?:contacted|noted|called)\s+by\s+/i.test(lowerQuery) ||
      /\w+[''\u2019]s\s+notes?/.test(lowerQuery);
  }

  // ============================================================
  // Synonym normalization — single source of truth for both
  // detectPatterns() and filterCustomers()
  // ============================================================

  private normalizeSynonyms(query: string): string {
    let q = query;
    // -- Calling / follow-up synonyms --
    q = q.replace(/\bneed(?:s)?\s+(?:to\s+)?(?:call|contact|reach\s+out(?:\s+to)?)\b/g, 'not contacted in 30 days');
    q = q.replace(/\bneed(?:s)?\s+follow\s*-?\s*up\b/g, 'not contacted in 14 days');
    q = q.replace(/\bwho\s+(?:do\s+i|should\s+i)\s+(?:call|follow\s+up|follow-up|contact|reach\s+out)\b/gi, 'not contacted in 30 days');
    q = q.replace(/\bhaven'?t\s+(?:called|reached\s+out)\b/g, 'not contacted in 30 days');
    q = q.replace(/\bnot\s+(?:been\s+)?called\b/g, 'not contacted in 30 days');
    q = q.replace(/\bneed\s+(?:a\s+)?touchpoint\b/g, 'not contacted in 30 days');
    q = q.replace(/\boverdue\s+for\s+(?:a\s+)?(?:call|contact|follow.?up)\b/g, 'not contacted in 30 days');
    q = q.replace(/\bwho\s+(?:do\s+i|should\s+i)\s+follow\s*-?\s*up\b/g, 'not contacted in 14 days');
    // -- Contract state synonyms --
    q = q.replace(/\binactive\s+(?:customers?|producers?|growers?|farmers?)\b/g, 'no active contract');
    q = q.replace(/\b(?:not\s+contracted|uncontracted|haven'?t\s+contracted|nothing\s+contracted|no\s+contracts)\b/g, 'no active contract');
    // -- Delivery state synonyms --
    q = q.replace(/\bhaven'?t\s+delivered\b/g, 'no deliveries');
    q = q.replace(/\bnot\s+delivered\b/g, 'no deliveries');
    q = q.replace(/\bnothing\s+delivered\b/g, 'no deliveries');
    q = q.replace(/\bzero\s+deliveries\b/g, 'no deliveries');
    // -- High-value / priority synonyms --
    q = q.replace(/\bhigh\s*-?\s*value\s+(?:customers?|producers?|growers?|farmers?)\b/g, 'top 10 by contract value');
    q = q.replace(/\bmy\s+biggest\s+(?:growers?|producers?|customers?|farmers?)\b/g, 'top 10 by acres');
    q = q.replace(/\blargest\s+(?:producers?|customers?|growers?|farmers?|operations?)\b/g, 'top 10 by acres');
    q = q.replace(/\b(?:most\s+active|best)\s+(?:customers?|producers?|growers?|farmers?)\b/g, 'top 10 by contract value');
    // -- Storage synonyms --
    q = q.replace(/\b(?:has\s+grain\s+in\s+storage|storing\s+grain|grain\s+on\s+hand)\b/g, 'in storage');
    // -- Contact time synonyms --
    q = q.replace(/\blist\s+of\s+contacted\b/g, 'contacted');
    q = q.replace(/\bwho\s+(?:did\s+)?(?:i|we)\s+(?:contact|call|reach)\s+today\b/g, 'contacted today');
    q = q.replace(/\bwho\s+(?:did\s+)?(?:i|we)\s+(?:contact|call|reach)\s+yesterday\b/g, 'contacted yesterday');
    return q;
  }

  // ============================================================
  // Pattern Detection (for "unrecognized query" UI feedback)
  // ============================================================

  detectPatterns(query: string, detectedState?: string | null): string[] {
    const lowerQuery = this.normalizeSynonyms(query.toLowerCase());
    const matched: string[] = [];

    // --- Location ---
    if (detectedState !== null && detectedState !== undefined) matched.push('state_filter');
    if (/(?:zip|postal)\s*(?:code)?\s*\d{5}/.test(lowerQuery)) matched.push('postal_code');

    // --- Acreage ---
    if (/(?:more than|over|at least|greater than|above|exceeding)\s*\d/.test(lowerQuery) &&
        (lowerQuery.includes('acre') || !lowerQuery.includes('deliver') && !lowerQuery.includes('bushel') && !lowerQuery.includes('contract')) &&
        // A bare "over N" inside a grain-on-farm / target prompt is bushels or a price, not acres.
        !/on\s+(?:the\s+)?farm/.test(lowerQuery) && !lowerQuery.includes('target')) {
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
        lowerQuery.includes('contacted today') || lowerQuery.includes('contacted yesterday') ||
        lowerQuery.includes('called today') || lowerQuery.includes('called yesterday') ||
        lowerQuery.includes('recently contacted')) matched.push('recently_contacted');

    // --- Storage ---
    if (lowerQuery.includes('in storage') || lowerQuery.includes('stored grain') ||
        lowerQuery.includes('storing grain') || lowerQuery.includes('have storage') ||
        lowerQuery.includes('with storage') || lowerQuery.includes('grain stored')) matched.push('storage');
    if (lowerQuery.includes('no storage') || lowerQuery.includes('without storage') ||
        lowerQuery.includes('not storing')) matched.push('no_storage');
    if (/(?:stored|storage|in storage)\s*(?:for\s+)?(?:over|more than|longer than)\s*\d+\s*days/.test(lowerQuery)) matched.push('storage_duration');
    if (/storage\s*cost\s*(?:over|above|more than|exceeding)\s*\$?[\d,]+/.test(lowerQuery)) matched.push('storage_cost');

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
    if ((lowerQuery.includes('active contract') || lowerQuery.includes('have contract') ||
        lowerQuery.includes('with active contract') || lowerQuery.includes('with contract') ||
        lowerQuery.includes('has contract')) &&
        !lowerQuery.includes('no active') && !lowerQuery.includes('no contract') && !lowerQuery.includes('without contract')) matched.push('has_contract');
    if (lowerQuery.includes('no active contract') || lowerQuery.includes('no contract') ||
        lowerQuery.includes('without contract')) matched.push('no_contract');
    if (lowerQuery.includes('unsigned contract') || lowerQuery.includes('not signed')) matched.push('unsigned_contract');
    if (lowerQuery.includes('pacing') || lowerQuery.includes('contract pace') || lowerQuery.includes('contract pacing')) {
      matched.push(
        (lowerQuery.includes('negative') || lowerQuery.includes('behind') || lowerQuery.includes('below') || lowerQuery.includes('slower') || lowerQuery.includes('down'))
          ? 'negative_pacing' : 'positive_pacing'
      );
    }
    if (lowerQuery.includes('fulfilled contract') || lowerQuery.includes('completed contract')) matched.push('contract_status_fulfilled');
    if (lowerQuery.includes('cancelled contract') || lowerQuery.includes('canceled contract')) matched.push('contract_status_cancelled');
    if (lowerQuery.includes('overdue contract') || lowerQuery.includes('past due contract') ||
        lowerQuery.includes('overdue')) matched.push('contract_status_overdue');
    if (lowerQuery.includes('pending contract')) matched.push('contract_status_pending');
    if (lowerQuery.includes('unconfirmed') || (lowerQuery.includes('not confirmed') && lowerQuery.includes('contract'))) matched.push('contract_unconfirmed');
    if (lowerQuery.includes('confirmed contract') || lowerQuery.includes('customer confirmed')) matched.push('contract_confirmed');
    if (lowerQuery.includes('unpriced') || lowerQuery.includes('not priced') ||
        lowerQuery.includes('not fully priced') || lowerQuery.includes('needs pricing') ||
        lowerQuery.includes('need to price') || lowerQuery.includes('open price') ||
        lowerQuery.includes('deferred') || lowerQuery.includes('without a price') ||
        lowerQuery.includes('no price') || lowerQuery.includes('fully priced') ||
        lowerQuery.includes('all priced') || lowerQuery.includes('priced contract')) matched.push('contract_priced');
    if (/contract\s*(?:s)?\s*(?:more than|over|above|exceeding|at least)\s*[\d,]+\s*(?:bushels?|bu)/i.test(lowerQuery) ||
        /(?:more than|over|above)\s*[\d,]+\s*(?:bushels?|bu)\s*(?:under\s+)?contract/i.test(lowerQuery)) matched.push('contract_quantity');
    if (/contract\s*(?:value|worth)\s*(?:over|above|more than|exceeding)\s*\$?[\d,]+/i.test(lowerQuery)) matched.push('contract_value');
    if (/(?:contract\s*)?price\s*(?:over|above|more than|below|under)\s*\$?[\d.]+/i.test(lowerQuery)) matched.push('contract_price');
    if (/contract\s*(?:delivering|delivery|expir|ending)\s*(?:in|before|after|by|this|next|soon)/i.test(lowerQuery)) matched.push('contract_delivery_date');
    if (/crop\s*year\s*\d{4}|cy\s*\d{4}|\d{4}\s*crop\s*year/i.test(lowerQuery)) matched.push('contract_crop_year');
    if (/open\s*balance|unshipped\s*bushels?|remaining\s*bushels?/i.test(lowerQuery)) matched.push('contract_open_balance');
    if (/(?:less than|under|more than|over|above|at least)\s*\d+\s*%\s*(?:delivered|fulfilled|complete)/i.test(lowerQuery) ||
        lowerQuery.includes('half delivered') || lowerQuery.includes('half fulfilled')) matched.push('fulfillment_ratio');
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
    if (lowerQuery.includes('purchase ticket') || lowerQuery.includes('inbound')) matched.push('ticket_type_purchase');
    if (lowerQuery.includes('sale ticket') || lowerQuery.includes('outbound') || lowerQuery.includes('loadout')) matched.push('ticket_type_sale');
    if (lowerQuery.includes('unapplied') || lowerQuery.includes('unmatched ticket') || lowerQuery.includes('tickets not applied')) matched.push('ticket_unapplied');
    if (lowerQuery.includes('unsettled') || lowerQuery.includes('not settled')) matched.push('ticket_unsettled');
    if ((lowerQuery.includes('settled ticket') || lowerQuery.includes('final settled')) && !lowerQuery.includes('unsettled')) matched.push('ticket_settled');

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

    // --- Grain on Farm + target price (entered on the producer profile) ---
    if (/\bgrain\s+on\s+(?:the\s+)?farm\b/.test(lowerQuery) ||
        /\b(?:bu|bushels?)\s+on\s+(?:the\s+)?farm\b/.test(lowerQuery) ||
        /\bon\s+(?:the\s+)?farm\b/.test(lowerQuery)) {
      matched.push('grain_on_farm');
    }
    if (/\btarget\b/.test(lowerQuery)) matched.push('grain_target');
    if (/\bgrade\b/.test(lowerQuery) && !this.queryInvolvesTickets(lowerQuery)
        && !/grade\s*(?:#?\s*)?(?:\d|one|two|three)/.test(lowerQuery)) matched.push('grain_grade');
    if (lowerQuery.includes('esign') || lowerQuery.includes('e-sign') ||
        lowerQuery.includes('electronic sign')) {
      matched.push(lowerQuery.includes('not') || lowerQuery.includes('no ') || lowerQuery.includes('without')
        ? 'esign_disabled' : 'esign_enabled');
    }
    // ACH payment method (\bach\b so it never matches inside reach/each/attach/etc.)
    if (/\bach\b/.test(lowerQuery)) {
      matched.push(lowerQuery.includes('not') || lowerQuery.includes('no ') || lowerQuery.includes('without')
        ? 'ach_disabled' : 'ach_payment');
    }
    if (/(?:trad|deal|work|grow|produc|rais|farm)\w*\s*(?:in|with|of)?\s*(?:corn|soybeans?|wheat|oats|barley|sorghum|milo|beans|canola|sunflower)/i.test(lowerQuery) ||
        /(?:corn|soybeans?|wheat|oats|barley|sorghum|milo|beans|canola|sunflower)\s*(?:customers?|producers?|growers?|farmers?)/i.test(lowerQuery)) {
      matched.push('commodities_match');
    }
    // Dynamic commodity detection from Commodities table (codes, names, categories).
    // Word-bounded so a short code can't match inside an unrelated word (e.g. inside "grain"),
    // and skipped for grain-on-farm / target prompts where crop words are dimension-scoped.
    if ((matched.length === 0 || !matched.includes('commodities_match'))
        && !/on\s+(?:the\s+)?farm/.test(lowerQuery) && !lowerQuery.includes('target')) {
      if (this._allCommodityTerms.some(term =>
          term.length > 2 && new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lowerQuery))) {
        matched.push('commodities_match');
      }
    }
    // Crop count — "two crops", "multiple crops", "more than 2 crops", "at least 3 commodities"
    if (/(?:two|2|multiple|several|many)\s+(?:crops?|commodit)/i.test(lowerQuery) ||
        /(?:more than|over|above|at least|exceeding)\s+(\d+)\s+(?:crops?|commodit)/i.test(lowerQuery)) {
      matched.push('crop_count');
    }

    if (lowerQuery.includes('linked producer') || lowerQuery.includes('linked customer') ||
        lowerQuery.includes('has linked') || lowerQuery.includes('with linked')) matched.push('has_linked_producers');
    if (lowerQuery.includes('no linked') || lowerQuery.includes('without linked') ||
        lowerQuery.includes('not linked')) matched.push('no_linked_producers');

    // City/location search (\b stops "in" matching inside words like "gra(in)")
    const cityTestMatch = /on\s+(?:the\s+)?farm/.test(lowerQuery) || lowerQuery.includes('target')
      ? null
      : lowerQuery.match(/\b(?:in|from|near|around)\s+([a-z][a-z\s]{1,25}?)(?=\s+(?:customers?|producers?|farmers?|growers?|area|region|with|who|and|that|having)|$)/);
    if (cityTestMatch && !this.stateNames[cityTestMatch[1].trim()]) matched.push('city_filter');

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
    // "customers with notes" — broad boolean check (has any notes at all)
    if (/(?:with|has|have)\s+notes?\b/.test(lowerQuery) &&
        !this._isNoteSearchQuery(lowerQuery) &&
        !lowerQuery.includes('no note') && !lowerQuery.includes('without note')) {
      matched.push('has_notes');
    }
    if (lowerQuery.includes('pinned note') || lowerQuery.includes('pinned')) matched.push('has_pinned_notes');
    if (/note(?:s)?\s*(?:about|mentioning|containing|with|saying|that\s+(?:say|mention|include|contain))\s+/i.test(lowerQuery) ||
        /search\s+notes?\s+for\s+/i.test(lowerQuery) ||
        /note\s*search\s*:?\s+/i.test(lowerQuery) ||
        /whose\s+notes?\s+(?:say|mention|include|contain|reference)\s+/i.test(lowerQuery)) {
      matched.push('note_contains');
    }
    // Note author/modifier search
    if (/note(?:s)?\s+(?:entered|created|added|written|made|left|from|by)\s+/i.test(lowerQuery) ||
        /(?:everyone|customers?|producers?|growers?|farmers?)\s+\w+\s+(?:has|have)\s+(?:entered|noted|contacted|called)/i.test(lowerQuery) ||
        /who\s+(?:has|have)\s+\w+\s+(?:noted|contacted|called)/i.test(lowerQuery) ||
        /(?:show|find|list|get)\s+(?:me\s+)?(?:everyone|all|customers?)\s+\w+\s+(?:has|have)\s+(?:entered|created|noted)/i.test(lowerQuery) ||
        /\w+[''\u2019]s\s+(?:notes?|contacts?)/.test(lowerQuery) ||
        /(?:contacted|noted|called)\s+by\s+/i.test(lowerQuery) ||
        /note(?:s)?\s+(?:modified|updated|edited)\s+by\s+/i.test(lowerQuery)) {
      matched.push('note_author');
    }

    // --- Ranking ---
    if (/top\s*\d+/.test(lowerQuery)) matched.push('top_n');
    if (/(?:bottom|smallest)\s*\d+/.test(lowerQuery)) matched.push('bottom_n');
    if (lowerQuery.includes('largest') || lowerQuery.includes('biggest')) matched.push('largest');
    if (lowerQuery.includes('by open balance') || (lowerQuery.includes('open balance') && /top\s*\d+/.test(lowerQuery))) matched.push('top_n_open_balance');
    if (lowerQuery.includes('by planting') || (lowerQuery.includes('planting') && /top\s*\d+/.test(lowerQuery))) matched.push('top_n_planting');
    if (lowerQuery.includes('by storage') || (lowerQuery.includes('storage') && /top\s*\d+/.test(lowerQuery))) matched.push('top_n_storage');
    if (lowerQuery.includes('most notes') || lowerQuery.includes('most engaged') || lowerQuery.includes('by notes')) matched.push('top_n_notes');

    // --- Customer name/ID search ---
    if (/(?:customer|producer|grower|farmer)\s+(?:named?\s+)?[A-Z]/.test(query) ||
        /(?:show|find|look up|search)\s+(?:me\s+)?[A-Z][a-z]/.test(query) ||
        /(?:customer|producer)\s+(?:id\s+|#\s*)?[\dA-Z]{2,}/.test(query)) {
      matched.push('customer_search');
    }

    // --- Region/multi-state ---
    for (const region of Object.keys(this.regionMap)) {
      if (lowerQuery.includes(region)) { matched.push('region_filter'); break; }
    }

    // --- Multi-commodity (both/and or X or Y) ---
    const detectedCrops = this.detectAllCropsInQuery(lowerQuery);
    if (detectedCrops.length >= 2) {
      if (lowerQuery.includes(' both ') || lowerQuery.includes(' and ')) {
        matched.push('multi_commodity');
      } else if (lowerQuery.includes(' or ')) {
        matched.push('multi_commodity_or');
      }
    }

    // --- Quarter-based dates ---
    if (/q[1-4]\s*\d{4}|\d{4}\s*q[1-4]/i.test(lowerQuery)) matched.push('quarter_date');

    // --- OR contract statuses ---
    if (/(?:active|pending|overdue|fulfilled|cancelled)\s+or\s+(?:active|pending|overdue|fulfilled|cancelled)/i.test(lowerQuery)) {
      matched.push('contract_status_or');
    }

    // --- Cross-entity ---
    if ((lowerQuery.includes('contract') && lowerQuery.includes('no deliver')) ||
        lowerQuery.includes('contracted but not delivered') || lowerQuery.includes('not yet delivered')) {
      matched.push('cross_contract_no_delivery');
    }
    if ((lowerQuery.includes('planting') && lowerQuery.includes('no contract')) ||
        lowerQuery.includes('intentions without contract')) {
      matched.push('cross_planting_no_contract');
    }
    if ((lowerQuery.includes('deliver') && lowerQuery.includes('no contract') && !lowerQuery.includes('planting')) ||
        lowerQuery.includes('delivered without contract')) {
      matched.push('cross_delivery_no_contract');
    }

    // --- Supplementary note keyword match ---
    // If no other patterns matched, check if the query has meaningful keywords (4+ chars)
    // that could match note content. This ensures the query isn't flagged as "unrecognized"
    // when the supplementary note search in filterCustomers() will find results.
    if (matched.length === 0) {
      const structuralWords = new Set([
        'show', 'find', 'list', 'customers', 'customer', 'producers', 'producer',
        'growers', 'grower', 'farmers', 'farmer', 'who', 'that', 'have', 'has',
        'with', 'without', 'more', 'less', 'than', 'over', 'under', 'above', 'below',
        'the', 'and', 'for', 'are', 'but', 'not', 'all', 'can', 'was', 'one',
        'out', 'had', 'how', 'did', 'let', 'say', 'use', 'been', 'said', 'each',
        'them', 'then', 'what', 'when', 'will', 'into', 'some', 'about', 'their',
        'which', 'would', 'there', 'these', 'other', 'from', 'they', 'this',
      ]);
      const hasKeywords = lowerQuery.split(/\s+/)
        .some(w => w.length >= 4 && !structuralWords.has(w) && !/^\d+$/.test(w));
      if (hasKeywords) matched.push('note_keyword_search');
    }

    return matched;
  }

  // ============================================================
  // Main filter orchestrator
  // ============================================================

  private filterCustomers(query: string, context: NlqFilterContext, detectedState: string | null): Customer[] {
    // Normalize synonyms before pattern matching
    const lowerQuery = this.normalizeSynonyms(query.toLowerCase());
    let result = [...context.customers];

    // Pre-index: latest note per customer — matches home page logic.
    // Indexes notes by customerCode (source ID), resolves linked producer notes
    // bidirectionally (outgoing + incoming links).
    const latestNoteByCustomer = new Map<number, { note: Note; time: number }>();
    const customerIdsWithNotes = new Set<number>();

    // Treat bare ISO strings as UTC — API stores DateTime.UtcNow without Z suffix.
    const parseUtc = (ts: string | Date) => {
      const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
      return new Date(raw).getTime();
    };

    // Index notes by customerCode (source customer ID string)
    const noteTimeByCode = new Map<string, { note: Note; time: number }>();
    for (const n of context.notes) {
      if (!n.customerCode) continue;
      const time = parseUtc(n.createdAt);
      const existing = noteTimeByCode.get(n.customerCode);
      if (!existing || time > existing.time) {
        noteTimeByCode.set(n.customerCode, { note: n, time });
      }
    }

    // Build bidirectional linked-producer map
    const linkedById = new Map<number, string[]>();
    for (const c of context.customers) {
      if (c.linkedProducerIds?.length) linkedById.set(c.id, c.linkedProducerIds);
    }
    const incomingCodeLinks = new Map<string, Set<string>>();
    for (const c of context.customers) {
      if (!c.scoularId) continue;
      for (const linkedCode of (c.linkedProducerIds || [])) {
        if (!incomingCodeLinks.has(linkedCode)) incomingCodeLinks.set(linkedCode, new Set());
        incomingCodeLinks.get(linkedCode)!.add(c.scoularId);
      }
    }

    // Resolve latest note per customer including bidirectional linked producers
    for (const customer of context.customers) {
      const freshLinked = linkedById.get(customer.id) ?? customer.linkedProducerIds ?? [];
      const allCodes = new Set<string>();
      if (customer.scoularId) allCodes.add(customer.scoularId);
      for (const linkedCode of freshLinked) allCodes.add(linkedCode);
      for (const incomingCode of (incomingCodeLinks.get(customer.scoularId || '') || new Set<string>())) {
        allCodes.add(incomingCode);
      }
      let latestEntry: { note: Note; time: number } | null = null;
      for (const code of allCodes) {
        const entry = noteTimeByCode.get(code);
        if (entry && (!latestEntry || entry.time > latestEntry.time)) latestEntry = entry;
      }
      if (latestEntry) {
        latestNoteByCustomer.set(customer.id, latestEntry);
        customerIdsWithNotes.add(customer.id);
      }
    }

    result = this.applyCustomerSearchFilter(query, result);
    result = this.applyRegionFilter(lowerQuery, result);
    result = this.applyStateFilter(result, detectedState);
    result = this.applyAcresFilter(lowerQuery, result);
    result = this.applyCustomerInfoFilters(lowerQuery, result, context.tickets, context.contracts);
    result = this.applyContactFilters(lowerQuery, result, latestNoteByCustomer, customerIdsWithNotes, context.notes, context.customers, context.currentUserDisplayName, context.currentUserUsername);
    result = this.applyNoteFilters(lowerQuery, result, context.notes, context.customers, context.currentUserDisplayName, context.currentUserUsername);
    result = this.applyStorageFilters(lowerQuery, result, context.storedGrain);
    result = this.applyPlantingFilters(lowerQuery, result, context.plantingIntentions);
    result = this.applyContractFilters(lowerQuery, result, context.contracts);
    result = this.applyMultiCommodityContractFilter(lowerQuery, result, context.contracts);
    result = this.applyTicketFilters(lowerQuery, result, context.tickets, context.contracts);
    result = this.applyQuarterDateFilter(lowerQuery, result, context.tickets);
    result = this.applyContractStatusOrFilter(lowerQuery, result, context.contracts);
    result = this.applyCrossEntityFilters(lowerQuery, result, context.contracts, context.tickets, context.plantingIntentions);
    result = this.applyRankingFilters(lowerQuery, result, context.contracts, context.tickets, context.plantingIntentions, context.storedGrain, context.notes);

    // ── Supplementary note search ──────────────────────────────────────
    // Notes are a first-class data source. Always search note content for
    // meaningful query keywords and merge in matches alongside structured filters.
    // E.g., "Customers with milo" finds customers with milo contracts AND customers
    // whose notes mention milo — merged together.
    //
    // SKIP when:
    // - Explicit note search ("notes mentioning X") — already handled by applyNoteFilters
    // - Ranking queries ("top 10") — note merging would dilute ranked results
    if (!this._isNoteSearchQuery(lowerQuery) && !/^top\s*\d+/.test(lowerQuery) &&
        !this.queryInvolvesPlanting(lowerQuery) && !this.queryInvolvesTickets(lowerQuery) &&
        !this.queryInvolvesGrainOnFarm(lowerQuery)) {
      const noteMatchedIds = this._findCustomersByNoteKeywords(lowerQuery, context.notes, context.customers);
      if (noteMatchedIds.size > 0) {
        const existingIds = new Set(result.map(c => c.id));
        const additional = context.customers.filter(c => noteMatchedIds.has(c.id) && !existingIds.has(c.id));
        if (additional.length > 0) {
          result = [...result, ...additional];
        }
      }
    }

    return result;
  }

  // ============================================================
  // CROSS-ENTITY FILTERS (contracts+deliveries, planting+contracts)
  // ============================================================

  private applyCrossEntityFilters(
    lowerQuery: string,
    result: Customer[],
    contracts: Contract[],
    tickets: Ticket[],
    plantingIntentions: PlantingIntention[]
  ): Customer[] {
    // Pre-index open contracts (closedDate is null) and tickets by customer — matches home page
    const contractsByCustomer = new Map<string, Contract[]>();
    for (const c of contracts) {
      if (!c.ctrmCustomerId || c.closedDate) continue;
      const arr = contractsByCustomer.get(c.ctrmCustomerId);
      if (arr) arr.push(c); else contractsByCustomer.set(c.ctrmCustomerId, [c]);
    }
    const ticketsByCustomer = new Map<string, Ticket[]>();
    for (const t of tickets) {
      if (!t.customerCode) continue;
      const arr = ticketsByCustomer.get(t.customerCode);
      if (arr) arr.push(t); else ticketsByCustomer.set(t.customerCode, [t]);
    }

    // "contracts but no deliveries", "contracted but not delivered", "not yet delivered".
    // Two parallel checks — a producer qualifies only when BOTH are clean:
    //   (a) no applied tickets matching customerCode (the ticket-level proof)
    //   (b) no contract showing delivery progress per CTRM's openBalanceQuantity aggregate
    //       (a contract with quantity 50,000 and openBalanceQuantity 30,000 has had 20,000
    //       delivered — even if those tickets aren't yet loaded in the UI's bulk fetch).
    // Without (b) the filter falsely flagged producers with Filled contracts whenever the
    // bulk tickets call was slow or empty, because `hasTickets` defaulted to false.
    if ((lowerQuery.includes('contract') && lowerQuery.includes('no deliver')) ||
        lowerQuery.includes('contracted but not delivered') ||
        lowerQuery.includes('not yet delivered')) {
      result = result.filter(c => {
        const customerContracts = contractsByCustomer.get(c.scoularId!) || [];
        if (customerContracts.length === 0) return false;
        const hasTickets = (ticketsByCustomer.get(c.scoularId!) || []).length > 0;
        if (hasTickets) return false;
        // Any contract where CTRM says delivery has started (openBalanceQuantity < quantity)
        // disqualifies the producer from "no deliveries".
        const hasDeliveryProgress = customerContracts.some(ct => {
          const qty = ct.quantity ?? 0;
          const open = ct.openBalanceQuantity ?? qty;  // null open → treat as fully undelivered
          return open < qty;
        });
        return !hasDeliveryProgress;
      });
    }

    // "planting but no contracts", "planting intentions without contracts"
    if ((lowerQuery.includes('planting') && (lowerQuery.includes('no contract') || lowerQuery.includes('no active contract'))) ||
        lowerQuery.includes('intentions without contract') ||
        lowerQuery.includes('planting but no contract') ||
        lowerQuery.includes('planting but no active contract')) {
      // Group planting by customer → Set of "year|crop" keys
      const plantingByCustomer = new Map<number, Set<string>>();
      for (const p of plantingIntentions) {
        const cropKey = (p.crop || '').trim().toUpperCase();
        if (!cropKey || !p.plantingYear) continue;
        const key = `${p.plantingYear}|${cropKey}`;
        const existing = plantingByCustomer.get(p.customerId);
        if (existing) existing.add(key); else plantingByCustomer.set(p.customerId, new Set([key]));
      }
      result = result.filter(c => {
        const plantingKeys = plantingByCustomer.get(c.id);
        if (!plantingKeys || plantingKeys.size === 0) return false;
        // Get this customer's contracts indexed by crop year
        const customerContracts = contractsByCustomer.get(c.scoularId!) || [];
        // Return true if ANY planting crop+year has zero matching contracts in the same year
        for (const key of plantingKeys) {
          const [yearStr, crop] = key.split('|');
          const year = parseInt(yearStr);
          const hasCoverage = customerContracts.some(ct => {
            if (ct.cropYear !== year) return false;
            const code = (ct.commodityCode || '').trim().toUpperCase();
            const desc = (ct.commodityDescription || '').trim().toUpperCase();
            const group = (ct.commodityGroup || '').trim().toUpperCase();
            return code.includes(crop) || crop.includes(code) ||
                   desc.includes(crop) || crop.includes(desc) ||
                   group.includes(crop) || crop.includes(group);
          });
          if (!hasCoverage) return true;
        }
        return false;
      });
    }

    // "deliveries but no contracts" / "delivered without contract"
    if ((lowerQuery.includes('deliver') && lowerQuery.includes('no contract') && !lowerQuery.includes('planting')) ||
        lowerQuery.includes('delivered without contract')) {
      result = result.filter(c => {
        const hasTickets = (ticketsByCustomer.get(c.scoularId!) || []).length > 0;
        const hasContracts = (contractsByCustomer.get(c.scoularId!) || []).length > 0;
        return hasTickets && !hasContracts;
      });
    }

    return result;
  }

  // ============================================================
  // CUSTOMER NAME / ID SEARCH
  // ============================================================

  private applyCustomerSearchFilter(query: string, result: Customer[]): Customer[] {
    // "customer named Johnson", "show me Johnson", "producer Smith", "customer ABC-123", "customer id 12345"
    let searchTerm: string | null = null;

    // Match: "customer/producer/grower/farmer [named] <Name>"
    const namedMatch = query.match(/(?:customer|producer|grower|farmer)\s+(?:named?\s+)?([A-Z][A-Za-z\s'-]+)/);
    if (namedMatch) searchTerm = namedMatch[1].trim();

    // Match: "show/find/look up <Name>"
    if (!searchTerm) {
      const showMatch = query.match(/(?:show|find|look\s*up|search)\s+(?:me\s+)?([A-Z][A-Za-z\s'-]{2,}?)(?:\s+(?:customer|producer|grower|farmer|in|from|with)|$)/);
      if (showMatch) searchTerm = showMatch[1].trim();
    }

    // Match: "customer id <ID>" or "customer #<ID>" or "customer <CODE>"
    if (!searchTerm) {
      const idMatch = query.match(/(?:customer|producer)\s+(?:id\s+|#\s*)?([\dA-Z][\dA-Z\-]{1,})/);
      if (idMatch) searchTerm = idMatch[1].trim();
    }

    if (!searchTerm) return result;

    const lower = searchTerm.toLowerCase();
    return result.filter(c =>
      c.name.toLowerCase().includes(lower) ||
      (c.scoularId || '').toLowerCase().includes(lower)
    );
  }

  // ============================================================
  // REGION / MULTI-STATE FILTER
  // ============================================================

  private applyRegionFilter(lowerQuery: string, result: Customer[]): Customer[] {
    for (const [region, states] of Object.entries(this.regionMap)) {
      if (lowerQuery.includes(region)) {
        const abbrevs = states.map(s => this.getStateAbbreviation(s));
        return result.filter(c => {
          const stateVal = (c.stateProvince || c.extendedStateProvince || '').toLowerCase();
          return states.some(s => stateVal.includes(s)) ||
                 abbrevs.some(a => a && stateVal.includes(a));
        });
      }
    }
    return result;
  }

  // ============================================================
  // MULTI-COMMODITY CONTRACT FILTER (both corn AND soybeans)
  // ============================================================

  private applyMultiCommodityContractFilter(lowerQuery: string, result: Customer[], contracts: Contract[]): Customer[] {
    const crops = this.detectAllCropsInQuery(lowerQuery);
    if (crops.length < 2) return result;
    if (!lowerQuery.includes(' both ') && !lowerQuery.includes(' and ')) return result;

    // Pre-index contracts by customer
    const contractsByCustomer = new Map<string, Contract[]>();
    for (const c of contracts) {
      if (!c.ctrmCustomerId) continue;
      const arr = contractsByCustomer.get(c.ctrmCustomerId);
      if (arr) arr.push(c); else contractsByCustomer.set(c.ctrmCustomerId, [c]);
    }

    return result.filter(c => {
      const customerContracts = contractsByCustomer.get(c.scoularId!) || [];
      const customerCommodities = c.commodities || [];
      // Check each required crop appears in either contracts or customer commodities
      return crops.every(crop =>
        customerContracts.some(ct => this.matchesCommodity(ct.commodityDescription, crop) || this.matchesCommodity(ct.commodityCode, crop)) ||
        customerCommodities.some(comm => this.matchesCommodity(comm, crop))
      );
    });
  }

  // ============================================================
  // QUARTER-BASED DATE FILTER (Q1 2025, Q2 2025, etc.)
  // ============================================================

  private applyQuarterDateFilter(lowerQuery: string, result: Customer[], tickets: Ticket[]): Customer[] {
    const quarterMatch = lowerQuery.match(/q([1-4])\s*(\d{4})|(\d{4})\s*q([1-4])/);
    if (!quarterMatch) return result;

    const quarter = parseInt(quarterMatch[1] || quarterMatch[4], 10);
    const year = parseInt(quarterMatch[2] || quarterMatch[3], 10);
    const startMonth = (quarter - 1) * 3; // 0-indexed: Q1→0, Q2→3, Q3→6, Q4→9
    const endMonth = startMonth + 2;

    // Pre-index tickets by customer
    const ticketsByCustomer = new Map<string, Ticket[]>();
    for (const t of tickets) {
      if (!t.customerCode) continue;
      const arr = ticketsByCustomer.get(t.customerCode);
      if (arr) arr.push(t); else ticketsByCustomer.set(t.customerCode, [t]);
    }

    return result.filter(c => {
      const customerTickets = ticketsByCustomer.get(c.scoularId!) || [];
      return customerTickets.some(t => {
        if (!t.date) return false;
        const d = new Date(t.date);
        return d.getFullYear() === year && d.getMonth() >= startMonth && d.getMonth() <= endMonth;
      });
    });
  }

  // ============================================================
  // OR LOGIC FOR CONTRACT STATUSES
  // ============================================================

  private applyContractStatusOrFilter(lowerQuery: string, result: Customer[], contracts: Contract[]): Customer[] {
    const orMatch = lowerQuery.match(/(active|pending|overdue|fulfilled|cancelled)\s+or\s+(active|pending|overdue|fulfilled|cancelled)/);
    if (!orMatch) return result;

    const statuses = [
      orMatch[1].charAt(0).toUpperCase() + orMatch[1].slice(1),
      orMatch[2].charAt(0).toUpperCase() + orMatch[2].slice(1),
    ];

    // Pre-index contracts by customer
    const contractsByCustomer = new Map<string, Contract[]>();
    for (const c of contracts) {
      if (!c.ctrmCustomerId) continue;
      const arr = contractsByCustomer.get(c.ctrmCustomerId);
      if (arr) arr.push(c); else contractsByCustomer.set(c.ctrmCustomerId, [c]);
    }

    return result.filter(c => {
      const customerContracts = contractsByCustomer.get(c.scoularId!) || [];
      return customerContracts.some(ct => statuses.includes(ct.status as string));
    });
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
    const moreAcresMatch = lowerQuery.match(/(?:more than|over|at least|greater than|above|exceeding)\s*(\d+(?:,\d+)?(?:k)?)\s*acres?/);
    if (moreAcresMatch) {
      const minAcres = this.parseQuantity(moreAcresMatch[1]);
      result = result.filter(c => c.totalAcres >= minAcres);
    }

    const lessAcresMatch = lowerQuery.match(/(?:less than|under|fewer than|below)\s*(\d+(?:,\d+)?(?:k)?)\s*acres?/);
    if (lessAcresMatch) {
      const maxAcres = this.parseQuantity(lessAcresMatch[1]);
      result = result.filter(c => c.totalAcres < maxAcres);
    }

    const betweenAcresMatch = lowerQuery.match(/between\s*(\d+(?:,\d+)?(?:k)?)\s*(?:and|to|-)\s*(\d+(?:,\d+)?(?:k)?)\s*acres?/);
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

  private applyCustomerInfoFilters(lowerQuery: string, result: Customer[], tickets: Ticket[], contracts: Contract[] = []): Customer[] {
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
    // Use word boundary after "contact" to avoid matching "contracts" which contains "contact" as a substring.
    const hasContact = /(?:has|have|with)\s+(?:a\s+)?(?:primary\s+)?contact\b(?!s?\s*(?:for|with|in))|contact\s*(?:person|info|name|details)/i.test(lowerQuery) && !lowerQuery.includes('contract');
    const noContact = /(?:no|without|missing|don'?t have|doesn'?t have)\s+(?:a\s+)?(?:primary\s+)?contact\b(?!s)|no\s+contact\s*(?:person|info|name)?/i.test(lowerQuery) && !lowerQuery.includes('contract');
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

    // ── Grain on Farm — per-commodity bushels on hand + a $/bu target price entered on the
    //    producer profile (dbo.ProducerGrainOnFarm). Supports:
    //      "grain on farm", "no grain on farm", "grain on farm over 50k", "corn on farm",
    //      "has a target", "no target set", "target over $5.50", "wheat target under 6".
    //    A crop word scopes the match to that commodity group ("corn on farm" → corn rows only).
    //    Kept ahead of the commodity block, which skips its dynamic-term fallback for these
    //    queries (isGrainOnFarmQuery) so "corn on farm" isn't also filtered as a generic corn
    //    producer. Requires customer.grainOnFarm to be merged in (build-list._mergeProducerDetails).
    const grainOnFarmContext = /\bgrain\s+on\s+(?:the\s+)?farm\b/.test(lowerQuery)
      || /\b(?:bu|bushels?)\s+on\s+(?:the\s+)?farm\b/.test(lowerQuery)
      || /\bon\s+(?:the\s+)?farm\b/.test(lowerQuery);
    const grainTargetContext = /\btarget\b/.test(lowerQuery);
    // "grade" as a free-text grain-quality note — but NOT ticket grade ("grade 2", "sample grade").
    const grainGradeContext = /\bgrade\b/.test(lowerQuery)
      && !this.queryInvolvesTickets(lowerQuery)
      && !/grade\s*(?:#?\s*)?(?:\d|one|two|three)/.test(lowerQuery);
    const isGrainOnFarmQuery = grainOnFarmContext || grainTargetContext || grainGradeContext;
    if (isGrainOnFarmQuery) {
      // Scope only by an explicit, whole-word crop name (commodityGroup is a group name like
      // "Corn"/"Soybeans"). detectCropInQuery's substring match would mis-fire on dynamic
      // commodity codes hiding inside words ("p(rod)ucers", "g(rai)n", "f(arm)"), wrongly
      // scoping the filter to a bogus crop and returning zero producers.
      const grainCrop = this.grainCrops.find(crop => new RegExp(`\\b${crop}\\b`).test(lowerQuery)) ?? null;
      const rowsFor = (c: Customer) => {
        const rows = c.grainOnFarm ?? [];
        return grainCrop ? rows.filter(g => this.matchesCommodity(g.commodityGroup, grainCrop)) : rows;
      };
      const totalBu = (c: Customer) => rowsFor(c).reduce((s, g) => s + (g.bushelsOnHand ?? 0), 0);
      const maxTarget = (c: Customer) => rowsFor(c).reduce((m, g) => Math.max(m, g.targetBushels ?? 0), 0);
      const hasGrain = (c: Customer) => rowsFor(c).some(g => (g.bushelsOnHand ?? 0) > 0);
      const hasTarget = (c: Customer) => rowsFor(c).some(g => (g.targetBushels ?? 0) > 0);
      const hasGrade = (c: Customer) => rowsFor(c).some(g => !!(g.grade ?? '').trim());

      // Target price thresholds — "target over $5.50", "target price above 6", "target under 4.25".
      const targetOver = lowerQuery.match(/target\s*(?:price)?\s*(?:of\s*)?(?:over|above|more than|greater than|exceeding|at least)\s*\$?\s*([\d,]+(?:\.\d+)?)/);
      const targetUnder = lowerQuery.match(/target\s*(?:price)?\s*(?:of\s*)?(?:under|below|less than|at most|no more than)\s*\$?\s*([\d,]+(?:\.\d+)?)/);
      const negativeTarget = /\b(?:no|without|missing)\b\s*(?:a\s+)?(?:price\s+)?target\b/.test(lowerQuery)
        || /\btarget\b\s*(?:price\s*)?(?:is\s+)?(?:not\s+set|missing|unset)\b/.test(lowerQuery)
        || /\bneed\w*\b[^$.]*\btarget\b/.test(lowerQuery);

      if (targetOver) {
        const min = parseFloat(targetOver[1].replace(/,/g, ''));
        result = result.filter(c => maxTarget(c) >= min);
      } else if (targetUnder) {
        const max = parseFloat(targetUnder[1].replace(/,/g, ''));
        result = result.filter(c => rowsFor(c).some(g => (g.targetBushels ?? 0) > 0 && (g.targetBushels ?? 0) <= max));
      } else if (grainTargetContext && negativeTarget) {
        // "grain on farm without a target set" — actionable: has grain but no target price yet.
        result = result.filter(c => hasGrain(c) && !hasTarget(c));
      } else if (grainTargetContext) {
        result = result.filter(c => hasTarget(c));
      }

      // Grain-on-farm quantity / presence — only when the query wasn't purely a target query.
      if (grainOnFarmContext && !targetOver && !targetUnder) {
        const overMatch = lowerQuery.match(/(?:over|above|more than|greater than|exceeding|at least)\s*([\d,]+k?)\s*(?:bushels?|bu)?\s*(?:of\s+grain\s+)?on\s+(?:the\s+)?farm/)
          || lowerQuery.match(/(?:grain\s+)?on\s+(?:the\s+)?farm\s*(?:over|above|more than|greater than|exceeding|at least)\s*([\d,]+k?)/);
        const underMatch = lowerQuery.match(/(?:under|below|less than|fewer than)\s*([\d,]+k?)\s*(?:bushels?|bu)?\s*(?:of\s+grain\s+)?on\s+(?:the\s+)?farm/)
          || lowerQuery.match(/(?:grain\s+)?on\s+(?:the\s+)?farm\s*(?:under|below|less than)\s*([\d,]+k?)/);
        const negativeGrain = /\b(?:no|without|zero)\b\s+(?:any\s+)?(?:grain\s+)?on\s+(?:the\s+)?farm\b/.test(lowerQuery);
        if (overMatch) {
          result = result.filter(c => totalBu(c) >= this.parseQuantity(overMatch[1]));
        } else if (underMatch) {
          result = result.filter(c => hasGrain(c) && totalBu(c) <= this.parseQuantity(underMatch[1]));
        } else if (negativeGrain) {
          result = result.filter(c => !hasGrain(c));
        } else if (!grainTargetContext) {
          // Plain "grain on farm" / "corn on farm" → producers who have any (scoped) grain on farm.
          result = result.filter(c => hasGrain(c));
        }
      }

      // Grade presence — "has a grade", "producers with a grain grade".
      if (grainGradeContext) {
        result = result.filter(c => hasGrade(c));
      }
    }

    // E-sign
    if (lowerQuery.includes('esign') || lowerQuery.includes('e-sign') || lowerQuery.includes('electronic sign')) {
      const isNegative = lowerQuery.includes('not') || lowerQuery.includes('no ') || lowerQuery.includes('without');
      result = result.filter(c => isNegative ? !c.eSignEnabled : c.eSignEnabled);
    }

    // ACH payment method (PaymentMethod == 'H'). \bach\b avoids matching reach/each/attach/etc.
    if (/\bach\b/.test(lowerQuery)) {
      const isNegative = lowerQuery.includes('not') || lowerQuery.includes('no ') || lowerQuery.includes('without');
      result = result.filter(c => isNegative ? !c.achEnabled : c.achEnabled);
    }

    // Commodities match (from customer's commodity list + ticket product codes + contracts)
    // Supports OR: "corn or soybeans customers", "grow corn or wheat"
    // Also supports dynamic commodity codes/names from the Commodities table (e.g. "HRWW", "yellow corn")
    //
    // Skip commodity filtering when the query is a note content search — crop words like
    // "beans" in "notes mentioning beans in the bin" are search terms, not commodity filters.
    const isNoteSearchQuery = this._isNoteSearchQuery(lowerQuery);

    const commodityTradeMatch = isNoteSearchQuery ? null : lowerQuery.match(/(?:trad|deal|work|grow|produc|rais|farm)\w*\s*(?:in|with|of)?\s*(corn|soybeans?|wheat|oats|barley|sorghum|milo|beans|canola|sunflower)/);
    const commodityProducerMatch = isNoteSearchQuery ? null : lowerQuery.match(/(corn|soybeans?|wheat|oats|barley|sorghum|milo|beans|canola|sunflower)\s*(?:customers?|producers?|growers?|farmers?)/);
    let commodityCrop = commodityTradeMatch?.[1] || commodityProducerMatch?.[1] || null;

    // If no hardcoded crop found, try detecting a dynamic commodity term from the DB.
    // Skip when the query is a storage query — words like "storage" can accidentally match
    // short commodity codes/names (e.g. "age", "tor") from the Commodities table.
    // Word-boundary matching prevents false hits like "act" inside "active" or "con" inside "contacted".
    const isStorageQuery = this.queryInvolvesStorage(lowerQuery);
    const isTicketQuery = this.queryInvolvesTickets(lowerQuery);
    if (!commodityCrop && !isNoteSearchQuery && !isStorageQuery && !isTicketQuery && !isGrainOnFarmQuery) {
      for (const term of this._allCommodityTerms) {
        if (term.length > 2 && new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lowerQuery)) {
          commodityCrop = term;
          break;
        }
      }
    }

    if (commodityCrop) {
      // Detect all crops/terms in query for OR logic
      const allCrops = this.detectAllCropsInQuery(lowerQuery);
      const cropsToMatch = allCrops.length > 1 && lowerQuery.includes(' or ') ? allCrops : [commodityCrop];

      // Build customer → ticket product codes map for efficient lookup
      const ticketCommoditiesByCustomer = new Map<string, Set<string>>();
      for (const t of tickets) {
        if (!t.customerCode || !t.productCode) continue;
        if (!ticketCommoditiesByCustomer.has(t.customerCode)) {
          ticketCommoditiesByCustomer.set(t.customerCode, new Set());
        }
        ticketCommoditiesByCustomer.get(t.customerCode)!.add(t.productCode);
      }

      // Build customer → contract commodity group map (commodityGroup = "Corn", "Soybeans", "Wheat", etc.)
      // Only consider open contracts (closedDate is null) — matches the home page contracts tab.
      const contractGroupsByCustomer = new Map<string, Set<string>>();
      const contractCodesByCustomer = new Map<string, Set<string>>();
      for (const c of contracts) {
        if (!c.ctrmCustomerId || c.closedDate) continue;
        if (!contractGroupsByCustomer.has(c.ctrmCustomerId)) {
          contractGroupsByCustomer.set(c.ctrmCustomerId, new Set());
          contractCodesByCustomer.set(c.ctrmCustomerId, new Set());
        }
        if (c.commodityGroup) contractGroupsByCustomer.get(c.ctrmCustomerId)!.add(c.commodityGroup.toLowerCase());
        if (c.commodityCode) contractCodesByCustomer.get(c.ctrmCustomerId)!.add(c.commodityCode.toLowerCase());
        if (c.commodityDescription) contractCodesByCustomer.get(c.ctrmCustomerId)!.add(c.commodityDescription.toLowerCase());
      }

      const cropWithContracts = lowerQuery.includes('contract');
      const cropWithTickets = this.queryInvolvesTickets(lowerQuery);

      result = result.filter(c => {
        return cropsToMatch.some(crop => {
          const cropLower = crop.toLowerCase();
          if (cropWithContracts) {
            // "corn contracts" → check contract commodityGroup directly (Corn, Soybeans, Wheat, Sorghum)
            const groups = contractGroupsByCustomer.get(c.scoularId ?? '');
            if (groups && groups.has(cropLower)) return true;
            // Also try matching crop aliases against the group (e.g. "milo" → matches group "sorghum")
            const codes = contractCodesByCustomer.get(c.scoularId ?? '');
            return codes ? [...codes].some(code => this.matchesCommodity(code, cropLower)) : false;
          }
          // Non-contract queries: check contracts, tickets, and ProducerDetails broadly
          const codes = contractCodesByCustomer.get(c.scoularId ?? '');
          if (codes && [...codes].some(code => this.matchesCommodity(code, cropLower))) return true;
          const ticketCodes = ticketCommoditiesByCustomer.get(c.scoularId ?? '');
          if (ticketCodes && [...ticketCodes].some(code => this.matchesCommodity(code, cropLower))) return true;
          return c.commodities?.some(cm => this.matchesCommodity(cm, cropLower)) ?? false;
        });
      });
    }

    // Crop count — filter by number of distinct commodities a customer has
    const cropCountMatch = lowerQuery.match(/(?:more than|over|above|at least|exceeding)\s+(\d+)\s+(?:crops?|commodit)/i);
    const cropCountWord = /(?:two|2|multiple|several|many)\s+(?:crops?|commodit)/i.test(lowerQuery);
    if (cropCountMatch || cropCountWord) {
      const minCrops = cropCountMatch ? parseInt(cropCountMatch[1], 10) : 2;
      // Count distinct commodities from contracts, tickets, and customer.commodities
      result = result.filter(c => {
        const crops = new Set<string>();
        // From customer commodities field
        for (const crop of (c.commodities ?? [])) { if (crop.trim()) crops.add(crop.trim().toUpperCase()); }
        // From contracts
        const custContracts = contracts.filter(ct =>
          ct.ctrmCustomerId === c.scoularId && ct.status !== 'Cancelled');
        for (const ct of custContracts) {
          if (ct.commodityCode) crops.add(ct.commodityCode.trim().toUpperCase());
        }
        // From tickets — include both direct-customer tickets AND tickets applied to one of
        // this customer's contracts (CTRM splits tickets across related entities, so a
        // ticket's CustomerCode can differ from the contract's CtrmCustomerId even when the
        // grain logically belongs to this customer's contract). Same fix as the contracts
        // table — keeps commodity-based "crops match" filters honest.
        const custContractIds = new Set(
          custContracts.map(ct => ct.sourceContractId).filter((s): s is string => !!s)
        );
        const custTickets = tickets.filter(t =>
          t.customerCode === c.scoularId
          || (!!t.ctrmContractNumber && custContractIds.has(t.ctrmContractNumber))
        );
        for (const t of custTickets) {
          if (t.productCode) crops.add(t.productCode.trim().toUpperCase());
        }
        return crops.size >= minCrops;
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
    // Lookahead allows trailing "with/who/and/having" without consuming them so other filters still fire.
    // Skip city matching for note-search, storage, ticket, and grain-on-farm queries to avoid
    // "in the bin" / "in storage" / "grain on farm" being parsed as a city. The \b before the
    // direction words also stops "in" matching inside a word like "gra(in)".
    const cityMatch = (this._isNoteSearchQuery(lowerQuery) || isStorageQuery || isTicketQuery || isGrainOnFarmQuery) ? null : lowerQuery.match(/\b(?:in|from|near|around)\s+([a-z][a-z\s]{1,25}?)(?=\s+(?:customers?|producers?|farmers?|growers?|area|region|with|who|and|that|having)|$)/);
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

    // Farm name search — "farm [name]", "on [name] farm". Skipped for grain-on-farm / target
    // prompts, where "on farm" is the dimension keyword, not a farm name to match against.
    const farmNameMatch = isGrainOnFarmQuery ? null : lowerQuery.match(/(?:farm\s+(?:named?\s+)?|on\s+)([a-z][a-z\s]{1,40}?)(?:\s+farm)?(?:\s+|$)/);
    if (farmNameMatch && !this.grainCrops.includes(farmNameMatch[1].trim()) && !this.stateNames[farmNameMatch[1].trim()]) {
      const farmName = farmNameMatch[1].trim();
      // Avoid false matches on common query words
      if (farmName.length > 2 && !['the', 'this', 'that', 'with', 'without', 'and', 'more', 'less', 'over', 'under', 'farm', 'grain'].includes(farmName)) {
        result = result.filter(c => (c.farm || '').toLowerCase().includes(farmName));
      }
    }

    return result;
  }

  // ============================================================
  // CONTACT HISTORY FILTER
  // ============================================================

  private applyContactFilters(
    lowerQuery: string,
    result: Customer[],
    latestNoteByCustomer: Map<number, { note: Note; time: number }>,
    customerIdsWithNotes: Set<number>,
    notes: Note[] = [],
    customers: Customer[] = [],
    currentUserDisplayName?: string,
    currentUserUsername?: string
  ): Customer[] {
    const isNotContactedQuery = lowerQuery.includes('have not contacted') ||
                                lowerQuery.includes("haven't contacted") ||
                                lowerQuery.includes('not contacted') ||
                                lowerQuery.includes('never contacted') ||
                                (lowerQuery.includes('contacted') && lowerQuery.includes('over') && lowerQuery.includes('days'));

    // Detect author-scoped contact queries — both negative ("never contacted BY <name>")
    // and positive ("contacted by <name> this week").
    let authorName: string | null = null;
    const authorMatch =
      // Negative: "never contacted by <name>", "<name> has never contacted"
      lowerQuery.match(/(?:have|has)\s+(?:never|not|n't)\s+(?:contacted|called|reached|noted)\s+by\s+(.+?)(?:\s|$)/) ||
      lowerQuery.match(/(?:never|not|haven'?t)\s+(?:contacted|called|reached|noted)\s+by\s+(.+?)(?:\s|$)/) ||
      lowerQuery.match(/customers?\s+(\w+(?:\s+\w+)?)\s+(?:has|have)\s+(?:never|not|n't)\s+(?:contacted|called|reached|noted)/) ||
      lowerQuery.match(/(\w+(?:\s+\w+)?)\s+(?:has|have)\s+(?:never|not|n't)\s+(?:contacted|called|reached|noted)/) ||
      // Positive: "contacted by <name>", "contacted by <name> this week"
      lowerQuery.match(/(?:contacted|noted|called|reached)\s+by\s+(\w+(?:\s+\w+)?)(?:\s+(?:this|last|today|yesterday|in|within)|$)/);
    if (authorMatch) authorName = authorMatch[1].trim();

    // Build author-scoped note indexes if author detected
    let authorContactedIds: Set<number> | null = null;
    let authorLatestNoteByCustomer: Map<number, { time: number }> | null = null;
    if (authorName && notes.length > 0) {
      // Build the candidate list robustly — the captured `authorName` is usually the first name
      // after `resolveUserReferences`, but notes may have CreatedBy as the unresolved email,
      // the resolved display name, or the short UPN depending on whether
      // UserTradeUnitSnapshot had a row for this user. Match against all forms.
      const authorCandidates = this.buildAuthorCandidates(authorName, currentUserDisplayName, currentUserUsername);
      const parseUtc = (ts: string | Date) => {
        const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
        return new Date(raw).getTime();
      };
      // Index notes by code for author-filtered lookups (matching linked producer logic)
      const authorNoteTimeByCode = new Map<string, number>();
      for (const n of notes) {
        const createdByMatch = this.matchesAuthor(n.createdBy, authorCandidates);
        const modifiedByMatch = this.matchesAuthor(n.modifiedBy, authorCandidates);
        if (!createdByMatch && !modifiedByMatch) continue;
        if (!n.customerCode) continue;
        const time = parseUtc(n.createdAt);
        const existing = authorNoteTimeByCode.get(n.customerCode);
        if (!existing || time > existing) authorNoteTimeByCode.set(n.customerCode, time);
      }
      authorContactedIds = new Set<number>();
      authorLatestNoteByCustomer = new Map<number, { time: number }>();
      // Resolve via bidirectional linked producers (same as main index)
      const incomingCodeLinks = new Map<string, Set<string>>();
      for (const c of customers) {
        if (!c.scoularId) continue;
        for (const linkedCode of (c.linkedProducerIds || [])) {
          if (!incomingCodeLinks.has(linkedCode)) incomingCodeLinks.set(linkedCode, new Set());
          incomingCodeLinks.get(linkedCode)!.add(c.scoularId);
        }
      }
      for (const customer of customers) {
        const allCodes = new Set<string>();
        if (customer.scoularId) allCodes.add(customer.scoularId);
        for (const linkedCode of (customer.linkedProducerIds || [])) allCodes.add(linkedCode);
        for (const incomingCode of (incomingCodeLinks.get(customer.scoularId || '') || new Set<string>())) {
          allCodes.add(incomingCode);
        }
        let latest = 0;
        for (const code of allCodes) {
          const t = authorNoteTimeByCode.get(code);
          if (t && t > latest) latest = t;
        }
        if (latest > 0) {
          authorContactedIds.add(customer.id);
          authorLatestNoteByCustomer.set(customer.id, { time: latest });
        }
      }
    }

    if (isNotContactedQuery) {
      const notContactedMatch = lowerQuery.match(
        /(?:not contacted|no contact|not called|no call|haven'?t (?:called|contacted|reached)|not spoken|not contacted in|contacted over)\s*(?:in|for|within)?\s*(?:the\s+)?(?:last|past)?\s*(?:over\s+)?(\d+)\s*days?/
      ) || lowerQuery.match(/(\d+)\s*days?\s*(?:ago)?\s*(?:not\s+contacted|no\s+contact|without\s+contact)/);
      if (notContactedMatch) {
        const cutoffTime = Date.now() - parseInt(notContactedMatch[1]) * 86400000;
        const mapToUse = authorLatestNoteByCustomer || latestNoteByCustomer;
        result = result.filter(c => {
          const entry = mapToUse.get(c.id);
          return !entry || entry.time < cutoffTime;
        });
      } else if (lowerQuery.includes('never contacted') || lowerQuery.includes('no contact history')) {
        const contactedSet = authorContactedIds || customerIdsWithNotes;
        result = result.filter(c => !contactedSet.has(c.id));
      }
      return result;
    }

    // Recently contacted — helper to filter by cutoff.
    // Uses author-scoped map if an author was detected (e.g., "contacted by Caden this week"),
    // otherwise uses the global contact map (any author).
    const mapToUse = authorLatestNoteByCustomer || latestNoteByCustomer;
    const filterByCutoff = (days: number) => {
      const cutoffTime = Date.now() - days * 86400000;
      result = result.filter(c => {
        const entry = mapToUse.get(c.id);
        return !!entry && entry.time >= cutoffTime;
      });
    };

    const recentlyContactedMatch = lowerQuery.match(/contacted\s*(?:in|within)?\s*(?:the)?\s*(?:last|past)?\s*(\d+)\s*days?/);
    if (recentlyContactedMatch) {
      filterByCutoff(parseInt(recentlyContactedMatch[1]));
    } else if (lowerQuery.includes('recently contacted') || lowerQuery.includes('contacted recently')) {
      filterByCutoff(14);
    }

    // Time-based contact filters — use loose matching (contacted ... today/this week/etc.)
    // to handle resolved user references like "contacted by Caden this week"
    const hasContacted = lowerQuery.includes('contacted') || lowerQuery.includes('called') || lowerQuery.includes('reached');
    if (hasContacted && (lowerQuery.includes('today') || lowerQuery.includes('list of contacted today'))) {
      filterByCutoff(1);
    }

    if (hasContacted && lowerQuery.includes('yesterday')) {
      filterByCutoff(2);
    }

    if (hasContacted && (lowerQuery.includes('this week') || lowerQuery.includes('last week'))) {
      filterByCutoff(7);
    }

    if (hasContacted && (lowerQuery.includes('this month') || lowerQuery.includes('last month'))) {
      filterByCutoff(30);
    }

    // "notes added/made/entered/written/created/left ..." — same data as contacted,
    // expressed from the note-author's perspective. Mirrors the contacted-* matchers above.
    const hasNoteVerb = /notes?\s+(?:added|made|entered|written|created|left)/.test(lowerQuery);
    if (hasNoteVerb) {
      const numericMatch = lowerQuery.match(/notes?\s+(?:added|made|entered|written|created|left)\s*(?:in|within)?\s*(?:the\s+)?(?:last|past)?\s*(\d+)\s*days?/);
      if (numericMatch) {
        filterByCutoff(parseInt(numericMatch[1]));
      } else if (lowerQuery.includes('today')) {
        filterByCutoff(1);
      } else if (lowerQuery.includes('yesterday')) {
        filterByCutoff(2);
      } else if (lowerQuery.includes('this week') || lowerQuery.includes('last week')) {
        filterByCutoff(7);
      } else if (lowerQuery.includes('this month') || lowerQuery.includes('last month')) {
        filterByCutoff(30);
      }
    }

    return result;
  }

  // ============================================================
  // NOTE FILTERS (pinned, content search)
  // ============================================================

  private applyNoteFilters(lowerQuery: string, result: Customer[], notes: Note[], allCustomers: Customer[] = result, currentUserDisplayName?: string, currentUserUsername?: string): Customer[] {
    // "Customers with notes" — broad boolean (has any note)
    if (/(?:with|has|have)\s+notes?\b/.test(lowerQuery) &&
        !this._isNoteSearchQuery(lowerQuery) &&
        !lowerQuery.includes('no note') && !lowerQuery.includes('without note')) {
      const customersWithNotes = new Set<number>(notes.map(n => n.customerId));
      result = result.filter(c => customersWithNotes.has(c.id));
    }

    // Pinned notes
    if (lowerQuery.includes('pinned note') || lowerQuery.includes('with pinned') || lowerQuery.includes('has pinned')) {
      const customersWithPinned = new Set<number>(
        notes.filter(n => n.isPinned).map(n => n.customerId)
      );
      result = result.filter(c => customersWithPinned.has(c.id));
    }

    // ── Note author/modifier search ──────────────────────────────────
    // Matches: "notes by Caden", "everyone Caden has noted", "customers Caden contacted",
    //   "notes entered by John", "notes created by Smith", "who has Caden noted",
    //   "show me everyone Caden has entered a note for", "notes modified by Jane"
    let noteAuthor: string | null = null;

    const authorPatterns = [
      // "notes by <name>", "notes entered/created/placed by <name>",
      // "customers with notes created by <name>"
      /note(?:s)?\s+(?:entered|created|added|written|made|left|placed|from|by)\s+(?:by\s+)?(.+?)(?:\s+(?:for|about|in|from|and)\s|$)/,
      // "everyone/customers <name> has noted/contacted/entered/placed a note"
      /(?:everyone|customers?|producers?|growers?|farmers?)\s+(\w+(?:\s+\w+)?)\s+(?:has|have)\s+(?:entered|placed|created|added|written|left|made)\s+(?:a\s+)?note/,
      /(?:everyone|customers?|producers?|growers?|farmers?)\s+(\w+(?:\s+\w+)?)\s+(?:has|have)\s+(?:noted|contacted|called|reached)/,
      // "who has <name> noted/contacted/entered"
      /who\s+(?:has|have)\s+(\w+(?:\s+\w+)?)\s+(?:noted|contacted|called|reached|entered|placed)/,
      // "show me everyone <name> has entered/placed a note for"
      /(?:show|find|list|get)\s+(?:me\s+)?(?:everyone|all|customers?)\s+(\w+(?:\s+\w+)?)\s+(?:has|have)\s+(?:entered|created|added|written|left|made|placed)/,
      // "<name>'s notes", "<name>'s customers"
      /(\w+(?:\s+\w+)?)[''\u2019]s\s+(?:notes?|customers?|contacts?)/,
      // "notes modified/updated/edited by <name>"
      /note(?:s)?\s+(?:modified|updated|edited)\s+by\s+(.+?)(?:\s+(?:for|about|in|from|and)\s|$)/,
      // "contacted/noted/placed by <name>"
      /(?:contacted|noted|called|reached|placed|entered|written)\s+by\s+(.+?)(?:\s+(?:for|about|in|from|and)\s|$)/,
    ];

    for (const pattern of authorPatterns) {
      const match = lowerQuery.match(pattern);
      if (match) {
        noteAuthor = match[1].trim();
        break;
      }
    }

    if (noteAuthor) {
      // Match against the full set of identity forms (resolved first name + display name +
      // username + UPN prefix). Notes whose CreatedBy was left as the unresolved email when
      // UserTradeUnitSnapshot had no row for this user still get caught.
      const authorCandidates = this.buildAuthorCandidates(noteAuthor, currentUserDisplayName, currentUserUsername);
      const customersWithAuthorNotes = new Set<number>();
      for (const n of notes) {
        const createdByMatch = this.matchesAuthor(n.createdBy, authorCandidates);
        const modifiedByMatch = this.matchesAuthor(n.modifiedBy, authorCandidates);
        if (createdByMatch || modifiedByMatch) {
          customersWithAuthorNotes.add(n.customerId);
        }
      }
      result = result.filter(c => customersWithAuthorNotes.has(c.id));
    }

    // Note content search — multiple trigger patterns:
    //   "notes about beans in the bin"
    //   "notes mentioning 75000"
    //   "whose notes say grain"
    //   "note search: beans"
    //   "search notes for beans in the bin"
    //   "notes with beans and corn"
    //
    // The search term is captured GREEDILY to end-of-string so phrases like
    // "beans and corn in the bin" aren't truncated. The note search clause
    // should be the last meaningful part of the query.
    let searchTerm: string | null = null;

    // Pattern 1: "notes about/mentioning/containing/with/saying <term...>"
    const noteContentMatch = lowerQuery.match(
      /note(?:s)?\s*(?:about|mentioning|containing|with|saying|that\s+(?:say|mention|include|contain))\s+(.+)$/
    );
    if (noteContentMatch) searchTerm = noteContentMatch[1].trim();

    // Pattern 2: "search notes for <term...>" / "note search: <term...>"
    if (!searchTerm) {
      const searchNotesMatch = lowerQuery.match(/(?:search\s+notes?\s+for|note\s*search\s*:?\s*)(.+)$/);
      if (searchNotesMatch) searchTerm = searchNotesMatch[1].trim();
    }

    // Pattern 3: "whose notes say/mention <term...>"
    if (!searchTerm) {
      const whoseNotesMatch = lowerQuery.match(/whose\s+notes?\s+(?:say|mention|include|contain|reference)\s+(.+)$/);
      if (whoseNotesMatch) searchTerm = whoseNotesMatch[1].trim();
    }

    if (searchTerm) {
      // Pre-index notes by customer for O(notes) build, O(1) lookup
      const notesByCustomer = new Map<number, string[]>();
      for (const n of notes) {
        const arr = notesByCustomer.get(n.customerId);
        const lower = n.content.toLowerCase();
        if (arr) arr.push(lower); else notesByCustomer.set(n.customerId, [lower]);
      }

      // Build linked-producer map from ALL customers (not just filtered result) so
      // linked producers that were filtered out by earlier filters can still be resolved.
      const sourceIdToNumericId = new Map<string, number>();
      for (const c of allCustomers) {
        if (c.scoularId) sourceIdToNumericId.set(c.scoularId, c.id);
      }

      // Extract keywords from the search term (3+ chars to skip stop words like
      // "in", "the", "a", "of"). Substring matching handles plurals naturally
      // (e.g., "bin" matches "bins", "bean" matches "beans").
      const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'her', 'his', 'its', 'was', 'one', 'our', 'out', 'had', 'how', 'who', 'did', 'get', 'let', 'say', 'she', 'too', 'use', 'that', 'this', 'with', 'from', 'they', 'been', 'have', 'said', 'each', 'than', 'them', 'then', 'what', 'when', 'will', 'into', 'some', 'about', 'their', 'which', 'would', 'there', 'these', 'other']);
      const keywords = searchTerm.split(/\s+/)
        .filter(w => w.length >= 3 && !stopWords.has(w));

      // If no meaningful keywords remain, fall back to full phrase match
      const useKeywordMatch = keywords.length > 0;

      result = result.filter(c => {
        // Collect note content from this customer + their linked producers
        const allNoteTexts: string[] = [];
        const own = notesByCustomer.get(c.id);
        if (own) allNoteTexts.push(...own);

        // Include linked producer notes
        if (c.linkedProducerIds?.length) {
          for (const linkedSourceId of c.linkedProducerIds) {
            const linkedNumericId = sourceIdToNumericId.get(linkedSourceId);
            if (linkedNumericId && linkedNumericId !== c.id) {
              const linked = notesByCustomer.get(linkedNumericId);
              if (linked) allNoteTexts.push(...linked);
            }
          }
        }

        if (allNoteTexts.length === 0) return false;
        const allContent = allNoteTexts.join(' ');

        if (useKeywordMatch) {
          // ALL keywords must appear somewhere in the customer's notes (substring match)
          return keywords.every(kw => allContent.includes(kw));
        }
        // Fallback: exact phrase match for very short search terms
        return allContent.includes(searchTerm!);
      });
    }

    return result;
  }

  /**
   * Supplementary note keyword search — extracts meaningful keywords from ANY query
   * and returns customer IDs whose notes contain ALL of them.
   * Used after pattern-based filtering to merge in note-matched customers.
   */
  private _findCustomersByNoteKeywords(lowerQuery: string, notes: Note[], allCustomers: Customer[]): Set<number> {
    const matched = new Set<number>();

    // Strip NLQ structural words that are part of query syntax, not search content
    const structuralWords = new Set([
      // Query verbs/prepositions
      'show', 'find', 'list', 'get', 'give', 'pull', 'search', 'look',
      'customers', 'customer', 'producers', 'producer', 'growers', 'grower',
      'farmers', 'farmer', 'who', 'that', 'have', 'has', 'with', 'without',
      'more', 'less', 'than', 'over', 'under', 'above', 'below',
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
      'was', 'one', 'our', 'out', 'had', 'how', 'did', 'let', 'say',
      'she', 'too', 'use', 'been', 'said', 'each', 'them', 'then',
      'what', 'when', 'will', 'into', 'some', 'about', 'their', 'which',
      'would', 'there', 'these', 'other', 'from', 'they', 'this',
      // NLQ-specific
      'active', 'contracts', 'contract', 'deliveries', 'delivery', 'delivered',
      'tickets', 'ticket', 'planting', 'planted', 'storage', 'stored', 'contacted',
      'acres', 'bushels', 'days', 'ago', 'last', 'past', 'recently', 'never',
      'notes', 'note', 'mentioning', 'containing', 'saying',
    ]);

    // Extract meaningful keywords (4+ chars, not structural)
    const keywords = lowerQuery.split(/\s+/)
      .filter(w => w.length >= 4 && !structuralWords.has(w))
      // Remove pure numbers (already handled by quantity filters)
      .filter(w => !/^\d+$/.test(w));

    if (keywords.length === 0) return matched;

    // Pre-index notes by customer (including linked producers)
    const sourceIdToNumericId = new Map<string, number>();
    for (const c of allCustomers) {
      if (c.scoularId) sourceIdToNumericId.set(c.scoularId, c.id);
    }

    const noteContentByCustomer = new Map<number, string>();
    for (const n of notes) {
      const existing = noteContentByCustomer.get(n.customerId) || '';
      noteContentByCustomer.set(n.customerId, existing + ' ' + n.content.toLowerCase());
    }

    for (const c of allCustomers) {
      // Collect this customer's notes + linked producer notes
      let allContent = noteContentByCustomer.get(c.id) || '';
      if (c.linkedProducerIds?.length) {
        for (const linkedSourceId of c.linkedProducerIds) {
          const linkedId = sourceIdToNumericId.get(linkedSourceId);
          if (linkedId && linkedId !== c.id) {
            const linkedContent = noteContentByCustomer.get(linkedId);
            if (linkedContent) allContent += ' ' + linkedContent;
          }
        }
      }

      if (!allContent.trim()) continue;

      // Customer matches if ALL keywords appear in their notes (substring match)
      if (keywords.every(kw => allContent.includes(kw))) {
        matched.add(c.id);
      }
    }

    return matched;
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

    // --- Storage duration: "stored for over 60 days", "grain in storage over 90 days" ---
    const storageDaysMatch = lowerQuery.match(/(?:stored|storage|in storage)\s*(?:for\s+)?(?:over|more than|longer than)\s*(\d+)\s*days/);
    if (storageDaysMatch) {
      const minDays = parseInt(storageDaysMatch[1]);
      const ids = new Set<number>(
        storedGrain.filter(s => {
          // Use storageDays from ODS if available, otherwise calculate from storageStartDate
          if (s.storageDays != null && s.storageDays > 0) {
            return s.storageDays >= minDays;
          }
          const d = this.parseDate(s.storageStartDate);
          return d && d.getTime() < (Date.now() - minDays * 86400000);
        }).map(s => s.customerId)
      );
      result = result.filter(c => ids.has(c.id));
    }

    // --- Storage cost threshold: "storage cost over $500" ---
    const storageCostMatch = lowerQuery.match(/storage\s*cost\s*(?:over|above|more than|exceeding)\s*\$?([\d,]+(?:k)?)/);
    if (storageCostMatch) {
      const minCost = this.parseQuantity(storageCostMatch[1]);
      const customerCosts = new Map<number, number>();
      for (const sg of storedGrain) {
        customerCosts.set(sg.customerId, (customerCosts.get(sg.customerId) || 0) + sg.receivableAmount);
      }
      const ids = new Set(
        [...customerCosts.entries()].filter(([_, cost]) => cost >= minCost).map(([id]) => id)
      );
      result = result.filter(c => ids.has(c.id));
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

    // Specific crop planting — supports OR: "planting corn or soybeans"
    const plantingCrops: string[] = [];
    for (const crop of this.grainCrops) {
      if (lowerQuery.includes(`planting ${crop}`) || lowerQuery.includes(`growing ${crop}`) ||
          lowerQuery.includes(`plant ${crop}`) || lowerQuery.includes(`plans to plant ${crop}`) ||
          lowerQuery.includes(`${crop} planting`) || lowerQuery.includes(`${crop} this season`)) {
        plantingCrops.push(crop);
      }
    }
    if (plantingCrops.length > 0) {
      const ids = new Set<number>(
        filteredIntentions
          .filter(p => plantingCrops.some(crop => this.matchesCommodity(p.crop, crop)))
          .map(p => p.customerId)
      );
      result = result.filter(c => ids.has(c.id));
    }

    // General planting (has any planting intention) — skip if query is asking for NO planting
    const isNoPlanting = lowerQuery.includes('no planting') || lowerQuery.includes('without planting') ||
                         lowerQuery.includes('not planting') || lowerQuery.includes('no plans to plant');
    if (!isNoPlanting && (lowerQuery.includes('planting intention') || lowerQuery.includes('planting plan') ||
        lowerQuery.includes('planning to plant') || lowerQuery.includes('plans to grow'))) {
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
    // Open contracts (closedDate is null) — matches the home page / customer profile contracts tab.
    // Status-specific queries (fulfilled, cancelled) use the full set which includes recent closed contracts.
    const openByCustomer = new Map<string, Contract[]>();
    const allByCustomer = new Map<string, Contract[]>();
    for (const c of contracts) {
      if (!c.ctrmCustomerId) continue;
      // Full set (open + recent closed from API)
      const allArr = allByCustomer.get(c.ctrmCustomerId) || [];
      allArr.push(c);
      allByCustomer.set(c.ctrmCustomerId, allArr);
      // Open only (no closedDate)
      if (!c.closedDate) {
        const openArr = openByCustomer.get(c.ctrmCustomerId) || [];
        openArr.push(c);
        openByCustomer.set(c.ctrmCustomerId, openArr);
      }
    }

    const getOpenContracts = (c: Customer): Contract[] =>
      c.scoularId ? openByCustomer.get(c.scoularId) ?? [] : [];
    const getAllContracts = (c: Customer): Contract[] =>
      c.scoularId ? allByCustomer.get(c.scoularId) ?? [] : [];

    // --- No active contracts ---
    const isCrossEntityNoContract = lowerQuery.includes('planting') && (lowerQuery.includes('no contract') || lowerQuery.includes('no active contract'));
    if (!isCrossEntityNoContract &&
        (lowerQuery.includes('no active contract') || lowerQuery.includes('no contract') ||
         lowerQuery.includes('without contract') || lowerQuery.includes('no contracts'))) {
      result = result.filter(c => getOpenContracts(c).length === 0);
    }

    // --- Has contracts (open = no closedDate, same as home page) ---
    const isActiveContractQuery = lowerQuery.includes('active contract');
    const isGenericContractQuery =
      lowerQuery.includes('with contract') ||
      lowerQuery.includes('have contract') ||
      lowerQuery.includes('has contract');
    if ((isActiveContractQuery || isGenericContractQuery) &&
        !lowerQuery.includes('no active') && !lowerQuery.includes('no contract') && !lowerQuery.includes('without contract')) {
      if (isActiveContractQuery) {
        // "active contract" must literally mean status = Active — anything else
        // (Pending, Overdue, Fulfilled, Cancelled) doesn't qualify even though the
        // contract may still be open.
        result = result.filter(c => getOpenContracts(c).some(ct => ct.status === 'Active'));
      } else {
        // "with contract / have contract / has contract" — any open contract regardless
        // of status.
        result = result.filter(c => getOpenContracts(c).length > 0);
      }
    }

    // --- Unsigned contracts (within active) ---
    if (lowerQuery.includes('unsigned contract') || lowerQuery.includes('not signed')) {
      result = result.filter(c =>
        getOpenContracts(c).some(ct => !ct.signed)
      );
    }

    // --- Status-specific filters (use full set) ---
    if (lowerQuery.includes('fulfilled contract') || lowerQuery.includes('completed contract')) {
      result = result.filter(c =>
        getAllContracts(c).some(ct => ct.status === 'Fulfilled')
      );
    }
    if (lowerQuery.includes('cancelled contract') || lowerQuery.includes('canceled contract')) {
      result = result.filter(c =>
        getAllContracts(c).some(ct => ct.status === 'Cancelled')
      );
    }
    if (lowerQuery.includes('overdue contract') || lowerQuery.includes('past due contract') ||
        (lowerQuery.includes('overdue') && !lowerQuery.includes('deliver'))) {
      result = result.filter(c =>
        getAllContracts(c).some(ct => ct.status === 'Overdue')
      );
    }
    if (lowerQuery.includes('pending contract')) {
      result = result.filter(c =>
        getOpenContracts(c).some(ct => ct.status === 'Pending')
      );
    }

    // --- Customer confirmation status (within active) ---
    if (lowerQuery.includes('unconfirmed contract') || lowerQuery.includes('unconfirmed') ||
        (lowerQuery.includes('not confirmed') && lowerQuery.includes('contract'))) {
      result = result.filter(c =>
        getOpenContracts(c).some(ct =>
          ct.customerConfirmStatus != null && ct.customerConfirmStatus !== 'Confirmed'
        )
      );
    } else if (lowerQuery.includes('confirmed contract') || lowerQuery.includes('customer confirmed')) {
      result = result.filter(c =>
        getOpenContracts(c).some(ct => ct.customerConfirmStatus === 'Confirmed')
      );
    }

    // --- Unpriced contracts (within active) ---
    if (lowerQuery.includes('unpriced') || lowerQuery.includes('not priced') ||
        lowerQuery.includes('not fully priced') || lowerQuery.includes('needs pricing') ||
        lowerQuery.includes('need to price') || lowerQuery.includes('open price') ||
        lowerQuery.includes('unprice') || lowerQuery.includes('deferred') ||
        lowerQuery.includes('without a price') || lowerQuery.includes('no price')) {
      result = result.filter(c =>
        getOpenContracts(c).some(ct =>
          ct.priceTypeCode === 'U' || ct.priceTypeCode === 'D' ||
          (!ct.pricedQuantity || ct.pricedQuantity < (ct.quantity || 0))
        )
      );
    }

    // Fully priced / priced contracts
    if ((lowerQuery.includes('fully priced') || lowerQuery.includes('all priced') ||
         lowerQuery.includes('priced contract')) &&
        !lowerQuery.includes('not ') && !lowerQuery.includes('un')) {
      result = result.filter(c =>
        getOpenContracts(c).some(ct =>
          ct.priceTypeCode === 'P' ||
          (ct.pricedQuantity && ct.pricedQuantity >= (ct.quantity || 0))
        )
      );
    }

    // --- Contract quantity threshold ---
    const contractQtyMatch = lowerQuery.match(/contract(?:ed|s)?\s*(?:more than|over|above|exceeding|at least)\s*([\d,]+)\s*(?:bushels?|bu)/);
    const contractQtyMatch2 = lowerQuery.match(/(?:more than|over|above)\s*([\d,]+)\s*(?:bushels?|bu)\s*(?:under\s+)?contract/);
    const contractQty = contractQtyMatch?.[1] || contractQtyMatch2?.[1];
    if (contractQty) {
      const minQty = this.parseQuantity(contractQty);
      result = result.filter(c => {
        const total = getOpenContracts(c).reduce((sum, ct) => sum + (ct.quantity || 0), 0);
        return total >= minQty;
      });
    }

    // --- Contract value threshold ---
    const contractValueMatch = lowerQuery.match(/contract\s*(?:value|worth)\s*(?:over|above|more than|exceeding)\s*\$?([\d,]+)/);
    if (contractValueMatch) {
      const minValue = this.parseQuantity(contractValueMatch[1]);
      result = result.filter(c => {
        const total = getOpenContracts(c).reduce((sum, ct) => sum + (ct.totalValue || 0), 0);
        return total >= minValue;
      });
    }

    // --- Contract price threshold ---
    // "target price over $X" is a grain-on-farm target, handled above — don't also read it as a
    // contract flat-price filter (the word "price" would otherwise match here too).
    const isTargetPriceQuery = lowerQuery.includes('target');
    const contractPriceOverMatch = isTargetPriceQuery ? null : lowerQuery.match(/(?:contract\s*)?price\s*(?:over|above|more than)\s*\$?([\d.]+)/);
    if (contractPriceOverMatch) {
      const minPrice = parseFloat(contractPriceOverMatch[1]);
      result = result.filter(c =>
        getOpenContracts(c).some(ct => (ct.price || 0) >= minPrice)
      );
    }
    const contractPriceUnderMatch = isTargetPriceQuery ? null : lowerQuery.match(/(?:contract\s*)?price\s*(?:below|under|less than)\s*\$?([\d.]+)/);
    if (contractPriceUnderMatch) {
      const maxPrice = parseFloat(contractPriceUnderMatch[1]);
      result = result.filter(c =>
        getOpenContracts(c).some(ct => ct.price != null && ct.price > 0 && ct.price <= maxPrice)
      );
    }

    // --- Contract delivery date window ---
    if (lowerQuery.includes('contracts expiring') || lowerQuery.includes('contracts ending')) {
      if (lowerQuery.includes('this month') || lowerQuery.includes('soon')) {
        const now = new Date();
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        result = result.filter(c =>
          getOpenContracts(c).some(ct => {
            const end = this.parseDate(ct.deliveryEnd);
            return end && end >= now && end <= endOfMonth;
          })
        );
      } else if (lowerQuery.includes('next month')) {
        const now = new Date();
        const startNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const endNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        result = result.filter(c =>
          getOpenContracts(c).some(ct => {
            const end = this.parseDate(ct.deliveryEnd);
            return end && end >= startNextMonth && end <= endNextMonth;
          })
        );
      }
    }

    // --- Commodity-specific contracts — supports OR: "corn or soybeans contracts" ---
    const contractCrops: string[] = [];
    for (const commodity of this.grainCrops) {
      if (lowerQuery.includes(`${commodity} contract`) || lowerQuery.includes(`contracts for ${commodity}`) ||
          lowerQuery.includes(`contract ${commodity}`) ||
          lowerQuery.includes(`sell ${commodity}`) || lowerQuery.includes(`selling ${commodity}`) ||
          lowerQuery.includes(`sold ${commodity}`) || lowerQuery.includes(`market ${commodity}`) ||
          lowerQuery.includes(`marketing ${commodity}`)) {
        contractCrops.push(commodity);
      }
    }
    if (contractCrops.length > 0) {
      result = result.filter(c =>
        getOpenContracts(c).some(ct =>
          contractCrops.some(crop =>
            this.matchesCommodity(ct.commodityDescription, crop) ||
            this.matchesCommodity(ct.commodityCode, crop)
          )
        )
      );
    }

    // --- Crop year filter: "crop year 2026", "CY2025", "2026 crop year" ---
    const cropYearMatch = lowerQuery.match(/(?:crop\s*year\s*|cy\s*)(\d{4})|(\d{4})\s*crop\s*year/i);
    if (cropYearMatch) {
      const year = parseInt(cropYearMatch[1] || cropYearMatch[2]);
      if (!isNaN(year)) {
        result = result.filter(c =>
          getOpenContracts(c).some(ct => ct.cropYear === year)
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
        const total = getOpenContracts(c).reduce((sum, ct) => sum + (ct.openBalanceQuantity || 0), 0);
        return total >= minBal;
      });
    }

    // "has open balance", "with unshipped bushels" (boolean — any open balance > 0)
    const hasOpenBal = /(?:has|have|with)\s+(?:an?\s+)?(?:open\s*balance|unshipped\s*bushels?|remaining\s*bushels?)/i.test(lowerQuery);
    const noOpenBal = /(?:no|without|zero)\s+(?:open\s*balance|unshipped\s*bushels?|remaining\s*bushels?)/i.test(lowerQuery);
    if (hasOpenBal && !noOpenBal && !openBalThreshold) {
      result = result.filter(c =>
        getOpenContracts(c).some(ct => (ct.openBalanceQuantity || 0) > 0)
      );
    }
    if (noOpenBal) {
      result = result.filter(c =>
        !getOpenContracts(c).some(ct => (ct.openBalanceQuantity || 0) > 0)
      );
    }

    // --- Delivery fulfillment ratio: "less than 50% delivered", "over 80% fulfilled", "half delivered" ---
    const fulfillPctMatch = lowerQuery.match(/(?:less than|under|below)\s*(\d+)\s*%\s*(?:delivered|fulfilled|complete)/);
    const fulfillPctOverMatch = lowerQuery.match(/(?:more than|over|above|at least)\s*(\d+)\s*%\s*(?:delivered|fulfilled|complete)/);
    const halfDeliveredMatch = lowerQuery.includes('half delivered') || lowerQuery.includes('half fulfilled');
    if (fulfillPctMatch || fulfillPctOverMatch || halfDeliveredMatch) {
      const threshold = halfDeliveredMatch ? 50
        : fulfillPctMatch ? parseFloat(fulfillPctMatch[1])
        : parseFloat(fulfillPctOverMatch![1]);
      const isUnder = !!fulfillPctMatch || halfDeliveredMatch;
      result = result.filter(c => {
        const cContracts = getOpenContracts(c).filter(ct =>
          ct.status === 'Active' || ct.status === 'Pending' || ct.status === 'Overdue'
        );
        if (cContracts.length === 0) return false;
        const totalQty = cContracts.reduce((s, ct) => s + (ct.quantity || 0), 0);
        if (totalQty === 0) return false;
        const openBal = cContracts.reduce((s, ct) => s + (ct.openBalanceQuantity || 0), 0);
        const deliveredPct = ((totalQty - openBal) / totalQty) * 100;
        return isUnder ? deliveredPct < threshold : deliveredPct >= threshold;
      });
    }

    // --- Contract booked date: "booked this year", "contracted since January", "booked in 2025" ---
    const bookedThisYearMatch = /(?:booked|contracted)\s*(?:this\s+year|in\s+\d{4})/i.test(lowerQuery);
    if (bookedThisYearMatch) {
      const yearMatch = lowerQuery.match(/(?:booked|contracted)\s*in\s*(\d{4})/i);
      const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
      result = result.filter(c =>
        getOpenContracts(c).some(ct => {
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
          getOpenContracts(c).some(ct => {
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
                         lowerQuery.includes('below') || lowerQuery.includes('slower') ||
                         lowerQuery.includes('down');
      const today = new Date();
      const samePointLastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
      result = result.filter(c => {
        const cContracts = getOpenContracts(c);
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

  private applyTicketFilters(lowerQuery: string, result: Customer[], tickets: Ticket[], contracts: Contract[] = []): Customer[] {
    // Build customerCode -> tickets map for efficient lookups
    const ticketsByCustomer = new Map<string, Ticket[]>();
    for (const t of tickets) {
      if (!t.customerCode) continue;
      const existing = ticketsByCustomer.get(t.customerCode) || [];
      existing.push(t);
      ticketsByCustomer.set(t.customerCode, existing);
    }

    const getCustomerTickets = (c: Customer): Ticket[] =>
      c.scoularId ? ticketsByCustomer.get(c.scoularId) ?? [] : [];

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

    // --- Delivered specific commodity — supports OR: "delivered corn or soybeans" ---
    const deliveryCropsFound: string[] = [];
    for (const crop of this.grainCrops) {
      // Use .includes() instead of RegExp to avoid regex injection risk
      if (lowerQuery.includes(`delivered ${crop}`) || lowerQuery.includes(`hauled ${crop}`) ||
          lowerQuery.includes(`delivery ${crop}`) || lowerQuery.includes(`deliveries ${crop}`) ||
          lowerQuery.includes(`${crop} deliver`) || lowerQuery.includes(`${crop} ticket`)) {
        deliveryCropsFound.push(crop);
      }
    }
    if (deliveryCropsFound.length > 0) {
      result = result.filter(c =>
        getCustomerTickets(c).some(t =>
          deliveryCropsFound.some(crop => this.matchesCommodity(t.productCode, crop))
        )
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
    // Matches "delivered this year" AND "delivered corn this year" (crop may appear between verb and "this year")
    const deliveredThisYear =
      /deliver(?:ed|ies|y)?\s*(?:this|in\s+(?:the\s+)?current)\s*year/.test(lowerQuery) ||
      (/deliver(?:ed|ies|y)?/.test(lowerQuery) && /(?:this|current)\s*year/.test(lowerQuery));
    if (deliveredThisYear) {
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

    // --- Ticket type (purchase/inbound only — S and L ticket types are not loaded) ---
    if (lowerQuery.includes('purchase ticket') || lowerQuery.includes('inbound ticket') ||
        lowerQuery.includes('inbound delivery') || lowerQuery.includes('inbound deliveries')) {
      result = result.filter(c =>
        getCustomerTickets(c).some(t => t.ticketType === 'P' || t.ticketType === 'U')
      );
    }

    // --- Applied/unapplied tickets ---
    // Build set of open contract IDs (no closedDate) — applied tickets should only count
    // if they match an open contract, since the customer profile only shows open contracts.
    const openContractIds = new Set<string>(
      contracts.filter(c => !c.closedDate && c.sourceContractId).map(c => c.sourceContractId!)
    );
    const isTicketAppliedToOpenContract = (t: Ticket) =>
      t.isApplied && !!t.ctrmContractNumber && openContractIds.has(t.ctrmContractNumber);

    if (lowerQuery.includes('unapplied ticket') || lowerQuery.includes('unmatched ticket') ||
        lowerQuery.includes('tickets not applied') || lowerQuery.includes('unapplied')) {
      // Use the server-provided isApplied flag directly — true unapplied tickets
      // (no ctrmContractNumber or isApplied=false), not affected by contract filtering.
      result = result.filter(c =>
        getCustomerTickets(c).some(t => !t.isApplied)
      );
    }
    if (lowerQuery.includes('applied ticket') && !lowerQuery.includes('unapplied')) {
      // Only count tickets as "applied" if they're matched to an open contract.
      // The server-provided isApplied flag may be true for tickets on closed contracts,
      // but those contracts aren't loaded anymore so the customer would appear to have
      // no contracts when viewed on the profile.
      result = result.filter(c =>
        getCustomerTickets(c).some(t => isTicketAppliedToOpenContract(t))
      );
    }

    // --- Settled/unsettled tickets ---
    if (lowerQuery.includes('unsettled ticket') || lowerQuery.includes('not settled') ||
        lowerQuery.includes('unsettled delivery') || lowerQuery.includes('unsettled deliveries')) {
      result = result.filter(c =>
        getCustomerTickets(c).some(t => !t.finalSettledDate)
      );
    }
    if ((lowerQuery.includes('settled ticket') || lowerQuery.includes('final settled')) &&
        !lowerQuery.includes('unsettled')) {
      result = result.filter(c =>
        getCustomerTickets(c).some(t => !!t.finalSettledDate)
      );
    }

    return result;
  }

  // ============================================================
  // RANKING FILTER (top/bottom/largest/smallest)
  // ============================================================

  private applyRankingFilters(
    lowerQuery: string,
    result: Customer[],
    contracts?: Contract[],
    tickets?: Ticket[],
    plantingIntentions?: PlantingIntention[],
    storedGrain?: StoredGrain[],
    notes?: Note[]
  ): Customer[] {
    const topMatch = lowerQuery.match(/top\s*(\d+)/);
    const bottomMatch = lowerQuery.match(/(?:bottom|smallest)\s*(\d+)/);
    // A bare "top … by …" (no count) is still a ranking — e.g. the "Top by grain on farm"
    // prompt. Without this it fell through unsorted, so a smaller total could sit above a larger.
    const bareTop = /\btop\b/.test(lowerQuery) && /\bby\b/.test(lowerQuery) && !topMatch;
    const isTop = !!topMatch || bareTop || lowerQuery.includes('largest') || lowerQuery.includes('biggest');
    const isBottom = !!bottomMatch || (lowerQuery.includes('smallest') && !topMatch);

    if (!isTop && !isBottom) return result;
    // Explicit count wins; a bare "top … by …" defaults to 25 (matches the "Top 25 …" prompts);
    // other countless rankings (largest/biggest) keep the historical default of 10.
    const n = topMatch ? parseInt(topMatch[1])
      : bottomMatch ? parseInt(bottomMatch[1])
      : bareTop ? 25
      : 10;

    // Determine sort criteria from query
    if (lowerQuery.includes('by open balance') || lowerQuery.includes('open balance') && lowerQuery.includes('top')) {
      // Sort by total open/unshipped balance
      const openBalTotals = new Map<string, number>();
      for (const c of (contracts || [])) {
        if (!c.ctrmCustomerId) continue;
        openBalTotals.set(c.ctrmCustomerId, (openBalTotals.get(c.ctrmCustomerId) || 0) + (c.openBalanceQuantity || 0));
      }
      result = [...result].sort((a, b) => {
        const aVal = openBalTotals.get(a.scoularId!) || 0;
        const bVal = openBalTotals.get(b.scoularId!) || 0;
        return isTop ? bVal - aVal : aVal - bVal;
      });
    } else if (lowerQuery.includes('by planting') || (lowerQuery.includes('planting') && lowerQuery.includes('top'))) {
      // Sort by total planting intention acres
      const plantingTotals = new Map<number, number>();
      for (const p of (plantingIntentions || [])) {
        plantingTotals.set(p.customerId, (plantingTotals.get(p.customerId) || 0) + (p.acres || 0));
      }
      result = [...result].sort((a, b) => {
        const aVal = plantingTotals.get(a.id) || 0;
        const bVal = plantingTotals.get(b.id) || 0;
        return isTop ? bVal - aVal : aVal - bVal;
      });
    } else if (lowerQuery.includes('by storage') || (lowerQuery.includes('storage') && lowerQuery.includes('top'))) {
      // Sort by total stored grain quantity
      const storageTotals = new Map<number, number>();
      for (const s of (storedGrain || [])) {
        storageTotals.set(s.customerId, (storageTotals.get(s.customerId) || 0) + (s.quantity || 0));
      }
      result = [...result].sort((a, b) => {
        const aVal = storageTotals.get(a.id) || 0;
        const bVal = storageTotals.get(b.id) || 0;
        return isTop ? bVal - aVal : aVal - bVal;
      });
    } else if (lowerQuery.includes('most notes') || lowerQuery.includes('most engaged') || lowerQuery.includes('by notes')) {
      // Sort by number of notes (engagement proxy)
      const noteCounts = new Map<number, number>();
      for (const note of (notes || [])) {
        noteCounts.set(note.customerId, (noteCounts.get(note.customerId) || 0) + 1);
      }
      result = [...result].sort((a, b) => {
        const aVal = noteCounts.get(a.id) || 0;
        const bVal = noteCounts.get(b.id) || 0;
        return isTop ? bVal - aVal : aVal - bVal;
      });
    } else if (lowerQuery.includes('by contract') || lowerQuery.includes('contract value') ||
        lowerQuery.includes('biggest buyer') || lowerQuery.includes('most contracted')) {
      // Sort by total contract volume
      const contractTotals = new Map<string, number>();
      for (const c of (contracts || [])) {
        if (!c.ctrmCustomerId) continue;
        contractTotals.set(c.ctrmCustomerId, (contractTotals.get(c.ctrmCustomerId) || 0) + (c.quantity || 0));
      }
      result = [...result].sort((a, b) => {
        const aVal = contractTotals.get(a.scoularId!) || 0;
        const bVal = contractTotals.get(b.scoularId!) || 0;
        return isTop ? bVal - aVal : aVal - bVal;
      });
    } else if (lowerQuery.includes('by deliver') || lowerQuery.includes('most delivered') ||
               lowerQuery.includes('biggest deliver')) {
      // Sort by total delivery volume
      const ticketTotals = new Map<string, number>();
      for (const t of (tickets || [])) {
        if (!t.customerCode) continue;
        ticketTotals.set(t.customerCode, (ticketTotals.get(t.customerCode) || 0) + (t.appliedDockQuantity || 0));
      }
      result = [...result].sort((a, b) => {
        const aVal = ticketTotals.get(a.scoularId!) || 0;
        const bVal = ticketTotals.get(b.scoularId!) || 0;
        return isTop ? bVal - aVal : aVal - bVal;
      });
    } else if (lowerQuery.includes('grain on farm') || (/on\s+(?:the\s+)?farm/.test(lowerQuery) && lowerQuery.includes('top'))) {
      // Sort by total bushels on hand across the producer's grain-on-farm rows.
      result = [...result].sort((a, b) => {
        const aVal = (a.grainOnFarm ?? []).reduce((s, g) => s + (g.bushelsOnHand ?? 0), 0);
        const bVal = (b.grainOnFarm ?? []).reduce((s, g) => s + (g.bushelsOnHand ?? 0), 0);
        return isTop ? bVal - aVal : aVal - bVal;
      });
    } else {
      // Default: sort by acreage, falling back to contract volume then ticket volume
      // when acres data hasn't been entered yet (all zero).
      const contractTotals = new Map<string, number>();
      for (const c of (contracts || [])) {
        if (!c.ctrmCustomerId) continue;
        contractTotals.set(c.ctrmCustomerId, (contractTotals.get(c.ctrmCustomerId) || 0) + (c.quantity || 0));
      }
      const ticketTotals = new Map<string, number>();
      for (const t of (tickets || [])) {
        if (!t.customerCode) continue;
        ticketTotals.set(t.customerCode, (ticketTotals.get(t.customerCode) || 0) + (t.appliedDockQuantity || 0));
      }
      result = [...result].sort((a, b) => {
        const acresDiff = (b.totalAcres || 0) - (a.totalAcres || 0);
        if (acresDiff !== 0) return isTop ? acresDiff : -acresDiff;
        const contractDiff = (contractTotals.get(b.scoularId!) || 0) - (contractTotals.get(a.scoularId!) || 0);
        if (contractDiff !== 0) return isTop ? contractDiff : -contractDiff;
        const ticketDiff = (ticketTotals.get(b.scoularId!) || 0) - (ticketTotals.get(a.scoularId!) || 0);
        return isTop ? ticketDiff : -ticketDiff;
      });
    }

    return result.slice(0, n);
  }
}
