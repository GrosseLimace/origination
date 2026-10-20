import { Commodity, Contract, Customer, NoteLastContact, PlantingIntention, ProducerDetails } from '@models';
import { commodityPlantingCategory, plantingCategory } from '@shared/utils/planting-category';
import { inSelectedTradeUnits } from '@shared/utils/planting-trade-unit-filter';
import { dashboardCropKey } from './dashboard-format';

/**
 * Row building, filtering and sorting for the dashboard's Producers & Planting Intentions tab.
 * Pure: the component reads the signals and passes the values in, so its computeds track the same
 * state they always did. Moved out of DashboardComponent unchanged.
 */

/** One crop on a "with intentions" producer row. colorKey = the PLAIN crop category (e.g. "Corn")
 *  so the chip colour matches the app-wide palette; category = the type-prefixed key (e.g.
 *  "Dryland Corn") kept for the chip-filter logic. */
export interface ProducerCropEntry {
  display: string;
  category: string;
  colorKey: string;
  acres: number;
  production: number;
}

/** One producer card on the Producers tab. Both views build these; the fields only the "with
 *  intentions" view has (acres, production, trade unit, the per-crop breakdown) are optional, and
 *  read as absent on a "without" row. */
export interface ProducerTabRow {
  customerId: number;
  customerName: string;
  scoularId: string | null;
  customer: Customer | undefined;
  tradeUnit?: string;
  acres?: number;
  production?: number | null;
  crops: string[];
  cropCategoryKeys?: string[];
  cropEntries?: ProducerCropEntry[];
  plantingChips: { display: string; colorKey: string; text: string }[];
  highlightedCrops?: Set<string> | null;
}

export type LastContactInfo = { text: string; colorClass: string; daysAgo: number };

/** One row per producer with an in-scope intention this year: acres, projected production and the
 *  per-crop breakdown behind the planting chips. */
export function buildProducersWithIntentionsRows(
  intentions: PlantingIntention[],
  yieldMap: Map<string, number | null>,
  customerMap: Map<number, Customer>,
  commodityByCode: Map<string, Commodity>,
) {
  const map = new Map<number, {
    customerName: string;
    tradeUnit: string;
    acres: number;
    production: number;
    // Per-crop breakdown so we can recompute the displayed acres/production when a chip is active.
    byKey: Map<string, ProducerCropEntry>;
  }>();
  for (const p of intentions) {
    const commodity = commodityByCode.get(p.crop);
    const category = plantingCategory(p, commodity);
    const categoryKey = dashboardCropKey(p.type, category);
    const displayKey = dashboardCropKey(p.type, p.crop);
    const yieldEst = yieldMap.get(categoryKey);
    const production = yieldEst != null ? p.acres * yieldEst : 0;
    let entry = map.get(p.customerId);
    if (!entry) {
      entry = {
        customerName: p.customerName,
        tradeUnit: p.tradeUnit,
        acres: 0,
        production: 0,
        byKey: new Map(),
      };
      map.set(p.customerId, entry);
    } else if (p.tradeUnit && !entry.tradeUnit.split(', ').includes(p.tradeUnit)) {
      // Rows for the same producer can carry different trade units when several are selected.
      entry.tradeUnit = entry.tradeUnit ? `${entry.tradeUnit}, ${p.tradeUnit}` : p.tradeUnit;
    }
    entry.acres += p.acres;
    entry.production += production;
    const existingDetail = entry.byKey.get(displayKey);
    if (existingDetail) {
      existingDetail.acres += p.acres;
      existingDetail.production += production;
    } else {
      entry.byKey.set(displayKey, { display: displayKey, category: categoryKey, colorKey: category, acres: p.acres, production });
    }
  }
  return [...map.entries()].map(([customerId, v]) => {
    const customer = customerMap.get(customerId);
    const cropEntries = [...v.byKey.values()].sort((a, b) => a.display.localeCompare(b.display));
    // Build-A-List-style planting chips: "<Type> <Crop> · <acres> ac", grouped by crop (same crops
    // adjacent) then acres desc, colored by the plain crop category.
    const plantingChips = [...cropEntries]
      .sort((a, b) => a.colorKey.localeCompare(b.colorKey) || b.acres - a.acres)
      .map(e => ({
        display: e.display,
        colorKey: e.colorKey,
        text: `${e.display} · ${e.acres.toLocaleString('en-US')} ac`,
      }));
    return {
      customerId,
      customerName: v.customerName,
      scoularId: customer?.scoularId ?? null,
      customer,
      tradeUnit: v.tradeUnit,
      acres: v.acres,
      production: v.production > 0 ? Math.round(v.production) : null,
      crops: cropEntries.map(e => e.display),
      cropCategoryKeys: [...new Set(cropEntries.map(e => e.category))].sort(),
      cropEntries,
      plantingChips,
      highlightedCrops: null as Set<string> | null,
    };
  });
}

