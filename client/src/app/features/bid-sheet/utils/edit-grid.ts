/**
 * Bid sheet Edit Bids grid.
 *
 * Pure functions behind the editable grid: which crop × month columns it shows and in what order,
 * the rows it is built from, the diff that becomes the bulk-upsert payload, and how a successful
 * save is folded back into the rows (dirty state) and the location cache (so navigating away and
 * back never shows a stale value). The page owns the signals, the API calls and the save
 * coordination; nothing here reads state or has side effects.
 */
import { moveItemInArray } from '@angular/cdk/drag-drop';
import { BidSheetEntry, BidSheetLocation, Commodity } from '@models';
import { bidLookupKey, MONTH_ABBREVIATIONS } from './bid-math';

export interface EditBidsRow {
  name: string;
  type: 'elevator' | 'entry';
  elevatorCode?: string;
  tradeUnitCode?: string;
  latitude?: number;
  longitude?: number;
  bids: Record<string, string>;
  originalBids: Record<string, string>;
}

/** One grid column: a crop for one period (month 0 = the yearly bid). `key` is "crop#month". */
export interface EditGridColumn {
  key: string;
  crop: string;
  month: number;
  label: string;
}

/** One changed cell, shaped for `bulkUpsertBidSheetBids`. */
export interface DirtyBid {
  name?: string;
  elevatorCode?: string;
  tradeUnitCode?: string;
  groupName?: string;
  latitude?: number;
  longitude?: number;
  commodityCode: string;
  commodityName?: string;
  commodityCategory?: string;
  cropYear: number;
  bid: string;
  month?: number;
}

/** Sorts `items` by a saved order (by key); items the order doesn't know go to the end, stably. */
export function applySavedOrder<T>(items: T[], savedOrder: string[] | undefined, keyOf: (item: T) => string): T[] {
  if (savedOrder && savedOrder.length > 0) {
    const orderMap = new Map(savedOrder.map((key, idx) => [key, idx]));
    items.sort((a, b) => {
      const ai = orderMap.get(keyOf(a)) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderMap.get(keyOf(b)) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }
  return items;
}

/** Visible crops (hidden ones removed), in the saved crop column order (unknown crops go to end). */
export function orderEditBidsCrops(crops: string[], hidden: ReadonlySet<string>, savedOrder: string[] | undefined): string[] {
  const result = [...crops].filter(c => !hidden.has(c));
  return applySavedOrder(result, savedOrder, c => c);
}

/** Cross-product of crops × selected months, in the user's chosen month order (`months` is the
 *  canonical order — defaults to Yearly first, reorderable via the print dialog's Months list). */
export function buildEditGridColumns(crops: string[], months: number[], year: number): EditGridColumn[] {
  return crops.flatMap(crop =>
    months.map(m => ({
      key: `${crop}#${m}`,
      crop,
      month: m,
      label: m === 0 ? `${crop} ${year}` : `${crop} ${MONTH_ABBREVIATIONS[m]}`
    }))
  );
}

/** Label shown on the month-selector button.
 *  Year-only → "Year". Months only → "N Months". Mixed → "N Months + Year". */
export function editBidsMonthsLabel(months: number[]): string {
  const hasYearly = months.includes(0);
  const specificCount = months.filter(m => m !== 0).length;
  if (specificCount === 0) return 'Year';
  const base = `${specificCount} Month${specificCount === 1 ? '' : 's'}`;
  return hasYearly ? `${base} + Year` : base;
}

/** Toggles a month in a selection. Yearly (0) can be selected alongside specific months; an empty
 *  selection falls back to yearly. */
export function toggleMonth(months: number[], month: number): number[] {
  let updated = [...months];
  if (updated.includes(month)) {
    updated = updated.filter(m => m !== month);
  } else {
    updated.push(month);
  }
  // If nothing selected, fall back to yearly
  return updated.length === 0 ? [0] : updated;
}

/** Default month ordering: Yearly (0) first, then months in calendar order. Custom order comes from drag. */
export function defaultMonthOrder(months: number[]): number[] {
  return [...new Set(months)].sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b));
}

/**
 * The grid rows for a crop year: every location that has bids (first-seen order), then every
 * trade-unit location with no bids yet (e.g. just added), each with its cell values per column and
 * a snapshot to diff edits against. Then the saved location order (unknown names go to the end).
 */
