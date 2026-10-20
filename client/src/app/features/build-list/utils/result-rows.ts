/**
 * Build a List result rows: the per-producer indexes and display derivations behind each row —
 * initials, location, crop list, linked-producer panel, and the storage / DP / grain-on-farm /
 * bin-site figures shown inline.
 *
 * Pure functions moved verbatim out of BuildListComponent; the page keeps the computeds and the
 * template-facing methods and delegates to these.
 */
import { Commodity, Contract, Customer, DpContract, GrainOnFarmItem, PlantingIntention, StoredGrain, Ticket } from '@models';
import { dpBreakdownByCrop } from '@shared/utils/dp-aggregate';
import { BinSiteGrainGroup } from '@shared/utils/grain-on-farm';

/** Inline per-crop figure on a Storage / DP result. `category` is the resolved crop name used for
 *  the shared chip color (the raw `crop` code is still what's displayed). */
export interface CropBushels { crop: string; bushels: number; category: string }

/** Contracts grouped by ctrmCustomerId. `openOnly` drops closed contracts (the refinement filters
 *  read open contracts only; pacing and the crop list read all of them). */
export function contractsByCustomerCode(contracts: Contract[], openOnly = false): Map<string, Contract[]> {
  const map = new Map<string, Contract[]>();
  for (const c of contracts) {
    if (!c.ctrmCustomerId || (openOnly && c.closedDate)) continue;
    const arr = map.get(c.ctrmCustomerId);
    if (arr) arr.push(c); else map.set(c.ctrmCustomerId, [c]);
  }
  return map;
}

/** Rows grouped by numeric customerId (storage receipts, DP rows, planting intentions all join on
 *  Customer.id, not scoularId). */
export function groupByCustomerId<T extends { customerId: number }>(rows: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const s of rows) {
    const arr = map.get(s.customerId);
    if (arr) arr.push(s); else map.set(s.customerId, [s]);
  }
  return map;
}

/** Distinct linked-producer info per customer (bidirectional, excluding self).
 *  Only includes producers whose Customer record is loaded — codes without a match are dropped.
 *  Manually-excluded customers are filtered out so the exclude action affects the linked panel too.
 *  `producers` is the actual Customer[] for inline detail rendering. */
export function linkedProducerInfo(
  customers: Customer[],
  excludedIds: Set<number>,
  components: Map<string, Set<string>>,
): Map<number, { count: number; producers: Customer[] }> {
  const map = new Map<number, { count: number; producers: Customer[] }>();
  const customerByCode = new Map<string, Customer>();
  for (const c of customers) {
    if (c.scoularId) customerByCode.set(c.scoularId, c);
  }

  for (const customer of customers) {
    if (!customer.scoularId) continue;
    const component = components.get(customer.scoularId);
    if (!component || component.size <= 1) continue;
    const producers: Customer[] = [];
    for (const code of component) {
      if (code === customer.scoularId) continue;
      const linked = customerByCode.get(code);
      if (linked && !excludedIds.has(linked.id)) producers.push(linked);
    }
    if (producers.length === 0) continue;
    map.set(customer.id, { count: producers.length, producers });
  }
  return map;
}

/** Crops per customer — merged from ProducerDetails, contracts (all, by ctrmCustomerId), planting
 *  intentions, tickets and storage; de-duplicated case-insensitively, first five kept. */
export function cropsByCustomer(
  contractMap: Map<string, Contract[]>,
  plantingIntentions: PlantingIntention[],
  tickets: Ticket[],
  storedGrain: StoredGrain[],
  customers: Customer[],
): Map<number, string[]> {
  const map = new Map<number, string[]>();

  // Pre-index intention crops by customerId — O(intentions) instead of O(customers × intentions)
  const intentionCropsByCustomer = new Map<number, Set<string>>();
  for (const p of plantingIntentions) {
    if (!intentionCropsByCustomer.has(p.customerId)) {
      intentionCropsByCustomer.set(p.customerId, new Set());
    }
    intentionCropsByCustomer.get(p.customerId)!.add(p.crop);
  }

  // Pre-index ticket product codes by customerId
  const ticketCropsByCustomer = new Map<number, Set<string>>();
  for (const t of tickets) {
    if (!t.customerId || !t.productCode) continue;
    if (!ticketCropsByCustomer.has(t.customerId)) {
      ticketCropsByCustomer.set(t.customerId, new Set());
    }
    ticketCropsByCustomer.get(t.customerId)!.add(t.productCode);
  }

  // Pre-index stored grain crops by customerId
  const storedGrainCropsByCustomer = new Map<number, Set<string>>();
  for (const sg of storedGrain) {
    if (!sg.customerId || !sg.crop) continue;
    if (!storedGrainCropsByCustomer.has(sg.customerId)) {
      storedGrainCropsByCustomer.set(sg.customerId, new Set());
    }
    storedGrainCropsByCustomer.get(sg.customerId)!.add(sg.crop);
  }

  for (const customer of customers) {
    const detailCrops = customer.commodities?.length ? [...customer.commodities] : [];
    const contractCrops = customer.scoularId
      ? [...new Set(
          (contractMap.get(customer.scoularId) || [])
            .map(c => c.commodityCode)
            .filter((crop): crop is string => !!crop)
        )]
      : [];
    const intentionCrops = [...(intentionCropsByCustomer.get(customer.id) || [])];
    const ticketCrops = [...(ticketCropsByCustomer.get(customer.id) || [])];
    const storageCrops = [...(storedGrainCropsByCustomer.get(customer.id) || [])];
    // Dedupe by trimmed uppercase value, but keep original casing for display
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const crop of [...detailCrops, ...contractCrops, ...intentionCrops, ...ticketCrops, ...storageCrops]) {
      const key = crop.trim().toUpperCase();
      if (key && !seen.has(key)) { seen.add(key); unique.push(crop.trim()); }
    }
    map.set(customer.id, unique.slice(0, 5));
  }
  return map;
}