/**
 * Combined crops per customer — mirrors build-list's resolution logic.
 * Sources (deduped, case-insensitive): producer details, contract commodity codes/descriptions.
 */
export function buildCustomerCropsById(
  producerDetails: ProducerDetails[],
  contracts: Contract[],
  customers: Customer[],
): Map<number, string[]> {
  const result = new Map<number, string[]>();

  // Producer details by customerId
  const pdByCustomer = new Map<number, string[]>();
  for (const pd of producerDetails) {
    if (pd.commodities) {
      const list = pd.commodities.split(',').map(s => s.trim()).filter(Boolean);
      if (list.length > 0) pdByCustomer.set(pd.customerId, list);
    }
  }

  // Contracts grouped by ctrmCustomerId (the FK on contracts that maps to customer.scoularId)
  const contractCropsBySrcId = new Map<string, string[]>();
  for (const c of contracts) {
    const key = c.ctrmCustomerId;
    if (!key) continue;
    const crop = (c.commodityCode || c.commodityDescription || c.commodityGroup || '').trim();
    if (!crop) continue;
    const arr = contractCropsBySrcId.get(key);
    if (arr) arr.push(crop); else contractCropsBySrcId.set(key, [crop]);
  }

  for (const customer of customers) {
    const detailCrops = pdByCustomer.get(customer.id) ?? customer.commodities ?? [];
    const contractCrops = customer.scoularId
      ? (contractCropsBySrcId.get(customer.scoularId) ?? [])
      : [];
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const crop of [...detailCrops, ...contractCrops]) {
      const key = crop.trim().toUpperCase();
      if (key && !seen.has(key)) { seen.add(key); merged.push(crop.trim()); }
    }
    if (merged.length > 0) result.set(customer.id, merged);
  }
  return result;
}

/** One row per producer with NO intention this year (for the top-filter crop, when one is set). */
export function buildProducersWithoutIntentionsRows(input: {
  plantingIntentions: PlantingIntention[];
  customers: Customer[];
  year: number;
  cropFilter: string;
  tradeUnitSet: Set<string>;
  commodityByCode: Map<string, Commodity>;
  cropsMap: Map<number, string[]>;
}) {
  const { year, cropFilter, cropsMap, tradeUnitSet, commodityByCode } = input;
  const cropFilterLower = cropFilter.toLowerCase();

  // When a crop is selected at the top, "without intentions" narrows to:
  //   producers who work with that crop (per their crops list) but have NO intention
  //   for THAT crop this year. Otherwise: producers with NO intention at all this year.
  // A producer whose only rows this year belong to ANOTHER of their trade units has no intentions
  // for this territory, so they belong in this list.
  const matchingIntentionCustomers = new Set<number>();
  for (const p of input.plantingIntentions) {
    if (+p.plantingYear !== +year) continue;
    if (!inSelectedTradeUnits(p, tradeUnitSet)) continue;
    if (cropFilter) {
      const commodity = commodityByCode.get(p.crop);
      const category = plantingCategory(p, commodity);
      if (category !== cropFilter) continue;
    }
    matchingIntentionCustomers.add(p.customerId);
  }

  return input.customers
    .filter(c => !matchingIntentionCustomers.has(c.id))
    .filter(c => {
      if (!cropFilter) return true;
      const crops = cropsMap.get(c.id) ?? [];
      return crops.some(crop => {
        const raw = crop.trim();
        if (raw.toLowerCase() === cropFilterLower) return true;
        // Resolve code (e.g. "YC") to its category (e.g. "Corn") via commodities lookup
        const commodity = commodityByCode.get(raw) || commodityByCode.get(raw.toUpperCase());
        return (commodityPlantingCategory(commodity) || '').toLowerCase() === cropFilterLower;
      });
    })
    .map(c => {
      const crops = [...(cropsMap.get(c.id) ?? [])].sort();
      // These producers have no planting intentions, so no acres/type — chips are just the crop
      // code, colored + grouped by crop category (resolved via the commodities lookup).
      const plantingChips = crops
        .map(code => {
          const commodity = commodityByCode.get(code) || commodityByCode.get(code.toUpperCase());
          const colorKey = commodityPlantingCategory(commodity) || code;
          return { display: code, colorKey, text: code };
        })
        .sort((a, b) => a.colorKey.localeCompare(b.colorKey) || a.display.localeCompare(b.display));
      return {
        customerId: c.id,
        customerName: c.name,
        scoularId: c.scoularId ?? null,
        customer: c,
        crops,
        plantingChips,
      };
    });
}