export function buildEditGridRows(
  entries: BidSheetEntry[], bidLocations: BidSheetLocation[], columns: EditGridColumn[],
  lookup: ReadonlyMap<string, BidSheetEntry>, year: number, savedOrder: string[] | undefined
): EditBidsRow[] {
  const rows: EditBidsRow[] = [];
  const addedNames = new Set<string>();

  // Add locations that have bid entries
  const uniqueNames = [...new Set(entries.map(e => e.name))];
  for (const name of uniqueNames) {
    addedNames.add(name);
    const rep = entries.find(e => e.name === name);
    const bids: Record<string, string> = {};
    for (const col of columns) {
      bids[col.key] = lookup.get(bidLookupKey(name, col.crop, year, col.month))?.bid ?? '';
    }
    rows.push({ name, type: 'entry', elevatorCode: rep?.elevatorCode, tradeUnitCode: rep?.tradeUnitCode, latitude: rep?.latitude, longitude: rep?.longitude, bids, originalBids: { ...bids } });
  }

  // Also include locations with no bids yet (e.g. just added from Edit Bids)
  for (const loc of bidLocations) {
    if (addedNames.has(loc.name)) continue;
    addedNames.add(loc.name);
    const bids: Record<string, string> = {};
    for (const col of columns) { bids[col.key] = ''; }
    rows.push({ name: loc.name, type: 'entry', elevatorCode: loc.elevatorCode, tradeUnitCode: loc.tradeUnitCode, latitude: loc.latitude, longitude: loc.longitude, bids, originalBids: { ...bids } });
  }

  // Apply saved location order (unknown names go to end)
  return applySavedOrder(rows, savedOrder, r => r.name);
}

/** The rows with one cell changed (immutably). */
export function setRowBid(rows: EditBidsRow[], rowIndex: number, colKey: string, value: string): EditBidsRow[] {
  const updated = [...rows];
  updated[rowIndex] = { ...updated[rowIndex], bids: { ...updated[rowIndex].bids, [colKey]: value } };
  return updated;
}

/**
 * Crop order after a grid column header is dragged. In monthly mode (crop × month columns) moving
 * one column moves ALL columns for that crop, so the reorder is at the CROP level. Returns the full
 * crop list — visible crops in their new order, hidden crops parked at the end — or null when the
 * drop changes nothing.
 */
export function reorderCropsByColumnDrop(
  columns: EditGridColumn[], visibleCrops: string[], allCrops: string[], hidden: ReadonlySet<string>,
  previousIndex: number, currentIndex: number
): string[] | null {
  const draggedCrop = columns[previousIndex]?.crop;
  const targetCrop = columns[currentIndex]?.crop;
  if (!draggedCrop || !targetCrop || draggedCrop === targetCrop) return null;

  const visible = [...visibleCrops];
  const fromIdx = visible.indexOf(draggedCrop);
  const toIdx = visible.indexOf(targetCrop);
  if (fromIdx === -1 || toIdx === -1) return null;
  moveItemInArray(visible, fromIdx, toIdx);

  // Rebuild the full crops list: visible crops in new order, then hidden crops at the end
  return withHiddenCropsLast(visible, allCrops, hidden);
}

/** The full crop list after a reorder of the visible crops: hidden crops stay parked at the end. */
export function withHiddenCropsLast(visible: string[], allCrops: string[], hidden: ReadonlySet<string>): string[] {
  return [...visible, ...allCrops.filter(c => hidden.has(c))];
}

/** Where an arrow key moves focus in a `rowCount` × `colCount` grid, or null when it doesn't
 *  (not an arrow key, or already at that edge). */
export function arrowKeyTarget(key: string, rowIdx: number, colIdx: number, rowCount: number, colCount: number): { row: number; col: number } | null {
  if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  let targetRow = rowIdx;
  let targetCol = colIdx;
  if (key === 'ArrowUp') targetRow = Math.max(0, rowIdx - 1);
  else if (key === 'ArrowDown') targetRow = Math.min(rowCount - 1, rowIdx + 1);
  else if (key === 'ArrowLeft') targetCol = Math.max(0, colIdx - 1);
  else if (key === 'ArrowRight') targetCol = Math.min(colCount - 1, colIdx + 1);
  if (targetRow === rowIdx && targetCol === colIdx) return null;
  return { row: targetRow, col: targetCol };
}