/** Two-letter avatar initials: first letters of the first two words, else the first two letters
 *  of a single word, else "??". */
export function initials(name: string): string {
  const parts = name.split(' ').filter(p => p.length > 0);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return '??';
}

/** "City, ST" — the extended (geocoding) address first, then the merchandising one, then whatever
 *  single part exists. */
export function formattedLocation(customer: Customer): string {
  if (customer.extendedCity && customer.extendedStateProvince) {
    return `${customer.extendedCity}, ${customer.extendedStateProvince}`;
  }
  if (customer.location && customer.stateProvince) {
    return `${customer.location}, ${customer.stateProvince}`;
  }
  return customer.extendedCity || customer.location || customer.stateProvince || '';
}

/**
 * Per-crop grain on farm with bushels on hand, largest first — the chips shown inline on Grain on
 * Farm results. Rows are per bin site, so one crop stored at two sites is summed into one chip.
 */
export function grainOnFarmBreakdown(customer: Customer): GrainOnFarmItem[] {
  const byCrop = new Map<string, GrainOnFarmItem>();
  for (const g of customer.grainOnFarm ?? []) {
    if (!g.commodityCode || (g.bushelsOnHand ?? 0) <= 0) continue;
    const key = g.commodityCode.toUpperCase();
    const seen = byCrop.get(key);
    byCrop.set(key, seen
      ? { ...seen, bushelsOnHand: (seen.bushelsOnHand ?? 0) + (g.bushelsOnHand ?? 0) }
      : { commodityCode: g.commodityCode, bushelsOnHand: g.bushelsOnHand });
  }
  return [...byCrop.values()].sort((a, b) => (b.bushelsOnHand ?? 0) - (a.bushelsOnHand ?? 0));
}

/** Lower-cased commodity code OR name → crop category ("yc"/"corn" → "Corn"), from the
 *  Commodities table — so storage chips (which carry codes like YC/SOR) color by their crop. */
export function commodityCategoryByKey(commodities: Commodity[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const cm of commodities) {
    const group = (cm.category || cm.name || '').trim();
    if (!group) continue;
    if (cm.code) map.set(cm.code.trim().toLowerCase(), group);
    if (cm.name) map.set(cm.name.trim().toLowerCase(), group);
  }
  return map;
}

/** Total bushels across a producer's storage receipts (sum of NET_QUANTITY). */
export function storageTotalBushels(recs: StoredGrain[]): number {
  return recs.reduce((sum, s) => sum + (s.quantity ?? 0), 0);
}

/** Per-commodity storage totals (bushels summed across locations), largest first — mirrors the
 *  grain-on-farm chips so Storage results show each commodity + bushels inline without opening
 *  the producer. */
export function storageBreakdown(recs: StoredGrain[], catByKey: Map<string, string>): CropBushels[] {
  const byCrop = new Map<string, number>();
  for (const s of recs) {
    const qty = s.quantity ?? 0;
    if (qty <= 0) continue;
    const crop = (s.crop || 'Unknown').trim();
    byCrop.set(crop, (byCrop.get(crop) ?? 0) + qty);
  }
  return [...byCrop.entries()]
    .map(([crop, bushels]) => ({ crop, bushels, category: catByKey.get(crop.toLowerCase()) ?? crop }))
    .sort((a, b) => b.bushels - a.bushels);
}

/** Per-commodity DP totals, largest first — the inline chips on DP results. Bushels are
 *  per-delivery and charges are summed across charge rows (see dp-aggregate). */
export function dpBreakdown(rows: DpContract[], catByKey: Map<string, string>): CropBushels[] {
  return dpBreakdownByCrop(rows)
    .filter(b => b.bushels > 0)
    .map(b => ({
      crop: b.crop,
      bushels: b.bushels,
      category: catByKey.get(b.crop.toLowerCase()) ?? b.crop,
    }));
}

/** "Show 3 more bin sites", or null when every site is listed (`visible` are shown). */
export function binSiteGrainHiddenLabel(groups: BinSiteGrainGroup[], visible: number): string | null {
  const sites = Math.max(0, groups.length - visible);
  return sites ? `Show ${sites} more bin site${sites === 1 ? '' : 's'}` : null;
}

/** A closed site's line: "2 crops · 35,000 bu", or "No grain on farm". */
export function binSiteGrainSummary(group: BinSiteGrainGroup): string {
  const n = group.rows.length;
  if (n === 0) return 'No grain on farm';
  const bushels = group.rows.reduce((sum, g) => sum + (g.bushelsOnHand ?? 0), 0);
  return `${n} crop${n === 1 ? '' : 's'} · ${bushels.toLocaleString('en-US')} bu`;
}

/** Whether the producer has any bin site or grain-on-farm row to show. */
export function hasBinSiteGrain(customer: Customer): boolean {
  return (customer.binSites?.length ?? 0) > 0 || (customer.grainOnFarm?.length ?? 0) > 0;
}