/**
 * Apply search + (optional) chip filter. Pass an empty chipFilter to skip the chip: it is
 * view-specific, so the inactive view's count skips it — that's why the With count doesn't move
 * when you toggle a chip while sitting on the Without view, and vice versa.
 */
export function applyProducerFilters(
  rows: ProducerTabRow[],
  view: 'with' | 'without',
  searchText: string,
  chipFilter: string,
  topFilterSet: boolean,
): ProducerTabRow[] {
  const search = searchText.trim().toLowerCase();
  const cropFilter = chipFilter.trim().toLowerCase();

  let result = rows;
  if (search) {
    result = result.filter(r =>
      r.customerName.toLowerCase().includes(search) ||
      (r.scoularId && r.scoularId.toLowerCase().includes(search))
    );
  }
  if (cropFilter) {
    result = result.filter(r => {
      if (view === 'with' && !topFilterSet) {
        const keys = r.cropCategoryKeys;
        return Array.isArray(keys) && keys.some(c => c.toLowerCase() === cropFilter);
      }
      return Array.isArray(r.crops) && r.crops.some((c: string) => c.toLowerCase() === cropFilter);
    });
  }
  return result;
}

/**
 * When a chip is active on the With view, narrow each row's acres/production to the matching
 * crop(s) only, and mark which crop badges should be highlighted on the card.
 */
export function narrowProducerRowsToChip(
  rows: ProducerTabRow[],
  view: 'with' | 'without',
  chipFilter: string,
  topFilterSet: boolean,
): ProducerTabRow[] {
  const chip = chipFilter.trim().toLowerCase();
  if (!(chip && view === 'with')) return rows;
  return rows.map(r => {
    const entries: { display: string; category: string; acres: number; production: number }[] = r.cropEntries ?? [];
    const matches = entries.filter(e => {
      const target = topFilterSet ? e.display : e.category;
      return target.toLowerCase() === chip;
    });
    if (matches.length === 0) return r;
    const acres = matches.reduce((s, e) => s + e.acres, 0);
    const productionRaw = matches.reduce((s, e) => s + e.production, 0);
    return {
      ...r,
      acres,
      production: productionRaw > 0 ? Math.round(productionRaw) : null,
      highlightedCrops: new Set(matches.map(e => e.display)),
    };
  });
}

/** Sorted copy. Acres falls back to the customer's farm acres for rows with no intention acres. */
export function sortProducerRows(
  rows: ProducerTabRow[],
  sortKey: 'acres' | 'production',
  dir: 1 | -1,
): ProducerTabRow[] {
  return [...rows].sort((a, b) => {
    if (sortKey === 'acres') {
      const av = a.acres ?? a.customer?.totalAcres ?? 0;
      const bv = b.acres ?? b.customer?.totalAcres ?? 0;
      return (av - bv) * dir;
    }
    if (sortKey === 'production') return ((a.production ?? 0) - (b.production ?? 0)) * dir;
    return a.customerName.localeCompare(b.customerName);
  });
}

/**
 * Crop chips for the With view:
 *   - Top filter empty: chips are "type + category" (e.g. "Dryland Corn") — broader buckets
 *   - Top filter set:   chips are "type + crop code" (e.g. "Dryland YC") — drill-down within that crop
 */