/** Diff the grid against its snapshot and build the upsert payload for the changed cells. A row
 *  with no trade unit of its own saves against `fallbackTu`. */
export function buildDirtyBids(
  rows: EditBidsRow[], columns: EditGridColumn[], year: number, fallbackTu: string,
  commodities: Commodity[], groupNameForTu: (tu: string) => string
): DirtyBid[] {
  const commodityLookup = new Map(commodities.map(c => [c.code, c]));
  const toCreate: DirtyBid[] = [];

  for (const row of rows) {
    for (const col of columns) {
      const current = (row.bids[col.key] ?? '').trim();
      const original = (row.originalBids[col.key] ?? '').trim();
      if (current !== original) {
        const commodity = commodityLookup.get(col.crop);
        toCreate.push({
          name: row.name,
          latitude: row.latitude,
          longitude: row.longitude,
          elevatorCode: row.elevatorCode,
          tradeUnitCode: row.tradeUnitCode || fallbackTu,
          groupName: groupNameForTu(row.tradeUnitCode || fallbackTu) || undefined,
          commodityCode: col.crop,
          commodityName: commodity?.name,
          commodityCategory: commodity?.category ?? undefined,
          cropYear: year,
          bid: current,
          month: col.month
        });
      }
    }
  }
  return toCreate;
}

/** Marks the saved cells clean so the "changed" highlight clears — by setting originalBids to the
 *  value that was actually SAVED (not the current input). If the user kept editing the same cell while
 *  the save was in flight, current ≠ saved, so the cell stays dirty and the re-run / next blur catches it. */
export function clearDirtyForSaved(rows: EditBidsRow[], dirty: Array<{ name?: string; commodityCode: string; month?: number; bid: string }>): EditBidsRow[] {
  const savedByName = new Map<string, Map<string, string>>();
  for (const b of dirty) {
    if (!b.name) continue;
    const colKey = `${b.commodityCode}#${b.month ?? 0}`;
    const m = savedByName.get(b.name) ?? new Map<string, string>();
    m.set(colKey, b.bid);
    savedByName.set(b.name, m);
  }
  return rows.map(row => {
    const saved = savedByName.get(row.name);
    if (!saved) return row;
    const originalBids = { ...row.originalBids };
    for (const [colKey, val] of saved) originalBids[colKey] = val;
    return { ...row, originalBids };
  });
}

/** Writes saved bids into a location list: updates the matching bid cell, or adds it. Returns the
 *  SAME array when nothing matched, so dependent computeds don't churn. */
export function applyBidsToLocations(locs: BidSheetLocation[], dirty: DirtyBid[], now: string): BidSheetLocation[] {
  let changed = false;
  const next = locs.map(loc => {
    const forLoc = dirty.filter(d => d.name === loc.name && (!d.tradeUnitCode || d.tradeUnitCode === loc.tradeUnitCode));
    if (forLoc.length === 0) return loc;
    changed = true;
    const bids = [...loc.bids];
    for (const d of forLoc) {
      const month = d.month ?? 0;
      const idx = bids.findIndex(b => b.commodityCode === d.commodityCode && b.cropYear === d.cropYear && b.month === month);
      if (idx >= 0) {
        bids[idx] = { ...bids[idx], bid: d.bid, commodityName: d.commodityName ?? bids[idx].commodityName, commodityCategory: d.commodityCategory ?? bids[idx].commodityCategory, modifiedAt: now };
      } else {
        bids.push({ id: 0, locationId: loc.id, commodityCode: d.commodityCode, commodityName: d.commodityName, commodityCategory: d.commodityCategory, cropYear: d.cropYear, month, bid: d.bid, createdBy: '', createdAt: now, modifiedAt: now });
      }
    }
    return { ...loc, bids };
  });
  return changed ? next : locs; // preserve reference when untouched so dependent computeds don't churn
}

/** Session key for a saved cell, so "Done" can count distinct cells saved: name|commodity|cropYear|month. */
export function savedBidKey(b: { name?: string; commodityCode: string; cropYear: number; month?: number }): string {
  return `${b.name}|${b.commodityCode}|${b.cropYear}|${b.month ?? 0}`;
}