export function withIntentionsChipOptions(
  rows: { crops: string[]; cropCategoryKeys: string[] }[],
  topFilterSet: boolean,
): string[] {
  const set = new Set<string>();
  if (topFilterSet) {
    for (const r of rows) for (const k of r.crops) set.add(k);
  } else {
    for (const r of rows) for (const k of r.cropCategoryKeys) set.add(k);
  }
  return [...set].sort();
}

/**
 * Crop chips for the Without view: crop codes (e.g. "YC", "SRWW") drawn from each customer's merged
 * crops list; when the top filter is set, limited to codes whose category matches it.
 */
export function withoutIntentionsChipOptions(
  rows: { crops: string[] }[],
  cropFilter: string,
  commodityByCode: Map<string, Commodity>,
): string[] {
  const set = new Set<string>();
  const cropFilterLower = cropFilter.toLowerCase();
  for (const r of rows) {
    for (const c of r.crops) {
      const raw = c.trim();
      if (!raw) continue;
      if (cropFilter) {
        // Limit chips to codes that resolve to the selected category
        const commodity = commodityByCode.get(raw) || commodityByCode.get(raw.toUpperCase());
        const category = (commodityPlantingCategory(commodity) || '').toLowerCase();
        if (category !== cropFilterLower && raw.toLowerCase() !== cropFilterLower) continue;
      }
      set.add(raw);
    }
  }
  return [...set].sort();
}

/**
 * Last-contacted info per customer — mirrors build-list's lastContactByCustomer.
 * Walks the last-contact aggregate (incl. linked producers, forward + reverse edges) to
 * find the most recent. Fed by noteLastContacts — one MAX(CreatedAt) row per customer,
 * all trade units — instead of the full note download.
 */
export function buildLastContactByCustomer(
  noteLastContacts: NoteLastContact[],
  customers: Customer[],
): Map<number, LastContactInfo> {
  const map = new Map<number, LastContactInfo>();
  const parseUtc = (ts: string | Date) => {
    const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
    return new Date(raw).getTime();
  };

  const notesByCode = new Map<string, { time: number }>();
  for (const row of noteLastContacts) {
    if (!row.customerCode) continue;
    const time = parseUtc(row.lastNoteAt);
    const existing = notesByCode.get(row.customerCode);
    if (!existing || time > existing.time) notesByCode.set(row.customerCode, { time });
  }

  const all = customers;
  const linkedById = new Map<number, string[]>();
  for (const c of all) {
    if (c.linkedProducerIds?.length) linkedById.set(c.id, c.linkedProducerIds);
  }
  const incomingCodeLinks = new Map<string, Set<string>>();
  for (const c of all) {
    if (!c.scoularId) continue;
    for (const linkedCode of (c.linkedProducerIds || [])) {
      if (!incomingCodeLinks.has(linkedCode)) incomingCodeLinks.set(linkedCode, new Set());
      incomingCodeLinks.get(linkedCode)!.add(c.scoularId);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const customer of all) {
    const codes = new Set<string>();
    if (customer.scoularId) codes.add(customer.scoularId);
    for (const code of (linkedById.get(customer.id) ?? customer.linkedProducerIds ?? [])) codes.add(code);
    for (const code of (incomingCodeLinks.get(customer.scoularId || '') || [])) codes.add(code);
    let latestTime = 0;
    for (const code of codes) {
      const e = notesByCode.get(code);
      if (e && e.time > latestTime) latestTime = e.time;
    }
    if (latestTime === 0) continue;
    const noteDate = new Date(latestTime);
    noteDate.setHours(0, 0, 0, 0);
    const daysAgo = Math.max(0, Math.round((today.getTime() - noteDate.getTime()) / 86400000));
    let info: LastContactInfo;
    if (daysAgo === 0) info = { text: 'Contacted today', colorClass: 'text-scoular-green', daysAgo };
    else if (daysAgo === 1) info = { text: 'Contacted yesterday', colorClass: 'text-scoular-green', daysAgo };
    else if (daysAgo < 7) info = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-green', daysAgo };
    else if (daysAgo < 30) info = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-yellow-500', daysAgo };
    else info = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-red', daysAgo };
    map.set(customer.id, info);
  }
  return map;
}
