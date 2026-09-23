import { ChangeDetectionStrategy, Component, DestroyRef, effect, HostListener, inject, signal, computed, viewChild, ElementRef, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, map, Observable, Subject, switchMap, catchError, finalize, of, retry, shareReplay, tap, timer } from 'rxjs';
import { CdkDragDrop, CdkDrag, CdkDropList, CdkDragHandle, moveItemInArray } from '@angular/cdk/drag-drop';
// CdkScrollable is what lets a row drag auto-scroll the grid: the CDK only scrolls ancestors that are
// registered as scrollable, and marking the container with the class alone does nothing.
import { CdkScrollable } from '@angular/cdk/scrolling';
// The Add-column panel hangs off a sticky <th> inside an overflow-auto scroller, which clips an
// absolutely-positioned child whatever its z-index. Overlay renders it in a detached layer and
// keeps it attached to the trigger as the grid scrolls.
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import type * as Leaflet from 'leaflet';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { BidSheet, BidSheetEntry, BidSheetLayoutUpdate, BidSheetLocation, BidSheetLocationBid, BidSheetShare, BidSheetShareType, Elevator, Commodity } from '@models';
import type { EntitlementPerson, EntitlementTradeUnit, EntitlementTradeUnitGroup } from '@features/daily-digest/models/entitlements-catalog.model';
import type { RecapGroup } from '@features/daily-digest/models/recap-group.model';
import { environment } from '@env/environment';
import { BarchartPickerComponent, BarchartBulkAddRequest, BarchartSearchArea } from '../../components/barchart-picker/barchart-picker.component';
import { SheetMultiSelectComponent } from '../../components/sheet-multi-select/sheet-multi-select.component';
import { BarchartCatalogLocation, BarchartCatalogLocationDetail } from '@models';
import { commodityHex } from '@shared/utils/commodity-color';
import { barchartDisplayName, barchartSaveName, isScoularListing } from '../../utils/barchart-location-name';
import { buildBidSheetExport, downloadWorkbook, writeBidSheetWorkbook, ExcelJSModule } from '../../utils/bid-sheet-export';
import { scopeCommodities } from '@shared/utils/commodity-scope';
import { formatBasis, normalizeBasis } from '../../utils/basis-format';
import {
  buildPrintLayout, cellStyleMap, DEFAULT_PRINT_LAYOUT_STYLE, parsePrintLayoutStyle, PRINT_GEOMETRY, renderPrintDocument, tableColWidthPcts,
  PrintCropGroup, PrintColumn, PrintLayoutModel, PrintLayoutStyle, PrintLocation
} from '../../utils/print-layout';

/**
 * One Edit Bids column, as the user chose it: a single crop in a single delivery month of a single
 * crop year.
 *
 * The grid used to derive its columns as the cross product of three separately-chosen sets -- crops
 * x months x years. That could not express a run of months crossing a year boundary: asking for Dec
 * 2026, Jan 2027, Feb 2027 meant selecting years {2026,2027} and months {12,1,2}, which yields all
 * six combinations with Jan 26 leading. Picking columns one at a time makes the arrangement say
 * exactly what it means, and makes the order the user's rather than a consequence of the nesting.
 */
export interface EditBidColumnPick {
  crop: string;
  year: number;
  month: number;
}

interface EditBidsRow {
  /**
   * The location this row is, and the row's identity. Required, not optional: a name does not identify
   * a location -- it is per-sheet (BidSheetLocationLink.DisplayName) and not unique across sheets --
   * so every lookup, save and template track key goes through this.
   */
  locationId: number;
  /** What the row is CALLED here: the per-sheet DisplayName, or the canonical name. Display only. */
  name: string;
  type: 'elevator' | 'entry';
  elevatorCode?: string;
  tradeUnitCode?: string;
  latitude?: number;
  longitude?: number;
  bids: Record<string, string>;
  originalBids: Record<string, string>;
  /** Basis value per column. Editable on manual cells: originators quote on basis as often as cash. */
  basisBids: Record<string, string>;
  originalBasisBids: Record<string, string>;
  /** Column key -> the covering contract's month ("Nov") on a cell that shows a LATER month's bid because
   *  that bid's delivery window covers this month; '' on the elevator's own bid for the month. Fills the
   *  cell's tooltip and nothing else: a covered month reads as an ordinary bid, because it is one. */
  coverageChips: Record<string, string>;
  /** Column key -> the board this fed cell is quoted against; '' on manual cells. */
  boardChips: Record<string, string>;
  /** True when the whole location is linked to a BarChart listing. */
  isBarchartLinked: boolean;
}

/** Status for a bid value vs the session reference. */
type BidStatus = 'reference' | 'beating' | 'matching' | 'none';

/** Row in the panel list view (`filteredBidItems`). */
interface BidSheetPanelItem {
  type: 'entry';
  /** The row's identity; `name` below is display only. See EditBidsRow.locationId. */
  locationId: number;
  name: string;
  isScoular: boolean;
  isRef: boolean;
  latitude: number | null;
  longitude: number | null;
  /** Numeric value, used for status comparison. */
  oldBid: string;
  newBid: string;
  /** What the panel prints -- the same value in cash or basis mode, the pair in Both. The contract is
   *  NOT baked in: it renders separately, smaller and muted, so "5.38 / 6 ZCZ26" fits one line in a
   *  narrow column instead of wrapping onto two. */
  oldBidLabel?: string;
  newBidLabel?: string;
  oldBidContract?: string;
  newBidContract?: string;
  oldStatus?: BidStatus;
  newStatus?: BidStatus;
  status: BidStatus;
  /** "Nov" when the column's value is really the November contract's bid covering this month. */
  oldCoveredBy?: string;
  newCoveredBy?: string;
}

/** Width threshold (px) below which the filter bar wraps the search/clear group to a centered second row. */
const FILTER_BAR_WRAP_WIDTH = 1050;

@Component({
  selector: 'app-bid-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule, CdkDropList, CdkDrag, CdkDragHandle, CdkScrollable, OverlayModule, BarchartPickerComponent, SheetMultiSelectComponent],
  templateUrl: './bid-sheet.component.html',
  styleUrl: './bid-sheet.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BidSheetComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly usageTracking = inject(UsageTrackingService);

  // --- Filters ---
  /**
   * Whether a grid cell accepts typing.
   *
   * Nothing makes it read-only any more. The grid used to lock whenever no single trade unit was
   * selected, because a bid had to be saved against a desk and "All Producers" had no desk to save
   * to. Locations are company-wide now and a bid names its own location, so there is always something
   * to save to.
   *
   * Kept as a per-cell call because the template asks per cell, and a future per-cell rule -- a sheet
   * you only have read access to, say -- lands here rather than in twenty template bindings.
   *
   * Fed cells ARE editable. A typed value is an override that stands until the feed's next run, which
   * takes the cell back and returns it to the vendor's number -- so an originator who knows an
   * elevator has moved can say so today without waiting, and the feed corrects it tomorrow if they
   * were wrong. The override drops the cell's board label and flips the row's chip to Manual.
   */
  cellReadOnly(): boolean {
    return false;
  }
  selectedYear = signal<number>(new Date().getFullYear());
  selectedCrop = signal<string>('');
  searchQuery = signal<string>('');
  selectedBasis = signal<string>('all');

  /**
   * Which price the sheet is showing. Cash is the posted flat price; basis is cents against the futures
   * board and is normally negative, so "-30" reads as thirty under. Both come from the feed on the same
   * row, so switching is a display change with no refetch.
   */
  priceMode = signal<'cash' | 'basis' | 'both'>('cash');
  /**
   * The delivery month the map and panel show, 1-12. Defaults to the current month, which is where the
   * feed's spot bids live. The "Yearly" period (0) was retired in September 2026: for a fed location it
   * meant the nearest open month, for a hand-typed one the crop year, and the two sat side by side as
   * if comparable. Saved preferences that still carry 0 are cleaned on load.
   */
  selectedMonth = signal<number>(BidSheetComponent.currentMonth());

  /**
   * The saved sheet selection, made safe to use: a JSON array of positive integers, de-duplicated, in
   * the order stored. Anything else -- null, "", malformed JSON, a bare number from before the column
   * held a list -- reads as an empty selection rather than throwing on load.
   */
  static parseSheetIds(raw: unknown): number[] {
    if (typeof raw !== 'string' || raw.trim() === '') return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return [...new Set(parsed.map(Number).filter(n => Number.isInteger(n) && n > 0))];
    } catch {
      return [];
    }
  }

  /** 1-12 for today. A function, not a constant, so a long-open tab does not freeze on the month it loaded in. */
  static currentMonth(): number { return new Date().getMonth() + 1; }

  /**
   * A saved month selection made safe to show: integers 1-12 only, de-duplicated, in the order given;
   * the current month when nothing survives. Preferences written before the Yearly period was retired
   * carry 0, and a grid with no columns has nothing to edit.
   */
  static cleanMonths(raw: unknown): number[] {
    const months = Array.isArray(raw)
      ? [...new Set(raw.map(Number).filter(m => Number.isInteger(m) && m >= 1 && m <= 12))]
      : [];
    return months.length > 0 ? months : [BidSheetComponent.currentMonth()];
  }

  /**
   * A saved column list made safe to render: well-formed picks only, in the order stored.
   *
   * De-duplication is not cosmetic. The template tracks both the header row and every body cell by
   * the column key, so two picks that agree on crop+year+month would produce a duplicate track key
   * and Angular would throw NG0955, taking the whole screen down. The picker refuses duplicates, but
   * a hand-edited row must not be able to do that either -- hence here, and again where the columns
   * are projected.
   */
  static parseSelectedColumns(raw: unknown): EditBidColumnPick[] {
    if (typeof raw !== 'string' || raw.trim() === '') return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const picks: EditBidColumnPick[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as { c?: unknown; y?: unknown; m?: unknown };
      const crop = typeof e.c === 'string' ? e.c.trim() : '';
      const year = Math.trunc(Number(e.y));
      const month = Math.trunc(Number(e.m));
      if (crop === '') continue;
      if (!Number.isInteger(year) || year < 1900 || year > 2999) continue;
      if (!Number.isInteger(month) || month < 1 || month > 12) continue;
      const key = `${crop}#${year}#${month}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push({ crop, year, month });
    }
    return picks;
  }

  /** The wire form of a column list: terse, because it is read and written whole. */
  static serialiseSelectedColumns(picks: EditBidColumnPick[]): string {
    return JSON.stringify(picks.map(p => ({ c: p.crop, y: p.year, m: p.month })));
  }

  // --- Data ---
  allMapLocations = signal<BidSheetLocation[]>([]); // every added location, company-wide (for map)

  // --- Sheets ---
  // A sheet is the named, shareable working set of locations a user actually compares -- what
  // replaced the trade unit as the thing deciding what the panel and grid show. The map stays
  // unscoped (allMapLocations, above); only the panel/grid narrow to the active sheet.
  readonly sheets = signal<BidSheet[]>([]);
  readonly sheetsLoaded = signal<boolean>(false);
  /**
   * The sheets on screen, in the order they were ticked. Several at once: originators compare a
   * Kansas sheet against a Nebraska one without switching back and forth, so the panel, the grid and
   * the map show their union.
   *
   * Ids rather than sheets, because a sheet object is replaced wholesale on every write (_applySheet)
   * and the selection has to survive that. Ids naming a sheet that is gone -- deleted, or unshared
   * since it was saved -- are simply skipped by selectedSheets rather than cleaned out, so a sheet
   * that comes back (a share restored) comes back selected.
   */
  readonly selectedSheetIds = signal<number[]>([]);

  /** The ticked sheets, in tick order, minus any id that no longer names a sheet this user can see. */
  readonly selectedSheets = computed<BidSheet[]>(() => {
    const byId = new Map(this.sheets().map(s => [s.id, s]));
    return this.selectedSheetIds()
      .map(id => byId.get(id))
      .filter((s): s is BidSheet => s !== undefined);
  });

  /**
   * The first ticked sheet -- the single destination for anything that can only happen on ONE sheet:
   * share, rename, delete, and the default in the chooser that asks where a new location should go.
   * It is NOT what the screen shows; that is selectedSheets. Kept as activeSheet/activeSheetId
   * because every such write already reads it under those names.
   */
  readonly activeSheet = computed<BidSheet | null>(() => this.selectedSheets()[0] ?? null);
  readonly activeSheetId = computed<number | null>(() => this.activeSheet()?.id ?? null);

  /**
   * The panel/grid location set: the union of the TICKED sheets' locations, cross-referenced against
   * allMapLocations so an in-place edit (a bid save, a rename, the Scoular flag) shows immediately
   * instead of waiting for the sheet to reload. Falls back to the sheet's own copy for a location
   * allMapLocations hasn't caught up to yet (e.g. one just linked from another tab).
   */
  readonly bidLocations = computed<BidSheetLocation[]>(() => {
    const sheets = this.selectedSheets();
    if (sheets.length === 0) return [];
    const live = new Map(this.allMapLocations().map(l => [l.id, l]));

    // One row per LOCATION, not per sheet row: a location on two ticked sheets is one elevator with
    // one set of bids, and listing it twice would give the grid two rows editing the same cell.
    // First sheet ticked wins the position, so the rows read in sheet order.
    const order: number[] = [];
    const first = new Map<number, BidSheetLocation>();
    const names = new Map<number, Set<string>>();
    for (const sheet of sheets) {
      for (const l of sheet.locations) {
        if (!first.has(l.id)) { order.push(l.id); first.set(l.id, l); }
        const seen = names.get(l.id);
        if (seen) seen.add(l.name); else names.set(l.id, new Set([l.name]));
      }
    }

    return order.map(id => {
      const own = first.get(id)!;
      const fresh = live.get(id);
      // The live row supplies fresh DATA (bids, coordinates, the Scoular flag), but a SHEET owns the
      // NAME: sheet.locations carries DisplayName ?? canonical, resolved server-side. Taking the live
      // row wholesale -- which this used to do -- threw that away and reverted every per-sheet rename
      // to the canonical name the moment allMapLocations loaded.
      //
      // With several sheets ticked the name can be contested: the same elevator may be "Kanza GP" on
      // one and "Garden Plain" on another. Agreement wins; disagreement falls back to the canonical
      // name, because picking one sheet's label over another's would be arbitrary and would silently
      // change what the row is called depending on the order they were ticked in.
      const name = (names.get(id)!.size === 1 ? own.name : fresh?.name) ?? own.name;
      return fresh ? { ...fresh, name } : { ...own, name };
    });
  });

  /**
   * Which ticked sheets each location is on. Ids, in tick order; a location on one sheet gets a
   * one-element list.
   *
   * Nothing DISPLAYS this -- the grid badge and the map hover line that used to were both taken off,
   * they earned less than the room they cost. It is still what a rename and a removal target, which
   * is the part that has to be right: both fan out to exactly these sheets.
   */
  readonly sheetIdsByLocationId = computed<ReadonlyMap<number, number[]>>(() => {
    const map = new Map<number, number[]>();
    for (const sheet of this.selectedSheets()) {
      for (const l of sheet.locations) {
        const on = map.get(l.id);
        if (on) { if (!on.includes(sheet.id)) on.push(sheet.id); } else map.set(l.id, [sheet.id]);
      }
    }
    return map;
  });

  /**
   * What the ticked sheets are called, as one phrase. Naming every sheet stops being readable past a
   * couple and a bare count stops being informative below that, so it switches at two.
   */
  readonly selectedSheetsLabel = computed<string>(() => {
    const names = this.selectedSheets().map(s => s.name);
    if (names.length === 0) return '';
    if (names.length <= 2) return names.join(' + ');
    return `${names.length} bid sheets`;
  });

  /**
   * Whether rows can be dragged. Row order is a column on the SHEET (BidSheetLocationLink.SortOrder),
   * shared with everyone on it -- so with several ticked there is no single list to write a new order
   * into, and a drag would have to either guess a sheet or invent a per-user order on top, which is
   * exactly the name-keyed thing the sheet order replaced. The handle is disabled instead, and says so.
   */
  readonly canReorderRows = computed<boolean>(() => this.selectedSheets().length === 1);

  readonly reorderDisabledReason = computed<string>(() =>
    this.canReorderRows() ? '' : 'Show one bid sheet on its own to reorder its rows');

  /** Ids on the ticked sheets, for the BarChart picker's "already here" checkbox state. */
  readonly activeSheetLocationIds = computed<ReadonlySet<number>>(() =>
    new Set(this.bidLocations().map(l => l.id)));

  /**
   * What the MAP is scoped to: the open sheet, or every added location company-wide.
   *
   * The map is the only surface that follows this. The side panel and the Edit Bids grid are the
   * SHEET's -- a sheet is the thing you compare and edit -- so in "All locations" they show nothing
   * but a prompt to pick one, and opening the grid narrows back to the sheet first (openEditBids).
   * That is the user's call after trying the alternative: with the panel and grid following the
   * scope too, "All" became a company-wide bid editor with no sheet to own its row order, and a panel
   * whose rows had no relation to what you were about to edit.
   *
   * What DOES follow the scope, deliberately, is the bid data (bidEntries): every pin's price, hover
   * and status colour comes from it, and if it stayed on the sheet then "All" only widened which pins
   * got DRAWN while other people's locations rendered as bidless dots.
   *
   * Defaults to the sheet. The sheet stays open underneath in either mode, so Add always has a
   * destination and switching back is one click.
   */
  readonly mapScope = signal<'sheet' | 'all'>('sheet');

  /**
   * True when the screen is showing everything rather than one sheet -- either "All locations" is
   * picked or there is no sheet to narrow to. The catalog layer rides on this too: with a sheet open
   * the map is meant to be JUST that sheet, and a few thousand catalog dots underneath is the opposite.
   */
  readonly showingAllLocations = computed<boolean>(() =>
    this.mapScope() === 'all' || this.sheets().length === 0);

  /**
   * The locations the MAP draws and prices: the sheet's, or every added one. bidEntries flattens this,
   * so every pin's price, hover and status colour follows the scope. The panel and grid do NOT read it
   * -- they are the sheet's (bidLocations) and are hidden in All scope.
   */
  readonly scopedLocations = computed<BidSheetLocation[]>(() =>
    this.showingAllLocations() ? this.allMapLocations() : this.bidLocations());

  /** Stable identity for "no sheet to be already-on" (the picker's new-sheet mode), so binding it
   *  doesn't hand the input a fresh Set on every change-detection pass. */
  readonly emptyLocationIds: ReadonlySet<number> = new Set();

  /**
   * The sheet a one-sheet action is aimed at: share, rename, delete.
   *
   * These cannot be done to a SET -- sharing two sheets with someone means two different things, and
   * a delete confirmation naming several would be a trap -- so each is raised from a particular
   * sheet's row in the picker and remembers which. Falling back to the first ticked keeps the
   * toolbar buttons, which have no row to be raised from, working exactly as they did.
   */
  readonly sheetActionTargetId = signal<number | null>(null);
  readonly sheetActionTarget = computed<BidSheet | null>(() =>
    this.sheets().find(s => s.id === this.sheetActionTargetId()) ?? this.activeSheet());

  readonly showSheetMenu = signal<boolean>(false);
  readonly showCreateSheet = signal<boolean>(false);
  readonly newSheetName = signal<string>('');
  readonly creatingSheet = signal<boolean>(false);

  /**
   * Whether the picker is filling the open sheet or building a brand-new one ("+ Add" → Build a bid
   * sheet). In 'new' the sheet does not exist until the batch is confirmed, so nothing downstream may
   * assume activeSheetId is the destination -- see onBarchartAddMany.
   */
  readonly barchartSheetMode = signal<'existing' | 'new'>('existing');
  /** A picked batch parked while the naming dialog asks what to call its sheet. */
  private readonly pendingBulkAdd = signal<BarchartBulkAddRequest | null>(null);
  /** Drives the create-sheet dialog's copy: naming a sheet for a batch reads differently to naming an empty one. */
  readonly namingSheetForBatch = computed(() => this.pendingBulkAdd() !== null);
  readonly showRenameSheet = signal<boolean>(false);
  readonly renameSheetName = signal<string>('');
  readonly renamingSheet = signal<boolean>(false);
  readonly showDeleteSheetConfirm = signal<boolean>(false);
  readonly deletingSheet = signal<boolean>(false);

  // Sharing
  readonly showShareSheet = signal<boolean>(false);
  readonly shareSearch = signal<string>('');
  readonly shareCatalog = signal<EntitlementPerson[]>([]);
  readonly shareCatalogLoaded = signal<boolean>(false);
  readonly shareCatalogLoading = signal<boolean>(false);
  /** Staged edits while the share dialog is open; written on Save, same pattern as the multi-select pickers elsewhere on this screen. */
  readonly pendingShares = signal<BidSheetShare[]>([]);
  readonly savingShares = signal<boolean>(false);

  /** Which list the picker is showing. Tabs rather than one mixed list, matching Manage Groups: the
   *  four kinds are searched differently and a name means a different thing in each. */
  readonly shareTab = signal<BidSheetShareType>('person');
  readonly shareTradeUnits = signal<EntitlementTradeUnit[]>([]);
  readonly shareTradeUnitGroups = signal<EntitlementTradeUnitGroup[]>([]);
  /** Recap groups from "Manage Groups". The endpoint already returns ONLY the ones the caller created
   *  or belongs to, which is exactly the rule wanted here -- no client-side filtering needed. */
  readonly shareRecapGroups = signal<RecapGroup[]>([]);

  /** One row in the picker, whichever tab it came from — so the template renders all four the same. */
  readonly shareOptions = computed<{ memberType: BidSheetShareType; memberId: string; label: string; sub: string }[]>(() => {
    const q = this.shareSearch().trim().toLowerCase();
    const staged = new Set(this.pendingShares().map(s => `${s.memberType}|${s.memberId.toLowerCase()}`));
    const owner = (this.activeSheet()?.ownerUserId ?? '').toLowerCase();
    const hit = (...fields: (string | undefined)[]) =>
      !q || fields.some(f => (f ?? '').toLowerCase().includes(q));

    let rows: { memberType: BidSheetShareType; memberId: string; label: string; sub: string }[];
    switch (this.shareTab()) {
      case 'trade-unit':
        rows = this.shareTradeUnits()
          .filter(t => hit(t.code, t.description ?? undefined))
          .map(t => ({ memberType: 'trade-unit' as const, memberId: t.code, label: t.code, sub: t.description ?? 'Trade unit' }));
        break;
      case 'trade-unit-group':
        rows = this.shareTradeUnitGroups()
          .filter(g => hit(g.name))
          .map(g => ({
            memberType: 'trade-unit-group' as const, memberId: String(g.groupId), label: g.name,
            sub: `${g.tradeUnitCodes.length} trade unit${g.tradeUnitCodes.length === 1 ? '' : 's'}`,
          }));
        break;
      case 'recap-group':
        rows = this.shareRecapGroups()
          .filter(g => hit(g.name))
          .map(g => ({
            memberType: 'recap-group' as const, memberId: g.id, label: g.name,
            sub: `${g.members.length} member${g.members.length === 1 ? '' : 's'}`,
          }));
        break;
      default:
        rows = this.shareCatalog()
          // The owner already sees the sheet, so offering to share it with them is a no-op the server
          // drops anyway -- better not to offer it than to have it silently vanish on save.
          .filter(p => p.userId.toLowerCase() !== owner)
          .filter(p => hit(p.displayName, p.userId))
          .map(p => ({ memberType: 'person' as const, memberId: p.userId, label: p.displayName, sub: p.userId }));
    }
    // Already-staged rows stay OUT of the list rather than showing as ticked: the staged list is right
    // there beneath, so a row in both places just reads as a duplicate.
    return rows.filter(r => !staged.has(`${r.memberType}|${r.memberId.toLowerCase()}`)).slice(0, 30);
  });

  /** Tab labels + counts, so an empty tab says so before you search it. */
  readonly shareTabs = computed<{ id: BidSheetShareType; label: string; count: number }[]>(() => [
    { id: 'person', label: 'People', count: this.shareCatalog().length },
    { id: 'trade-unit', label: 'Trade Units', count: this.shareTradeUnits().length },
    { id: 'trade-unit-group', label: 'Groups', count: this.shareTradeUnitGroups().length },
    { id: 'recap-group', label: 'Recap Groups', count: this.shareRecapGroups().length },
  ]);

  // ---- Delete / remove-locations, from the Edit Bids header ------------------------------------
  // One Delete button that asks WHICH first. Deleting the sheet and taking locations off it differ
  // enormously in blast radius, and they used to live in completely different places (the sheet menu
  // vs. clicking one location in the side panel), so there was no way to remove several at once.

  readonly showDeleteChoice = signal<boolean>(false);
  readonly showRemoveLocations = signal<boolean>(false);
  /** Location ids ticked for removal. A Set so the template row toggle stays O(1). */
  readonly removeLocationIds = signal<ReadonlySet<number>>(new Set());
  readonly removingLocations = signal<boolean>(false);

  /** The ticked sheets' locations, in row order, for the removal list. */
  readonly removableLocations = computed<BidSheetLocation[]>(() => this.bidLocations());

  /**
   * How many ticked sheets the removal would touch, so the dialog can say "from 2 sheets" rather than
   * letting a user on a multi-sheet view think they are only editing the one they were looking at.
   */
  readonly removeSheetCount = computed<number>(() => {
    const onSheets = this.sheetIdsByLocationId();
    const sheetIds = new Set<number>();
    for (const locationId of this.removeLocationIds()) {
      for (const sheetId of onSheets.get(locationId) ?? []) sheetIds.add(sheetId);
    }
    return sheetIds.size;
  });

  readonly allRemovableSelected = computed<boolean>(() => {
    const rows = this.removableLocations();
    return rows.length > 0 && rows.every(l => this.removeLocationIds().has(l.id));
  });

  openDeleteChoice(sheetId?: number): void {
    this.sheetActionTargetId.set(sheetId ?? null);
    if (!this.sheetActionTarget()) return;
    this.showDeleteChoice.set(true);
    this.showSheetMenu.set(false);
  }

  cancelDeleteChoice(): void {
    this.showDeleteChoice.set(false);
  }

  /** Into the existing owner-only sheet-delete confirmation, which already names the consequences. */
  chooseDeleteSheet(): void {
    this.showDeleteChoice.set(false);
    this.openDeleteSheetConfirm();
  }

  chooseRemoveLocations(): void {
    this.showDeleteChoice.set(false);
    this.removeLocationIds.set(new Set());
    this.showRemoveLocations.set(true);
  }

  cancelRemoveLocations(): void {
    this.showRemoveLocations.set(false);
    this.removeLocationIds.set(new Set());
  }

  toggleRemoveLocation(locationId: number): void {
    this.removeLocationIds.update(ids => {
      const next = new Set(ids);
      if (!next.delete(locationId)) next.add(locationId);
      return next;
    });
  }

  toggleAllRemoveLocations(): void {
    this.removeLocationIds.set(this.allRemovableSelected()
      ? new Set()
      : new Set(this.removableLocations().map(l => l.id)));
  }

  /**
   * Takes the ticked locations off every ticked sheet holding them -- one request per sheet, so a
   * batch cannot half-apply WITHIN a sheet.
   *
   * Across sheets it removes from all of them, because the row on screen stands for the location on
   * each: leaving it on the sheets that happen not to be first would put it straight back on the list
   * the moment they were looked at on their own.
   *
   * Flushes pending bid edits FIRST: the grid is rebuilt from the responses, so an unsaved cell on a
   * row that survives would otherwise be thrown away along with the removed ones.
   */
  confirmRemoveLocations(): void {
    const ids = [...this.removeLocationIds()];
    const onSheets = this.sheetIdsByLocationId();
    const bySheet = new Map<number, number[]>();
    for (const locationId of ids) {
      for (const sheetId of onSheets.get(locationId) ?? []) {
        const on = bySheet.get(sheetId);
        if (on) on.push(locationId); else bySheet.set(sheetId, [locationId]);
      }
    }
    if (bySheet.size === 0 || ids.length === 0 || this.removingLocations()) return;

    this._saveDirtyBids(() => {
      // Raised HERE, not before the flush: _saveDirtyBids never calls back when the bid save fails (it
      // keeps the edit and aborts whatever was queued behind it), so a flag set earlier stayed up --
      // "Removing..." forever, button dead until a reload. A second click during the flush is
      // harmless: _saveDirtyBids coalesces and fires only the latest callback.
      this.removingLocations.set(true);
      const sheetCount = bySheet.size;
      forkJoin([...bySheet].map(([sheetId, locationIds]) =>
        this.apiService.removeBidSheetLocations(sheetId, locationIds)))
        .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (sheets) => {
            this.removingLocations.set(false);
            this.showRemoveLocations.set(false);
            this.removeLocationIds.set(new Set());
            for (const sheet of sheets) this._applySheet(sheet);
            this._applyBidFilterSources();
            this.filterBids();
            this._refreshMapMarkers();
            if (this.editBidsMode()) this._buildEditGrid();
            const what = ids.length === 1 ? '1 location' : `${ids.length} locations`;
            this.toastService.success(sheetCount === 1
              ? `Removed ${what} from this sheet`
              : `Removed ${what} from ${sheetCount} sheets`);
          },
          error: () => {
            this.removingLocations.set(false);
            this.toastService.error('Failed to remove the locations');
          }
        });
    });
  }
  /** How a staged share reads in the list -- the kind matters, since "2190" alone is ambiguous. */
  shareKindLabel(type: BidSheetShareType): string {
    switch (type) {
      case 'trade-unit': return 'Trade unit';
      case 'trade-unit-group': return 'Group';
      case 'recap-group': return 'Recap group';
      default: return 'Person';
    }
  }

  /** Sheet-count behind the delete-location confirmation, fetched when the confirm dialog opens. */
  readonly deleteLocationSheetCount = signal<number | null>(null);
  /** Set of location IDs that are marked as Scoular facilities — used for row highlighting in edit bids grid and print. */
  readonly scoularLocationIds = computed<Set<number>>(() => {
    const ids = new Set<number>();
    for (const loc of this.allMapLocations()) {
      if (loc.isScoularFacility) ids.add(loc.id);
    }
    return ids;
  });
  /** True if the currently-selected panel location is a Scoular facility. */
  readonly panelSelectedIsScoular = computed<boolean>(() => {
    const id = this.panelSelectedLocationId();
    return id != null && this.scoularLocationIds().has(id);
  });
  /**
   * Flattened view of every in-scope location and its bids.
   *
   * Reads scopedLocations(), not bidLocations(), for the MAP's sake: bidLookup is built from this, and
   * it is what every pin's price, hover and status colour comes from. If it stayed on the sheet then
   * "All locations" only widened which pins got drawn while other people's locations rendered as
   * bidless dots. The panel and grid also read this, but they are hidden in All scope (they are the
   * sheet's), so in every state where they render the two lists are the same.
   */
  readonly bidEntries = computed<BidSheetEntry[]>(() => {
    const source = this.scopedLocations();
    // 'both' resolves to cash here: the map colours, side panel and print each need one number.
    const basisMode = this.priceMode() === 'basis';
    return source.flatMap(loc =>
      (loc.bids ?? []).map(bid => ({
        id: bid.id,
        locationId: loc.id,
        name: loc.name,
        address: loc.address,
        city: loc.city,
        state: loc.state,
        latitude: loc.latitude,
        longitude: loc.longitude,
        elevatorCode: loc.elevatorCode,
        barchartLocationKey: loc.barchartLocationKey,
        tradeUnitCode: loc.tradeUnitCode,
        groupName: loc.groupName,
        commodityCode: bid.commodityCode,
        commodityName: bid.commodityName,
        commodityCategory: bid.commodityCategory,
        cropYear: bid.cropYear,
        month: bid.month,
        // The entry carries whichever price the sheet is showing, so every downstream consumer --
        // map colours, panel, grid, print -- follows the toggle without knowing it exists.
        bid: basisMode ? (bid.basisBid ?? '') : bid.bid,
        source: bid.source ?? 'Manual',
        barchartSymbol: basisMode ? bid.basisSymbol : bid.barchartSymbol,
        quoteAsOf: basisMode ? bid.basisQuoteAsOf : bid.quoteAsOf,
        // Both prices travel alongside the selected one so the Edit Bids grid can show them together
        // without re-deriving anything. Only Both mode reads these.
        cashBid: bid.bid,
        basisBid: bid.basisBid,
        // The basis timestamp, always -- unlike quoteAsOf above, which is whichever side the toggle is
        // showing. BidSheetEntry has declared this field all along but nothing populated it, so a
        // consumer reading it silently got undefined. "Did this move today?" needs both sides: cash and
        // basis are independent instruments, so a basis-only move must still flag while in Cash mode.
        basisQuoteAsOf: bid.basisQuoteAsOf,
        coveredByCropYear: bid.coveredByCropYear,
        coveredByMonth: bid.coveredByMonth,
        cashChangedAt: bid.cashChangedAt,
        basisChangedAt: bid.basisChangedAt,
        underlyingFuture: bid.underlyingFuture,
        createdBy: bid.createdBy,
        createdAt: bid.createdAt,
        modifiedBy: bid.modifiedBy,
        modifiedAt: bid.modifiedAt
      }))
    );
  });
  /**
   * Pre-computed lookup: "locationId|commodityCode|cropYear|month" -> the latest BidSheetEntry for that
   * cell (by modifiedAt then createdAt). O(1) instead of repeated filter+sort.
   *
   * Keyed by id, not by name. A location's displayed name is per-sheet (BidSheetLocationLink.DisplayName),
   * so a name is not an identity: two sheets can call one elevator different things, and two different
   * elevators can share a name. Keying on the name collapsed the second case into one cell -- last write
   * wins, the other elevator's bid invisible -- and split the first into two.
   */
  private readonly bidLookup = computed(() => {
    const lookup = new Map<string, BidSheetEntry>();
    for (const e of this.bidEntries()) {
      const key = `${e.locationId}|${e.commodityCode}|${e.cropYear}|${e.month}`;
      const existing = lookup.get(key);
      if (!existing || new Date(e.modifiedAt || e.createdAt).getTime() > new Date(existing.modifiedAt || existing.createdAt).getTime()) {
        lookup.set(key, e);
      }
    }
    return lookup;
  });
  cropYears = signal<number[]>([]);
  crops = signal<string[]>([]);
  isLoading = signal<boolean>(false);

  /**
   * Every commodity that EXISTS to filter by -- the whole planting list, not just what some sheet has
   * priced. Only "All locations" uses this directly (see mapCropChoices): the catalog layer shows
   * elevators nobody has added, so there the filter has to offer a commodity before any sheet does.
   */
  readonly filterableCrops = computed<string[]>(() => {
    const source = this.plantingCommodities().length > 0 ? this.plantingCommodities() : this.allCommodities();
    const seen = new Set<string>();
    const codes: string[] = [];
    for (const c of source) {
      const code = (c.code ?? '').trim();
      const cat = (c.category ?? '').trim().toUpperCase();
      if (!code || seen.has(code) || BidSheetComponent._excludedCommodityCategories.has(cat)) continue;
      seen.add(code);
      codes.push(code);
    }
    return codes.sort();
  });

  /**
   * What the MAP's crop filter actually offers, which depends on what the map is showing.
   *
   * With a SHEET open: only the commodities that sheet's own locations have priced (`crops()`). The
   * sheet is the thing you're comparing, so offering a commodity nobody on it quotes can only produce
   * an empty panel with no visible cause. An empty sheet therefore offers just "All Crops" — correct,
   * because nothing is priced on it yet; commodities are added from the Edit Bids crop dropdown, which
   * has its own "Add a commodity…" search and is unaffected by this.
   *
   * In "All locations": every possible commodity (`filterableCrops`). That was the original reason
   * this list existed at all — the catalog layer draws elevators nobody has added, and narrowing THOSE
   * by commodity is the whole point of the filter there, so it can't wait for a sheet to price one.
   *
   * (Years deliberately do NOT work this way: `filterableYears` always offers last/this/next, because
   * looking at a year before anyone has priced it is normal and was asked for explicitly.)
   */
  readonly mapCropChoices = computed<string[]>(() =>
    this.showingAllLocations() ? this.filterableCrops() : this.crops());

  /**
   * Every year the YEAR filter offers: a sensible default span around today plus whatever years the
   * active sheet actually has bids for, so a real priced year is never missing just because it falls
   * outside the default window.
   */
  readonly filterableYears = computed<number[]>(() => {
    const now = new Date().getFullYear();
    // Last year, this year, next year -- the three an originator actually trades across: the old crop
    // still being priced out, the current one, and the new crop being booked forward. Anything further
    // out only appears if a bid genuinely exists for it (below), rather than offering empty years.
    const years = new Set<number>([now - 1, now, now + 1]);
    for (const y of this.cropYears()) years.add(y);
    return [...years].sort((a, b) => a - b);
  });

  // --- Old/New year logic (data-driven, navigable) ---
  // yearOffset 0 = latest two years, -1 = shift one year earlier, etc.
  yearOffset = signal(0);
  oldYear = computed(() => {
    const years = this.cropYears();
    if (years.length < 2) return null;
    const idx = years.length - 2 + this.yearOffset();
    return idx >= 0 && idx < years.length ? years[idx] : null;
  });
  newYear = computed(() => {
    const years = this.cropYears();
    if (years.length < 1) return null;
    const idx = years.length - 1 + this.yearOffset();
    return idx >= 0 && idx < years.length ? years[idx] : null;
  });
  // --- Old/New (month, year) pair for the panel comparison columns ---
  // The previous month vs the selected month, rolling the year over at January.
  newDisplay = computed(() => ({ month: this.selectedMonth(), year: this.selectedYear() }));
  oldDisplay = computed(() => {
    const year = this.selectedYear();
    const month = this.selectedMonth();
    if (month === 1) return { month: 12, year: year - 1 };
    return { month: month - 1, year };
  });
  /** Whether the BarChart picker and fed-bid display are turned on for this environment. */
  readonly barchartEnabled = environment.barchartBidsEnabled === true;


  // A fed bid that had sat unchanged for a while used to render at half opacity. It is gone: every bid
  // reads the same whether it is this morning's or August's. For a past month the month itself already
  // says the price is history, so the mute only made a correct number look degraded; for a live month
  // it was the one hint that an elevator had gone quiet, but opacity cannot say HOW quiet -- the as-of
  // date is on every cell and would answer that properly if it is ever wanted on screen.

  /** How recent counts as "just moved". A trading day: what changed since you last looked. */
  private static readonly CHANGED_WITHIN_HOURS = 24;

  /**
   * True when ANY of these timestamps is inside the last 24 hours.
   *
   * Takes several because a cell can move for different reasons and each records its own time: the feed
   * republishing cash (quoteAsOf) or basis (basisQuoteAsOf), or somebody typing over it (modifiedAt).
   * Undefined and unparseable are simply "no", so a location with no timestamps never claims freshness.
   */
  private _changedWithin24h(...timestamps: (string | undefined)[]): boolean {
    const cutoff = Date.now() - BidSheetComponent.CHANGED_WITHIN_HOURS * 3_600_000;
    return timestamps.some(ts => {
      if (!ts) return false;
      const when = new Date(ts).getTime();
      return !isNaN(when) && when >= cutoff;
    });
  }

  /**
   * Whether an ADDED location's bid for this period moved in the last 24 hours.
   *
   * Fed cells: the BASIS actually changing. Not quoteAsOf -- that is the vendor's re-post stamp and
   * refreshes most days whether or not the number moved. On 2026-09-10, 410 of 431 fed cells carried a
   * fresh stamp; 404 cash prices had moved, because cash follows the board every day, but only 64 basis
   * values had. Basis is the elevator's own decision, so that is the move worth a pulse, and the bridge
   * records exactly when it last changed (basisChangedAt) rather than when it was last re-posted.
   *
   * Manual cells: an edit (modifiedAt), or first entry (createdAt) -- a cell typed an hour ago has
   * changed as much as one edited an hour ago. With no crop or period selected there is no single cell
   * to judge, so it answers false rather than picking one arbitrarily.
   */
  private _locationChangedWithin24h(locationId: number, year: number | null, crop: string, month: number): boolean {
    if (!crop || !year) return false;
    const entry = this._getLatestEntry(locationId, year, crop, month);
    if (!entry) return false;
    return entry.source === 'Barchart'
      ? this._changedWithin24h(entry.basisChangedAt)
      : this._changedWithin24h(entry.modifiedAt ?? entry.createdAt);
  }

  /**
   * The "moved in the last 24h" marker: a slow brightness pulse on the pin itself.
   *
   * Returns a CSS class, not markup. A first attempt used a small white corner dot; it was fussy at pin
   * scale and needed its own legend swatch, which had to be drawn on some colour -- and whichever
   * colour it borrowed then looked like a status of its own. Pulsing the pin needs no extra geometry
   * and no fourth colour: the fill still says the status, the ring still says Scoular, and brightness is
   * the one channel neither of them uses.
   *
   * Keyframes live in global styles.css (Leaflet builds these elements outside the component template,
   * so a scoped rule would never reach them) -- see the comment there for why it is slow and shallow.
   */
  private _movedPulseClass(hasMoved: boolean): string {
    return hasMoved ? ' bid-moved-pulse' : '';
  }

  /**
   * A message worth showing a user, or '' when there isn't one.
   *
   * The server's validation errors are written for people ("A location named X already exists on this
   * trade unit") and are worth surfacing. Angular's transport errors are not: "Http failure response
   * for http://localhost:5000/api/bidsheet/bids/bulk: 500 Internal Server Error" is noise at best and
   * embarrassing in front of an audience, so those collapse to the caller's own plain wording.
   */
  private _errorToast(err: unknown, fallback: string): string {
    const message = (err as { message?: string })?.message?.trim();
    if (!message || /^Http failure/i.test(message) || message.includes('://')) return fallback;
    return `${fallback}: ${message}`;
  }

  /** Short, human "as of" for a vendor timestamp: today shows a time, older shows a date. */
  formatAsOf(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const isToday = d.toDateString() === new Date().toDateString();
    return isToday
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  formatMonthYear(month: number, year: number | null): string {
    if (year == null) return '';
    const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[month]} ${year.toString().slice(-2)}`;
  }

  /** Saved crop column order, or null when the user has never reordered. Persisted in
   *  BidSheetPreferences.CropOrder. Was a map keyed by trade unit, back when each desk kept its own. */
  private cropOrder = signal<string[] | null>(null);

  // --- Panel ---
  showPanel = signal<boolean>(false);
  /** The key explains the colour scheme once, then just covers the map, so it starts closed. */
  showLegend = signal<boolean>(false);
  /** Active base map: 'street' (OpenStreetMap) or 'satellite' (Esri aerial imagery + labels). */
  mapView = signal<'street' | 'satellite'>('street');
  /** True while a base-layer switch is loading its tiles — drives a brief loading overlay so the
   *  map doesn't visibly flash/pop tiles during the toggle. */
  mapSwitching = signal<boolean>(false);
  showFilters = signal<boolean>(true);
  /** True when the filter bar container is narrow enough that search/clear should wrap to a centered second row. */
  filterBarNarrow = signal<boolean>(false);
  private _filterBarObserver: ResizeObserver | null = null;
  /** Reference to the filter bar div so we can observe its width with ResizeObserver. */
  private filterBarRef = viewChild<ElementRef<HTMLElement>>('filterBar');
  /** Reference to the map container div for Leaflet initialization (replaces document.getElementById). */
  private mapElRef = viewChild<ElementRef<HTMLElement>>('mapEl');
  filteredBidItems = signal<BidSheetPanelItem[]>([]);
  /**
   * The session comparison reference, and the location whose detail the panel is showing.
   *
   * Both were names. A name is not an identity -- it is per-sheet and not unique -- so clicking one of
   * two same-named elevators set "the name", and the reference or the panel could then resolve to the
   * other one. A rename also had to be chased through both signals; an id does not move.
   */
  selectedLocationId = signal<number | null>(null);
  panelSelectedLocationId = signal<number | null>(null);

  /** The row the panel is showing, sheet-first so a per-sheet rename wins over the canonical name. */
  readonly panelSelectedRow = computed<BidSheetLocation | null>(() => {
    const id = this.panelSelectedLocationId();
    if (id == null) return null;
    return this.bidLocations().find(l => l.id === id)
        ?? this.allMapLocations().find(l => l.id === id)
        ?? null;
  });

  /** What to CALL the panel's location. Display only. */
  readonly panelSelectedName = computed<string>(() => this.panelSelectedRow()?.name ?? '');
  showDeleteLocationConfirm = signal(false);
  deleteMode = signal(false);
  showDeleteCropConfirm = signal(false);
  pendingDeleteCrop = signal<string>('');
  editingLocationName = signal(false);
  editLocationNameValue = signal('');

  /** All crop/bid rows for the location selected in the panel */
  readonly panelLocationBids = computed(() => {
    const locationId = this.panelSelectedLocationId();
    if (locationId == null) return [];
    const oldD = this.oldDisplay();
    const newD = this.newDisplay();
    const entries = this.bidEntries().filter(e => e.locationId === locationId);
    let cropSet = [...new Set(entries.map(e => e.commodityCode).filter(Boolean))].sort();
    // Only show crops that have bids for the displayed old/new periods
    cropSet = cropSet.filter(crop =>
      this._getLatestBid(locationId, newD.year, crop!, newD.month) ||
      this._getLatestBid(locationId, oldD.year, crop!, oldD.month));

    // Reference comparison — color-code each crop row vs the session reference, whichever kind
    // (an added location via selectedLocationId, or a catalog listing via catalogReferenceKey).
    const isRef = this.selectedLocationId() === locationId;

    return cropSet.map(crop => {
      const oldBid = this._getLatestBid(locationId, oldD.year, crop!, oldD.month);
      const newBid = this._getLatestBid(locationId, newD.year, crop!, newD.month);
      // Get reference bid for this crop (if any). If reference doesn't have this crop → leave white (status 'none').
      const oldRefBid = this._hasReference() && !isRef ? this._referenceBid(oldD.year, crop!, oldD.month) : null;
      const newRefBid = this._hasReference() && !isRef ? this._referenceBid(newD.year, crop!, newD.month) : null;
      const oldStatus = isRef ? 'reference' : this._computeItemStatus(oldBid, false, oldRefBid);
      const newStatus = isRef ? 'reference' : this._computeItemStatus(newBid, false, newRefBid);
      // Feed provenance for the displayed periods, so the panel can say where a number came from and
      // when the elevator last touched it. Taken from the newer period when both are fed.
      const newEntry = this._getLatestEntry(locationId, newD.year, crop!, newD.month);
      const oldEntry = this._getLatestEntry(locationId, oldD.year, crop!, oldD.month);
      const fedEntry = newEntry?.source === 'Barchart' ? newEntry : (oldEntry?.source === 'Barchart' ? oldEntry : null);
      return {
        crop: crop!, oldBid, newBid, oldStatus, newStatus,
        oldBidLabel: this._getDisplayBid(locationId, oldD.year, crop!, oldD.month, false),
        newBidLabel: this._getDisplayBid(locationId, newD.year, crop!, newD.month, false),
        oldBidContract: this.panelContractFor(locationId, oldD.year, crop!, oldD.month),
        newBidContract: this.panelContractFor(locationId, newD.year, crop!, newD.month),
        isFed: !!fedEntry, fedAsOf: fedEntry?.quoteAsOf
      };
    });
  });

  // --- Edit Bids ---
  editBidsMode = signal(false);
  addCommodityQuery = signal('');

  /**
   * Identity of one grid cell within a row: crop + crop year + month.
   *
   * Every column-keyed store on EditBidsRow uses this, and it is reconstructed from two OTHER data
   * shapes -- the save payload (_clearDirtyForSaved) and a print column (printCellValue) -- neither of
   * which the compiler can check against the column set. It lives in one place for that reason: print
   * reads grid rows with a key it builds itself, and a mismatch does not throw, it returns undefined,
   * which the print layout then treats as an empty column and DROPS. The failure mode is columns
   * quietly vanishing from a producer's sheet.
   */
  private _colKey(crop: string, year: number, month: number): string {
    return `${crop}#${year}#${month}`;
  }

  /**
   * The grid's columns, in display order. The single source of what Edit Bids shows.
   *
   * Empty means "not seeded yet" rather than "no columns": openEditBids fills it on first open, from
   * the saved list or, for a user who predates it, by synthesising the old cross product so their
   * arrangement survives the upgrade. See _seedColumns.
   */
  readonly selectedColumns = signal<EditBidColumnPick[]>([]);

  /**
   * Ceiling on how many columns can be ADDED interactively. Both mode renders two inputs per cell, so
   * 24 columns is already ~48 inputs a row, and _buildEditGrid rebuilds all of them on a price-mode
   * toggle, a rename and a star click.
   *
   * Deliberately not applied to the synthesised list: a user arriving from the old cross product may
   * already be over it, and silently dropping their columns on upgrade would look like data loss.
   * Refusing a 25th Add costs them nothing by comparison -- nothing is lost, the button just stops.
   */
  static readonly MAX_EDIT_BID_COLUMNS = 24;
  readonly maxEditBidColumns = BidSheetComponent.MAX_EDIT_BID_COLUMNS;

  /**
   * True when the loaded preference row had no SelectedColumns at all -- an existing user meeting the
   * new grid for the first time. Their columns are synthesised from the legacy fields below.
   *
   * Distinct from "the saved list was empty", which is a user who removed every column on purpose and
   * must not have the old cross product handed back to them.
   */
  private _needsColumnSeed = false;

  /** Legacy inputs stashed by _loadPreference, used once by _seedColumns. Never written back. */
  private _legacyCropOrder: string[] | null = null;
  private _legacyHiddenCrops: Set<string> | null = null;
  private _legacyMonths: number[] | null = null;
  private _legacyYears: number[] | null = null;

  /**
   * Years offered by the picker: every year the trade unit has bids for, plus one beyond the latest.
   * Without that extra year there would be no way to enter the first bid of a new crop year here.
   */
  readonly editBidsYearChoices = computed(() => {
    const known = this.cropYears();
    const base = known.length > 0 ? [...known] : [this.selectedYear() || new Date().getFullYear()];
    const next = Math.max(...base) + 1;
    // Last / this / next calendar year are always offered (filterableYears, the map dropdown's own
    // rule), so a sheet priced only for the new crop can still open last year's -- the old crop being
    // priced out is exactly what an originator compares against. Before this the list was only the
    // years the sheet had already priced plus one forward, so there was no way BACK to a year with no
    // bids yet. Priced years and one beyond the latest stay in.
    return [...new Set([...this.filterableYears(), ...base, next])].sort((a, b) => a - b);
  });

  /** Column key currently being dragged. Empty when not dragging. A drag now moves ONE column, not a
   *  whole crop block, so the highlight follows the key rather than the crop. */
  draggingColKey = signal<string>('');

  // --- Add column picker ---------------------------------------------------------------------
  /**
   * Open state and staged pick. Crop and year deliberately PERSIST across an Add so building a run of
   * months is pick-Add-pick-Add rather than three round trips through the whole form; the month is
   * what usually changes between adjacent columns.
   */
  readonly showAddColumn = signal(false);

  /**
   * Below the trigger, left-aligned, flipping above when there is no room. The Locations header is
   * at the top-left of a scroller, so "below" almost always wins; the fallback matters on a short
   * viewport where the grid is near the bottom of the window.
   */
  readonly addColumnOverlayPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 }
  ];

  readonly addColumnCrop = signal<string>('');
  readonly addColumnYear = signal<number>(new Date().getFullYear());
  readonly addColumnMonth = signal<number>(BidSheetComponent.currentMonth());
  readonly addColumnQuery = signal('');
  /**
   * True while a flush is in flight. _saveDirtyBids keeps only the LATEST onDone when a save is
   * already running, so two adds fired back to back would silently drop the first one's mutation.
   * The old dropdowns could not hit this because their Cancel/Done modality serialised them; a
   * popover that stays open for repeat adds can.
   */
  readonly columnMutationBusy = signal(false);

  readonly atColumnLimit = computed(() => this.selectedColumns().length >= BidSheetComponent.MAX_EDIT_BID_COLUMNS);

  /** The staged pick as a column key, for the duplicate check. */
  private readonly _addColumnKey = computed(() =>
    this._colKey(this.addColumnCrop(), this.addColumnYear(), this.addColumnMonth()));

  readonly addColumnIsDuplicate = computed(() =>
    this.addColumnCrop() !== '' && this._gridColumnKeys().has(this._addColumnKey()));

  readonly canAddColumn = computed(() =>
    this.addColumnCrop() !== '' && !this.addColumnIsDuplicate() && !this.atColumnLimit() && !this.columnMutationBusy());

  /**
   * Crops the picker offers: the sheet's priced codes first, then anything else the user is entitled
   * to, matched on the query.
   *
   * Sourced from filteredCommodities, NOT allCommodities -- the former applies the user's group and
   * trade-unit scope, so an originator outside the organics desk is not offered organic commodities.
   * The union with crops() is what keeps the codes already on the sheet reachable without typing.
   */
  readonly addColumnCropChoices = computed(() => {
    const query = this.addColumnQuery().trim().toLowerCase();
    const priced = this.crops();
    const scoped = this.filteredCommodities(this.addColumnQuery());
    // Names come from the full commodity list purely for display; the SCOPE decision is
    // filteredCommodities', above. crops() is already the sheet's own priced set, so it is in scope
    // by construction.
    const names = new Map(this.allCommodities().map(c => [(c.code ?? '').trim(), c.name ?? '']));
    const seen = new Set<string>();
    const out: Array<{ code: string; name: string }> = [];
    for (const code of priced) {
      if (seen.has(code)) continue;
      const name = names.get(code) ?? code;
      if (query !== '' && !code.toLowerCase().includes(query) && !name.toLowerCase().includes(query)) continue;
      seen.add(code);
      out.push({ code, name });
    }
    for (const c of scoped) {
      if (!c.code || seen.has(c.code)) continue;
      seen.add(c.code);
      out.push({ code: c.code, name: c.name ?? c.code });
    }
    return out;
  });
  editBidsRows = signal<EditBidsRow[]>([]);
  editBidsSaving = signal(false); // gates ONLY the Done button; silent auto-save never touches it
  addLocationSaving = signal(false); // in-flight guard for the Add-Location "Done" button
  editBidsGridLoading = signal(false);
  // Silent auto-save coordination (blur / navigation). Plain fields — they don't drive UI.
  private _autoSaving = false;
  private _autoSaveRerun = false;
  private _pendingOnDone: (() => void) | null = null;
  // Distinct bid cells saved during the current edit session (incl. silent auto-saves), so "Done"
  // can report the session total. Keyed by name|commodity|cropYear|month; reset when the grid opens.
  private _editBidsSavedKeys = new Set<string>();

  /** Month name abbreviations for column labels. */
  private static readonly MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** 1-12 with their labels, for the Add-column month select. Derived from MONTH_NAMES, and declared
   *  immediately after it: an instance initialiser may not reach a static declared further down. */
  readonly monthChoices = BidSheetComponent.MONTH_NAMES
    .map((label, value) => ({ value, label }))
    .filter(m => m.value >= 1);

  /**
   * Grid columns: the user's list, projected.
   *
   * Order is theirs -- whatever they dragged the headers into -- not a consequence of any nesting.
   * The key format is unchanged from when columns were a cross product, which is why every
   * column-keyed store (cell values, dirty tracking, board and coverage chips, the save payload,
   * keyboard navigation, the export) carries over untouched.
   *
   * De-duplicates again, after the load sanitiser already has: this is the projection the template
   * tracks by, and a duplicate key here is an NG0955 that takes the screen down. Cheap insurance on a
   * list this short.
   */
  readonly editGridColumns = computed(() => {
    const picks = this.selectedColumns();
    const seen = new Set<string>();
    const columns: Array<{ key: string; crop: string; month: number; year: number; label: string; board: string }> = [];
    for (const pick of picks) {
      const key = this._colKey(pick.crop, pick.year, pick.month);
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push({
        key,
        crop: pick.crop,
        month: pick.month,
        year: pick.year,
        // Code, month and year on one line, always. It used to drop the year whenever more than one
        // was in play and let a band row above carry it instead, which cost a row of header height
        // and split one column's identity across two places.
        label: `${pick.crop} ${BidSheetComponent.MONTH_NAMES[pick.month]} ${pick.year}`,
        // Not shown in the header any more -- it made every header two lines tall. Still carried
        // because the Excel export takes it, and print resolves its own.
        board: this.boardConsensus(pick.crop, pick.year, pick.month)
      });
    }
    return columns;
  });

  /**
   * The keys currently on the grid. Used to refuse a duplicate in the Add-column picker, and by print
   * to tell a live column from one it has to fall back for.
   */
  private readonly _gridColumnKeys = computed(() => new Set(this.editGridColumns().map(c => c.key)));


  // --- Commodities lookup ---
  allCommodities = signal<Commodity[]>([]);
  // Curated "Planting Intentions" commodity set — drives the Add-Location crop search so the picker
  // matches the rest of the app. Full allCommodities is still used for code->name resolution.
  plantingCommodities = signal<Commodity[]>([]);

  // --- Add competitor modal ---
  addLocationMode = signal<boolean>(false);       // map is in "pick location" mode
  addLocationOrigin = signal<'editBids' | null>(null); // where the add-location flow was launched from
  showAddLocationForm = signal<boolean>(false);    // form popup is open
  newLocationName = signal<string>('');
  newLocationLat = signal<number | null>(null);
  newLocationLng = signal<number | null>(null);
  newLocationIsScoular = signal<boolean>(false);
  private _addLocationPin: Leaflet.Marker | null = null;

  // ---------------------------------------------------------------------------
  // Add from BarChart (picker)
  // ---------------------------------------------------------------------------
  /** Picker panel open; the map switches to showing vendor candidates instead of our own pins. */
  barchartMode = signal<boolean>(false);
  /** "Where should this location come from?" chooser, shown before either add flow starts. */
  showAddSourceChoice = signal<boolean>(false);
  /** Trade-unit code → description, so the picker's selector can be searched by location too. */
  /** Map centre the picker searches around. Updated as the user pans. */
  barchartSearchArea = signal<BarchartSearchArea | null>(null);
  /** Candidate clicked on the map, handed to the picker so map and panel stay in step. */
  barchartSelectedKey = signal<string | null>(null);

  /** Keys ticked in the picker list. Their pins go blue so the batch is visible on the map too. */
  barchartTickedKeys = signal<ReadonlySet<string>>(new Set<string>());
  barchartAdding = signal<boolean>(false);
  /** Candidate pins live on their own layer so they never mix with the clustered bid-sheet pins. */
  private _barchartLayer: Leaflet.LayerGroup | null = null;
  /** Candidate markers by location key, so the selected one can be re-styled without a full redraw. */
  private _barchartMarkers = new Map<string, Leaflet.Marker>();
  /** Keys already on some bid sheet — they draw hollow, and stay hollow when selected. */
  /** Candidate keys already on the sheet being added to -- drawn hollow, since ticking them is a no-op. */
  private _barchartOnSheetKeys = new Set<string>();
  /** Candidate keys that are Scoular sites -- drawn green. Cached because _highlightBarchartPin only
   *  has the key to work from, not the listing. */
  private _barchartScoularKeys = new Set<string>();
  private _barchartMoveTimer: ReturnType<typeof setTimeout> | null = null;
  private _pickerRef = viewChild<BarchartPickerComponent>('picker');

  // ---------------------------------------------------------------------------
  // Catalog map — the whole BarChart catalog (~4,002 listings), not just what's been added.
  //
  // This is the base layer the map always shows (outside add-location/barchart-picker overlay
  // modes), separate from the picker's own search: the picker asks "what's here so I can tick some",
  // this asks "what's here at all" continuously as the user pans, so the map is a real catalog
  // browser rather than only ever showing the handful of locations someone has already added.
  // ---------------------------------------------------------------------------
  /** Every catalog listing within the current view. Refetched on pan/zoom, debounced. */
  private catalogLocations = signal<BarchartCatalogLocation[]>([]);
  private _catalogMoveTimer: ReturnType<typeof setTimeout> | null = null;
  private _catalogLoadGen = 0; // guards against a slow request landing after a newer one
  private _catalogDetailGen = 0; // the same guard for the popup: clicking a second pin supersedes the first

  /** The catalog pin the user clicked -- drives the detail popup. Null closes it. */
  readonly catalogDetailKey = signal<string | null>(null);
  readonly catalogDetailLoading = signal<boolean>(false);
  readonly catalogDetail = signal<BarchartCatalogLocationDetail | null>(null);

  /**
   * Why the catalog popup's table is empty, in the user's terms.
   *
   * Three different reasons land in the same blank space -- the elevator publishes nothing at all, it
   * publishes nothing in the selected crop, or nothing of the selected price type -- and saying which
   * is the difference between "this elevator is quiet" and "I have a filter on".
   */
  readonly catalogDetailEmptyMessage = computed<string>(() => {
    const detail = this.catalogDetail();
    if (!detail || detail.bids.length === 0) return 'No active bids published right now.';

    const mode = this.priceMode();
    const priced = mode === 'both' ? 'cash or basis' : mode;
    const crop = this.selectedCrop();
    return crop
      ? `No ${crop} ${priced} bids published right now.`
      : `No ${priced} bids published right now.`;
  });

  /** The same choice as a sentence, for the printed sheet's header. */
  readonly printPriceModeCaption = computed<string>(() => {
    const mode = this.priceMode();
    return mode === 'basis' ? 'Basis bids' : mode === 'both' ? 'Cash and basis bids' : 'Cash bids';
  });

  /**
   * The BarChart key behind the location the panel is showing, or null for a hand-made one.
   *
   * The published-bids popup is keyed on the vendor's listing, not on our row, so a manual location
   * has nothing to open -- there is no vendor book behind it.
   */
  readonly panelSelectedBarchartKey = computed<string | null>(() => {
    return this.panelSelectedRow()?.barchartLocationKey ?? null;
  });

  /**
   * True when the listing in the popup is already on the open sheet.
   *
   * The popup used to be reachable only from a catalog dot, which by definition was not on the sheet,
   * so Add was always the right offer. It opens from the panel now, where the location always IS on
   * the sheet -- and adding a second time collides with UQ_BidSheetLocations_BarchartKey and comes
   * back an error rather than doing anything useful.
   */
  readonly catalogDetailOnActiveSheet = computed<boolean>(() => {
    const key = this.catalogDetail()?.location.locationKey;
    if (!key) return false;
    // Any TICKED sheet, not just the first: the popup opens from a pin, the pin is drawn because the
    // location is on one of the sheets on screen, and offering Add for a location already visible in
    // the panel just collides with UQ_BidSheetLocations_BarchartKey.
    return this.bidLocations().some(l => l.barchartLocationKey === key);
  });

  /**
   * Opens the published-bids popup for the location the panel is showing.
   *
   * Deliberately not _selectCatalogLocation, which also toggles the comparison reference: from a dot
   * on the map those two go together, but from the panel the user asked to look at a book, not to
   * re-anchor every other pin's colour.
   */
  openPublishedBidsForPanelLocation(): void {
    const key = this.panelSelectedBarchartKey();
    if (key) this.openCatalogDetail(key);
  }

  /** What the Cash/Basis/Both toggle is currently showing, for a column header to name. */
  readonly priceModeLabel = computed<string>(() => {
    const mode = this.priceMode();
    return mode === 'basis' ? 'Basis' : mode === 'both' ? 'Cash / Basis' : 'Cash';
  });

  /**
   * The catalog popup's bid table, one row per crop and delivery period.
   *
   * The vendor publishes cash and basis as separate instruments, so detail.bids arrives as two flat
   * rows for the same crop and month, told apart only by isBasis. Printed straight out that read as a
   * duplicated crop under a column headed "Price", with no way to tell which number was which -- and
   * whatever the Cash/Basis/Both toggle said, the list showed everything.
   *
   * Pairing them by crop and period lets the table answer the toggle: one column of the selected
   * price, or both side by side. A period the elevator only quotes one way keeps its row and shows a
   * dash for the other -- dropping it would hide a real bid.
   *
   * The crop dropdown narrows it the same way it narrows everything else on the screen: All Crops
   * shows the elevator's whole book, a chosen crop shows only that one. A vendor commodity we have no
   * mapping for can never match a chosen crop, so it drops out -- which is right, since it cannot
   * reach the sheet either.
   */
  readonly catalogDetailRows = computed<{ crop: string; cropYear: number; month: number; cash: number | null; basis: number | null }[]>(() => {
    const detail = this.catalogDetail();
    if (!detail) return [];
    const mode = this.priceMode();
    const onlyCrop = this.selectedCrop();
    const byPeriod = new Map<string, { crop: string; cropYear: number; month: number; cash: number | null; basis: number | null }>();
    for (const bid of detail.bids) {
      if (onlyCrop && bid.commodityCode !== onlyCrop) continue;
      const crop = bid.commodityCode || bid.vendorCommodity;
      const key = `${crop}|${bid.cropYear}|${bid.month}`;
      let row = byPeriod.get(key);
      if (!row) {
        row = { crop, cropYear: bid.cropYear, month: bid.month, cash: null, basis: null };
        byPeriod.set(key, row);
      }
      if (bid.isBasis) row.basis = bid.price ?? null;
      else row.cash = bid.price ?? null;
    }
    const rows = [...byPeriod.values()];
    // In a single-price mode a period the elevator does not quote that way has nothing to say here.
    if (mode === 'basis') return rows.filter(r => r.basis != null);
    if (mode === 'cash') return rows.filter(r => r.cash != null);
    return rows.filter(r => r.cash != null || r.basis != null);
  });
  readonly catalogDetailAdding = signal<boolean>(false);

  /**
   * The catalog (not-yet-added) location currently set as the comparison reference, mutually
   * exclusive with selectedLocationId (an ADDED location's reference). Kept as its own signal
   * rather than overloading selectedLocationId: that one is an ID matched against bidLocations()
   * everywhere it's read (panel rows, _findLocationByName, ...), and a catalog listing's key isn't a
   * name in that sense -- reusing it would make every one of those lookups silently miss.
   */
  readonly catalogReferenceKey = signal<string | null>(null);
  /** Detail responses already fetched, by location key -- lets the reference comparison resolve a
   *  catalog reference's bid for any period without a new fetch each time the filters change, and
   *  the click-to-detail popup reuse whatever a prior click already has. */
  private readonly _catalogDetailCache = new Map<string, BarchartCatalogLocationDetail>();

  /**
   * Detail requests currently in flight, one per location key.
   *
   * A single click on a catalog dot asked for the same listing TWICE: the reference toggle warms the
   * cache, and the popup opens, and neither could see the other's request because the cache is only
   * written on response. Two identical calls doubled the chance one of them failed -- and the popup's
   * failure path closes the popup, so a click whose data had already arrived on the other request
   * could still end with nothing on screen. Sharing the request makes a second caller wait on the
   * first instead of racing it.
   */
  private readonly _catalogDetailInFlight = new Map<string, Observable<BarchartCatalogLocationDetail>>();

  /**
   * One shared fetch per location key: the cache if it is warm, the in-flight request if there is
   * one, otherwise a new request that fills both.
   */
  private _fetchCatalogDetail(locationKey: string): Observable<BarchartCatalogLocationDetail> {
    const inFlight = this._catalogDetailInFlight.get(locationKey);
    if (inFlight) return inFlight;

    const request = this.apiService.getBarchartLocationDetail(locationKey).pipe(
      takeUntilDestroyed(this.destroyRef),
      tap(detail => this._catalogDetailCache.set(locationKey, detail)),
      // Cleared on success AND on failure, so a location that failed once can be retried by clicking
      // it again rather than replaying the error for the rest of the session.
      finalize(() => this._catalogDetailInFlight.delete(locationKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this._catalogDetailInFlight.set(locationKey, request);
    return request;
  }

  /**
   * Where a BARCHART add places its locations: whatever trade units are selected, and nothing else.
   *
   * This used to fall back to EVERY trade unit the user could reach when nothing was selected, which
   * meant ticking three elevators on a twelve-desk book silently created thirty-six placements on
   * other people's sheets.
   *
   * Both of those computeds are gone with trade-unit scoping: adding a location creates ONE row that
   * everybody can see, so there is no destination to choose and nothing to multiply. The picker's
   * bulk add went from N locations x M desks to N rows.
   */

  private static readonly _excludedCommodityCategories = new Set([
    'CURRENCY', 'TRANSPORTATION', 'FEED & FERT INGREDIENTS', 'FEED &FERT INGREDIENTS'
  ]);

  filteredCommodities(query: string): { code: string; name: string }[] {
    if (!query || query.length < 1) return [];
    // Split on whitespace so multi-word queries (e.g. "yellow corn") narrow results
    // instead of broadening them. Every word must appear somewhere in the code OR name.
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const seen = new Set<string>();
    const results: { code: string; name: string; rank: number }[] = [];
    // Search the curated Planting Intentions list; fall back to the full list if it's not loaded
    // so the picker never goes blank.
    // Drop commodities scoped to a trade group the user isn't in (organics). Applied to the
    // fallback too, or a failed curated fetch would leak them into a conventional picker.
    const inScope = { groupNames: this.appState.inScopeGroupNames(), tradeUnitCodes: this.appState.inScopeTradeUnitCodes() };
    const curated = scopeCommodities(this.plantingCommodities(), inScope);
    const source = curated.length > 0 ? curated : scopeCommodities(this.allCommodities(), inScope);
    for (const c of source) {
      const code = (c.code ?? '').trim();
      const cat = (c.category ?? '').trim().toUpperCase();
      const desc = (c.name ?? '').trim();
      if (!code || seen.has(code) || BidSheetComponent._excludedCommodityCategories.has(cat)) continue;
      const codeLower = code.toLowerCase();
      const descLower = desc.toLowerCase();
      // AND match: every word must be in either the code or the name (category ignored)
      const allMatch = words.every(w => codeLower.includes(w) || descLower.includes(w));
      if (!allMatch) continue;
      seen.add(code);
      // Rank: exact code match (0) < code starts-with (1) < name starts-with (2) < contains (3)
      const fullQ = words.join(' ');
      let rank = 3;
      if (codeLower === fullQ) rank = 0;
      else if (codeLower.startsWith(fullQ)) rank = 1;
      else if (descLower.startsWith(fullQ)) rank = 2;
      results.push({ code, name: `${(desc || cat).toUpperCase()} (${code.toUpperCase()})`, rank });
    }
    return results
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .slice(0, 20)
      .map(({ code, name }) => ({ code, name }));
  }


  // --- Refresh timer ---

  // --- Map ---
  private _map: Leaflet.Map | null = null;
  /** Track the currently-hovered marker so we can force-reset its icon when another marker is hovered.
   *  Fixes Leaflet's stuck-hover bug where setIcon() swaps the DOM element and a pending mouseout never fires. */
  private _hoveredMarker: { marker: any; resetIcon: any } | null = null;
  // markercluster's MarkerClusterGroup isn't in @types/leaflet — keep loose-typed
  private _clusterGroup: any = null;
  /**
   * Plain (non-clustering) layer for the catalog dots. Bundling them into _clusterGroup collapsed
   * whole regions into a single numbered blob at any zoom wide enough to matter, which is the
   * opposite of what a browsable catalog map is for -- a user panning around wants to see where
   * things actually are. Small dots at their true coordinates are cheap enough to just show all of,
   * so this layer never clusters; _spreadOverlappingPins isn't run on it either, for the same reason.
   */
  private _catalogLayer: Leaflet.LayerGroup | null = null;
  // Base layers for the street/satellite toggle. _satelliteLayer is a layerGroup
  // (Esri World Imagery + road/place label overlays) for a hybrid aerial view.
  private _streetLayer: Leaflet.TileLayer | null = null;
  private _satelliteLayer: Leaflet.LayerGroup | null = null;
  // The imagery tile layer inside _satelliteLayer — watched for its 'load' event so we can hide the
  // switching spinner / drop the old base only once the new tiles are actually painted.
  private _satelliteImageryLayer: Leaflet.TileLayer | null = null;
  private _isMapInitialized = false;
  private _searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _zoomDebounceTimer: ReturnType<typeof setTimeout> | null = null;


  // Geocode cache removed — coordinates now come from API (dbo.ElevatorCoordinates)

  /**
   * The key everything on this screen is saved under: crop order, hidden crops, selected months and
   * years, print layout, row order.
   *
   * It used to be the sorted list of selected trade units, so each desk kept its own arrangement. The
   * bid sheet is not scoped by trade unit any more, so there is one arrangement per user and it lives
   * under the key the codebase already reserved for exactly that.
   *
   * A constant rather than an inlined literal because it is about to become the SHEET key, and every
   * save and load path has to move together when it does -- a save writing one key while a load reads
   * another loses the user's layout in silence.
   */
  readonly preferenceKey = computed(() => BidSheetComponent.GLOBAL_PREF_KEY);

  constructor() {
    // Keep the map in step with the BarChart panel: whichever listing is open shows as a blue pin, so
    // the name on screen is tied to a place on the map rather than left to be guessed.
    effect(() => {
      const key = this.barchartSelectedKey();
      this._highlightBarchartPin(key);
    });

    // Observe the filter bar's actual width so we can wrap search/clear to a centered second row when narrow.
    effect(() => {
      const ref = this.filterBarRef();
      if (this._filterBarObserver) { this._filterBarObserver.disconnect(); this._filterBarObserver = null; }
      if (!ref?.nativeElement) return;
      this._filterBarObserver = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width ?? 0;
        const narrow = width > 0 && width < FILTER_BAR_WRAP_WIDTH;
        if (this.filterBarNarrow() !== narrow) this.filterBarNarrow.set(narrow);
      });
      this._filterBarObserver.observe(ref.nativeElement);
    });

    // Load all bid sheet locations for map display (once)
    this._loadAllMapLocations();

    // Restores saved crop/month/year/columns AND which sheet was last open (_loadSheets runs once
    // that comes back). This used to be gated on having a trade unit selected and, worse, was never
    // actually called after that gate was written -- so no preference has loaded since the trade-unit
    // selector came off the screen. Fixed here rather than left for whoever notices next.
    this._loadPreference();

    // Load commodities on init (once). Two lists:
    //  - allCommodities (full): used to resolve a bid's commodity code -> name (existing bids may
    //    carry any code), so display never loses a name.
    //  - plantingCommodities (curated "Planting Intentions" set): drives the Add-Location crop
    //    SEARCH so the picker offers the same clean set as the rest of the app.
    this.apiService.getCommodities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (commodities) => this.allCommodities.set(commodities),
      error: () => {}
    });
    this.apiService.getPlantingCommodities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (commodities) => this.plantingCommodities.set(commodities),
      error: () => {}
    });

    this._initializeMapWhenReady();

    this.destroyRef.onDestroy(() => {
      this._destroyMap();
      if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
      if (this._zoomDebounceTimer) clearTimeout(this._zoomDebounceTimer);
      if (this._barchartMoveTimer) clearTimeout(this._barchartMoveTimer);
      if (this._filterBarObserver) this._filterBarObserver.disconnect();
    });
  }

  // =========================================================================
  // Data Loading

  /**
   * Loads every bid sheet location, with its bids, in one call.
   *
   * This is the ONLY load now. There used to be a second, per-trade-unit path that fetched each
   * desk's locations plus its crop and crop-year lists as three calls apiece, with retries and
   * partial-failure handling -- all of which existed to answer "what may this desk see". Nothing is
   * scoped by desk any more, and this endpoint was already unscoped, so the whole pipeline went and
   * the crop and year lists are derived from the payload that just arrived.
   */
  private _loadAllMapLocations(onLoaded?: () => void): void {
    this.apiService.getAllBidSheetLocations().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (locs) => {
        this.allMapLocations.set(locs);
        this._applyBidFilterSources();
        this.filterBids();
        this._refreshMapMarkers();
        this.isLoading.set(false);
        this.editBidsGridLoading.set(false);
        if (this.editBidsMode() && this._buildDirtyBids().length === 0) this._buildEditGrid();
        onLoaded?.();
      },
      error: () => {
        this.isLoading.set(false);
        this.editBidsGridLoading.set(false);
        this.toastService.error('Failed to load bid sheet locations');
      }
    });
  }

  /**
   * Derives the crop and crop-year filter lists from the bids that were just loaded, and defaults the
   * selection to something that actually has data.
   *
   * These used to come from two per-trade-unit endpoints. Deriving them from the payload is a call
   * the screen no longer has to make, and it cannot disagree with what is on the map -- the old pair
   * could, whenever a desk's list and the map's locations were fetched a moment apart.
   *
   * Reads bidLocations(), the ACTIVE SHEET's locations -- not scopedLocations(), which the map follows.
   * These lists drive the grid's columns and the panel's empty states, and both of those are the
   * sheet's (hidden in All scope), so they describe the sheet. A crop list built from every location
   * would offer crops nobody on this sheet has priced, and picking one would show an empty grid with
   * no visible cause. (The MAP's crop dropdown is filterableCrops, a separate all-possible list.)
   */
  private _applyBidFilterSources(): void {
    const bids = this.bidLocations().flatMap(l => l.bids ?? []);
    const crops = [...new Set(bids.map(b => b.commodityCode).filter((c): c is string => !!c))].sort();
    const years = [...new Set(bids.map(b => b.cropYear).filter((y): y is number => y != null))].sort((a, b) => a - b);
    this.crops.set(crops);
    this.cropYears.set(years);
    if (!this.selectedCrop() || !crops.includes(this.selectedCrop())) {
      this.selectedCrop.set(crops[0] ?? '');
    }
    if (years.length > 0 && !years.includes(this.selectedYear())) {
      this.selectedYear.set(years[years.length - 1]);
      this.yearOffset.set(0);
    }
  }

  // =========================================================================
  // Sheets
  // =========================================================================

  /**
   * Loads the sheets the user owns or is shared on, then decides which one is open.
   *
   * Preference order: the sheets the preference row named, minus any that no longer exist -- one may
   * have been deleted, or unshared, since it was saved; otherwise, if there is exactly one sheet,
   * that one, since a picker would be pure friction with nothing to pick between. With zero sheets,
   * or more than one and no saved choice, nothing is ticked and the empty state asks the user to
   * create or pick one.
   */
  private _loadSheets(preferredSheetIds: number[]): void {
    this.apiService.getBidSheets().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => {
        this.sheets.set(list);
        this.sheetsLoaded.set(true);
        const visible = preferredSheetIds.filter(id => list.some(s => s.id === id));
        if (visible.length > 0) {
          this.selectedSheetIds.set(visible);
        } else if (list.length === 1) {
          this.selectedSheetIds.set([list[0].id]);
        }
        this._applyBidFilterSources();
        this.filterBids();
        this._refreshMapMarkers();
      },
      error: (err) => {
        this.sheetsLoaded.set(true);
        if (isDevMode()) console.error('[BidSheet] failed to load sheets', err);
        this.toastService.error('Failed to load bid sheets');
      }
    });
  }

  /**
   * Swaps in a freshly-saved sheet. Every sheet mutation (create, rename, share, layout, add/remove
   * location, reorder) returns the whole sheet back from the server, so this is the one place that
   * merges a write into local state -- no path re-derives it by hand and risks drifting from what the
   * server actually stored.
   */
  private _applySheet(sheet: BidSheet): void {
    this.sheets.update(list => {
      const idx = list.findIndex(s => s.id === sheet.id);
      if (idx === -1) return [...list, sheet].sort((a, b) => a.name.localeCompare(b.name));
      const next = [...list];
      next[idx] = sheet;
      return next;
    });
  }

  /** Shows exactly this sheet and nothing else -- what picking one from a menu has always meant. */
  selectSheet(id: number): void {
    this.showSheetMenu.set(false);
    this.setSelectedSheets([id]);
  }

  /**
   * Ticks or unticks one sheet, leaving the rest of the selection alone. Ticking appends, so the
   * order on screen is the order they were ticked in.
   */
  toggleSheet(id: number): void {
    const current = this.selectedSheetIds();
    this.setSelectedSheets(current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  }

  /**
   * The one way the selection changes. Every caller funnels through here so nothing can set the ids
   * and forget to rebuild what depends on them.
   */
  setSelectedSheets(ids: number[]): void {
    const next = [...new Set(ids)];
    const current = this.selectedSheetIds();
    // Picking a sheet ANYWHERE means "show me this sheet", so it narrows the map back from "All
    // locations" too. This used to live only in the map dropdown's handler, and choosing a sheet from
    // the panel's own menu in All scope did nothing visible: the sheet was usually already selected
    // underneath, so the no-change return below fired and mapScope stayed 'all'. Must run BEFORE that
    // return for exactly that reason.
    if (next.length > 0 && this.mapScope() === 'all') this.setMapScope('sheet');
    if (next.length === current.length && next.every((id, i) => id === current[i])) return;
    this.selectedSheetIds.set(next);
    this._applyBidFilterSources();
    this.filterBids();
    this._refreshMapMarkers();
    this._saveSelectedSheets(next);
  }

  toggleSheetMenu(): void {
    this.showSheetMenu.update(v => !v);
  }

  /**
   * Changing the sheet selection from inside the Edit Bids grid. Flushes pending cell edits against
   * the CURRENT rows before they change underneath them -- same ordering confirmCropSelection uses,
   * and for the same reason: _buildEditGrid reshapes what the dirty cells refer to.
   *
   * Unticking the last sheet is refused rather than obeyed. The grid IS the sheets' rows; with none
   * it would be a header over nothing, and the user would have to leave the screen to get back.
   */
  onEditBidsSheetToggle(id: number): void {
    const current = this.selectedSheetIds();
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    if (next.length === 0) {
      this.toastService.error('Keep at least one bid sheet open while editing bids');
      return;
    }
    this._changeEditBidsSheets(next);
  }

  onEditBidsSheetPickOnly(id: number): void {
    this._changeEditBidsSheets([id]);
  }

  private _changeEditBidsSheets(ids: number[]): void {
    const current = this.selectedSheetIds();
    if (ids.length === current.length && ids.every((id, i) => id === current[i])) return;
    this._saveDirtyBids(() => {
      this.setSelectedSheets(ids);
      this._buildEditGrid();
    });
  }

  /**
   * The "nothing to compare against" pin colour, for an added location that is neither the reference
   * nor a Scoular site.
   *
   * Scope-dependent because the map is a different thing in each mode. Showing one sheet, every pin is
   * an added location and grey is the established neutral. Showing ALL locations, the map is mostly
   * catalog listings -- and an added location rendered grey among thousands of blue ones reads as
   * "this pin is special" when the only thing different about it is that somebody added it. Same
   * colour, so the two layers look like one map. Once a reference IS set both layers switch to the
   * shared status palette, so they already agree from there on.
   */
  private _neutralPinColors(shape: 'pill' | 'dot' = 'pill'): { bg: string; border: string } {
    if (!this.showingAllLocations()) return { bg: '#6b7280', border: '#4b5563' };
    // Matched per shape, not just per layer: the catalog draws its dots lighter than its pills, so
    // borrowing the pill colour for an added DOT made that one pin visibly darker than every catalog
    // dot around it -- the same "why is mine different" the colour split caused in the first place.
    return shape === 'dot'
      ? { bg: BidSheetComponent.CATALOG_DOT_BG, border: BidSheetComponent.CATALOG_DOT_BORDER }
      : { bg: BidSheetComponent.CATALOG_PILL_BG, border: BidSheetComponent.CATALOG_PILL_BORDER };
  }

  /**
   * Narrows the map to the open sheet, or widens it to every added location plus the catalog. The
   * panel re-filters because bidEntries follows the scope (the panel is hidden in All scope, but its
   * filtered list is still what sheet-scope pins are pruned against on the way back). The grid is not
   * touched: it only ever opens in sheet scope (openEditBids), and it is a full-screen overlay, so this
   * cannot be reached while it is up.
   */
  setMapScope(scope: 'sheet' | 'all'): void {
    if (this.mapScope() === scope) return;
    this.mapScope.set(scope);
    this.usageTracking.postClickEvent('interaction', 'bidsheet', `map-scope-${scope}`);

    // Narrowing takes the catalog layer off the map, so anything anchored to it has to go with it: an
    // open detail popup for a pin that no longer exists, and -- worse -- a catalog listing left as the
    // comparison reference, which would go on colouring every sheet pin against something invisible.
    if (scope === 'sheet') {
      this.catalogDetailKey.set(null);
      this.catalogDetail.set(null);
      if (this.catalogReferenceKey()) this.catalogReferenceKey.set(null);
    } else {
      // The panel shows nothing in All scope, so nothing is "open in the panel" -- and the pin for
      // whatever was open would otherwise stay drawn in its expanded, hover-style form.
      this.panelSelectedLocationId.set(null);
    }

    // bidEntries follows the scope, so the panel's filtered list (the model sheet-scope pins are pruned
    // against) and the pins themselves both need recomputing. Crop/year lists are the sheet's and
    // don't change here.
    this.filterBids();
    this._refreshMapMarkers();
    // Widening needs the catalog fetched (sheet scope skips it); narrowing clears what it left behind.
    this._loadCatalogLocations();
  }

  /** Records which sheets are open, so a reload reopens the same ones in the same order. */
  private _saveSelectedSheets(ids: number[]): void {
    const cropCode = this.selectedCrop() || null;
    const month = this.selectedMonth();
    const cropYear = this.selectedYear() || null;
    this.apiService.setBidSheetPreference({
      tradeUnitKey: BidSheetComponent.GLOBAL_PREF_KEY, cropCode, month, cropYear,
      selectedBidSheetIds: JSON.stringify(ids)
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      error: (err) => { if (isDevMode()) console.warn('Failed to save the open bid sheets', err); }
    });
  }

  openCreateSheet(): void {
    this.newSheetName.set('');
    this.showCreateSheet.set(true);
    this.showSheetMenu.set(false);
  }

  cancelCreateSheet(): void {
    this.showCreateSheet.set(false);
    // Backing out of naming returns to the picker with the basket still ticked, rather than throwing
    // the selection away -- the user cancelled the name, not the batch.
    this.pendingBulkAdd.set(null);
  }

  confirmCreateSheet(): void {
    const name = this.newSheetName().trim();
    if (!name || this.creatingSheet()) return;

    // Naming a sheet for a batch that's already picked: create it and add them, in one step.
    const pending = this.pendingBulkAdd();
    if (pending) {
      this.pendingBulkAdd.set(null);
      this.showCreateSheet.set(false);
      this._createSheetThenBulkAdd(name, pending);
      return;
    }

    this.creatingSheet.set(true);
    this.apiService.createBidSheet(name).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (sheet) => {
        this.creatingSheet.set(false);
        this._applySheet(sheet);
        // A sheet you just made is the one you want to look at, on its own -- not added alongside
        // whatever was already ticked, which would open it half-buried in other people's rows.
        this.setSelectedSheets([sheet.id]);
        this.showCreateSheet.set(false);
        this.toastService.success(`Created "${sheet.name}"`);
      },
      error: (err) => {
        this.creatingSheet.set(false);
        this.toastService.error(err?.status === 409
          ? `You already have a bid sheet called "${name}"`
          : 'Failed to create bid sheet');
      }
    });
  }

  openRenameSheet(sheetId?: number): void {
    this.sheetActionTargetId.set(sheetId ?? null);
    const sheet = this.sheetActionTarget();
    if (!sheet) return;
    this.renameSheetName.set(sheet.name);
    this.showRenameSheet.set(true);
    this.showSheetMenu.set(false);
  }

  cancelRenameSheet(): void {
    this.showRenameSheet.set(false);
  }

  confirmRenameSheet(): void {
    const sheet = this.sheetActionTarget();
    const name = this.renameSheetName().trim();
    if (!sheet || !name || this.renamingSheet()) return;
    this.renamingSheet.set(true);
    this.apiService.renameBidSheet(sheet.id, name).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.renamingSheet.set(false);
        this._applySheet(updated);
        this.showRenameSheet.set(false);
        this.toastService.success(`Renamed to "${updated.name}"`);
      },
      error: (err) => {
        this.renamingSheet.set(false);
        this.toastService.error(err?.status === 409
          ? `You already have a bid sheet called "${name}"`
          : 'Failed to rename bid sheet');
      }
    });
  }

  /**
   * No argument means "keep whatever is already aimed" -- unlike the other openers, which reset.
   * chooseDeleteSheet() calls it that way to carry through the aim openDeleteChoice() set.
   *
   * The resolved id is PINNED here rather than left to sheetActionTarget's fall-back-to-first, so the
   * open confirmation cannot come to mean a different sheet than the one it was opened for.
   */
  openDeleteSheetConfirm(sheetId?: number): void {
    const target = sheetId ?? this.sheetActionTarget()?.id ?? null;
    if (target == null) return;
    this.sheetActionTargetId.set(target);
    this.showDeleteSheetConfirm.set(true);
    this.showSheetMenu.set(false);
  }

  cancelDeleteSheet(): void {
    this.showDeleteSheetConfirm.set(false);
  }

  confirmDeleteSheet(): void {
    // By id, straight out of the list -- NOT through sheetActionTarget, whose fall-back-to-first
    // would turn "the sheet I aimed at has gone" into "delete a different one".
    const id = this.sheetActionTargetId();
    const sheet = this.sheets().find(x => x.id === id);
    if (!sheet || this.deletingSheet()) return;
    this.deletingSheet.set(true);
    this.apiService.deleteBidSheet(sheet.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deletingSheet.set(false);
        this.showDeleteSheetConfirm.set(false);
        this.sheets.update(list => list.filter(s => s.id !== sheet.id));
        // Only the deleted one goes; anything else ticked stays on screen.
        this.setSelectedSheets(this.selectedSheetIds().filter(id => id !== sheet.id));
        this.sheetActionTargetId.set(null);
        // Delete is reachable from the Edit Bids header now. The grid is the sheet's, and the sheet
        // is gone -- leaving it open would show an empty grid under a blank dropdown.
        if (this.editBidsMode()) this.closeEditBids();
        this.toastService.success(`Deleted "${sheet.name}"`);
        this._applyBidFilterSources();
        this.filterBids();
        this._refreshMapMarkers();
      },
      error: () => {
        this.deletingSheet.set(false);
        this.toastService.error('Failed to delete bid sheet');
      }
    });
  }

  // ---- Sharing ------------------------------------------------------------------------------

  openShareSheet(sheetId?: number): void {
    this.sheetActionTargetId.set(sheetId ?? null);
    const sheet = this.sheetActionTarget();
    if (!sheet) return;
    this.pendingShares.set([...sheet.shares]);
    this.shareSearch.set('');
    this.showShareSheet.set(true);
    this.showSheetMenu.set(false);
    this.shareTab.set('person');
    if (!this.shareCatalogLoaded() && !this.shareCatalogLoading()) {
      this.shareCatalogLoading.set(true);
      // Two calls, not one: people/desks/groups come from the entitlements catalog, while recap
      // groups come from their own endpoint -- which already returns ONLY the ones this caller
      // created or belongs to, so "groups I am in" needs no filtering on this side.
      forkJoin({
        catalog: this.apiService.getEntitlementsCatalog(),
        recapGroups: this.apiService.getRecapGroups().pipe(catchError(() => of([] as RecapGroup[]))),
      }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ catalog, recapGroups }) => {
          this.shareCatalog.set(catalog.people ?? []);
          this.shareTradeUnits.set(catalog.tradeUnits ?? []);
          this.shareTradeUnitGroups.set(catalog.groups ?? []);
          this.shareRecapGroups.set(recapGroups);
          this.shareCatalogLoaded.set(true);
          this.shareCatalogLoading.set(false);
        },
        error: () => {
          this.shareCatalogLoading.set(false);
          this.toastService.error('Failed to load the directory');
        }
      });
    }
  }

  cancelShareSheet(): void {
    this.showShareSheet.set(false);
  }

  addShareCandidate(option: { memberType: BidSheetShareType; memberId: string; label: string }): void {
    this.pendingShares.update(list => [...list, {
      memberType: option.memberType,
      memberId: option.memberId,
      // userId only means something for a person; leaving a desk code here would read as a user id.
      userId: option.memberType === 'person' ? option.memberId : '',
      name: option.label,
      sharedBy: '', sharedAt: '',
    }]);
    this.shareSearch.set('');
  }

  /** Keyed on type AND id: a desk and a person can share an id string. */
  removeShareCandidate(memberType: BidSheetShareType, memberId: string): void {
    this.pendingShares.update(list =>
      list.filter(s => !(s.memberType === memberType && s.memberId === memberId)));
  }

  confirmShareSheet(): void {
    const sheet = this.sheetActionTarget();
    if (!sheet || this.savingShares()) return;
    this.savingShares.set(true);
    const members = this.pendingShares().map(s => ({ memberType: s.memberType, memberId: s.memberId, name: s.name }));
    this.apiService.setBidSheetShares(sheet.id, members).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.savingShares.set(false);
        this._applySheet(updated);
        this.showShareSheet.set(false);
        this.toastService.success('Sharing updated');
      },
      error: () => {
        this.savingShares.set(false);
        this.toastService.error('Failed to update sharing');
      }
    });
  }

  // =========================================================================

  /** Special key used to store the user's single, global bid-sheet preference row. */
  private static readonly GLOBAL_PREF_KEY = '__global__';

  /**
   * Loads the one saved preference row: crop/month/year, columns, print layout, and which sheet was
   * last open.
   *
   * There used to be a per-trade-unit key with this as its fallback (a forkJoin of two fetches that
   * merged). There is only one key now, so it is one fetch -- and the row order that used to live
   * here (BidSheetLocationOrders, name-keyed, per user) is gone too: it now lives on the sheet itself,
   * shared with everyone on it, keyed by location id rather than a name a rename could orphan.
   */
  private _loadPreference(): void {
    this.apiService.getBidSheetPreference(BidSheetComponent.GLOBAL_PREF_KEY)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pref) => {
          const key = BidSheetComponent.GLOBAL_PREF_KEY;
          let changed = false;

          // Apply crop if available
          const available = this.crops();
          const desiredCrop = pref?.cropCode ?? null;
          if (desiredCrop && available.includes(desiredCrop) && this.selectedCrop() !== desiredCrop) {
            this.selectedCrop.set(desiredCrop);
            changed = true;
          }

          // Apply month (always valid 0-12)
          const desiredMonth = pref?.month ?? null;
          if (desiredMonth != null && this.selectedMonth() !== desiredMonth) {
            // 0 is the retired Yearly period: a preference from before it went falls back to today.
            this.selectedMonth.set(desiredMonth > 0 ? desiredMonth : BidSheetComponent.currentMonth());
            changed = true;
          }

          // Apply year if available in current cropYears
          const desiredYear = pref?.cropYear ?? null;
          if (desiredYear != null && this.cropYears().includes(desiredYear) && this.selectedYear() !== desiredYear) {
            const years = this.cropYears();
            const idx = years.indexOf(desiredYear);
            this.selectedYear.set(desiredYear);
            if (idx >= 0) this.yearOffset.set(idx - (years.length - 1));
            changed = true;
          }

          // The grid's columns. Null here is meaningful: it marks a user who has not opened the new
          // grid yet, whose list is synthesised from the four legacy fields below. Absent rather than
          // empty, so a user who deliberately removed every column is not re-seeded behind them.
          const selectedColumnsJson = pref?.selectedColumns ?? null;
          const savedColumns = BidSheetComponent.parseSelectedColumns(selectedColumnsJson);
          if (savedColumns.length > 0) {
            this.selectedColumns.set(savedColumns);
            this._needsColumnSeed = false;
          } else {
            this._needsColumnSeed = selectedColumnsJson === null;
          }

          // The three fields below describe the RETIRED cross product. They are stashed, never
          // applied: the only thing left that reads them is _seedColumns, once, for a user who has no
          // SelectedColumns yet. Sanitised on the way in all the same -- synthesis must not be handed
          // a month of 0 (the retired Yearly period) or a year of NaN.
          const hiddenCropsJson = pref?.hiddenCrops ?? null;
          if (hiddenCropsJson) {
            try { this._legacyHiddenCrops = new Set(JSON.parse(hiddenCropsJson)); }
            catch { this._legacyHiddenCrops = new Set(); }
          }

          const selectedMonthsJson = pref?.selectedMonths ?? null;
          if (selectedMonthsJson) {
            try { this._legacyMonths = BidSheetComponent.cleanMonths(JSON.parse(selectedMonthsJson)); }
            catch { this._legacyMonths = null; }
          }

          const selectedYearsJson = pref?.selectedYears ?? null;
          if (selectedYearsJson) {
            try {
              const parsed: unknown = JSON.parse(selectedYearsJson);
              const years = Array.isArray(parsed)
                ? [...new Set(parsed.map(y => Math.trunc(Number(y))).filter(y => y >= 1900 && y <= 2999))]
                    .sort((a, b) => a - b)
                : [];
              if (years.length > 0) this._legacyYears = years;
            } catch { /* invalid JSON -- synthesis falls back to the panel's year */ }
          }

          // Apply crop column order if available
          const cropOrderJson = pref?.cropOrder ?? null;
          if (cropOrderJson) {
            try {
              const savedOrder: string[] = JSON.parse(cropOrderJson);
              this.cropOrder.set(savedOrder);
              this._legacyCropOrder = savedOrder;
              // Bring back any crop the user added but has not priced yet. The server derives its commodity
              // list from saved BIDS, so a crop with none is absent from it, and the bid load runs before
              // this -- which is why an added-then-unused column disappeared on a page reload. The saved
              // order is the record that the user asked for that column, so it is what restores it.
              const known = new Set(this.crops());
              const missing = savedOrder.filter(c => c && !known.has(c));
              if (missing.length > 0) this.crops.update(cs => [...cs, ...missing]);
              if (this.editBidsMode()) this._buildEditGrid();
            } catch { /* invalid JSON — skip */ }
          }

          // Restore the cash/basis/both choice. Validated rather than trusted: an unrecognised value
          // falls back to cash rather than putting the sheet in a mode nothing renders.
          //
          // 'both' used to fall into that fallback, so it saved correctly and then came back as cash on
          // every load -- which is why a sheet set to Both printed cash, and why the map, panel and
          // export all quietly dropped the basis half after a refresh.
          const savedMode = pref?.priceMode;
          this.priceMode.set(savedMode === 'basis' || savedMode === 'both' ? savedMode : 'cash');

          // Apply saved print/export layout if available. Sanitize on read so malformed/out-of-range
          // persisted data can't break the year pickers.
          const printLayoutJson = pref?.printLayout ?? null;
          if (printLayoutJson) {
            try {
              const l = JSON.parse(printLayoutJson);
              // yearlyRows, when present, belongs to the retired Yearly period and is ignored.
              if (typeof l?.address === 'string') this.printAddress.set(l.address);
              if (typeof l?.phone === 'string') this.printPhone.set(l.phone);
              if (typeof l?.highlightScoular === 'boolean') this.printHighlightScoularLocations.set(l.highlightScoular);
              // Retired 'sideBySide' / 'stacked' values fall back to the default; the next save rewrites them.
              this.printLayoutStyle.set(parsePrintLayoutStyle(l?.layoutStyle));
            } catch { /* invalid JSON — keep defaults */ }
          }

          if (changed) {
            this.filterBids();
            this._refreshMapMarkers();
          }

          // Sheets load last, using whichever one this preference row says was open.
          this._loadSheets(BidSheetComponent.parseSheetIds(pref?.selectedBidSheetIds));
        },
        // A failed preference load must not block the screen from showing sheets at all.
        error: (err) => { if (isDevMode()) console.warn('Failed to load bid sheet preference', err); this._loadSheets([]); }
      });
  }

  /** Persists the current crop, month, and year preferences (fire-and-forget). */
  private _savePreference(): void {
    const cropCode = this.selectedCrop() || null;
    const month = this.selectedMonth();
    const cropYear = this.selectedYear() || null;
    // Cash/basis rides along with crop, month and year: it's the same kind of choice, and having it
    // reset on every visit would be its own small annoyance.
    const priceMode = this.priceMode();
    this.apiService.setBidSheetPreference({ tradeUnitKey: BidSheetComponent.GLOBAL_PREF_KEY, cropCode, month, cropYear, priceMode })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save bid sheet preference', err); } });
  }

  /** Pixel width of the side panel when open. */
  private static readonly PANEL_WIDTH_PX = 440;

  /** Computes the lat/lng that, when used as map center, places (lat, lng) at the visual center of the map area not covered by the panel. */
  private _offsetCenter(lat: number, lng: number, zoom: number): Leaflet.LatLng {
    if (!this._map || !this._L) return this._L!.latLng(lat, lng);
    if (!this.showPanel()) return this._L.latLng(lat, lng);
    // Panel covers right side. To keep marker centered in the visible area,
    // we shift the map center LEFT (in pixel space) by half the panel width.
    const point = this._map.project([lat, lng], zoom);
    const adjusted = point.add([BidSheetComponent.PANEL_WIDTH_PX / 2, 0]);
    return this._map.unproject(adjusted, zoom);
  }

  /** Smoothly moves the map to a single location, accounting for the side panel if open. */
  private _flyToLocation(lat: number, lng: number, zoom?: number): void {
    if (!this._map || !this._L) return;
    const targetZoom = zoom ?? Math.max(this._map.getZoom(), 11);
    const center = this._offsetCenter(lat, lng, targetZoom);
    this._map.flyTo(center, targetZoom, { duration: 0.6 });
  }

  private _zoomToBidLocations(): void {
    if (!this._map || !this._L) return;
    const locs = this.bidLocations().filter(l => l.latitude && l.longitude);
    if (locs.length === 0) return;

    // Prioritize: selected location → first location
    const refId = this.selectedLocationId();
    const refLoc = refId != null ? locs.find(l => l.id === refId) : null;
    const panelOpen = this.showPanel();
    const rightPad = panelOpen ? BidSheetComponent.PANEL_WIDTH_PX + 20 : 50;

    if (refLoc) {
      this._flyToLocation(refLoc.latitude!, refLoc.longitude!, 10);
    } else if (locs.length === 1) {
      this._flyToLocation(locs[0].latitude!, locs[0].longitude!, 10);
    } else {
      const bounds = this._L.latLngBounds(locs.map(l => [l.latitude!, l.longitude!] as [number, number]));
      // fitBounds with right padding ensures bounds fit in the visible area (excluding the panel)
      this._map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [rightPad, 80], maxZoom: 12 });
    }
  }

  // =========================================================================
  // Filter & Display (Panel)
  // =========================================================================

  /**
   * Switches between the cash and basis views. Only fed bids carry a basis, so a sheet of manually
   * typed bids goes largely blank in basis mode — that is the data being honest, not a fault.
   */
  setPriceMode(mode: 'cash' | 'basis' | 'both'): void {
    if (this.priceMode() === mode) return;
    this.priceMode.set(mode);
    this.usageTracking.postClickEvent('interaction', 'bidsheet', `price-mode-${mode}`);
    this.onFilterChange();
    this._savePreference();
    // Cash and basis are separate BarChart instruments with independent quotes, so a catalog pin's
    // price pill has to be re-fetched for the newly chosen one -- it is not a client-side relabel of
    // a value already in hand the way it is for an added location's bid.
    this._loadCatalogLocations();
    if (this.editBidsMode()) this._buildEditGrid();
  }

  onFilterChange(): void {
    if (this._map) this._map.closePopup();
    this.filterBids();
    this._refreshMapMarkers();
  }

  onMapCropChange(): void {
    this.onFilterChange();
    this._savePreference();
    this._loadCatalogLocations(); // crop narrows the catalog dots too, not just the added-location pins
  }

  onYearDropdownChange(year: number): void {
    this.selectedYear.set(year);
    // Sync yearOffset so newYear() matches the dropdown selection
    const years = this.cropYears();
    const idx = years.indexOf(year);
    if (idx >= 0) {
      this.yearOffset.set(idx - (years.length - 1));
    }
    this.onFilterChange();
    this._savePreference();
    this._loadCatalogLocations(); // year is part of the matched-bid-price period
  }

  onMonthDropdownChange(month: number): void {
    this.selectedMonth.set(month);
    this.onFilterChange();
    this._savePreference();
    this._loadCatalogLocations(); // month is part of the matched-bid-price period
  }

  shiftYearsBack(): void {
    // One month back, rolling the year at January.
    const m = this.selectedMonth();
    if (m === 1) {
      this.selectedMonth.set(12);
      this.selectedYear.update(y => y - 1);
    } else {
      this.selectedMonth.set(m - 1);
    }
    this.onFilterChange();
    this._savePreference();
    this._loadCatalogLocations();
  }

  shiftYearsForward(): void {
    // One month forward, rolling the year at December.
    const m = this.selectedMonth();
    if (m === 12) {
      this.selectedMonth.set(1);
      this.selectedYear.update(y => y + 1);
    } else {
      this.selectedMonth.set(m + 1);
    }
    this.onFilterChange();
    this._savePreference();
    this._loadCatalogLocations();
  }

  /** Search filters map pins (panel stays full) and re-queries the catalog layer, debounced 250ms. */
  onSearchInput(): void {
    if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
    this._searchDebounceTimer = setTimeout(() => {
      this._refreshMapMarkers();
      this._loadCatalogLocations();
    }, 250);
  }

  filterBids(): void {
    // Every location is in scope and every location has crop-year data derived the same way, so
    // the panel filter always prunes map pins too, and bids, statuses and the reference comparison
    // always render. Both were once conditional on a trade unit being selected, and the name-only
    // fallback list that ran when neither held has gone with them.
    const basis = this.selectedBasis();

    let items: BidSheetPanelItem[] = [];

    const crop = this.selectedCrop();
    const oldD = this.oldDisplay();
    const newD = this.newDisplay();

    // Compute reference bids per period for status comparison. _referenceBid resolves whichever
    // kind of reference is set -- an added location (via bidLookup) or a catalog one (via its
    // cached detail, once hovered or clicked) -- so every other row's color follows either kind
    // the same way.
    const refId = this.selectedLocationId();
    const selectedYr = this.selectedYear();
    const month = this.selectedMonth();
    let oldRefBid: number | null = null;
    let newRefBid: number | null = null;
    let selectedRefBid: number | null = null;
    if (this._hasReference()) {
      oldRefBid = this._referenceBid(oldD.year, crop, oldD.month);
      newRefBid = this._referenceBid(newD.year, crop, newD.month);
      selectedRefBid = this._referenceBid(selectedYr, crop, month);
    }

    // Add location entries — filter by crop if one is selected
    const entries = crop
      ? this.bidEntries().filter(e => e.commodityCode === crop)
      : this.bidEntries();
    // One row per LOCATION, not per name. Two sheets can call the same elevator different things and
    // two elevators can share a name, so a name-keyed set both split and merged rows wrongly.
    const uniqueIds = new Set(entries.map(e => e.locationId));

    // Ensure reference location always appears even if it has no bid for the selected crop
    if (refId != null) uniqueIds.add(refId);

    // Built once, not once per row: a .find() over bidEntries()/allMapLocations() inside the loop
    // below is O(rows x entries), which is fine at a few dozen locations and stops being fine once
    // the map is showing the whole BarChart catalog.
    const entryById = new Map<number, BidSheetEntry>();
    for (const e of this.bidEntries()) if (!entryById.has(e.locationId)) entryById.set(e.locationId, e);
    // The name to PRINT comes from the locations in scope, which carry the per-sheet DisplayName.
    const nameById = new Map<number, string>();
    for (const l of this.scopedLocations()) nameById.set(l.id, l.name);
    const scoularIdsForItems = this.scoularLocationIds();

    for (const locationId of uniqueIds) {
      const oldBid = this._getLatestBid(locationId, oldD.year, crop, oldD.month);
      const newBid = this._getLatestBid(locationId, newD.year, crop, newD.month);
      const selectedBid = this._getLatestBid(locationId, selectedYr, crop, month);
      const entryWithCoords = entryById.get(locationId);
      const name = nameById.get(locationId) ?? entryWithCoords?.name ?? '';
      const isRef = locationId === refId;

      items.push({
        type: 'entry',
        locationId,
        name,
        isScoular: scoularIdsForItems.has(locationId),
        isRef,
        latitude: entryWithCoords?.latitude ?? null,
        longitude: entryWithCoords?.longitude ?? null,
        oldBid,
        newBid,
        oldBidLabel: this._getDisplayBid(locationId, oldD.year, crop, oldD.month, false),
        newBidLabel: this._getDisplayBid(locationId, newD.year, crop, newD.month, false),
        oldBidContract: this.panelContractFor(locationId, oldD.year, crop, oldD.month),
        newBidContract: this.panelContractFor(locationId, newD.year, crop, newD.month),
        oldCoveredBy: this.coverageLabelFor(locationId, oldD.year, crop, oldD.month),
        newCoveredBy: this.coverageLabelFor(locationId, newD.year, crop, newD.month),
        oldStatus: isRef ? 'reference' : this._computeItemStatus(oldBid, false, oldRefBid),
        newStatus: isRef ? 'reference' : this._computeItemStatus(newBid, false, newRefBid),
        status: isRef ? 'reference' : this._computeItemStatus(selectedBid, false, selectedRefBid)
      });
    }

    // Include locations with no bids yet (only when no crop filter is active)
    if (!crop) {
      for (const loc of this.bidLocations()) {
        if (uniqueIds.has(loc.id)) continue;
        const isRef = loc.id === refId;
        items.push({
          type: 'entry',
          locationId: loc.id,
          name: loc.name,
          isScoular: !!loc.isScoularFacility,
          isRef,
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
          oldBid: '',
          newBid: '',
          oldStatus: 'none',
          newStatus: 'none',
          status: isRef ? 'reference' : 'none'
        });
      }
    }

    // Status (basis) filter — always keep the reference item
    if (basis !== 'all') {
      items = items.filter(item => item.status === 'reference' || item.status === basis);
    }

    // Sort: reference first, then alphabetical
    items.sort((a, b) => {
      if (a.isRef) return -1;
      if (b.isRef) return 1;
      return a.name.localeCompare(b.name);
    });

    this.filteredBidItems.set(items);
  }

  private _getLatestBid(locationId: number, year: number | null, commodityCode: string, month: number): string {
    if (!year || !commodityCode) return '';
    return this.bidLookup().get(`${locationId}|${commodityCode}|${year}|${month}`)?.bid ?? '';
  }

  /**
   * The board most locations in a column quote against: "commodity|cropYear|month" -> e.g. "ZCU26".
   *
   * A column mixes boards more often than it sounds like it should -- 15 of the 55 fed columns on Dev
   * do. Some are elevators that rolled to the next contract early (August corn against ZCZ26 while
   * neighbours still quote ZCU26); HRWW is worse, with the same column split between Kansas City
   * (KEU26) and Chicago (ZWU26) -- different exchanges. Those numbers are not comparable, and a basis
   * against the wrong board silently reads as a better or worse bid than it is.
   *
   * The header names this consensus once; only cells that deviate from it get marked. Marking every
   * cell was rejected: 40 of the 55 columns are uniform, so the repeats would bury the mismatches,
   * which are the whole point.
   *
   * Majority wins; ties break to the alphabetically first board so the label never flip-flops between
   * loads. Counts each location once (the lookup already keeps only the latest entry per cell).
   */
  private readonly _columnBoards = computed(() => {
    const counts = new Map<string, Map<string, number>>();
    for (const e of this.bidLookup().values()) {
      if (e.source !== 'Barchart') continue;
      const board = e.underlyingFuture?.trim();
      if (!board) continue;
      const key = `${e.commodityCode}|${e.cropYear}|${e.month}`;
      const perBoard = counts.get(key) ?? new Map<string, number>();
      perBoard.set(board, (perBoard.get(board) ?? 0) + 1);
      counts.set(key, perBoard);
    }
    const consensus = new Map<string, string>();
    for (const [key, perBoard] of counts) {
      let best = ''; let bestCount = -1;
      for (const [board, n] of perBoard) {
        if (n > bestCount || (n === bestCount && board < best)) { best = board; bestCount = n; }
      }
      consensus.set(key, best);
    }
    return consensus;
  });

  /** The column's consensus board, or '' when the column has no fed bids (or is the Year column). */
  boardConsensus(crop: string, year: number | null, month: number): string {
    if (!year) return '';
    return this._columnBoards().get(`${crop}|${year}|${month}`) ?? '';
  }

  /**
   * The board a fed month cell is quoted against, '' on manual cells. Every fed bid shows this --
   * the business wants the contract on the number itself, so a producer never has to look away from
   * a bid to know what it is priced off. Deviation from the column consensus additionally turns the
   * label, so a cell against a different board than its column still declares it.
   */
  cellBoardFor(locationId: number, year: number | null, crop: string, month: number): string {
    const entry = this._getLatestEntry(locationId, year, crop, month);
    if (entry?.source !== 'Barchart') return '';
    return entry.underlyingFuture?.trim() ?? '';
  }

  private _getLatestEntry(locationId: number, year: number | null, commodityCode: string, month: number): BidSheetEntry | null {
    if (!year || !commodityCode) return null;
    return this.bidLookup().get(`${locationId}|${commodityCode}|${year}|${month}`) ?? null;
  }

  /**
   * The bid text a map pin or hover label shows. Cash and basis print the one selected price; Both
   * prints them together, because a pin has no room for a second line and "4.98 / -30" reads the way
   * an originator says it.
   *
   * Status colouring deliberately does NOT use this -- it keys off the cash value alone, because a
   * combined string has no numeric meaning and would compare as NaN against the reference.
   */
  /**
   * @param includeContract false drops the "(ZCU26)" suffix. Only the MAP passes false, and only at a
   * wide zoom -- the contract doubles a pill's width, and a region's worth of them is what makes the
   * map cramped. The panel, the grid and print always name it; so does hover, at any zoom.
   */
  private _getDisplayBid(locationId: number, year: number | null, crop: string, month: number, includeContract = true): string {
    const primary = this._getLatestBid(locationId, year, crop, month);
    const basis = (this._getLatestEntry(locationId, year, crop, month)?.basisBid ?? '').trim();
    // A positive basis is signed so it cannot be read as a small cash price. In basis mode the
    // "primary" value IS the basis -- _applyBidFilterSources puts whichever side the toggle shows
    // into the entry's bid field -- so that one needs signing too.
    const signedBasis = formatBasis(basis);
    const value = this.priceMode() === 'both'
      ? (primary && basis ? `${primary} / ${signedBasis}` : (primary || signedBasis))
      : (this.priceMode() === 'basis' ? formatBasis(primary) : primary);
    if (!includeContract) return value;
    // Every fed value names the contract it is quoted against: a Year cell because its value is one
    // month standing in for a year, a month cell because the board is what makes two bids comparable
    // at all. Manual cells stay bare -- there is no contract behind them to name.
    //
    // Full symbol for now ("-80 (KEU26)"), by request: the trade-notation letter ("-80U") is the
    // denser candidate, and the Dev feedback round decides between them. The full form also never
    // hides a cross-exchange split -- KEU26 and ZWU26 share a letter but not a market.
    const contract = value
      ? this.cellBoardFor(locationId, year, crop, month)
      : '';
    return contract ? `${value} (${contract})` : value;
  }

  /**
   * The contract a panel value is quoted against, or '' when there is no value or the cell is manual.
   *
   * Mirrors the suffix _getDisplayBid used to append. Split out so the panel can render it as its own
   * small muted span: a combined "5.38 / 6 (ZCZ26)" is wider than the column and wrapped onto a second
   * line, which turned a list you scan into a stack you read.
   */
  panelContractFor(locationId: number, year: number | null, crop: string, month: number): string {
    if (!this._getDisplayBid(locationId, year, crop, month, false)) return '';
    return this.cellBoardFor(locationId, year, crop, month);
  }

  /**
   * The contract month a fed cell is really showing, when it is not the cell's own -- '' otherwise.
   *
   * One vendor bid in five opens its delivery window before its contract month, so the bridge fills every
   * month the window covers with that bid.
   *
   * Deliberately invisible except in the tooltip. October's 5.38 IS Cargill's price for October delivery
   * -- one bid, one window running 1 Oct to 30 Nov, which the vendor happens to name after the November
   * futures contract -- so marking it on the face of the grid would imply a substitute where there is
   * none. Both attempts at marking it (a month tag, then italics) were dropped for exactly that. What the
   * tooltip adds is that the elevator posted no SEPARATE October price: worth knowing on a call, noise
   * otherwise. The chip beside the value is the board symbol, as on every fed cell -- and could not carry
   * this anyway, since a covering contract and the month it covers trade against the same board.
   */
  coverageChipFor(entry: BidSheetEntry | null | undefined): string {
    if (!entry || entry.source !== 'Barchart' || !entry.coveredByMonth) return '';
    return BidSheetComponent.MONTH_NAMES[entry.coveredByMonth] ?? '';
  }

  /** coverageChipFor, looked up by cell. */
  coverageLabelFor(locationId: number, year: number | null, crop: string, month: number): string {
    if (!crop) return '';
    return this.coverageChipFor(this._getLatestEntry(locationId, year, crop, month));
  }

  private _parseBid(bid: string): number | null {
    const n = parseFloat(bid);
    return isNaN(n) ? null : n;
  }

  private _computeItemStatus(bidStr: string, isRef: boolean, refBid: number | null): BidStatus {
    if (isRef) return 'reference';
    const num = this._parseBid(bidStr);
    if (refBid !== null && num !== null) {
      if (num > refBid) return 'beating';
      if (num === refBid) return 'matching';
    }
    return 'none';
  }

  // =========================================================================
  // Competitor Entry CRUD
  // =========================================================================

  /**
   * Single entry point for adding a location. Asks where it should come from first, because the two
   * sources behave differently once chosen: a BarChart location arrives with the vendor's bids
   * already on it and refreshed nightly, a manual one is yours to type. Deciding up front beats
   * discovering that afterwards.
   *
   * With the feed turned off there's nothing to choose, so this goes straight to the manual flow —
   * the behaviour every environment had before the picker existed.
   */
  /**
   * The "+ Add" menu. Deliberately does NOT require a sheet up front: building one out of a batch of
   * locations is one of the choices it offers, so demanding a sheet first would gate the very thing
   * the user came to do. The choices that do need a destination ask for one themselves (_requireSheet).
   */
  startAddLocation(origin: 'editBids' | 'map'): void {
    this.addLocationOrigin.set(origin === 'editBids' ? 'editBids' : null);
    // Without the feed there is no catalog to build a sheet from, so the only choice is the manual
    // one -- skip the menu rather than show it with a single option.
    if (!this.barchartEnabled) {
      if (!this._requireSheet()) return;
      this._startManualAdd();
      return;
    }
    this.showAddSourceChoice.set(true);
  }

  /**
   * Which sheet a newly added location goes on. Adding to all of them was rejected: a sheet is a
   * curated list somebody else may be sharing, and a location added to the one you were looking at
   * appearing on your colleague's too is not something you would be able to undo from this screen.
   *
   * Remembered for the session rather than saved, and re-asked whenever the remembered sheet is no
   * longer ticked. It is a within-a-sitting convenience -- "everything I add today goes on Kansas" --
   * and a choice that outlived the sitting would silently send tomorrow's additions somewhere the
   * user had stopped looking.
   */
  readonly addTargetSheetId = signal<number | null>(null);
  readonly showAddSheetChoice = signal<boolean>(false);
  private readonly _pendingAddAction = signal<((sheetId: number) => void) | null>(null);

  /** The sheet an add would land on right now: the remembered one if still ticked, else the first. */
  readonly addTargetSheet = computed<BidSheet | null>(() => {
    const sheets = this.selectedSheets();
    if (sheets.length === 0) return null;
    return sheets.find(s => s.id === this.addTargetSheetId()) ?? sheets[0];
  });

  /**
   * Runs an add once there is exactly one sheet for it to land on -- asking first, but only when the
   * answer is not already settled: one sheet ticked, or a remembered choice still among the ticked.
   */
  private _withAddTarget(action: (sheetId: number) => void): void {
    const sheets = this.selectedSheets();
    if (sheets.length === 0) { this._requireSheet(); return; }
    if (sheets.length === 1) { this.addTargetSheetId.set(sheets[0].id); action(sheets[0].id); return; }
    const remembered = sheets.find(s => s.id === this.addTargetSheetId());
    if (remembered) { action(remembered.id); return; }
    // Parked as-is; the chooser hands it the id that was actually picked. It used to re-read
    // addTargetSheet() at run time, which meant re-deriving the answer the user had just given --
    // and asserting non-null on a computed that returns null with nothing ticked.
    this._pendingAddAction.set(action);
    this.showAddSheetChoice.set(true);
  }

  chooseAddTargetSheet(id: number): void {
    this.addTargetSheetId.set(id);
    this.showAddSheetChoice.set(false);
    const action = this._pendingAddAction();
    this._pendingAddAction.set(null);
    action?.(id);
  }

  cancelAddSheetChoice(): void {
    this.showAddSheetChoice.set(false);
    this._pendingAddAction.set(null);
  }

  /**
   * Ensures there is somewhere for a single location to land, prompting for a sheet if not.
   * Returns false when the caller should stand down and let the prompt take over.
   */
  private _requireSheet(): boolean {
    if (this.activeSheet()) return true;
    if (this.sheets().length === 0) { this.openCreateSheet(); } else { this.showSheetMenu.set(true); }
    return false;
  }

  chooseManualAdd(): void {
    this.showAddSourceChoice.set(false);
    if (!this._requireSheet()) return;
    this._startManualAdd();
  }

  /** Build a new sheet from a batch of catalog locations. The sheet is created on confirm, not now. */
  chooseBuildSheet(): void {
    this.showAddSourceChoice.set(false);
    // Also reachable from the panel's sheet menu now, which would otherwise stay open floating over
    // the map you are about to pick locations from.
    this.showSheetMenu.set(false);
    // No feed means no catalog to pick from, so there is nothing to build a sheet OUT of -- fall back
    // to naming an empty one, which is the only way to get a sheet at all in that configuration.
    if (!this.barchartEnabled) { this.openCreateSheet(); return; }
    this.barchartSheetMode.set('new');
    this.newSheetName.set('');
    this._pickerRef()?.clearSelection();
    this.enterBarchartMode();
  }

  /** Add catalog locations to the sheet that's already open. */
  chooseAddToSheet(): void {
    this.showAddSourceChoice.set(false);
    if (!this._requireSheet()) return;
    this.barchartSheetMode.set('existing');
    this.enterBarchartMode();
  }

  cancelAddSourceChoice(): void {
    this.showAddSourceChoice.set(false);
    this.addLocationOrigin.set(null);
  }

  private _startManualAdd(): void {
    if (this.addLocationOrigin() === 'editBids') this.editBidsMode.set(false);
    this.enterAddLocationMode();
  }

  /** Kept for the grid's Add Location row, which is scoped to the Edit Bids origin. */
  addLocationFromEditBids(): void {
    this.startAddLocation('editBids');
  }

  enterAddLocationMode(): void {
    this.addLocationMode.set(true);
    this.showPanel.set(false);
    // Clear existing markers to show clean map
    if (this._clusterGroup) this._clusterGroup.clearLayers();
  }

  exitAddLocationMode(): void {
    this.addLocationMode.set(false);
    this.showAddLocationForm.set(false);
    this._removeAddLocationPin();
    this._resetAddForm();
    this._refreshMapMarkers();
    this._loadCatalogLocations(); // resumes the catalog layer, skipped while this mode owned the map
    this.addLocationOrigin.set(null);
  }

  private _onMapClick(e: any): void {
    if (!this.addLocationMode()) return;

    // Remove previous pin
    this._removeAddLocationPin();

    // Place pin
    const { lat, lng } = e.latlng;
    this.newLocationLat.set(lat);
    this.newLocationLng.set(lng);

    const _L = this._L!;
    const pinIcon = _L.divIcon({
      className: 'custom-marker',
      html: `<div style="width:28px;height:28px;background:#EF4623;border:3px solid #DF3410;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    if (!this._map) return;
    this._addLocationPin = _L.marker([lat, lng], { icon: pinIcon }).addTo(this._map);

    // Auto-select TU if only one is available

    // Open the form (just name + Scoular star; bids are entered later in the grid)
    this.showAddLocationForm.set(true);
  }

  canSaveLocation = computed(() => {
    const name = this.newLocationName().trim();
    const hasCoords = this.newLocationLat() !== null;
    // Bids are entered afterward in the Edit Bids grid, so creating a location needs only a name and
    // the coordinates picked on the map. It used to need a trade unit too -- the desk the row would
    // belong to -- and a location belongs to nobody now.
    return !!name && hasCoords;
  });

  confirmAddLocation(): void {
    if (this.addLocationSaving()) return; // guard against a double-click firing two creates
    if (this.selectedSheets().length === 0) { this.toastService.error('Create or select a bid sheet first'); return; }
    this._withAddTarget(sheetId => this._confirmAddLocationTo(sheetId));
  }

  private _confirmAddLocationTo(sheetId: number): void {
    this.usageTracking.postClickEvent('interaction', 'bidsheet', 'locations-added');
    const name = this.newLocationName().trim();
    const lat = this.newLocationLat();
    const lng = this.newLocationLng();

    if (!name) { this.toastService.error('Enter a location name'); return; }

    this.addLocationSaving.set(true);
    // Create the location with NO bids — bids are entered next in the Edit Bids grid.
    this.apiService.createBidSheetLocation({
      name,
      latitude: lat ?? undefined,
      longitude: lng ?? undefined,
      isScoularFacility: this.newLocationIsScoular(),
      bids: []
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.addLocationSaving.set(false);
        // Optimistically add the new location -- to the catalog AND the active sheet -- so the grid
        // can open instantly without a network wait.
        this.allMapLocations.update(locs => [saved, ...locs]);
        this.sheets.update(list => list.map(s => s.id === sheetId ? { ...s, locations: [saved, ...s.locations] } : s));
        this.toastService.success(`Added ${name}`);
        this.exitAddLocationMode();

        // Open the Edit Bids grid IMMEDIATELY from in-memory data — _buildEditGrid includes
        // bidLocations with no bids yet, so the new location shows as an empty row to fill in
        // (existing locations' bids are already loaded). No round-trip before the screen appears.
        // Pass saved.name only as the grid's focus target — do NOT set panelSelectedLocationId, or
        // the side panel would open in single-location DETAIL mode (for the new location) after the
        // grid closes, instead of the full list.
        this._applyBidFilterSources();
        this.filterBids();
        this._refreshMapMarkers();
        this.openEditBids(saved.name);

        // Persist the sheet link in the background. Idempotent server-side, so a race against the
        // optimistic update above just resolves to the same row.
        this.apiService.addBidSheetLocation(sheetId, saved.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (sheet) => this._applySheet(sheet),
          error: (err) => { if (isDevMode()) console.warn('Failed to link the new location to the sheet', err); }
        });

        // Sync map/panel with the server in the background. Pass NO onLoaded callback: the grid is
        // already open and built from in-memory data, and an onLoaded callback would flip
        // editBidsGridLoading on and show a grid spinner that the success path
        // doesn't clear. The load's own success path already runs filterBids() + _refreshMapMarkers().
        this._loadAllMapLocations();
      },
      error: (err) => {
        this.addLocationSaving.set(false);
        if (isDevMode()) console.error('[BidSheet] add location failed', err);
        this.toastService.error(this._errorToast(err, "Failed to add location"));
      }
    });
  }

  cancelAddLocation(): void {
    const fromEditBids = this.addLocationOrigin() === 'editBids';
    this.exitAddLocationMode();
    if (fromEditBids) { this.openEditBids(); }
  }

  // =========================================================================
  // Add from BarChart
  // =========================================================================

  /**
   * Escape backs out of the add-location flows. Both of them hide the map's own controls while active,
   * so without this the panel's small X is the only way out and it's easy to feel stranded.
   */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showAddSourceChoice()) { this.cancelAddSourceChoice(); return; }
    if (this.barchartMode()) { this.exitBarchartMode(); return; }
    if (this.addLocationMode()) this.cancelAddLocation();
  }

  /** Opens the picker. The map keeps its current view — that view IS the search. */
  enterBarchartMode(): void {
    if (!this.barchartEnabled) return;
    this.usageTracking.postClickEvent('interaction', 'bidsheet', 'barchart-picker-opened');
    // Leaves addLocationOrigin alone on purpose — exitBarchartMode reads it to decide where to return.
    this.editBidsMode.set(false);
    this.showPanel.set(false);
    this.barchartMode.set(true);
    this._refreshMapMarkers();       // clears our own pins; the picker's candidates replace them
    this._publishBarchartSearchArea();
  }

  exitBarchartMode(): void {
    this._leaveBarchartMode();
    // Return the user where they started, matching cancelAddLocation's behaviour for the manual flow.
    const fromEditBids = this.addLocationOrigin() === 'editBids';
    this.addLocationOrigin.set(null);
    if (fromEditBids) this.openEditBids();
  }

  /**
   * Tears the picker down without deciding where to go next.
   *
   * Split out because the two ways of leaving want different destinations. Cancelling goes back where
   * you came from; finishing an add goes to Edit Bids for the rows you just created, and from there
   * back to the map -- returning to the picker would drop the user into a search they are done with.
   */
  private _leaveBarchartMode(): void {
    this.barchartMode.set(false);
    this.barchartSheetMode.set('existing'); // or the next visit inherits "building a new sheet"
    this.pendingBulkAdd.set(null);
    this.barchartSelectedKey.set(null);
    this.barchartSearchArea.set(null);
    this._clearBarchartPins();
    this._refreshMapMarkers();
    this._loadCatalogLocations(); // resumes the catalog layer, skipped while the picker owned the map
  }

  /**
   * The current map view as a centre + radius, capped to what the search endpoint accepts (500mi).
   * Radius = centre to the north-east corner, so the search covers everything on screen rather than
   * a circle inscribed in it (which would omit the corners the user can plainly see). Shared by the
   * picker's search and the catalog map layer -- both mean "what's visible right now".
   */
  private _currentViewArea(): BarchartSearchArea | null {
    if (!this._map) return null;
    const centre = this._map.getCenter();
    const bounds = this._map.getBounds();
    const radiusMiles = Math.max(10, Math.min(500,
      Math.round(this._map.distance(centre, bounds.getNorthEast()) / 1609.34)));
    return { latitude: centre.lat, longitude: centre.lng, radiusMiles };
  }

  /** Publishes the current map view as a centre + radius for the picker to search. */
  private _publishBarchartSearchArea(): void {
    const area = this._currentViewArea();
    if (area) this.barchartSearchArea.set(area);
  }

  /**
   * The row cap for a catalog fetch, scaled DOWN as the view widens. take was a flat 5,000 at first --
   * fine for the network payload (the request DTO's own ceiling), not fine for panning: a national-
   * scale view was asking for and then drawing thousands of un-clustered DOM markers (see
   * _catalogLayer's own comment for why they don't cluster), which is exactly the redraw cost that
   * made panning feel laggy. At that radius the dots would overlap into an unreadable smear anyway, so
   * capping lower there costs nothing worth having; a close-in view keeps the full 5,000 because at
   * that radius there are naturally few enough results for it to never bind.
   */
  private static _catalogTakeFor(radiusMiles: number): number {
    if (radiusMiles >= 300) return 500;
    if (radiusMiles >= 100) return 1500;
    return 5000;
  }

  /**
   * Fetches every catalog listing in the current view and re-renders JUST the catalog layer -- never
   * the added-location pins, which this has no new data for and which are the more expensive of the
   * two to redraw (clustering, spread, richer icons). Splitting it out is what makes panning tolerable:
   * every pan/zoom used to force a full _refreshMapMarkers(), redrawing added-location pins that had
   * not changed at all.
   *
   * Skipped while the map is repurposed for add-location or the BarChart picker -- same guard
   * _refreshMapMarkers uses for its own layer, so the two stay in step.
   *
   * The crop and search filters narrow this same request (server-side, via the commodity mapping and
   * name/city match the search endpoint already supports) -- geography still applies too, unlike the
   * BarChart picker's own search, which drops it once you type. The map's search box is "find this
   * pin on my screen", not "search the whole catalog"; that broader search already exists as its own
   * feature (the picker).
   */
  private _loadCatalogLocations(): void {
    if (this.addLocationMode() || this.barchartMode()) return;
    // Nothing to draw it into while the map is scoped to one sheet -- skip the round trip entirely
    // rather than fetching thousands of rows for a layer that won't render (see _renderCatalogMarkers).
    if (!this.showingAllLocations()) { this.catalogLocations.set([]); return; }
    const area = this._currentViewArea();
    if (!area) return;
    const gen = ++this._catalogLoadGen;
    const crop = this.selectedCrop() || undefined;
    const month = this.selectedMonth();
    const take = BidSheetComponent._catalogTakeFor(area.radiusMiles);
    const baseParams = {
      latitude: area.latitude, longitude: area.longitude, radiusMiles: area.radiusMiles, take,
      commodityCode: crop,
      search: this.searchQuery().trim() || undefined,
    };

    // With no crop there is no instrument to price a listing against, so catalog pins fall back to a
    // plain dot.
    if (!crop) {
      this.apiService.searchBarchartLocations(baseParams).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (rows) => {
          if (gen !== this._catalogLoadGen) return; // a newer pan/zoom/filter already superseded this
          this.catalogLocations.set(rows);
          this._renderCatalogMarkers();
        },
        error: (err) => { if (isDevMode()) console.warn('Failed to load the BarChart catalog for this view', err); }
      });
      return;
    }

    const period = { cropYear: this.selectedYear(), month };
    // Cash and basis are separate BarChart instruments with independent quotes, not one price under
    // two labels -- "Both" mode needs both fetched and merged, one request per type, since the search
    // endpoint prices one instrument at a time. Cash carries the location metadata (name, coordinates,
    // placements); the basis pass only contributes its price, matched back in by locationKey.
    if (this.priceMode() === 'basis') {
      this.apiService.searchBarchartLocations({ ...baseParams, ...period, instrumentType: 'bidBasis' })
        .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (rows) => {
            if (gen !== this._catalogLoadGen) return;
            this.catalogLocations.set(rows);
            this._renderCatalogMarkers();
          },
          error: (err) => { if (isDevMode()) console.warn('Failed to load the BarChart catalog for this view', err); }
        });
      return;
    }

    const cash$ = this.apiService.searchBarchartLocations({ ...baseParams, ...period, instrumentType: 'bidCash' });
    if (this.priceMode() !== 'both') {
      cash$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (rows) => {
          if (gen !== this._catalogLoadGen) return;
          this.catalogLocations.set(rows);
          this._renderCatalogMarkers();
        },
        error: (err) => { if (isDevMode()) console.warn('Failed to load the BarChart catalog for this view', err); }
      });
      return;
    }

    const basis$ = this.apiService.searchBarchartLocations({ ...baseParams, ...period, instrumentType: 'bidBasis' });
    forkJoin({ cash: cash$, basis: basis$ }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ cash, basis }) => {
        if (gen !== this._catalogLoadGen) return;
        const basisByKey = new Map(basis.filter(r => r.matchedBidPrice != null).map(r => [r.locationKey, r.matchedBidPrice]));
        this.catalogLocations.set(cash.map(r => {
          const matchedBasisPrice = basisByKey.get(r.locationKey);
          return matchedBasisPrice != null ? { ...r, matchedBasisPrice } : r;
        }));
        this._renderCatalogMarkers();
      },
      error: (err) => { if (isDevMode()) console.warn('Failed to load the BarChart catalog for this view', err); }
    });
  }

  /** Draws the picker's current results as candidate pins. */
  onBarchartResults(rows: BarchartCatalogLocation[]): void {
    if (!this._map || !this._L) return;
    const L = this._L;
    this._clearBarchartPins();
    this._barchartLayer = L.layerGroup().addTo(this._map);
    // Hollow means "already on the sheet you are adding to" -- not "on any sheet anywhere", which is
    // what it used to mean and is information about other people's sheets. In new-sheet mode there is
    // no sheet yet, so nothing is hollow.
    const sheetIds: ReadonlySet<number> = this.barchartSheetMode() === 'new'
      ? this.emptyLocationIds
      : this.activeSheetLocationIds();
    this._barchartOnSheetKeys = new Set(rows
      .filter(r => r.placements.some(p => sheetIds.has(p.locationId)))
      .map(r => r.locationKey));
    // Cached per result set rather than re-derived in _highlightBarchartPin, which only has the key.
    this._barchartScoularKeys = new Set(rows.filter(isScoularListing).map(r => r.locationKey));

    for (const loc of rows) {
      if (loc.latitude == null || loc.longitude == null) continue;
      const onThisSheet = this._barchartOnSheetKeys.has(loc.locationKey);
      const marker = L.marker([loc.latitude, loc.longitude],
          { icon: this._barchartPinIcon(onThisSheet, loc.locationKey === this.barchartSelectedKey(), this.barchartTickedKeys().has(loc.locationKey), this._barchartScoularKeys.has(loc.locationKey)) })
        // Company first, matching the panel — the vendor's site name is sometimes another company's
        // name, so leading with it on a pin would misattribute the bid.
        .bindTooltip(
          `${loc.elevator || loc.locationName || loc.locationKey}${loc.city ? ' — ' + loc.city : ''}`,
          { direction: 'top' });
      // Ticks the location rather than opening its detail, matching a click on its row. Routed
      // through the picker so clicking the same pin twice unticks it -- going via a signal would not,
      // since setting it to the value it already holds changes nothing.
      marker.on('click', () => this._pickerRef()?.toggleSelected(loc));
      marker.addTo(this._barchartLayer!);
      this._barchartMarkers.set(loc.locationKey, marker);
    }
  }

  /**
   * Candidate pin while picking locations.
   *
   * Colour says WHAT the elevator is, and it means the same thing here as everywhere else on the map:
   *   blue  = ticked for adding (the action state, so it wins over the other two)
   *   green = a Scoular site -- the same green the main map uses for "ours"
   *   grey  = anybody else's, the same neutral the main map uses
   *
   * Green used to be the default for EVERY candidate, standing for "is in the feed" -- which is true of
   * all of them, so it said nothing, and it spent the one colour that already means "ours" elsewhere.
   *
   * Size is a separate channel: the bigger pin is the one whose detail is open in the panel. Keeping
   * that off the colour means a pin can be focused AND ticked without the two states fighting.
   *
   * Hollow = already on THIS sheet, so ticking it could only be a no-op -- matching the disabled row in
   * the picker list. It used to mean "on ANY sheet, anywhere", which told the user about other people's
   * sheets; that is exactly the distinction they said they don't care about while picking.
   */
  private _barchartPinIcon(onThisSheet: boolean, focused: boolean, ticked = false, isScoular = false): any {
    const L = this._L!;
    const size = focused ? 26 : 20;
    let fill: string, border: string;
    if (ticked) {
      fill = '#2563eb'; border = '#1d4ed8';
    } else if (isScoular) {
      fill = BidSheetComponent.SCOULAR_RING; border = BidSheetComponent.SCOULAR_BORDER;
    } else {
      // Same grey as the map's neutral pin (_neutralPinColors), darkened in step with it so a
      // candidate and an added location still read as the same colour.
      fill = '#6b7280'; border = '#4b5563';
    }
    // Border keeps its colour when hollow, so an unavailable pin still says whether it's ours.
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:3px solid ${border};background:${onThisSheet ? 'transparent' : fill};box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  /** Re-styles the candidate pins so exactly one reads as selected, without redrawing the layer. */
  private _highlightBarchartPin(selectedKey: string | null): void {
    const ticked = this.barchartTickedKeys();
    for (const [key, marker] of this._barchartMarkers) {
      const focused = key === selectedKey;
      marker.setIcon(this._barchartPinIcon(this._barchartOnSheetKeys.has(key), focused, ticked.has(key), this._barchartScoularKeys.has(key)));
      // Focused pin on top, so a neighbouring pin can't sit over the one being described in the panel.
      marker.setZIndexOffset(focused ? 1000 : 0);
    }
  }

  /** The picker's tick list changed: recolour the pins so the map matches the panel. */
  onBarchartSelectionChange(keys: ReadonlySet<string>): void {
    this.barchartTickedKeys.set(keys);
    this._highlightBarchartPin(this.barchartSelectedKey());
  }

  private _clearBarchartPins(): void {
    if (this._barchartLayer && this._map) {
      this._map.removeLayer(this._barchartLayer);
    }
    this._barchartLayer = null;
    this._barchartMarkers.clear();
    this._barchartOnSheetKeys.clear();
    this._barchartScoularKeys.clear();
  }

  /**
   * The picker asked us to centre on a candidate it listed.
   *
   * Pans WITHOUT changing zoom. Flying to zoom 11 shrank the search radius, which re-ran the nearby
   * search and replaced the fifty-row list with the handful within ten miles -- so ticking a row
   * collapsed the list under the user, and the row they had just ticked usually dropped out of the
   * results and reappeared at the bottom under "Still selected". Keeping the zoom keeps the area the
   * user is working, which is the whole premise of a map-first picker.
   */
  onBarchartFocus(loc: BarchartCatalogLocation): void {
    // Also mark it selected, so picking from the list turns the same pin blue as clicking it on the map.
    this.barchartSelectedKey.set(loc.locationKey);
    if (loc.latitude == null || loc.longitude == null) return;
    // The current zoom, passed explicitly -- omitting it means "at least 11", which is the zoom-in.
    this._flyToLocation(loc.latitude, loc.longitude, this._map?.getZoom());
  }

  /**
   * Adds every location ticked in the picker, then opens Edit Bids on them.
   *
   * Adding one at a time meant naming and confirming each elevator before the next, which is slow
   * when standing up a whole area. Names come from the vendor and the Scoular flag is guessed from
   * the publishing company; Edit Bids is where both get corrected, which is why it opens straight
   * after rather than dropping the user back on the map.
   */
  /**
   * Resolves where a picked batch is going, then hands off to _bulkAddToSheet.
   *
   * In "build a sheet" mode the destination does not exist yet: the sheet is created from the name
   * typed in the picker, or -- if that was left blank -- from one asked for now, with the batch parked
   * until the dialog comes back. Naming last is deliberate; see the picker's newSheetMode.
   */
  onBarchartAddMany(request: BarchartBulkAddRequest): void {
    if (this.barchartAdding()) return;
    if (request.locations.length === 0) return;

    if (this.barchartSheetMode() === 'new') {
      const name = this.newSheetName().trim();
      if (!name) { this.pendingBulkAdd.set(request); this.showCreateSheet.set(true); return; }
      this._createSheetThenBulkAdd(name, request);
      return;
    }

    // No destination means nothing can be linked anywhere. Said out loud rather than returning
    // silently, which left the button looking broken.
    if (this.selectedSheets().length === 0) {
      this.toastService.error('Create or select a bid sheet first, then add these locations');
      return;
    }
    this._withAddTarget(sheetId => this._bulkAddToSheet(sheetId, request));
  }

  /** Creates the sheet a "build a sheet" batch is destined for, then adds the batch to it. */
  private _createSheetThenBulkAdd(name: string, request: BarchartBulkAddRequest): void {
    this.barchartAdding.set(true);
    this.apiService.createBidSheet(name).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (sheet) => {
        this.barchartAdding.set(false);
        this._applySheet(sheet);
        this.setSelectedSheets([sheet.id]);
        this.barchartSheetMode.set('existing'); // it exists now -- anything further adds to it
        this._bulkAddToSheet(sheet.id, request);
      },
      error: (err: { status?: number }) => {
        this.barchartAdding.set(false);
        // Keeps the picker open with the basket intact, so the user just renames and confirms again.
        this.toastService.error(err?.status === 409
          ? `You already have a bid sheet called "${name}"`
          : 'Failed to create bid sheet');
      }
    });
  }

  private _bulkAddToSheet(sheetId: number, request: BarchartBulkAddRequest): void {
    this.barchartAdding.set(true);
    this.usageTracking.postClickEvent('interaction', 'bidsheet', 'locations-added');

    // Create only when the location doesn't already exist company-wide (the picker tells us via
    // existingLocationId, from the catalog's placements); either way, finish by linking it onto the
    // active sheet. Each location carries its own failure -- one already-linked location must not
    // sink the rest of the batch, which is exactly what a bare forkJoin did.
    //
    // The failure is KEPT, not discarded. A duplicate is routine and worth only a footnote, but a 403
    // or a 500 is not -- reporting everything as "already added" made a real outage look like a
    // no-op. 400 is the server's validation status for the duplicate-name create rule, so it is the
    // one status treated as benign.
    const linkToSheet = (locationId: number) =>
      this.apiService.addBidSheetLocation(sheetId, locationId).pipe(
        map(sheet => ({
          sheet,
          location: sheet.locations.find(l => l.id === locationId) ?? null,
          duplicate: false,
          failed: false
        })),
        catchError((err: unknown) => {
          if (isDevMode()) console.error('[BidSheet] failed to add location to sheet', err);
          return of({ sheet: null as BidSheet | null, location: null as BidSheetLocation | null, duplicate: false, failed: true });
        })
      );

    const creates = request.locations.map(loc =>
      loc.existingLocationId != null
        ? linkToSheet(loc.existingLocationId)
        : this.apiService.createBidSheetLocation({
            name: loc.name,
            barchartLocationKey: loc.locationKey,
            isScoularFacility: loc.isScoularFacility,
            bids: []
          }).pipe(
            switchMap(created => linkToSheet(created.id)),
            catchError((err: unknown) => {
              const duplicate = (err as { status?: number })?.status === 400;
              if (!duplicate && isDevMode()) console.error('[BidSheet] barchart create failed', err);
              return of({ sheet: null as BidSheet | null, location: null as BidSheetLocation | null, duplicate, failed: !duplicate });
            })
          ));

    forkJoin(creates).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(results => {
      // Reset before the handoff, not after the reload. Tying it to the reload's callback meant a
      // cancelled reload left this true forever, and the picker's own guards then made it
      // permanently dead behind a spinning button.
      this.barchartAdding.set(false);

      const succeeded = results.filter((r): r is { sheet: BidSheet; location: BidSheetLocation; duplicate: boolean; failed: boolean } => r.location != null);
      const duplicates = results.filter(r => r.duplicate).length;
      const failures = results.filter(r => r.failed).length;

      if (succeeded.length === 0) {
        this.toastService.error(failures > 0
          ? 'Could not add locations — something went wrong, please try again'
          : 'Those locations are already on this sheet');
        return;
      }

      const saved = succeeded.map(r => r.location);
      const count = new Set(saved.map(l => l.name)).size;
      const notes = [
        duplicates > 0 ? `${duplicates} already added` : '',
        failures > 0 ? `${failures} failed` : ''
      ].filter(Boolean).join(', ');
      this.toastService.success(
        `Added ${count} location${count === 1 ? '' : 's'}` + (notes ? ` — ${notes}` : ''));

      this.allMapLocations.update(locs => [...saved, ...locs.filter(l => !saved.some(s => s.id === l.id))]);
      // Bridge with whichever response landed, in order -- the requests ran in parallel against the
      // same sheet, so any single one may be missing a sibling's row. The reload below is what makes
      // this authoritative; this just avoids a blank moment before it lands.
      for (const r of succeeded) this._applySheet(r.sheet);
      this._applyBidFilterSources();

      // Hand off immediately from the cache we just updated -- Edit Bids builds from memory, so the
      // new rows are there at once and no map flash shows between the two screens. The server sync
      // runs behind it and the open grid trues itself up when it lands.
      this._pickerRef()?.clearSelection();
      this._leaveBarchartMode();
      this.addLocationOrigin.set(null);
      this.openEditBids(request.locations[0]?.name);

      this._loadAllMapLocations();
      this.apiService.getBidSheet(sheetId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (sheet) => this._applySheet(sheet),
        error: (err) => { if (isDevMode()) console.warn('Failed to refresh the sheet after a batch add', err); }
      });
    });
  }

  // =========================================================================
  // Edit Bids
  // =========================================================================

  openEditBids(focusLocationName?: string): void {
    // The grid is the SHEET's. Every path in here narrows the map back to it first, so the rows the
    // grid builds from bidEntries are the sheet's rows -- in All scope they would be everyone's.
    if (this.mapScope() === 'all') this.setMapScope('sheet');
    // Focus target for the grid: an explicit name (e.g. a just-added location) or, by default, the
    // panel's selected location. Passing it as an argument avoids forcing the panel into detail mode.
    const focusLocation = focusLocationName ?? this.panelSelectedName();
    // Seed the column list on first open. Only when empty: a saved arrangement, or one the user built
    // this session, is theirs and must not be re-derived from the panel underneath them.
    //
    // This replaced a pair of lines that re-seeded the grid's year and month from the panel on every
    // re-entry whenever only one of each was selected. The panel no longer reaches the grid at all --
    // which is the point of the columns being explicit, but it does mean stepping the panel to another
    // year and reopening Edit Bids no longer changes what the grid shows.
    if (this.selectedColumns().length === 0) {
      const seeded = this._seedColumns();
      if (seeded.length > 0) {
        this.selectedColumns.set(seeded);
        // Spent. Reconstructing the old arrangement happens ONCE. Leaving it armed meant that
        // clearing every column and stepping out to the map brought the whole set back on the way
        // in, because this runs on every open and the flag only ever reset on a page load.
        this._needsColumnSeed = false;
      }
    }
    this._buildEditGrid();
    this._editBidsSavedKeys.clear();
    this.editBidsMode.set(true);
    this.usageTracking.postClickEvent('interaction', 'bidsheet', 'edit-bids-opened');

    // The grid opens instantly from in-memory data and trues itself up here in the background --
    // the job the header's Refresh button used to do by hand. No spinner (no onLoaded callback),
    // and the pipeline only rebuilds the open grid when nothing is dirty, so a keystroke can never
    // be eaten by data arriving underneath it.
    this._loadAllMapLocations();

    // Focus the first crop input for the selected location
    if (focusLocation) {
      setTimeout(() => {
        const rowIdx = this.editBidsRows().findIndex(r => r.name === focusLocation);
        const firstCol = this.editGridColumns()[0];
        if (rowIdx >= 0 && firstCol) {
          const el = document.getElementById(`bid-${rowIdx}-${firstCol.key}`);
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            (el as HTMLInputElement).focus();
          }
        }
      }, 100);
    }
  }

  /**
   * Rebuilds every grid row from the loaded bids.
   *
   * Takes no year: each column carries its own, and bidLookup already holds every year the trade unit
   * has. It used to take one, which only worked because callers set editBidsYear first -- a second
   * source of truth that would now silently resolve one year's cells under another year's headers.
   */
  private _buildEditGrid(): void {
    const lookup = this.bidLookup();
    const columns = this.editGridColumns();
    const rows: EditBidsRow[] = [];
    const addedIds = new Set<number>();

    // One row per LOCATION. Keyed by id rather than name: a per-sheet rename is not an identity, and
    // two rows sharing a name collapsed into one cell store -- editing either wrote to both.
    const allEntries = this.bidEntries();
    const uniqueIds = [...new Set(allEntries.map(e => e.locationId))];
    // Built once rather than re-scanned per row: a .find() inside this loop is O(rows x entries).
    const repById = new Map<number, BidSheetEntry>();
    for (const e of allEntries) if (!repById.has(e.locationId)) repById.set(e.locationId, e);
    const gridNameById = new Map<number, string>();
    for (const l of this.scopedLocations()) gridNameById.set(l.id, l.name);
    for (const locationId of uniqueIds) {
      addedIds.add(locationId);
      const rep = repById.get(locationId);
      const name = gridNameById.get(locationId) ?? rep?.name ?? '';
      const bids: Record<string, string> = {};
      const basisBids: Record<string, string> = {};
      const originalBasisBids: Record<string, string> = {};
      const coverageChips: Record<string, string> = {};
      const boardChips: Record<string, string> = {};
      for (const col of columns) {
        const entry = lookup.get(`${locationId}|${col.crop}|${col.year}|${col.month}`);
        // Each price lives in its own field whatever the toggle says. The template picks which to
        // show; the save writes each to its own column. Reading a mode-selected value into bids is
        // how a basis would end up filed as a cash price.
        bids[col.key] = entry?.cashBid ?? '';
        // Display form, sign and all: a negative already shows its "-" here, so a positive hiding
        // its "+" reads as an inconsistency rather than as a convention. normalizeBasis takes it back
        // off at every boundary that leaves this screen.
        basisBids[col.key] = formatBasis(entry?.basisBid ?? '');
        originalBasisBids[col.key] = basisBids[col.key];
        coverageChips[col.key] = this.coverageChipFor(entry);
        boardChips[col.key] = this.cellBoardFor(locationId, col.year, col.crop, col.month);
      }
      rows.push({ locationId, name, type: 'entry', elevatorCode: rep?.elevatorCode, tradeUnitCode: rep?.tradeUnitCode, latitude: rep?.latitude, longitude: rep?.longitude, bids, originalBids: { ...bids }, basisBids, originalBasisBids, coverageChips, boardChips, isBarchartLinked: !!rep?.barchartLocationKey });
    }

    // Also include locations with no bids yet (e.g. just added from Edit Bids)
    for (const loc of this.bidLocations()) {
      if (addedIds.has(loc.id)) continue;
      addedIds.add(loc.id);
      const bids: Record<string, string> = {};
      for (const col of columns) { bids[col.key] = ''; }
      rows.push({ locationId: loc.id, name: loc.name, type: 'entry', elevatorCode: loc.elevatorCode, tradeUnitCode: loc.tradeUnitCode, latitude: loc.latitude, longitude: loc.longitude, bids, originalBids: { ...bids }, basisBids: {}, originalBasisBids: {}, coverageChips: {}, boardChips: {}, isBarchartLinked: !!loc.barchartLocationKey });
    }

    // No re-sort here. Row order used to be a separate, per-user, name-keyed lookup applied on top --
    // the sheet's locations already arrive in its own order (SortOrder, shared with everyone on it),
    // because rows above were built by iterating bidEntries(). The grid only ever opens in sheet scope
    // (openEditBids narrows first), so that order is always the one to keep.
    this.editBidsRows.set(rows);
  }

  onRowDrop(event: CdkDragDrop<EditBidsRow[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    // Belt and braces -- the handle is already disabled. A drop that got through here with several
    // sheets ticked would write the UNION's order onto whichever sheet happened to be first,
    // scrambling that sheet's order for everyone sharing it with rows that are not even on it.
    if (!this.canReorderRows()) return;

    this.editBidsRows.update(rows => {
      const updated = [...rows];
      moveItemInArray(updated, event.previousIndex, event.currentIndex);
      return updated;
    });

    // Persisted on the SHEET, shared with everyone on it, keyed by location id -- not the old
    // per-user JSON keyed by name, which meant a colleague's drag never showed up for you and a
    // rename silently orphaned a row's saved position.
    const sheetId = this.activeSheetId();
    if (sheetId == null) return;
    const locationIds = this.editBidsRows().map(r => r.locationId).filter((id): id is number => id != null);

    // Reflect the new order in the local sheet immediately so a second drag before the response
    // lands still sees the just-moved row where it was put.
    this.sheets.update(list => list.map(s => s.id !== sheetId ? s : {
      ...s,
      locations: locationIds
        .map(id => s.locations.find(l => l.id === id))
        .filter((l): l is BidSheetLocation => !!l)
    }));

    this.apiService.setBidSheetRowOrder(sheetId, locationIds)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sheet) => this._applySheet(sheet),
        error: () => this.toastService.error('Failed to save row order')
      });
  }


  /**
   * The panel fields every preference write has to carry, because the server assigns crop/month/year
   * unconditionally while only writing the JSON columns it is handed -- omit them and saving a crop
   * order would blank the panel's selection.
   */
  private _panelPrefFields(key: string) {
    return {
      tradeUnitKey: key,
      cropCode: this.selectedCrop() || null,
      month: this.selectedMonth(),
      cropYear: this.selectedYear() || null
    };
  }

  /** Opens the Add-column panel, seeding it from the last column so the next pick is usually close. */
  toggleAddColumn(): void {
    if (this.showAddColumn()) { this.showAddColumn.set(false); return; }
    const columns = this.selectedColumns();
    const last = columns[columns.length - 1];
    if (this.addColumnCrop() === '') {
      this.addColumnCrop.set(last?.crop ?? this.crops()[0] ?? '');
      this.addColumnYear.set(last?.year ?? this.selectedYear() ?? new Date().getFullYear());
      this.addColumnMonth.set(last?.month ?? BidSheetComponent.currentMonth());
    }
    this.addColumnQuery.set('');
    this.showAddColumn.set(true);
  }

  /**
   * Appends the staged pick.
   *
   * Flushes first and rebuilds after, both required: the new key is absent from every row's bids
   * record, so without a rebuild the column renders blank even where a bid exists -- and a rebuild
   * re-reads bidLookup, which would discard an un-blurred edit if it were not saved first.
   */
  addColumn(): void {
    if (!this.canAddColumn()) return;
    const pick: EditBidColumnPick = {
      crop: this.addColumnCrop(),
      year: this.addColumnYear(),
      month: this.addColumnMonth()
    };
    this._mutateColumns(cols => [...cols, pick]);
    // Closes on Add. It used to stay open with crop and year still set, on the theory that a run of
    // months is quicker that way -- but adding one column and being left staring at the form reads
    // as though the Add did not take, and the new column is behind the panel where it cannot be seen.
    // Adding several is the rarer case, and it costs one more click.
    this.showAddColumn.set(false);
  }

  /** Removes one column. Flushes first: a dirty cell in it would otherwise never reach the server. */
  removeColumn(key: string): void {
    if (this.columnMutationBusy()) return;
    const picks = this.selectedColumns();
    const next = picks.filter(p => this._colKey(p.crop, p.year, p.month) !== key);
    if (next.length === picks.length) return;
    this._mutateColumns(() => next);
  }

  /**
   * Reorders columns by drag.
   *
   * Deliberately does NOT flush or rebuild, unlike add and remove. An order change leaves the KEY SET
   * identical, so every bids / originalBids / coverageChips / boardChips entry stays valid -- and
   * calling _buildEditGrid here would rebuild rows from bidLookup and throw away an edit the user has
   * typed but not blurred.
   */
  onColumnDrop(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex === event.currentIndex) return;
    const next = [...this.selectedColumns()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.selectedColumns.set(next);
    this._saveSelectedColumns();
  }

  /**
   * The shared add/remove shape: flush, mutate, rebuild, persist.
   *
   * The mutation happens INSIDE the _saveDirtyBids callback, which never fires if the save errors --
   * so a failed flush leaves the columns alone rather than reshaping the grid out from under an edit
   * that did not make it.
   */
  private _mutateColumns(next: (cols: EditBidColumnPick[]) => EditBidColumnPick[]): void {
    this.columnMutationBusy.set(true);
    this._saveDirtyBids(() => {
      this.selectedColumns.update(next);
      this.editBidsGridLoading.set(true);
      requestAnimationFrame(() => {
        this._buildEditGrid();
        this.editBidsGridLoading.set(false);
      });
      // Cleared here, NOT inside the frame. The flag serialises FLUSHES, and the flush is done by the
      // time this callback runs; the frame only defers the repaint. requestAnimationFrame does not
      // fire in a background tab, so clearing it there would leave the picker disabled for anyone who
      // added a column and switched away before the grid redrew.
      this.columnMutationBusy.set(false);
      this._saveSelectedColumns();
    });
  }

  /**
   * Persists the grid's column list. Fire-and-forget like its neighbours: losing a column arrangement
   * to a dropped request is worth less than blocking the UI on every add.
   *
   * The _panelPrefFields spread is not optional -- the server assigns crop/month/year unconditionally,
   * so omitting them would blank the map panel's selection every time a column changed.
   */
  private _saveSelectedColumns(): void {
    // Whatever they just saved IS their arrangement now, empty included, so there is nothing left to
    // migrate. Cleared here rather than only on the seed path because clearing the last column is
    // exactly the case that never reaches it.
    this._needsColumnSeed = false;
    const key = this.preferenceKey();
    if (!key) return;
    const payload = BidSheetComponent.serialiseSelectedColumns(this.selectedColumns());
    this.apiService.setBidSheetPreference({ ...this._panelPrefFields(key), selectedColumns: payload })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save selected columns', err); } });
  }

  /**
   * The column list to open with, for a grid that has none.
   *
   * For a user who predates SelectedColumns, this reproduces the OLD cross product exactly -- same
   * crop filter, same crop order, same crop → month → year nesting -- so their first open after the
   * upgrade looks identical to their last open before it.
   *
   * For everyone else it returns NOTHING. A grid with no columns stays empty and waits to be told
   * what to show: guessing a set the user did not ask for is the behaviour the explicit column list
   * replaced, and it would be the last place the screen still decided for them.
   *
   * The 24-column cap is deliberately NOT applied to a migration: someone arriving from three years
   * x several months may already be over it, and truncating their view would read as data loss.
   */
  private _seedColumns(): EditBidColumnPick[] {
    if (!this._needsColumnSeed) return [];

    // Only an OLD ARRANGEMENT is worth reconstructing. These four are written by the Edit Bids grid
    // and nothing else -- the map panel writes CropCode/Month/CropYear -- so one of them being
    // present is what says this person used the old grid. With none of them, there is nothing to
    // carry over and the grid opens empty rather than guessing.
    const hasOldArrangement = this._legacyMonths !== null || this._legacyYears !== null
      || this._legacyCropOrder !== null || this._legacyHiddenCrops !== null;
    if (!hasOldArrangement) return [];

    const hidden = this._legacyHiddenCrops ?? new Set<string>();
    const order = this._legacyCropOrder;
    const months = this._legacyMonths ?? [BidSheetComponent.currentMonth()];
    const years = this._legacyYears ?? [new Date().getFullYear()];

    let crops = this.crops().filter(c => !hidden.has(c));
    if (order && order.length > 0) {
      const orderMap = new Map(order.map((code, idx) => [code, idx]));
      crops = [...crops].sort((a, b) =>
        (orderMap.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b) ?? Number.MAX_SAFE_INTEGER));
    }
    return crops.flatMap(crop => months.flatMap(month => years.map(year => ({ crop, year, month }))));
  }

  /**
   * Has this cell's basis actually changed?
   *
   * Compares the storage form, so "5" typed over a cell showing "+5" is not a change. A plain string
   * comparison of the two would call it one, mark the cell dirty, and send a no-op write.
   */
  basisChanged(row: EditBidsRow, key: string): boolean {
    return normalizeBasis(row.basisBids[key]) !== normalizeBasis(row.originalBasisBids[key]);
  }

  /** Handles arrow key navigation between bid input cells in the edit grid. */
  onBidKeyDown(event: KeyboardEvent, rowIdx: number, colIdx: number): void {
    const key = event.key;
    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    const columns = this.editGridColumns();
    const rowCount = this.editBidsRows().length;
    let targetRow = rowIdx;
    let targetCol = colIdx;
    if (key === 'ArrowUp') targetRow = Math.max(0, rowIdx - 1);
    else if (key === 'ArrowDown') targetRow = Math.min(rowCount - 1, rowIdx + 1);
    else if (key === 'ArrowLeft') targetCol = Math.max(0, colIdx - 1);
    else if (key === 'ArrowRight') targetCol = Math.min(columns.length - 1, colIdx + 1);
    if (targetRow === rowIdx && targetCol === colIdx) return;
    event.preventDefault();
    const targetKey = columns[targetCol]?.key;
    if (!targetKey) return;
    const el = document.getElementById(`bid-${targetRow}-${targetKey}`) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
  }

  updateBid(rowIndex: number, crop: string, value: string): void {
    // Mirrors cellReadOnly, whose only reason to refuse is a view-only grid (All Producers, where
    // there is no trade unit to save against). Fed cells and basis cells are both writable.
    const row = this.editBidsRows()[rowIndex];
    if (!row || this.cellReadOnly()) return;
    this.editBidsRows.update(rows => {
      const updated = [...rows];
      updated[rowIndex] = { ...updated[rowIndex], bids: { ...updated[rowIndex].bids, [crop]: value } };
      return updated;
    });
  }

  /** Diff the current grid against the snapshot and build the upsert payload for changed cells.
   *  Reads editBidsYear() and editGridColumns() at CALL TIME — callers that navigate (year/month/crop
   *  change) must invoke a save BEFORE mutating those, so the payload reflects the cells the user edited. */
  /** Basis counterpart of updateBid. Same ownership rule: the feed owns fed cells, users own theirs. */
  updateBasisBid(rowIndex: number, crop: string, value: string): void {
    const row = this.editBidsRows()[rowIndex];
    if (!row || this.cellReadOnly()) return;
    this.editBidsRows.update(rows => {
      const next = [...rows];
      next[rowIndex] = { ...next[rowIndex], basisBids: { ...next[rowIndex].basisBids, [crop]: value } };
      return next;
    });
  }

  private _buildDirtyBids(): Array<{ locationId: number; name?: string; elevatorCode?: string; tradeUnitCode?: string; groupName?: string; latitude?: number; longitude?: number; commodityCode: string; commodityName?: string; commodityCategory?: string; cropYear: number; bid: string; basisBid: string; month?: number }> {
    const commodityLookup = new Map(this.allCommodities().map(c => [c.code, c]));
    const toCreate: Array<{ locationId: number; name?: string; elevatorCode?: string; tradeUnitCode?: string; groupName?: string; latitude?: number; longitude?: number; commodityCode: string; commodityName?: string; commodityCategory?: string; cropYear: number; bid: string; basisBid: string; month?: number }> = [];

    for (const row of this.editBidsRows()) {
      for (const col of this.editGridColumns()) {
        // Fed cells are included now: overriding one is allowed, and the save is what makes the
        // override real. Unchanged fed cells fall out below on the value comparison, so a plain
        // re-save does not rewrite every fed row as manual.
        const current = (row.bids[col.key] ?? '').trim();
        const original = (row.originalBids[col.key] ?? '').trim();
        // Normalised on both sides: the cell holds "+5" and the server holds "5", and a user who
        // retypes the same number without the plus has not changed anything.
        const currentBasis = normalizeBasis(row.basisBids[col.key]);
        const originalBasis = normalizeBasis(row.originalBasisBids[col.key]);
        // Either price changing dirties the cell, and BOTH are always sent -- the upsert writes what
        // it is given, so omitting the untouched one would blank it.
        if (current !== original || currentBasis !== originalBasis) {
          const commodity = commodityLookup.get(col.crop);
          toCreate.push({
            locationId: row.locationId,
            name: row.name,
            latitude: row.latitude,
            longitude: row.longitude,
            elevatorCode: row.elevatorCode,
            tradeUnitCode: row.tradeUnitCode,
            commodityCode: col.crop,
            commodityName: commodity?.name,
            commodityCategory: commodity?.category ?? undefined,
            cropYear: col.year,
            bid: current,
            basisBid: currentBasis,
            month: col.month
          });
        }
      }
    }
    return toCreate;
  }

  /** Silently persists any changed cells (no toast, no reload, no close). Fired on input blur and
   *  before any grid-rebuilding navigation, so an in-progress bid is never lost. The green "changed"
   *  highlight clears as cells are confirmed saved (the only feedback). On success runs onDone (used by
   *  navigation to rebuild AFTER the save). On error, onDone is NOT called — the edit is preserved.
   *  Concurrency: at most one upsert in flight; edits arriving mid-flight coalesce into a single re-run. */
  private _saveDirtyBids(onDone?: () => void): void {
    const dirty = this._buildDirtyBids();
    if (dirty.length === 0) { onDone?.(); return; }

    if (this._autoSaving) {
      // A save is already running — coalesce. Remember the latest navigation callback so it still fires.
      this._autoSaveRerun = true;
      if (onDone) this._pendingOnDone = onDone;
      return;
    }

    this._autoSaving = true;
    this.apiService.bulkUpsertBidSheetBids(dirty)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this._autoSaving = false;
          this._clearDirtyForSaved(dirty);
          this._applyBidsToLocalCache(dirty);
          this._recordSaved(dirty);
          if (this._autoSaveRerun) {
            // Edits happened during the request — run once more; defer the callback to that final save.
            // Prefer the latest coalesced navigation (_pendingOnDone) over this save's original onDone.
            this._autoSaveRerun = false;
            const next = this._pendingOnDone ?? onDone ?? undefined;
            this._pendingOnDone = null;
            this._saveDirtyBids(next);
          } else {
            const cb = this._pendingOnDone ?? onDone ?? undefined;
            this._pendingOnDone = null;
            cb?.();
          }
        },
        error: (err) => {
          this._autoSaving = false;
          this._autoSaveRerun = false;
          this._pendingOnDone = null;
          if (isDevMode()) console.error('[BidSheet] auto-save bids failed', err);
          this.toastService.error(this._errorToast(err, "Failed to save bids"));
          // Deliberately NOT calling onDone — preserves the edit and aborts any pending navigation.
        }
      });
  }

  /** Marks the saved cells clean so the "changed" highlight clears — by setting originalBids to the
   *  value that was actually SAVED (not the current input). If the user kept editing the same cell while
   *  the save was in flight, current ≠ saved, so the cell stays dirty and the re-run / next blur catches it. */
  private _clearDirtyForSaved(dirty: Array<{ locationId: number; commodityCode: string; cropYear: number; month?: number; bid: string; basisBid: string }>): void {
    // By location, not by label: two rows sharing a name both matched, so saving one marked the
    // other clean -- its green highlight cleared and its genuinely unsaved edit dropped out of the
    // dirty set, which also re-armed the background refresh that is gated on a clean grid.
    const savedById = new Map<number, Map<string, { bid: string; basisBid: string }>>();
    for (const b of dirty) {
      // The year is part of the identity. Without it, saving 2026 corn would mark the 2027 corn cell
      // clean too: its highlight would clear, its board symbol would be deleted, and
      // _buildDirtyBids would stop reporting it -- which also re-arms the background refresh that is
      // gated on a clean grid, so the rebuild would land on top of the still-unsaved edit.
      const colKey = this._colKey(b.commodityCode, b.cropYear, b.month ?? 0);
      const m = savedById.get(b.locationId) ?? new Map<string, { bid: string; basisBid: string }>();
      m.set(colKey, { bid: b.bid, basisBid: b.basisBid });
      savedById.set(b.locationId, m);
    }
    this.editBidsRows.update(rows => rows.map(row => {
      const saved = savedById.get(row.locationId);
      if (!saved) return row;
      const originalBids = { ...row.originalBids };
      const originalBasisBids = { ...row.originalBasisBids };
      // BOTH sides, or a basis-only edit never goes clean: its green highlight would never clear, every
      // later blur would re-send it, and _buildDirtyBids would never report zero again -- which silently
      // switches off the background refresh that runs when the grid is open.
      // Everything that described the FEED's number has to go, because the cell is the user's now and
      // the row counts as clean again the moment originalBids is updated below. Two separate stores:
      //   boardChips    - the month-column board symbol
      //   coverageChips - the "this is really November's bid" marker, which a typed value is not
      // Per cell, not per side: the upsert writes both prices and the server flips the whole row to
      // Manual, so a basis-only edit takes the cash side with it.
      const boardChips = { ...row.boardChips };
      const coverageChips = { ...row.coverageChips };
      for (const [colKey, val] of saved) {
        originalBids[colKey] = val.bid;
        // Back into display form. The payload carries what the server stored, which has no sign of
        // its own, and leaving it bare would make the cell read as edited the moment it went clean.
        originalBasisBids[colKey] = formatBasis(val.basisBid);
        delete boardChips[colKey];
        delete coverageChips[colKey];
      }
      return { ...row, originalBids, originalBasisBids, boardChips, coverageChips };
    }));
  }

  /** Optimistically writes saved bids into the local location cache (bidLocations / allMapLocations),
   *  which feed the computed bidEntries → bidLookup that _buildEditGrid reads. Without this, navigating
   *  to another year and back rebuilds the grid from the stale cache and shows the pre-edit value until
   *  a full server refresh. Mirrors the optimistic update confirmAddLocation does for a new location. */
  private _applyBidsToLocalCache(dirty: Array<{ locationId: number; tradeUnitCode?: string; commodityCode: string; commodityName?: string; commodityCategory?: string; cropYear: number; bid: string; basisBid: string; month?: number }>): void {
    if (dirty.length === 0) return;
    const now = new Date().toISOString();

    // Grouped once rather than re-filtered per location: this used to scan the whole dirty array for
    // EVERY location in allMapLocations(), which is fine at a few dozen locations and is real work
    // once that list is the whole BarChart catalog.
    const dirtyById = new Map<number, typeof dirty>();
    for (const d of dirty) {
      const arr = dirtyById.get(d.locationId);
      if (arr) arr.push(d); else dirtyById.set(d.locationId, [d]);
    }

    const upsertInto = (locs: BidSheetLocation[]): BidSheetLocation[] => {
      let changed = false;
      const next = locs.map(loc => {
        // Matched by id. This used to match the dirty row's NAME against allMapLocations, which holds
        // the CANONICAL name -- so on any location with a per-sheet rename nothing matched and the
        // local cache silently went unupdated, leaving the grid to wait for a server round trip. The
        // trade-unit tie-break that went with it is gone too: it only ever existed to disambiguate a
        // name, and against an id it can only produce a false miss.
        const forLoc = dirtyById.get(loc.id) ?? [];
        if (forLoc.length === 0) return loc;
        changed = true;
        const bids = [...loc.bids];
        for (const d of forLoc) {
          const month = d.month ?? 0;
          const idx = bids.findIndex(b => b.commodityCode === d.commodityCode && b.cropYear === d.cropYear && b.month === month);
          if (idx >= 0) {
            // basisBid travels with bid: manual bids ARE basis for most originators, so dropping it
            // here made a basis edit revert on any year-switch-and-back -- the exact staleness this
            // method exists to prevent. Source becomes Manual and the fed provenance is dropped
            // because this path only runs for a user's own edit: overriding a fed cell takes it over,
            // and keeping Source='Barchart' left the row wearing a Feed chip and a board label that
            // no longer described its number.
            bids[idx] = {
              ...bids[idx],
              bid: d.bid,
              basisBid: d.basisBid,
              source: 'Manual',
              barchartSymbol: undefined,
              basisSymbol: undefined,
              underlyingFuture: undefined,
              commodityName: d.commodityName ?? bids[idx].commodityName,
              commodityCategory: d.commodityCategory ?? bids[idx].commodityCategory,
              modifiedAt: now
            };
          } else {
            // Always 'Manual': this path only runs for a user's own grid edits. The feed writes
            // its cells server-side and they arrive on the next load.
            bids.push({ id: 0, locationId: loc.id, commodityCode: d.commodityCode, commodityName: d.commodityName, commodityCategory: d.commodityCategory, cropYear: d.cropYear, month, bid: d.bid, basisBid: d.basisBid, source: 'Manual', createdBy: '', createdAt: now, modifiedAt: now });
          }
        }
        return { ...loc, bids };
      });
      return changed ? next : locs; // preserve reference when untouched so dependent computeds don't churn
    };

    this.allMapLocations.update(upsertInto);

    // Surface any brand-new crop year to the panel / old-new navigation as well.
    for (const d of dirty) {
      if (!this.cropYears().includes(d.cropYear)) {
        this.cropYears.update(yrs => [...yrs, d.cropYear].sort((a, b) => a - b));
      }
    }
  }

  /** Records the distinct cells saved this session so "Done" can report the running total. */
  private _recordSaved(dirty: Array<{ locationId: number; commodityCode: string; cropYear: number; month?: number }>): void {
    for (const b of dirty) {
      // By id, so two same-named locations are two saved cells rather than one under-reported.
      this._editBidsSavedKeys.add(`${b.locationId}|${b.commodityCode}|${b.cropYear}|${b.month ?? 0}`);
    }
  }

  /** Fired when a bid input loses focus — silently saves any changed cells. */
  onBidBlur(): void {
    this._saveDirtyBids();
  }

  /** Footer "Done": flush any remaining edits, then close + refresh, and report the session total.
   *  (Most cells are already auto-saved on blur; this just sweeps up anything not yet flushed.) */
  doneEditBids(): void {
    const dirty = this._buildDirtyBids();
    if (dirty.length === 0) {
      this._announceSaved();
      this._finishEditBids();
      return;
    }

    // Track one bids-changed event per affected location so the Usage Dashboard can attribute edits
    // (Most Edited Location card + Top Edited Bid Locations). Done-only, to avoid per-blur event spam.
    const affectedLocations = new Set(dirty.map(b => b.name).filter((n): n is string => !!n));
    for (const locName of affectedLocations) {
      this.usageTracking.postClickEvent('interaction', 'bidsheet', 'bids-changed', locName);
    }

    this.editBidsSaving.set(true);
    this.apiService.bulkUpsertBidSheetBids(dirty)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.editBidsSaving.set(false);
          this._applyBidsToLocalCache(dirty); // keep panel/map correct even if the post-close refresh hiccups
          this._recordSaved(dirty);
          this._announceSaved();
          this._finishEditBids();
        },
        error: (err) => {
          this.editBidsSaving.set(false);
          if (isDevMode()) console.error('[BidSheet] save bids failed', err);
          this.toastService.error(this._errorToast(err, "Failed to save bids"));
        }
      });
  }

  /** Shows a success toast summarizing how many distinct bids were saved this session (no toast if none). */
  private _announceSaved(): void {
    const n = this._editBidsSavedKeys.size;
    if (n === 0) return;
    this.toastService.success(`Saved ${n} bid ${n !== 1 ? 'changes' : 'change'} successfully`, 4000);
  }

  private _finishEditBids(): void {
    this._closeEditBids();
    // 'refresh': a hiccup in this post-save reload is shown softly, never as a save failure.
    this._loadAllMapLocations();
  }

  /** Footer "Close": there is no discard anymore — everything auto-saves on blur/navigation.
   *  Does a final silent flush, then exits. On a save error the flush keeps the grid open (edit preserved). */
  closeEditBids(): void {
    this._saveDirtyBids(() => {
      this._closeEditBids();
      this.editBidsRows.set([]);
    });
  }

  private _closeEditBids(): void {
    // Close the edit grid but keep the session reference and panel state intact
    this.editBidsMode.set(false);
    this._refreshMapMarkers();
  }

  // ── Print dialog state ──
  showPrintDialog = signal(false);

  // ── Print preview scaling ──
  // The preview sheet is laid out at the printable page width (10.4in at 96dpi) plus its own
  // 20px padding each side, then ZOOMED to fill whatever width the pane has. On a big monitor the
  // sheet — type included — grows so it's easy to read; on a laptop it shrinks to fit. The layout
  // itself never changes, so what you see is still exactly what prints.
  readonly printPreviewSheetPx = Math.round(PRINT_GEOMETRY.PAGE_WIDTH_IN * PRINT_GEOMETRY.PX_PER_IN) + 40;
  private readonly printPreviewPane = viewChild<ElementRef<HTMLElement>>('printPreviewPane');
  private readonly printPreviewPaneWidth = signal(0);
  private readonly _printPreviewResize = effect(onCleanup => {
    const el = this.printPreviewPane()?.nativeElement;
    if (!el) { this.printPreviewPaneWidth.set(0); return; }
    // contentRect excludes the pane's padding, which is exactly the width the sheet may fill.
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      this.printPreviewPaneWidth.set(Math.round(width));
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });
  /** Zoom that fits the sheet to the pane with a little margin, bounded so it never becomes unreadably
   *  small or blown up: 1.1× is as large as a print preview should read on a monitor. */
  readonly printPreviewZoom = computed(() => {
    const paneWidth = this.printPreviewPaneWidth();
    if (paneWidth <= 0) return 1;
    return Math.round(Math.min(1.1, Math.max(0.5, (paneWidth * 0.9) / this.printPreviewSheetPx)) * 100) / 100;
  });
  /**
   * Which grid columns to print, by column key.
   *
   * One set, where there used to be two independent ones for crops and months. Under the cross
   * product those two could describe the printed columns between them; against an explicit list they
   * cannot -- "YC" and "Dec" no longer pick out one column, and a sheet holding Dec 2026 and Dec 2027
   * would have had both or neither. Not persisted, like the two it replaces: it is a per-print choice.
   */
  printSelectedColumns = signal<Set<string>>(new Set());
  readonly todayFormatted = computed(() => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
  printAddress = signal('');
  printPhone = signal('');
  printHighlightScoularLocations = signal<boolean>(true);
  /**
   * Which export layout to render. Same data either way — only the arrangement differs.
   *   'locationsDown'   — one Location column, then a coloured band per crop with its periods
   *                       beneath. Locations listed once; wide selections split into bands.
   *   'locationsAcross' — the transpose: crop/period rows down the side, locations across the top
   *                       in blocks of 4–8. Best for comparing many locations.
   * Persisted per trade unit alongside the rest of the print layout (see utils/print-layout.ts).
   */
  printLayoutStyle = signal<PrintLayoutStyle>(DEFAULT_PRINT_LAYOUT_STYLE);

  /**
   * Commodity CODE → the key the shared palette actually understands.
   *
   * The bid sheet groups by code (YC, SOR, YSB) but commodity-color.ts is keyed by crop NAME
   * (corn, sorghum, soybeans). Passing a code straight in misses every entry and falls through to
   * the hashed fallback palette — and YC, SOR and YSB all hash to the same bucket, so the whole
   * sheet printed in one colour. Category is the Commodities table's code→crop mapping.
   */
  private readonly cropCategoryByCode = computed(
    () => new Map(this.allCommodities().map(c => [c.code, c.category?.trim() || c.code])));

  cropPaletteKey(crop: string): string {
    return this.cropCategoryByCode().get(crop) ?? crop;
  }

  /** Solid per-crop hex from the shared palette — used for the header border/accent. */
  cropHeaderColor(crop: string): string {
    return commodityHex(this.cropPaletteKey(crop));
  }

  /**
   * Pastel version of a crop's colour, matching the commodity CHIPS used everywhere else in the app
   * (light tint + dark text) rather than the saturated fill this export used to have.
   *
   * Derived by blending the palette hex toward white instead of hard-coding a second set of pastels,
   * so it stays in step automatically if commodity-color.ts ever changes. Chips are roughly the
   * Tailwind 100-level of the same hue, which is about an 82% blend.
   */
  cropHeaderTint(crop: string, blend = 0.82): string {
    const hex = this.cropHeaderColor(crop).replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * blend);
    return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  /** Absolute, because the print popup is `about:blank` — a relative asset path 404s there. */
  readonly printLogoUrl = `${window.location.origin}/assets/images/scoular-logo-dark.webp`;

  /**
   * Every edit-grid row with its bids resolved for the selected print columns, in grid order.
   * The Highlight toggle is folded into `isScoular` here so the layout builder never has to know
   * about it. Locations with no bids are dropped by the builder, not here.
   */
  readonly printLocations = computed<PrintLocation[]>(() => {
    const columns = this.printCropGroups().flatMap(g => g.columns);
    const highlight = this.printHighlightScoularLocations();
    const scoularIds = this.scoularLocationIds();
    return this.editBidsRows().map(row => ({
      name: row.name,
      isScoular: highlight && scoularIds.has(row.locationId),
      values: Object.fromEntries(columns.map(col => [col.key, this.printCellValue(row, col)]))
    }));
  });

  /** The ONE layout model both the dialog preview and the printed document render. */
  readonly printLayoutModel = computed<PrintLayoutModel>(() => buildPrintLayout({
    style: this.printLayoutStyle(),
    groups: this.printCropGroups(),
    locations: this.printLocations(),
    cropColors: crop => ({ solid: this.cropHeaderColor(crop), tint: this.cropHeaderTint(crop) })
  }));

  /** Template hooks onto the shared renderers (the preview binds these with `[style]`). */
  readonly printCellStyle = cellStyleMap;
  readonly printColWidths = tableColWidthPcts;

  onPrintPhoneInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10);
    let formatted = raw;
    if (raw.length > 6) formatted = `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`;
    else if (raw.length > 3) formatted = `(${raw.slice(0, 3)}) ${raw.slice(3)}`;
    else if (raw.length > 0) formatted = `(${raw}`;
    this.printPhone.set(formatted);
    (event.target as HTMLInputElement).value = formatted;
  }

  /**
   * The chosen grid columns, grouped for the print preview — each group is one banded section.
   *
   * Groups are CONTIGUOUS RUNS of the same crop, not one group per distinct crop. The grid's order is
   * the user's and print promises to match it, so interleaving (YC Dec, SB Dec, YC Jan) has to draw
   * three bands rather than re-sorting into two. The same crop appearing twice is therefore normal and
   * gets the same colour both times.
   *
   * Print is no longer single-year: it used to build every column against editBidsYear(), the first
   * selected year, so a multi-year grid printed one year's numbers under every heading.
   */
  readonly printCropGroups = computed(() => {
    const chosen = this.printSelectedColumns();
    const columnsToPrint = this.editGridColumns().filter(c => chosen.has(c.key));

    const groups: PrintCropGroup[] = [];
    for (const gridCol of columnsToPrint) {
      const viewedYear = gridCol.year;
      const crop = gridCol.crop;
      const m = gridCol.month;
      let group = groups[groups.length - 1];
      if (!group || group.crop !== crop) {
        group = { crop, columns: [] };
        groups.push(group);
      }
      const columns = group.columns;
      {
        // Monthly: one column per selected month for the viewed year, headed "May (2026)".
        //
        // The board deliberately does NOT go in compactLabel, even though that is the only header the
        // renderer prints. compactLabel is also what the fit-first sizing MEASURES: " · ZCU26" doubles
        // a column's width, which pushes four commodities off a single band and splits the sheet in
        // two -- the stacked layout users rejected. Paper therefore names a board only on the cells
        // that DISAGREE with their column (see printCellValue), so a cross-exchange outlier is never
        // silently comparable, and the common case stays as compact as the layout was tuned for.
        // `label` keeps the full text for any future header that is not width-measured.
        const board = this.boardConsensus(crop, viewedYear, m);
        for (const pt of this.printPriceTypes()) {
          const suffix = pt ? (pt === 'cash' ? ' Cash' : ' Basis') : '';
          columns.push({
            // The YEAR is part of the key. Without it Dec 2026 and Dec 2027 collided on "YC#12" in
            // printLocations' values record, and the second silently overwrote the first -- invisible
            // while print was single-year, a wrong sheet the moment columns carry their own year.
            key: `${crop}#${viewedYear}#${m}${pt ? '#' + pt : ''}`, crop, month: m, year: viewedYear,
            label: `${this.getMonthName(m)} (${viewedYear})${suffix}${board ? ' · ' + board : ''}`,
            compactLabel: `${this.getMonthName(m)} ${String(viewedYear).slice(-2)}${suffix}`,
            priceType: pt
          });
        }
      }
    }
    return groups;
  });

  /**
   * Resolve a printed cell's bid value. A year the GRID is showing reads the live edit-grid value, so
   * unsaved edits print; any other year reads the saved bid from the lookup. That test is now
   * "is this year on screen", not "is this the one viewed year" -- with several years in the grid,
   * several of print's columns are live.
   */
  printCellValue(row: EditBidsRow, col: { crop: string; month: number; year: number; priceType?: 'cash' | 'basis' }): string {
    const gridKey = this._colKey(col.crop, col.year, col.month);
    // "Is this column on the grid", so unsaved edits print. Print columns are a subset of the grid's
    // now, so this is true in practice; the saved-bid fallback below is kept for the case where the
    // grid is rebuilt between the preview and the print.
    const live = this._gridColumnKeys().has(gridKey);

    // row.bids is ALWAYS the cash column and row.basisBids ALWAYS the basis one -- the grid keeps
    // both side by side so it can render either without rebuilding. A single-price column carries no
    // priceType (adding one would suffix every header and cost font size in the fit-first sizing), so
    // the type has to come from the toggle instead. Reading row.bids whenever priceType was absent is
    // what printed a Basis sheet full of cash prices.
    const wantBasis = col.priceType ? col.priceType === 'basis' : this.priceMode() === 'basis';

    let value: string;
    if (wantBasis) {
      value = live
        ? (row.basisBids[gridKey] ?? '').trim()
        : (this._getLatestEntry(row.locationId, col.year, col.crop, col.month)?.basisBid ?? '').trim();
    } else if (live) {
      value = (row.bids[gridKey] ?? '').trim();
    } else {
      // Mode-aware, but only cash reaches it: basis took the branch above.
      value = this._getLatestBid(row.locationId, col.year, col.crop, col.month).trim();
    }
    if (!value) return value;

    // The board describes the FED number, and for the viewed year the value above may be an unsaved
    // override. Printing the two together stamped a hand-typed price with a board it was never quoted
    // against; the grid guards this the same way before showing its own symbol.
    const overridden = live && (wantBasis
      ? value !== (row.originalBasisBids[gridKey] ?? '').trim()
      : value !== (row.originalBids[gridKey] ?? '').trim());

    // Signed only now, where it is emitted. The comparison above has to come first: it weighs the
    // value against the stored original, which carries no sign of its own, so signing any earlier
    // would make every positive basis look like an unsaved override and drop its board symbol.
    const shown = wantBasis ? formatBasis(value) : value;
    if (overridden) return shown;

    // Paper says it once in the header and only repeats it on a cell that disagrees -- unlike the
    // screen, which labels every fed bid. Print cannot afford the repetition: the values feed the
    // fit-first column sizing, and a symbol on all of them widened columns enough to drop the whole
    // sheet to 9px type, or overflow the page outright in Both mode.
    const cellBoard = this.cellBoardFor(row.locationId, col.year, col.crop, col.month);
    const consensus = this.boardConsensus(col.crop, col.year, col.month);
    return cellBoard && cellBoard !== consensus ? `${shown} (${cellBoard})` : shown;
  }

  /**
   * Which price columns each period prints as. Cash and basis print one column carrying the selected
   * price; Both prints the pair, which is why this returns undefined rather than 'cash' in the single
   * cases -- an unset priceType keeps the column keys and headers exactly as they were.
   */
  private readonly printPriceTypes = computed<(('cash' | 'basis') | undefined)[]>(() =>
    this.priceMode() === 'both' ? ['cash', 'basis'] : [undefined]);

  // ---------------------------------------------------------------------------
  // Export to Excel
  // ---------------------------------------------------------------------------

  readonly exporting = signal<boolean>(false);

  /**
   * The open sheet as an Excel workbook: the grid exactly as displayed -- location names, and under each
   * period the price(s) the Cash/Basis/Both toggle is showing plus the contract symbol. Nothing more, by
   * request. Beside Print because it answers the same question -- "give me this sheet to take away" --
   * for the person who wants to sort or paste rather than read.
   *
   * Unsaved cells are saved FIRST, the same rule removing locations follows: the file must never show
   * a value the database doesn't. If that save fails, no file is produced (the toast says why), rather
   * than a spreadsheet that quietly disagrees with the sheet.
   */
  exportEditBids(): void {
    if (this.exporting() || this.selectedSheets().length === 0) return;
    this._saveDirtyBids(() => { void this._runExport(); });
  }

  private async _runExport(): Promise<void> {
    // The workbook is the rows on screen, so it is named after every sheet they came from. Naming it
    // after the first alone would put a file called "Kansas" on someone's desk holding Nebraska's
    // elevators too.
    const sheetName = this.selectedSheetsLabel();
    if (!sheetName) return;
    this.exporting.set(true);
    try {
      // exceljs is ~1MB, so it is loaded on first use rather than shipped in the initial bundle. It is
      // a CommonJS module: under esbuild's interop the namespace may arrive on .default or as the
      // namespace itself, hence the fallback.
      const loaded: unknown = await import('exceljs');
      const ExcelJS = ((loaded as { default?: ExcelJSModule }).default ?? loaded) as ExcelJSModule;

      const model = buildBidSheetExport({
        sheetName,
        exportedAt: new Date(),
        // The toggle decides what each period exports: Cash or Basis alone, or both side by side.
        priceMode: this.priceMode(),
        columns: this.editGridColumns().map(c => ({ key: c.key, crop: c.crop, year: c.year, month: c.month, board: c.board })),
        rows: this.editBidsRows().map(r => ({ name: r.name, bids: r.bids, basisBids: r.basisBids, boardChips: r.boardChips })),
        monthNames: BidSheetComponent.MONTH_NAMES,
      });

      downloadWorkbook(await writeBidSheetWorkbook(model, ExcelJS), model.fileName);
      this.usageTracking.postClickEvent('interaction', 'bidsheet', 'exported-excel');
      this.toastService.success(`Exported "${sheetName}"`);
    } catch (err) {
      if (isDevMode()) console.error('[BidSheet] export failed', err);
      this.toastService.error('Failed to export the bid sheet');
    } finally {
      this.exporting.set(false);
    }
  }

  printEditBids(): void {
    // Initialize period (crop/month) selection with whatever is currently visible on the edit grid.
    // The per-context year configs persist (loaded from preference / kept across opens).
    this.printSelectedColumns.set(new Set(this.editGridColumns().map(c => c.key)));
    this.showPrintDialog.set(true);
  }

  /** Persists the print layout: contact info, highlight and layout style (fire-and-forget). */
  private _savePrintLayout(): void {
    const layout = JSON.stringify({
      address: this.printAddress(),
      phone: this.printPhone(),
      highlightScoular: this.printHighlightScoularLocations(),
      layoutStyle: this.printLayoutStyle()
    });
    const cropCode = this.selectedCrop() || null;
    const month = this.selectedMonth();
    const cropYear = this.selectedYear() || null;
    this.apiService.setBidSheetPreference({ tradeUnitKey: this.preferenceKey(), cropCode, month, cropYear, printLayout: layout })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save print layout', err); } });
  }

  closePrintDialog(): void {
    this._savePrintLayout(); // persist contact info / any pending changes on close
    this.showPrintDialog.set(false);
  }

  togglePrintColumn(key: string): void {
    this.printSelectedColumns.update(s => {
      const out = new Set(s);
      out.has(key) ? out.delete(key) : out.add(key);
      return out;
    });
  }

  /** True when every grid column is ticked, so the All/None button knows which it is offering. */
  readonly allPrintColumnsSelected = computed(() => {
    const columns = this.editGridColumns();
    const chosen = this.printSelectedColumns();
    return columns.length > 0 && columns.every(c => chosen.has(c.key));
  });

  toggleAllPrintColumns(): void {
    this.printSelectedColumns.set(
      this.allPrintColumnsSelected() ? new Set() : new Set(this.editGridColumns().map(c => c.key)));
  }

  getMonthName(month: number): string {
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1] ?? '';
  }

  /** Prints the SAME model the preview shows — the popup document is rendered from it, not rebuilt. */
  confirmPrint(): void {
    const model = this.printLayoutModel();
    if (model.tables.length === 0) return;

    this._savePrintLayout(); // remember this layout for next time

    const html = renderPrintDocument(model, {
      address: this.printAddress(),
      phone: this.printPhone(),
      dateText: this.todayFormatted(),
      logoUrl: this.printLogoUrl,
      priceModeLabel: this.printPriceModeCaption()
    });

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
    }
    this.showPrintDialog.set(false);
  }

  private _removeAddLocationPin(): void {
    if (this._addLocationPin && this._map) {
      this._map.removeLayer(this._addLocationPin);
      this._addLocationPin = null;
    }
  }

  private _resetAddForm(): void {
    this.newLocationName.set('');
    this.newLocationLat.set(null);
    this.newLocationLng.set(null);
    this.newLocationIsScoular.set(false);
  }

  // =========================================================================
  // Panel helpers
  // =========================================================================

  selectItemFromTable(item: BidSheetPanelItem): void {
    // Open the detail view for this location — does NOT set it as the session reference.
    // Use the "Set as Reference" button in the detail view to make it the reference.
    const alreadyOpen = this.panelSelectedLocationId() === item.locationId;
    this.panelSelectedLocationId.set(alreadyOpen ? null : item.locationId);
    this.showPanel.set(true);
    if (!alreadyOpen) {
      this.usageTracking.postClickEvent('interaction', 'bidsheet', 'location-selected', item.name);
    }

    // Opening a location does NOT change the trade-unit/group scope — stays in the current view
    // (All Producers or the selected group) so it can be compared against all other locations.

    // Pan the map to the selected location so the user can see the enlarged pin
    if (!alreadyOpen && item.latitude != null && item.longitude != null) {
      this._flyToLocation(item.latitude, item.longitude);
    }

    this._refreshMapMarkers();
  }

  /** Sets the currently-open panel detail location as the session reference. */
  panelSetReference(): void {
    const id = this.panelSelectedLocationId();
    if (id == null) return;
    // Toggle: clicking again clears the reference
    const isSetting = this.selectedLocationId() !== id;
    if (isSetting) {
      this.selectedLocationId.set(id);
      this.usageTracking.postClickEvent('interaction', 'bidsheet', 'reference-set', this.panelSelectedName());
    } else {
      this.selectedLocationId.set(null);
    }
    this.filterBids();
    this._refreshMapMarkers();
  }

  panelGoBack(): void {
    // Close detail view but keep the session reference (selectedLocationId) intact
    this.panelSelectedLocationId.set(null);
    this.showDeleteLocationConfirm.set(false);
    this.deleteMode.set(false);
    this.showDeleteCropConfirm.set(false);
    this.pendingDeleteCrop.set('');
    this._refreshMapMarkers();
  }

  /**
   * Opens the delete confirmation and fetches how many sheets hold this location -- deleting it now
   * takes the elevator and its whole bid history off every one of them, not just this screen's.
   */
  openDeleteLocationConfirm(): void {
    this.showDeleteLocationConfirm.set(true);
    this.deleteLocationSheetCount.set(null);
    const loc = this.panelSelectedRow();
    if (!loc) return;
    this.apiService.getBidSheetLocationSheetCount(loc.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (count) => this.deleteLocationSheetCount.set(count),
      error: () => this.deleteLocationSheetCount.set(null)
    });
  }

  confirmDeleteLocation(): void {
    const loc = this.panelSelectedRow();
    if (!loc) return;
    const name = loc.name;
    // No trade unit sent. The one on the row is provenance -- whichever desk first added the
    // location -- and sending it 403'd anyone deleting a location a different desk introduced.
    // The server authorizes on the persisted CreatedBy instead: creator or Admin.
    this.apiService.deleteBidSheetLocation(loc.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.allMapLocations.update(locs => locs.filter(l => l.id !== loc.id));
        // Company-wide delete: it comes off every sheet, not just the active one.
        this.sheets.update(list => list.map(s => ({ ...s, locations: s.locations.filter(l => l.id !== loc.id) })));
        this.showDeleteLocationConfirm.set(false);
        this.deleteMode.set(false);
        this.panelSelectedLocationId.set(null);
        this.selectedLocationId.set(null);
        this.toastService.success(`Deleted ${name}`);
        this._applyBidFilterSources();
        this.filterBids();
        this._refreshMapMarkers();
        this.usageTracking.postClickEvent('interaction', 'bidsheet', 'location-deleted', name);
      },
      error: () => {
        this.showDeleteLocationConfirm.set(false);
        this.toastService.error('Failed to delete location');
      }
    });
  }

  requestDeleteCrop(crop: string): void {
    this.pendingDeleteCrop.set(crop);
    this.showDeleteCropConfirm.set(true);
  }

  cancelDeleteCrop(): void {
    this.pendingDeleteCrop.set('');
    this.showDeleteCropConfirm.set(false);
  }

  confirmDeleteCrop(): void {
    const crop = this.pendingDeleteCrop();
    const loc = this.panelSelectedRow();
    if (!crop || !loc) return;
    // No trade unit sent -- see confirmDeleteLocation above.
    this.apiService.deleteBidSheetBids(loc.id, crop).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.allMapLocations.update(locs => locs.map(l =>
          l.id === loc.id ? { ...l, bids: (l.bids ?? []).filter(b => b.commodityCode !== crop) } : l
        ));
        this.showDeleteCropConfirm.set(false);
        this.pendingDeleteCrop.set('');
        this.toastService.success(`Deleted ${crop} bids from ${name}`);
        this.filterBids();
        this._refreshMapMarkers();
      },
      error: () => {
        this.showDeleteCropConfirm.set(false);
        this.pendingDeleteCrop.set('');
        this.toastService.error('Failed to delete crop bids');
      }
    });
  }

  startEditLocationName(): void {
    this.editLocationNameValue.set(this.panelSelectedName());
    this.editingLocationName.set(true);
  }

  cancelEditLocationName(): void {
    this.editingLocationName.set(false);
    this.editLocationNameValue.set('');
  }

  /**
   * Resolves a panel-selected location name to the row the user is actually looking at.
   *
   * Location names are only unique WITHIN a trade unit, so a bare name lookup across every trade unit
   * can return someone else's row — and then a rename, a Scoular toggle or a delete lands on the wrong
   * desk. Adding a location to several trade units from the BarChart picker creates identical names by
   * design, so this went from unlikely to routine.
   *
   * Prefers a row in the trade units currently in view, lowest id first so repeat actions are stable.
   * Falls back to any match, which preserves the old behaviour for the case where the panel is showing
   * one row per elevator, so a name that matches twice means two genuinely different places that
   * happen to share a name -- lowest id wins, which is at least stable.
   *
   * This used to prefer a row inside the selected trade units, and its own comment noted that the
   * unscoped fallback was tolerable only because mutations were gated behind a trade unit being
   * selected. That gate is gone, so prefer the id where you have one: renaming and the Scoular
   * toggle both do.
   */
  private _findLocationByName(name: string): BidSheetLocation | undefined {
    // The SHEET first: its names are what the grid and panel actually display, which since per-sheet
    // renames may be a DisplayName that no canonical row carries. Searching only allMapLocations
    // (canonical names) meant a renamed location could not be found at all, so the Scoular toggle and
    // the grid rename silently did nothing on exactly the rows the user had bothered to rename.
    const onSheet = this.bidLocations()
      .filter(l => l.name === name)
      .sort((a, b) => a.id - b.id)[0];
    if (onSheet) return onSheet;
    return this.allMapLocations()
      .filter(l => l.name === name)
      .sort((a, b) => a.id - b.id)[0];
  }

  /**
   * The location's own, company-wide name -- never a per-sheet DisplayName.
   *
   * Needed because the update endpoint replaces the whole record, so every write has to send a name;
   * sending the name the SHEET shows would silently publish one sheet's private label as the
   * elevator's real name for everybody. That is precisely the bug the per-sheet rename exists to
   * prevent, and it leaked back in through the Scoular toggle.
   */
  private _canonicalNameFor(locationId: number, fallback: string): string {
    return this.allMapLocations().find(l => l.id === locationId)?.name ?? fallback;
  }

  /**
   * Whether another location ON SCREEN already shows this name (trimmed, case-insensitive).
   *
   * Two rows reading the same thing is the problem: which one did you just rename, and which one are
   * you about to remove? Checked against what the rows DISPLAY (DisplayName ?? canonical), because
   * that is what the user is disambiguating by. Identity itself is safe either way -- everything keys
   * on locationId now, so a collision is a readability fault rather than the wrong-row bug it used to
   * be.
   *
   * Note it reads bidLocations, so with several sheets ticked it spans the UNION and is therefore
   * STRICTER than the server, which checks one sheet. A name free on sheet A but taken on sheet B is
   * refused here and would have been accepted there. That is the intended side: the union is what the
   * user is looking at, and letting them create two identical rows in it helps nobody.
   *
   * What it cannot prevent: two DIFFERENT locations arriving already identically named, one from each
   * sheet. Nothing rejects that -- the rows are keyed by id, so they render and behave correctly, they
   * just read alike.
   */
  private _nameTakenOnSheet(name: string, exceptLocationId: number): boolean {
    const wanted = name.trim().toLowerCase();
    return this.bidLocations().some(l => l.id !== exceptLocationId && l.name.trim().toLowerCase() === wanted);
  }

  // -------------------------------------------------------------------------
  // Renaming and classifying from the Edit Bids grid
  //
  // Adding a batch from BarChart lands here, so this is where the vendor's names get corrected and
  // Scoular sites get confirmed. The side-panel versions below do the same job for whichever single
  // location the panel has selected; these are row-scoped so a whole batch can be worked through.
  // -------------------------------------------------------------------------

  /** Row currently being renamed, by location name. Empty when none is. */
  /** The location id of the row being renamed in the grid, or null. Was the row's name, which is not
   *  an identity -- two rows can share one. */
  readonly renamingRow = signal<number | null>(null);
  readonly renameRowDraft = signal('');

  startRenameRow(row: EditBidsRow, event?: Event): void {
    event?.stopPropagation();
    this.renamingRow.set(row.locationId);
    this.renameRowDraft.set(row.name);
    // The template's `autofocus` does nothing here -- browsers honour it at parse time, not when an
    // element is inserted later -- so the user had to click the pencil and then click the box. Focus
    // after the input exists, and select the text so a full replacement is one keystroke away.
    setTimeout(() => {
      const el = document.getElementById(`rename-row-${row.locationId}`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }

  cancelRenameRow(): void {
    this.renamingRow.set(null);
    this.renameRowDraft.set('');
  }

  /** A name is required: there is no sensible way to render a location without one. */
  readonly renameRowValid = computed(() => this.renameRowDraft().trim().length > 0);

  /** Empties the input so a long vendor name can be replaced without selecting it first. */
  clearRenameRow(event?: Event): void {
    event?.preventDefault();   // keep focus on the input; blurring it would commit the rename
    this.renameRowDraft.set('');
  }

  saveRenameRow(row: EditBidsRow): void {
    const newName = this.renameRowDraft().trim();
    // An empty name reverts rather than saving. Blur commits, so a user who clears the box and clicks
    // away must get the old name back instead of a nameless row.
    this.cancelRenameRow();
    if (!newName || newName === row.name) return;

    // By id: _findLocationByName would resolve a shared name to the lowest-id match, which is how a
    // rename could land on a different elevator than the one the user was looking at.
    const loc = this.allMapLocations().find(l => l.id === row.locationId);
    if (!loc) return;
    if (this._nameTakenOnSheet(newName, loc.id)) {
      this.toastService.error(`Another location on this sheet is already called "${newName}"`);
      return;
    }
    // PER-SHEET, like the side panel's rename. This used to go through _saveLocationFields, which
    // writes the shared location row -- so renaming a row in the grid renamed that elevator for
    // EVERY sheet holding it, and the new name survived being removed and re-added because it had
    // become the elevator's real name. Row order is keyed by location id, so nothing to carry over.
    this._renameLocationOnSheets(loc.id, newName);
  }

  isRowScoular(row: EditBidsRow): boolean {
    // scoularLocationIds() is an O(1) set lookup; scanning every location is O(n), and this is called
    // once per grid row on every change-detection pass -- O(rows x locations) repeated many times a
    // second. At catalog scale that stops being free.
    return this.scoularLocationIds().has(row.locationId);
  }

  toggleRowScoular(row: EditBidsRow, event?: Event): void {
    event?.stopPropagation();
    const loc = this.allMapLocations().find(l => l.id === row.locationId);
    if (!loc) return;
    const next = !(loc.isScoularFacility ?? false);
    this._saveLocationFields(loc, { isScoularFacility: next },
      next ? `${loc.name} marked as a Scoular facility` : `${loc.name} marked as a competitor`,
      'Failed to update location');
  }

  /**
   * Saves a change to one or two location fields, carrying the rest through unchanged.
   *
   * The update endpoint replaces the whole record, so every field has to be sent or it is cleared.
   * That is easy to get wrong one call at a time, which is why both callers go through here.
   */
  private _saveLocationFields(
    loc: BidSheetLocation, changes: Partial<BidSheetLocation>, successMessage: string, failureMessage: string): void {
    this.apiService.updateBidSheetLocation(loc.id, {
      // The CANONICAL name, never the sheet's display name -- see _canonicalNameFor. loc may have come
      // from the sheet's list, where name is already DisplayName ?? canonical, and sending that would
      // publish one sheet's private label as the elevator's real name for everybody.
      name: this._canonicalNameFor(loc.id, loc.name),
      address: loc.address,
      city: loc.city,
      state: loc.state,
      latitude: loc.latitude,
      longitude: loc.longitude,
      elevatorCode: loc.elevatorCode,
      tradeUnitCode: loc.tradeUnitCode,
      groupName: loc.groupName,
      isScoularFacility: loc.isScoularFacility ?? false,
      bids: [],
      ...changes
    } as any).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.allMapLocations.update(locs => locs.map(l => l.id === loc.id ? { ...l, ...changes } : l));
        this.toastService.success(successMessage);
        // Rebuild from the cache just updated, then sync in the background with NO callback. Passing
        // one makes the reload take ownership of the grid's loading flag, which replaces the whole
        // table with a full-screen spinner and comes back with focus and scroll reset -- twice over,
        // on a rename-then-star hop. The rename is already local, so there is nothing to wait for,
        // and the open grid still trues itself up when the reload lands.
        if (this.editBidsMode()) this._buildEditGrid();
        this._loadAllMapLocations();
        this._loadAllMapLocations();
      },
      error: () => this.toastService.error(failureMessage)
    });
  }

  saveLocationName(): void {
    const newName = this.editLocationNameValue().trim();
    const loc = this.panelSelectedRow();
    if (!loc) return;
    if (!newName || newName === loc.name) {
      this.cancelEditLocationName();
      return;
    }
    // Refused with the edit box left OPEN so the name can be corrected -- unlike the grid, where blur
    // has already committed by the time this check runs.
    if (this._nameTakenOnSheet(newName, loc.id)) {
      this.toastService.error(`Another location on this sheet is already called "${newName}"`);
      return;
    }
    // Renames on the TICKED SHEETS only. It used to PUT the shared location row, and locations are
    // company-wide -- so the name changed on every sheet holding that elevator, last write wins, with
    // no warning. Two originators with the same elevator overwrote each other's label. The canonical
    // name (what "All locations" shows, and what the BarChart bridge matches on) is left alone.
    //
    // Nothing to re-point afterwards: the panel and the reference both hold the location's ID, which a
    // rename does not change. Both used to hold the NAME, so each had to be chased -- and the
    // reference could only be chased by comparing names, which moved it onto the wrong location
    // whenever two shared one.
    this._renameLocationOnSheets(loc.id, newName, () => {
      this.editingLocationName.set(false);
      this.editLocationNameValue.set('');
    });
  }

  /**
   * Renames a location on the TICKED SHEETS that hold it, and refreshes everything derived from them.
   *
   * Shared by the side panel and the Edit Bids grid. The grid used to write the shared location row
   * instead, which renamed the elevator for every sheet holding it -- and because that became its real
   * name, the label came back even after removing and re-adding the location from the catalog.
   *
   * With several sheets ticked the row on screen is ONE row standing for the same elevator on each of
   * them, so renaming it has to reach all of them. Renaming only the first would leave the other
   * sheets on the old label and the union's name rule would then see a disagreement and show the
   * canonical name -- the user's new name would appear to have been ignored.
   *
   * Sheets the location is not on are untouched, ticked or not: the user renamed a row they can see.
   */
  private _renameLocationOnSheets(locationId: number, newName: string, onDone?: () => void): void {
    const sheetIds = this.sheetIdsByLocationId().get(locationId) ?? [];
    if (sheetIds.length === 0) { this.toastService.error('Open a bid sheet to rename a location'); return; }

    // One request per sheet, because a rename is per-sheet by construction (BidSheetLocationLink
    // .DisplayName). forkJoin reports the first failure, and any write that already landed stays --
    // the sheets that did succeed come back in the error-free responses we never see, so the next
    // load reconciles. Half-renamed is visible (the row falls back to the canonical name) rather than
    // silent, which is the right failure for something this cheap to redo.
    forkJoin(sheetIds.map(id => this.apiService.setBidSheetLocationName(id, locationId, newName)))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (updated) => {
          this.toastService.success(sheetIds.length === 1
            ? `Renamed to ${newName} on this sheet`
            : `Renamed to ${newName} on ${sheetIds.length} sheets`);
          // Each response carries its sheet with names already resolved, so everything downstream
          // rebuilds from them. No _loadAllMapLocations(): the canonical row did not change.
          for (const sheet of updated) this._applySheet(sheet);
          onDone?.();
          this._applyBidFilterSources();
          this.filterBids();
          this._refreshMapMarkers();
          if (this.editBidsMode()) this._buildEditGrid();
        },
        error: () => this.toastService.error('Failed to rename location')
      });
  }

  toggleLocationScoularStatus(): void {
    const loc = this.panelSelectedRow();
    if (!loc) return;
    const newValue = !(loc.isScoularFacility ?? false);

    this.apiService.updateBidSheetLocation(loc.id, {
      // The CANONICAL name, never the sheet's display name -- see _canonicalNameFor. loc may have come
      // from the sheet's list, where name is already DisplayName ?? canonical, and sending that would
      // publish one sheet's private label as the elevator's real name for everybody.
      name: this._canonicalNameFor(loc.id, loc.name),
      address: loc.address,
      city: loc.city,
      state: loc.state,
      latitude: loc.latitude,
      longitude: loc.longitude,
      elevatorCode: loc.elevatorCode,
      tradeUnitCode: loc.tradeUnitCode,
      groupName: loc.groupName,
      isScoularFacility: newValue
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.allMapLocations.update(locs => locs.map(l =>
          l.id === loc.id ? { ...l, isScoularFacility: newValue } : l
        ));
        this.toastService.success(newValue ? `${name} marked as Scoular facility` : `${name} unmarked as Scoular facility`);
      },
      error: () => this.toastService.error('Failed to update Scoular status')
    });
  }

  selectPanelItem(item: BidSheetPanelItem): void {
    if (item.type === 'entry') {
      this.selectItemFromTable(item);
    }
    // Pan map to the selected location, offset for the panel if open
    if (item.latitude != null && item.longitude != null) {
      this._flyToLocation(item.latitude, item.longitude);
    }
  }

  /** Called when a map pin is clicked — toggles it as the comparison reference. Does NOT change the
   *  trade-unit/group scope, so the location is compared against all others in the current view
   *  (All Producers or the selected group). */
  private _selectMapLocation(loc: BidSheetLocation): void {
    // Toggle selected location for highlighted pin / comparison reference
    const alreadySelected = this.selectedLocationId() === loc.id;
    this.selectedLocationId.set(alreadySelected ? null : loc.id);
    // Mutually exclusive with a catalog reference -- only one comparison anchor at a time.
    this.catalogReferenceKey.set(null);

    // In All locations the map is a catalog to browse, not a sheet to work. Two things follow.
    //
    // The published-bids popup opens on any pin, exactly as it does for a catalog dot -- there is no
    // other place for a location's bids to appear while browsing. With a sheet open it is only ever
    // re-pointed, never opened from here: the panel is what a click on your own sheet is for, and
    // opening the popup on every click was offered and turned down. Either way an open popup follows
    // the selection rather than sitting there naming the elevator you just navigated away from.
    const browsing = this.mapScope() === 'all';
    if (browsing || this.catalogDetailKey()) {
      const key = alreadySelected ? null : loc.barchartLocationKey;
      if (key) this.openCatalogDetail(key);
      else this.closeCatalogDetail(); // deselected, or a hand-made location with no vendor book
    }

    if (alreadySelected) {
      this._refreshMapMarkers();
      return;
    }

    this.panelSelectedLocationId.set(null);
    // And the panel stays shut. It is the SHEET's comparison list; in All locations it renders only
    // "pick a bid sheet", so opening it on a pin click covers half the map with a message about
    // something else, and there is no Edit Bids to go on to. _offsetCenter reads showPanel, so
    // leaving it closed also stops the map flying to an off-centre position to clear a panel that
    // is not there.
    if (!browsing) {
      this.showPanel.set(true); // before flying, so the offset calculation knows about it
    }
    if (loc.latitude && loc.longitude) {
      this._flyToLocation(loc.latitude, loc.longitude);
    }
    this.filterBids();
    this._refreshMapMarkers();
  }

  clearAllFilters(): void {
    this.appState.setSelectedGroupNames([]);
    this.appState.setTradeUnits([]);
    this.searchQuery.set('');
    this.selectedBasis.set('all');
    this.selectedCrop.set('');
    this.selectedLocationId.set(null);
    this.showPanel.set(false);
    this.panelSelectedLocationId.set(null);
    this._refreshMapMarkers();
    this._loadCatalogLocations();
  }

  togglePanel(): void { this.showPanel.set(!this.showPanel()); }

  /** Switches the base map between street (OpenStreetMap) and the realistic aerial view
   *  (Esri imagery + labels). Markers live in markerPane above the tiles, so they stay put.
   *  Shows a brief loading overlay and keeps the previous base layer underneath until the new
   *  tiles finish loading, so the map doesn't flash/pop tiles mid-switch. */
  toggleMapView(): void {
    if (!this._map || !this._streetLayer || !this._satelliteLayer || this.mapSwitching()) return;

    const toSatellite = this.mapView() === 'street';
    const newLayer = toSatellite ? this._satelliteLayer : this._streetLayer;
    const oldLayer = toSatellite ? this._streetLayer : this._satelliteLayer;
    // The tile layer whose 'load' tells us the new base has painted (street layer is itself a tile
    // layer; for satellite it's the imagery layer inside the group).
    const watch = (toSatellite ? this._satelliteImageryLayer : this._streetLayer) as any;

    this.mapSwitching.set(true);
    this.mapView.set(toSatellite ? 'satellite' : 'street');
    newLayer.addTo(this._map); // add on top; old stays underneath so there's no blank gap

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { this._map?.removeLayer(oldLayer); } catch { /* already gone */ }
      this.mapSwitching.set(false);
    };

    // Hide the overlay once the new tiles have loaded; fall back after 2.5s in case 'load' doesn't
    // fire (e.g. fully cached tiles) so the spinner can never get stuck.
    if (watch?.once) watch.once('load', finish);
    setTimeout(finish, 2500);
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // =========================================================================
  // Map
  // =========================================================================

  private _mapRetries = 0;
  private _resizeObserver: ResizeObserver | null = null;
  private _L: typeof Leaflet | null = null;

  private async _initializeMapWhenReady(): Promise<void> {
    if (this._isMapInitialized) return;

    // Dynamically import leaflet + markercluster (only once)
    if (!this._L) {
      try {
        const leaflet = await import('leaflet');
        await import('leaflet.markercluster');
        this._L = leaflet.default ?? leaflet;
      } catch {
        return;
      }
    }

    const mapElement = this.mapElRef()?.nativeElement;
    if (mapElement && mapElement.offsetHeight > 0) {
      this._initializeMap(mapElement);
    } else if (this._mapRetries < 30) {
      this._mapRetries++;
      setTimeout(() => this._initializeMapWhenReady(), 200);
    }
  }

  private _initializeMap(mapElement: HTMLElement): void {
    if (this._isMapInitialized || !this._L) return;
    const L = this._L;

    try {
      this._map = L.map(mapElement).setView([38.5, -98.0], 6);

      // Hovering a pin swaps its icon, which REPLACES the pin's DOM element. When the pointer lands
      // outside the new, larger element's box, that element never sees a mouseover -- so it never
      // fires the mouseout either, and the pin sticks expanded. The map's own mousemove is the one
      // signal that always keeps coming, so it collapses any expanded pin the pointer is not
      // actually over; map mouseout catches the pointer leaving for an overlay or off-map.
      this._map.on('mousemove', (e: any) => {
        const hovered = this._hoveredMarker;
        if (!hovered) return;
        const el = hovered.marker.getElement?.();
        const target = e.originalEvent?.target as Node | null;
        if (el && target && el.contains(target)) return; // genuinely still over the pin
        this._collapseHoveredMarker();
      });
      this._map.on('mouseout', () => this._collapseHoveredMarker());

      // Street view (default) — OpenStreetMap.
      this._streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      });

      // Satellite ("realistic") view — Esri World Imagery + transparent road/place label overlays
      // (hybrid), so reps can recognize a location and still read town/road names when zoomed in.
      // maxNativeZoom caps tile requests at the provider's real resolution; Leaflet up-scales beyond it.
      this._satelliteImageryLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics', maxZoom: 19, maxNativeZoom: 19
      });
      this._satelliteLayer = L.layerGroup([
        this._satelliteImageryLayer,
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19, maxNativeZoom: 19
        }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19, maxNativeZoom: 19
        })
      ]);

      // Default to street; toggleMapView() swaps to satellite.
      this._streetLayer.addTo(this._map);

      // Covers added locations only -- the catalog layer (below) is deliberately its own,
      // never-clustering layer, so these values are back to trade-unit scale: a curated set of
      // locations someone actually added, which can run into the low hundreds company-wide but isn't
      // the whole catalog. A little more forgiving than the original 12px/zoom-5, which the phase-3
      // audit flagged as too tight even for that smaller set.
      this._clusterGroup = (L as any).markerClusterGroup({
        maxClusterRadius: 30,
        disableClusteringAtZoom: 8,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true
      });
      this._map.addLayer(this._clusterGroup);

      // Catalog dots: plain layer group, no clustering. See the field comment on _catalogLayer for why.
      this._catalogLayer = L.layerGroup();
      this._map.addLayer(this._catalogLayer);

      this._isMapInitialized = true;

      // Watch for container resize and tell Leaflet to recalculate
      this._resizeObserver = new ResizeObserver(() => {
        if (this._map) this._map.invalidateSize();
      });
      this._resizeObserver.observe(mapElement);

      // Re-render markers when zoom changes (dot vs label at different zoom levels, debounced 200ms)
      this._map.on('zoomend', () => {
        if (this._zoomDebounceTimer) clearTimeout(this._zoomDebounceTimer);
        this._zoomDebounceTimer = setTimeout(() => this._refreshMapMarkers(), 200);
        if (this._catalogMoveTimer) clearTimeout(this._catalogMoveTimer);
        this._catalogMoveTimer = setTimeout(() => this._loadCatalogLocations(), 300);
      });

      // Left-click to place pin in add-location mode
      this._map.on('click', (e: any) => this._onMapClick(e));

      // While the picker is open, panning re-asks "what's near here?". Debounced, because a single
      // drag fires moveend repeatedly and each one would be a round trip. The catalog layer does the
      // same, always -- it is the map's base content, not something only the picker needs.
      this._map.on('moveend', () => {
        if (this.barchartMode()) {
          if (this._barchartMoveTimer) clearTimeout(this._barchartMoveTimer);
          this._barchartMoveTimer = setTimeout(() => this._publishBarchartSearchArea(), 400);
        }
        if (this._catalogMoveTimer) clearTimeout(this._catalogMoveTimer);
        this._catalogMoveTimer = setTimeout(() => this._loadCatalogLocations(), 300);
      });

      this._refreshMapMarkers();
      this._loadCatalogLocations();
    } catch { /* map init failed — will retry on next navigation */ }
  }

  private _refreshMapMarkers(): void {
    if (!this._map || !this._clusterGroup || !this._L) return;
    const L = this._L;
    this._clusterGroup.clearLayers();
    // Keep map clean during add-location mode, and while the BarChart picker owns the map
    if (this.addLocationMode() || this.barchartMode()) { this._catalogLayer?.clearLayers(); return; }

    const zoom = this._map.getZoom();
    const month = this.selectedMonth();

    const locKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const crop = this.selectedCrop();
    const basis = this.selectedBasis();

    // refName identifies which ADDED-location pin, if any, IS the reference itself (its own special
    // styling below) -- a catalog reference is never one of these pins, so this stays tied to
    // selectedLocationId alone. refBid is the VALUE every OTHER pin compares against, and resolves
    // whichever kind of reference is actually set (_referenceBid), so comparison still works when the
    // reference is a catalog listing.
    const refId = this.selectedLocationId();
    const year = this.selectedYear();
    const refBid = this._referenceBid(year, crop, month);

    const statusColors: Record<string, { bg: string; border: string }> = {
      reference: { bg: '#2563eb', border: '#1d4ed8' },
      beating:   { bg: '#b91c1c', border: '#7f1d1d' },
      matching:  { bg: '#ca8a04', border: '#854d0e' },
      none:      { bg: '#6b7280', border: '#4b5563' }
    };

    // Search query — only filter map pins, panel stays full
    const searchQ = this.searchQuery().toLowerCase();

    // One threshold, both layers, every scope -- so the sheet's pins and the catalog's never disagree
    // about whether this zoom is a dot zoom or a label zoom.
    const labelZoom = BidSheetComponent.LABEL_ZOOM;

    // Scoular pins switch presentation on ONE thing: whether a reference location is set.
    //   no reference  → whole pin green (fill), no ring
    //   reference set → status fill (blue/red/yellow) + green ring
    // Keyed on _hasReference(), NOT on crop: picking a crop alone doesn't produce a comparison, and
    // testing crop here is what previously made the ring appear with no reference selected.
    const comparingToRef = this._hasReference();
    const scoularIds = this.scoularLocationIds();

    // Group the in-scope locations by coordinates -- the open sheet's, or everything, per mapScope.
    const locsByPos = new Map<string, BidSheetLocation[]>();
    for (const loc of this.scopedLocations()) {
      if (!loc.latitude || !loc.longitude) continue;
      const key = locKey(loc.latitude, loc.longitude);
      const arr = locsByPos.get(key) || [];
      arr.push(loc);
      locsByPos.set(key, arr);
    }

    const panelOpenId = this.panelSelectedLocationId();
    const panelOpenName = this.panelSelectedName();

    // Build set of location names visible in the panel (respects crop/TU/search filters). The panel
    // now lists exactly the scoped locations -- the same set drawn below -- so it speaks for every pin
    // in either mode, and a Matching/Beating filter narrows map and panel together.
    const panelNames = new Set(this.filteredBidItems().map(i => i.name));

    // Pass 1: decide which coordinate groups actually render a marker (apply the skip filters once)
    // and capture the per-group flags the draw pass needs.
    const renderGroups: { locs: BidSheetLocation[]; names: string[]; isRef: boolean; isPanelOpen: boolean; }[] = [];
    for (const [, locs] of locsByPos) {
      // If searching, skip this pin group unless at least one location name matches
      if (searchQ && !locs.some(l => l.name.toLowerCase().includes(searchQ))) continue;
      const names = locs.map(l => l.name);
      const isRef = refId != null && locs.some(l => l.id === refId);
      const isPanelOpen = panelOpenId != null && locs.some(l => l.id === panelOpenId);
      if (this.showingAllLocations()) {
        // All scope: the panel is empty by design, so it can't be the filter model. Apply the Status
        // filter directly, by filterBids' own rule (keep the reference and the chosen status), and ONLY
        // to groups with a bid to be judged by. A group with no bid for this period is not failing the
        // filter -- it has nothing to say -- and draws as a dot, exactly like a catalog listing with no
        // matched price. Skipping it here was why some added pins simply vanished in All locations.
        if (basis !== 'all' && crop && !isRef) {
          const judged = locs.map(l => this._getLatestBid(l.id, year, crop, month)).filter(Boolean);
          if (judged.length > 0 && !judged.some(b => this._computeItemStatus(b, false, refBid) === basis)) continue;
        }
      } else {
        // Sheet scope: the panel IS the filter model -- show what its filters left, and only what has a
        // bid for the selected period. A sheet with a crop picked lists who is bidding it.
        if (!names.some(n => panelNames.has(n))) continue;
        if (crop && !locs.some(l => this._getLatestBid(l.id, year, crop, month))) continue;
      }
      renderGroups.push({ locs, names, isRef, isPanelOpen });
    }

    // Spread out groups whose pins would overlap on screen so none get hidden behind another. The
    // offset is measured in screen pixels at the current zoom, so as you zoom in and the true
    // positions separate, the spread shrinks and each pin glides back toward its real spot.
    const displayPos = this._spreadOverlappingPins(
      renderGroups.map(g => [g.locs[0].latitude!, g.locs[0].longitude!] as [number, number]),
      zoom
    );

    // Pass 2: draw each group at its (possibly offset) display position.
    renderGroups.forEach((g, gi) => {
      const { locs, names, isRef, isPanelOpen } = g;
      const [lat, lng] = displayPos[gi];
      const showBidValues = !!crop;

      // Panel-open location — render expanded with name + bid (uses status color if reference, otherwise gray)
      if (isPanelOpen) {
        const bidStr = crop ? this._getLatestBid(panelOpenId!, year, crop, month) : '';
        // This pin represents the open location specifically, not "any location at this coordinate".
        const panelIsScoular = this.scoularLocationIds().has(panelOpenId!);
        let pinBg = '#6b7280', pinBorder = '#4b5563';
        if (isRef) { pinBg = '#2563eb'; pinBorder = '#1d4ed8'; }
        else if (this._hasReference() && bidStr) {
          const status = this._computeItemStatus(bidStr, false, refBid);
          const c = statusColors[status] ?? statusColors['none'];
          pinBg = c.bg; pinBorder = c.border;
        } else if (panelIsScoular) { pinBg = BidSheetComponent.SCOULAR_BG; pinBorder = BidSheetComponent.SCOULAR_BORDER; }
        const expandedIcon = this._buildHoverIcon(panelOpenName, bidStr, pinBg, pinBorder, panelIsScoular);
        const marker = L.marker([lat, lng], { icon: expandedIcon, zIndexOffset: 1000 });
        marker.on('click', () => this._selectMapLocation(locs[0]));
        this._clusterGroup.addLayer(marker);
        return;
      }

      // A plain dot for this group. ONE builder, shared by both places that draw one -- the wide-zoom
      // tier just below, and the "nothing to label" fallback further down -- so the two can never
      // disagree about colour or size. Every mismatch between a sheet pin and a catalog pin so far has
      // been two rendering tiers drifting apart; this is the tier that keeps drifting.
      const drawDot = (): void => {
        // Dot stands for the whole coordinate group, so it counts as ours if ANY location here is.
        const dotIsScoular = locs.some(l => scoularIds.has(l.id));
        // Compute dot color from bid status (matches the pill colors used when zoomed in)
        let color: string, border: string;
        if (isRef) {
          color = statusColors['reference'].bg; border = statusColors['reference'].border;
        } else if (this._hasReference() && crop) {
          // Use beating/matching/none color based on this location's bid vs the reference
          const bidVal = this._getLatestBid(locs[0].id, year, crop, month);
          const status = bidVal ? this._computeItemStatus(bidVal, false, refBid) : 'none';
          color = statusColors[status].bg; border = statusColors[status].border;
        } else if (dotIsScoular) {
          color = BidSheetComponent.SCOULAR_BG; border = BidSheetComponent.SCOULAR_BORDER;
        } else {
          ({ bg: color, border } = this._neutralPinColors('dot'));
        }
        // Sized to match the catalog's dots in "All locations" for the same reason they're coloured to
        // match: a bigger, darker dot among thousands of small pale ones says "this one is special"
        // when the only thing different about it is that somebody added it. Scoped to a sheet it keeps
        // its own larger size -- there is nothing there for it to disagree with.
        const dotPx = this.showingAllLocations() ? BidSheetComponent.CATALOG_DOT_SIZE : 14;
        const dotBorderPx = this.showingAllLocations() ? 1.5 : 2;
        const dotIcon = L.divIcon({
          className: 'custom-marker' + this._movedPulseClass(locs.some(l => this._locationChangedWithin24h(l.id, year, crop, month))),
          html: `<div style="width:${dotPx}px;height:${dotPx}px;background:${color};border:${dotBorderPx}px solid ${border};border-radius:50%;box-shadow:${this._scoularRing(comparingToRef && dotIsScoular)}0 1px 3px rgba(0,0,0,0.3);cursor:pointer;"></div>`,
          iconSize: [dotPx, dotPx], iconAnchor: [dotPx / 2, dotPx / 2]
        });
        const m = L.marker([lat, lng], { icon: dotIcon });
        m.on('click', () => this._selectMapLocation(locs[0]));
        const hoverBid2 = crop ? this._getDisplayBid(locs[0].id, year, crop, month) : '';
        this._bindHoverExpand(m, dotIcon, locs[0].name, hoverBid2, color, border, scoularIds.has(locs[0].id));
        this._clusterGroup.addLayer(m);
      };

      // Below the bid-pin zoom threshold: colored dot — but when searching, always show name labels.
      // Lowered from 8 → 6 so the bid-value pins appear sooner (esp. in All Producers, which opens at
      // the wider US overview). Zoom 5 = national overview keeps dots; 6+ shows the bid pins. In "All
      // locations" this defers to the catalog's threshold so both layers change together.
      if (zoom < labelZoom && !searchQ) { drawDot(); return; }

      if (showBidValues) {
        // A crop is selected -- show bid values with status colors.
        const bidItems = locs
          .map(l => {
            const n = l.name;
            const isNameRef = l.id === refId;
            // bidVal drives presence and status comparison and must stay numeric; bidLabel is what
            // the pill prints, which in Both mode carries the basis alongside.
            const bidVal = this._getLatestBid(l.id, year, crop, month);
            // The board only joins the pill once there is room for it (BOARD_SYMBOL_ZOOM); hover and
            // the panel still name it at any zoom.
            const bidLabel = this._getDisplayBid(l.id, year, crop, month, zoom >= BidSheetComponent.BOARD_SYMBOL_ZOOM);
            const nameIsScoular = this.scoularLocationIds().has(l.id);
            if (isNameRef) {
              const { bg, border } = statusColors['reference'];
              return { name: n, label: bidLabel || '--', bg, border, isScoular: nameIsScoular };
            }
            if (!bidVal) return null;
            // No reference set means there is no comparison to colour by, so ours are simply green
            // rather than a gray "no status" pill wearing a ring.
            if (!comparingToRef && nameIsScoular) {
              return { name: n, label: bidLabel, bg: BidSheetComponent.SCOULAR_BG, border: BidSheetComponent.SCOULAR_BORDER, isScoular: true };
            }
            // No reference means there is no status to colour by, so this is the neutral pin -- which
            // in "All locations" has to be the catalog's own neutral, or the added pins are the only
            // grey ones on a map of blue (see _neutralPinColors).
            if (!comparingToRef) {
              const neutral = this._neutralPinColors();
              return { name: n, label: bidLabel, bg: neutral.bg, border: neutral.border, isScoular: nameIsScoular };
            }
            const status = this._computeItemStatus(bidVal, false, refBid);
            const { bg, border } = statusColors[status] ?? statusColors['none'];
            return { name: n, label: bidLabel, bg, border, isScoular: nameIsScoular };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        if (bidItems.length > 0) {
          const linesHtml = bidItems.map(({ label, bg, border, isScoular }) => {
            const isGrey = bg === '#d1d5db';
            const pillBg = isGrey ? '#6b7280' : bg;
            const pillBorder = isGrey ? '#4b5563' : border;
            return `<div style="background:${pillBg};border:2px solid ${pillBorder};border-radius:6px;padding:5px 6px;font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,0.45);white-space:nowrap;box-shadow:${this._scoularRing(comparingToRef && isScoular)}0 2px 4px rgba(0,0,0,0.3);line-height:1.2;cursor:pointer;">${this._esc(label)}</div>`;
          }).join('');
          const maxWidth = Math.max(58, ...bidItems.map(({ label }) => label.length * 7 + 16));
          const height = bidItems.length * 28 + 16;
          const primaryBg = bidItems[0].bg;
          const divIcon = L.divIcon({
            // One pulse for the whole coordinate group, like the Scoular ring: "something here moved".
            className: 'custom-marker' + this._movedPulseClass(locs.some(l => this._locationChangedWithin24h(l.id, year, crop, month))),
            html: `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;">
              ${linesHtml}
              <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${primaryBg};margin:-1px auto 0;"></div>
            </div>`,
            iconSize: [maxWidth, height],
            iconAnchor: [maxWidth / 2, height]
          });
          const marker = L.marker([lat, lng], { icon: divIcon });
          marker.on('click', () => this._selectMapLocation(locs[0]));
          const hoverBid3 = crop ? this._getDisplayBid(locs[0].id, year, crop, month) : '';
          this._bindHoverExpand(marker, divIcon, locs[0].name, hoverBid3, primaryBg, bidItems[0].border, scoularIds.has(locs[0].id));
          this._clusterGroup.addLayer(marker);
          return;
        }
      }

      // Nothing to label -- no crop selected, or none of these locations has a bid for this period.
      //
      // In "All locations" that is a DOT, exactly as it is for a catalog listing with no matched price.
      // A name card here was the "why does my sheet's location look hovered" report: the hover icon is
      // also a name card, so a pin wearing one permanently reads as stuck mid-hover, when the only
      // thing different about it is that somebody put it on a sheet. Name labels stay for sheet scope,
      // where every pin is one the user chose and the names are what they are there to read.
      if (this.showingAllLocations()) { drawDot(); return; }

      // Default: name labels — match the pill color story used elsewhere
      // Keyed to locs[0] specifically, not "any name here": this bg also drives the hover icon,
      // which shows locs[0]. Per-line fill for mixed groups is handled inside _buildStackedLabel.
      const labelIsScoular = scoularIds.has(locs[0].id);
      let bg: string, border: string;
      if (isRef) {
        bg = statusColors['reference'].bg; border = statusColors['reference'].border;
      } else if (this._hasReference() && crop) {
        // Use beating/matching/none color based on this location's bid vs the reference
        const bidVal = this._getLatestBid(locs[0].id, year, crop, month);
        const status = bidVal ? this._computeItemStatus(bidVal, false, refBid) : 'none';
        bg = statusColors[status].bg; border = statusColors[status].border;
      } else if (labelIsScoular) {
        bg = BidSheetComponent.SCOULAR_BG; border = BidSheetComponent.SCOULAR_BORDER;
      } else {
        ({ bg, border } = this._neutralPinColors());
      }
      // Must match _buildStackedLabel's own width maths, including its 150px cap -- the label clamps
      // and ellipsises at that width, so sizing the icon box by an uncapped estimate left a long
      // vendor name anchored ~110px off from the text actually drawn.
      const maxWidth = Math.min(150, Math.max(85, ...names.map(n => n.length * 7 + 22)));
      const nameIcon = L.divIcon({
        className: 'custom-marker' + this._movedPulseClass(locs.some(l => this._locationChangedWithin24h(l.id, year, crop, month))),
        html: this._buildStackedLabel(locs, bg, border, comparingToRef),
        iconSize: [maxWidth, names.length * 26 + 8],
        iconAnchor: [maxWidth / 2, names.length * 26 + 8]
      });
      const marker = L.marker([lat, lng], { icon: nameIcon });
      marker.on('click', () => this._selectMapLocation(locs[0]));
      const hoverBid4 = crop ? this._getDisplayBid(locs[0].id, year, crop, month) : '';
      this._bindHoverExpand(marker, nameIcon, locs[0].name, hoverBid4, bg, border, scoularIds.has(locs[0].id));
      this._clusterGroup.addLayer(marker);
    });

    this._renderCatalogMarkers();
  }

  /**
   * Draws the catalog layer: every BarChart listing in view that ISN'T already an added, company-wide
   * location (those rendered above, from allMapLocations -- drawing both would double a pin).
   *
   * Deliberately cheap and deliberately NOT run through _spreadOverlappingPins: a small dot has
   * nothing to lose by sitting under a neighbour the way a labeled card would, and the whole point of
   * this layer is that it can be a few thousand pins, where the spread pass's O(n^2) pairwise
   * comparison stops being free. Clicking one fetches its live bids -- see openCatalogDetail.
   */
  /** Visible size of a catalog dot, in px. The clickable/hoverable icon box is bigger than this (see
   *  _renderCatalogMarkers) -- the dot only needs to be big enough to see, not big enough to aim at. */
  private static readonly CATALOG_DOT_SIZE = 10;
  private static readonly CATALOG_DOT_SIZE_SELECTED = 16;
  /** The icon's hit-test box is Leaflet's whole iconSize, so a visible dot this small would otherwise
   *  need pixel-perfect aim. Padding the box (dot centered inside via the wrapper div) makes the
   *  target roughly what a normal marker's is, without changing what's actually drawn. */
  private static readonly CATALOG_HIT_PADDING = 14;

  /** Not-comparing-to-anything color for a catalog price pill -- distinct from the added-location
   *  pass's neutral gray so a catalog (not-yet-added) bid still reads as "not yours yet" even before
   *  any comparison is in play. */
  private static readonly CATALOG_PILL_BG = '#60a5fa';
  private static readonly CATALOG_PILL_BORDER = '#3b82f6';

  /** A catalog DOT is lighter than a catalog pill on purpose -- a pill is a number you are meant to
   *  read, a dot is just "something is here". Named because the added-location pass has to match them
   *  exactly in "All locations" scope; see _neutralPinColors. */
  private static readonly CATALOG_DOT_BG = '#93c5fd';
  private static readonly CATALOG_DOT_BORDER = '#60a5fa';

  /**
   * Zoom at which a pin turns from a plain dot into a labelled price -- for BOTH layers, deliberately.
   *
   * The bid value is the reason this screen exists, so it appears as early as it can be read: zoom 5 is
   * the national overview and stays dots, 6 is regional and shows the numbers. An earlier attempt held
   * catalog prices back to zoom 9 to fight crowding, which just meant no bids were visible at any zoom
   * a user actually browses at. Crowding is the BOARD's problem to solve (below), not the price's.
   */
  private static readonly LABEL_ZOOM = 6;

  /**
   * Zoom at which a label gains the futures contract -- "4.98" becomes "4.98 (ZCU26)".
   *
   * This is the one thing that genuinely needs holding back: the contract roughly doubles a pill's
   * width, and it is what tipped the map from busy into cramped once catalog pins started carrying it.
   * It was 10, which meant zooming in further than anyone wants just to read a symbol; 8 is one step
   * above the price threshold (6), so a regional view shows boards while the national overview stays
   * readable. Hover shows it at any zoom regardless.
   */
  private static readonly BOARD_SYMBOL_ZOOM = 8;

  private _renderCatalogMarkers(): void {
    if (!this._map || !this._catalogLayer || !this._L) return;
    this._catalogLayer.clearLayers();
    if (this.addLocationMode() || this.barchartMode()) return;
    // With a sheet open the map answers with that sheet and nothing else -- browsing the wider catalog
    // is what "All locations" is for.
    if (!this.showingAllLocations()) return;
    const L = this._L;
    const detailKey = this.catalogDetailKey();
    const refKey = this.catalogReferenceKey();
    const crop = this.selectedCrop();
    const month = this.selectedMonth();
    const hasReference = this._hasReference();
    const year = this.selectedYear();
    // Same reference value the added-location pass compares against, so a catalog pin recolors
    // consistently with everything else on the map when either kind of reference is set.
    const refBid = hasReference ? this._referenceBid(year, crop, month) : null;
    const basis = this.selectedBasis();

    // Skip only what the pin pass ACTUALLY drew, not everything that has ever been added. In sheet
    // scope an added location that isn't on the open sheet is drawn by neither pass otherwise, and
    // simply vanishes; as a catalog dot it stays findable, and clicking it offers to add it.
    const drawnIds = new Set(this.scopedLocations().map(l => l.id));

    const zoom = this._map.getZoom();
    const showLabels = zoom >= BidSheetComponent.LABEL_ZOOM;
    const showBoard = zoom >= BidSheetComponent.BOARD_SYMBOL_ZOOM;

    for (const loc of this.catalogLocations()) {
      if (loc.latitude == null || loc.longitude == null) continue;
      if (loc.placements.some(p => drawnIds.has(p.locationId))) continue; // drawn as a bid pin above

      // "Selected" covers both the open detail popup AND being the comparison reference -- closing
      // the popup shouldn't make the pin you're actively comparing against look unselected.
      const isRef = loc.locationKey === refKey;
      const selected = loc.locationKey === detailKey || isRef;
      const price = loc.matchedBidPrice;
      // Status filter, by the same rule the added-location pass uses: only a pin with a price can be
      // judged, the reference always stays, and a dot has nothing to say so it is left alone. Without
      // this the filter narrowed one layer and not the other, which read as pins randomly missing.
      if (basis !== 'all' && price != null && !isRef) {
        const status = hasReference ? this._computeItemStatus(price.toString(), false, refBid) : 'none';
        if (status !== basis) continue;
      }
      // Two separate gates, so the label grows in stages as you close in: nothing at a wide zoom, the
      // price once pills have room, the board once the price alone has room to spare.
      const label = showLabels ? this._catalogPriceLabel(loc, showBoard) : null;

      const { marker, icon } = label != null
        ? this._buildCatalogPriceMarker(loc, label, price, isRef, hasReference, refBid, selected)
        : this._buildCatalogDotMarker(loc, selected);

      marker.on('click', () => this._selectCatalogLocation(loc));
      // Hover is a deliberate act on one pin, so it always gets the full label -- the zoom gates are
      // about the map being legible at a glance, not about withholding the number.
      this._bindCatalogHover(marker, icon, loc, this._catalogPriceLabel(loc));
      this._catalogLayer.addLayer(marker);
    }
  }

  /**
   * The pill text for a catalog pin's matched price(s), or null when this listing has nothing for the
   * current period (falls back to a plain dot). Both mode combines cash and basis the same way
   * _getDisplayBid does for an added location ("4.98 / -30", or whichever side actually has a value) --
   * a location can have one instrument published without the other, since they're independent feeds.
   */
  private _catalogPriceLabel(loc: BarchartCatalogLocation, includeBoard = true): string | null {
    // matchedBidPrice carries whichever instrument the toggle asked for: the catalog search is run
    // with instrumentType 'bidBasis' in basis mode and 'bidCash' otherwise, so in basis mode this
    // field IS the basis. matchedBasisPrice is only populated in Both mode, by the second request.
    const primary = loc.matchedBidPrice;
    const basis = loc.matchedBasisPrice;
    const primaryIsBasis = this.priceMode() === 'basis';
    let value: string | null;
    if (this.priceMode() !== 'both') {
      value = primary != null
        ? (primaryIsBasis ? formatBasis(primary.toString()) : primary.toString())
        : null;
    } else if (primary != null && basis != null) {
      value = `${primary} / ${formatBasis(basis.toString())}`;
    } else {
      value = primary != null
        ? primary.toString()
        : (basis != null ? formatBasis(basis.toString()) : null);
    }
    if (value == null) return null;
    if (!includeBoard) return value;
    // Names the contract behind the number, exactly as _getDisplayBid does for an added location --
    // the two kinds of pin sit on the same map and have to be readable against each other.
    const board = loc.matchedBidBoard?.trim();
    return board ? `${value} (${board})` : value;
  }

  /** No crop selected, or this listing has nothing for the current period: a plain, small dot. */
  private _buildCatalogDotMarker(loc: BarchartCatalogLocation, selected: boolean): { marker: Leaflet.Marker; icon: Leaflet.DivIcon } {
    const L = this._L!;
    const dotSize = selected ? BidSheetComponent.CATALOG_DOT_SIZE_SELECTED : BidSheetComponent.CATALOG_DOT_SIZE;
    const box = dotSize + BidSheetComponent.CATALOG_HIT_PADDING;
    const dotColor = selected ? '#2563eb' : BidSheetComponent.CATALOG_DOT_BG;
    const dotBorder = selected ? '#1d4ed8' : BidSheetComponent.CATALOG_DOT_BORDER;
    const icon = L.divIcon({
      // A catalog listing's only timestamp is latestQuoteAsOf: the freshest quote across the WHOLE
      // SITE, not this crop and period. So a pulsing catalog pin means "this elevator published
      // something today" -- the most this endpoint can say. An added location's pulse is exact,
      // because there the cell carries its own time.
      className: 'custom-marker' + this._movedPulseClass(this._changedWithin24h(loc.latestQuoteAsOf)),
      html: `<div style="width:${box}px;height:${box}px;display:flex;align-items:center;justify-content:center;">
        <div style="width:${dotSize}px;height:${dotSize}px;background:${dotColor};border:1.5px solid ${dotBorder};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
      </div>`,
      iconSize: [box, box],
      iconAnchor: [box / 2, box / 2]
    });
    return { marker: L.marker([loc.latitude!, loc.longitude!], { icon }), icon };
  }

  /**
   * A crop/period filter is active and this listing publishes a price for it: a labeled pill, the
   * same visual language _refreshMapMarkers already uses for an added location's bid ("show the bid
   * value directly, hover to see the name") -- a plain dot only stands in for this until there is
   * an actual number to show.
   */
  private _buildCatalogPriceMarker(loc: BarchartCatalogLocation, label: string, cashPrice: number | undefined, isRef: boolean,
    hasReference: boolean, refBid: number | null, selected: boolean): { marker: Leaflet.Marker; icon: Leaflet.DivIcon } {
    const L = this._L!;
    let bg: string, border: string;
    if (isRef) {
      bg = '#2563eb'; border = '#1d4ed8';
    } else if (hasReference) {
      // Status keys off the cash value alone -- a combined "x / y" string has no numeric meaning to
      // compare against the reference, the same rule _getDisplayBid documents for added locations. A
      // basis-only listing (no cash for this period) has nothing to compare, so it reads as 'none'.
      const status = cashPrice != null ? this._computeItemStatus(cashPrice.toString(), false, refBid) : 'none';
      const colors: Record<string, [string, string]> = {
        beating: ['#b91c1c', '#7f1d1d'], matching: ['#ca8a04', '#854d0e'], none: ['#6b7280', '#4b5563'], reference: ['#2563eb', '#1d4ed8']
      };
      [bg, border] = colors[status] ?? colors['none'];
    } else {
      bg = BidSheetComponent.CATALOG_PILL_BG; border = BidSheetComponent.CATALOG_PILL_BORDER;
    }
    const width = Math.max(44, label.length * 8 + 16);
    const height = selected ? 34 : 28;
    const icon = L.divIcon({
      // Site-wide freshness, not this period's -- see the dot marker above for why.
      className: 'custom-marker' + this._movedPulseClass(this._changedWithin24h(loc.latestQuoteAsOf)),
      html: `<div style="position:relative;text-align:center;">
        <div style="background:${bg};border:2px solid ${border};border-radius:6px;padding:4px 6px;font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,0.45);white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);line-height:1.2;cursor:pointer;">${this._esc(label)}</div>
        <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${bg};margin:-1px auto 0;"></div>
      </div>`,
      iconSize: [width, height],
      iconAnchor: [width / 2, height]
    });
    return { marker: L.marker([loc.latitude!, loc.longitude!], { icon }), icon };
  }

  /**
   * Hover-expand for a catalog pin: name plus whatever the pin is already showing -- the matched
   * price label when it has one (the same text the pill prints), city/state otherwise. No fetch: the
   * batched search response already carries every visible pin's price for the current period (see
   * _loadCatalogLocations), so there is nothing left to look up just because the pointer arrived.
   */
  private _bindCatalogHover(marker: Leaflet.Marker, icon: Leaflet.DivIcon, loc: BarchartCatalogLocation, label: string | null): void {
    const name = barchartDisplayName(loc);
    const subtitle = [loc.city, loc.state].filter(Boolean).join(', ');
    this._bindHoverExpand(marker, icon, name, label ?? subtitle, '#2563eb', '#1d4ed8');
  }

  /**
   * Opens the detail popup for a catalog-only pin and fetches its live bids -- the read path already
   * existed for the picker's old confirm step; this is its only caller now. Uses the shared cache
   * first, so a pin already inspected via hover (or a prior click) doesn't fetch twice.
   */
  openCatalogDetail(locationKey: string): void {
    // Every open takes a ticket. Without one, clicking a second pin while the first is still in
    // flight left the slower response to win: it wrote its bids into a popup whose header already
    // named the other location, so the popup looked like it had refused to switch. A failed stale
    // request was worse -- its error handler closed the popup the user had just opened.
    const gen = ++this._catalogDetailGen;
    this.catalogDetailKey.set(locationKey);
    this._refreshMapMarkers(); // re-draw so the clicked pin highlights immediately

    const cached = this._catalogDetailCache.get(locationKey);
    if (cached) { this.catalogDetail.set(cached); this.catalogDetailLoading.set(false); return; }

    this.catalogDetail.set(null);
    this.catalogDetailLoading.set(true);
    this._fetchCatalogDetail(locationKey).subscribe({
      next: (detail) => {
        // The shared fetch has already cached it -- good even when superseded, so the next click on
        // that pin is instant. Only the DISPLAY is stale, and that is what the ticket guards.
        if (gen !== this._catalogDetailGen) return;
        this.catalogDetailLoading.set(false);
        this.catalogDetail.set(detail);
      },
      error: () => {
        if (gen !== this._catalogDetailGen) return;
        this.catalogDetailLoading.set(false);
        this.toastService.error('Failed to load this location');
        this.closeCatalogDetail();
      }
    });
  }

  closeCatalogDetail(): void {
    // Bumped so a request still in flight cannot repopulate a popup the user has closed.
    this._catalogDetailGen++;
    this.catalogDetailKey.set(null);
    this.catalogDetail.set(null);
    // Cleared too: the guard above makes the in-flight response a no-op, so nothing else would ever
    // turn the spinner off, and the next open of an already-cached location would flash it.
    this.catalogDetailLoading.set(false);
    this._refreshMapMarkers();
  }

  /**
   * Toggles a catalog listing as the map's comparison reference -- the same click behaviour an ADDED
   * location's pin already has (_selectMapLocation), extended to a listing nobody has added yet.
   * Mutually exclusive with selectedLocationId: only one reference at a time, whichever kind.
   * Public (not the click handler itself) because the detail popup's own button calls it too, for a
   * location whose popup is already open.
   */
  toggleCatalogReference(locationKey: string): void {
    if (this.catalogReferenceKey() === locationKey) {
      this.catalogReferenceKey.set(null);
    } else {
      this.selectedLocationId.set(null);
      this.catalogReferenceKey.set(locationKey);
      this._ensureCatalogDetailCached(locationKey, () => this._refreshMapMarkers());
    }
    this.filterBids();
    this._refreshMapMarkers();
  }

  /** Map-click handler for a catalog dot: sets/clears the reference AND opens its detail popup --
   *  inspecting a listing and anchoring the comparison to it are complementary on the same click,
   *  not competing actions. */
  private _selectCatalogLocation(loc: BarchartCatalogLocation): void {
    this.toggleCatalogReference(loc.locationKey);
    this.openCatalogDetail(loc.locationKey);
  }

  /** Fetches and caches a catalog listing's live bids if not already cached, then runs the callback
   *  either way (immediately when cached, once the fetch resolves otherwise). Errors leave the key
   *  uncached -- callers just see no bid data, same as a listing with nothing published. */
  private _ensureCatalogDetailCached(locationKey: string, then: () => void): void {
    if (this._catalogDetailCache.has(locationKey)) { then(); return; }
    this._fetchCatalogDetail(locationKey).subscribe({
      next: () => then(), // the shared fetch does the caching
      error: () => { /* stays uncached */ }
    });
  }

  /**
   * A catalog listing's bid for one crop/year/month, or '' if there's nothing for it.
   *
   * Checks the CURRENT search results first: catalogLocations() already carries matchedBidPrice for
   * exactly the period the map's filters are showing (see _loadCatalogLocations), so when the
   * requested period is that one, the answer is already in memory -- no fetch, no flash while a
   * reference comparison waits on one to resolve. Old/new navigation asks about OTHER periods the
   * current search never priced, which is what the detail cache (populated by hover or a click,
   * covering every period a listing publishes) exists for.
   */
  private _catalogBidFor(locationKey: string, year: number | null, crop: string, month: number): string {
    if (!year || !crop) return '';
    if (year === this.selectedYear() && month === this.selectedMonth() && crop === this.selectedCrop()) {
      const current = this.catalogLocations().find(l => l.locationKey === locationKey);
      if (current?.matchedBidPrice != null) return String(current.matchedBidPrice);
    }
    // isBasis has to match too: the detail cache holds cash AND basis as separate rows for the same
    // commodity/period, not one row with two prices, so leaving this off would let whichever one
    // happens to sort first win regardless of which the price mode toggle asked for.
    const wantBasis = this.priceMode() === 'basis';
    const bid = this._catalogDetailCache.get(locationKey)?.bids
      .find(b => b.commodityCode === crop && b.cropYear === year && b.month === month && b.isBasis === wantBasis);
    return bid?.price != null ? String(bid.price) : '';
  }

  /** True while ANY reference is set -- an added location or a catalog one. Drives the "am I
   *  comparing at all" branches (the ring styling, the status-vs-plain-gray choice) without either
   *  branch needing to know which kind of reference it is. */
  private _hasReference(): boolean {
    return this.selectedLocationId() != null || !!this.catalogReferenceKey();
  }

  /**
   * The reference's bid for one crop/year/month, whichever kind of reference is set. Added-location
   * references resolve through the normal bidLookup(); a catalog reference falls back to whatever's
   * cached from being hovered or clicked -- null (not compared) rather than blocking on a fetch, so
   * setting the reference doesn't freeze every other pin's color until a request round-trips.
   */
  private _referenceBid(year: number | null, crop: string, month: number): number | null {
    const refId = this.selectedLocationId();
    if (refId != null) return this._parseBid(this._getLatestBid(refId, year, crop, month));
    const catalogKey = this.catalogReferenceKey();
    if (catalogKey) return this._parseBid(this._catalogBidFor(catalogKey, year, crop, month));
    return null;
  }

  /**
   * Adds the catalog-only location from the detail popup to the active sheet: creates the company-wide
   * row (linked to the feed, so its bids publish immediately) and links it in one flow, mirroring
   * confirmAddLocation / onBarchartAddMany.
   */
  addCatalogDetailToSheet(): void {
    const detail = this.catalogDetail();
    if (!detail || this.catalogDetailAdding()) return;
    if (this.selectedSheets().length === 0) { this.toastService.error('Create or select a bid sheet first'); return; }
    // The detail is captured HERE, not re-read when the add finally runs: the sheet chooser can sit
    // open while the user clicks a different pin behind it, and "which sheet for THIS location" must
    // not quietly become an answer about a different one.
    this._withAddTarget(sheetId => this._addCatalogDetailTo(sheetId, detail));
  }

  private _addCatalogDetailTo(sheetId: number, detail: BarchartCatalogLocationDetail): void {
    this.catalogDetailAdding.set(true);
    const loc = detail.location;
    this.apiService.createBidSheetLocation({
      name: barchartSaveName(loc),
      barchartLocationKey: loc.locationKey,
      isScoularFacility: (loc.elevator ?? '').toLowerCase().includes('scoular'),
      bids: []
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.catalogDetailAdding.set(false);
        this.allMapLocations.update(locs => [saved, ...locs]);
        this.sheets.update(list => list.map(s => s.id === sheetId ? { ...s, locations: [saved, ...s.locations] } : s));
        this.toastService.success(`Added ${saved.name}`);
        this.closeCatalogDetail();
        this._applyBidFilterSources();
        this.filterBids();
        this._refreshMapMarkers();

        this.apiService.addBidSheetLocation(sheetId, saved.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (sheet) => this._applySheet(sheet),
          error: (err) => { if (isDevMode()) console.warn('Failed to link the new location to the sheet', err); }
        });
        this._loadAllMapLocations();
        this._loadCatalogLocations(); // drops it from the catalog layer now that it has a placement
      },
      error: (err) => {
        this.catalogDetailAdding.set(false);
        this.toastService.error(this._errorToast(err, 'Failed to add location'));
      }
    });
  }


  /**
   * Spreads pins whose on-screen positions would overlap so none get hidden behind another. Members
   * of an overlapping cluster are pushed out to a fixed pixel radius around the cluster centroid; the
   * spread is computed in screen pixels at the current zoom, so as you zoom in and the true positions
   * separate, the offset shrinks and each pin glides back to its real spot. Returns one [lat,lng] per
   * input point (aligned by index); points that don't overlap anything are returned unchanged.
   */
  /** Above this count the O(n^2) pairwise overlap check below stops being free. Locations added
   *  company-wide accumulate across every sheet ever created, not just the active one, so this can
   *  realistically be reached over time even though a single sheet stays small. Skipping the spread
   *  at that point means some pins may sit exactly on top of each other rather than fanning out --
   *  a visual compromise, not a functional one; clicking still works via the cluster. */
  private static readonly MAX_SPREAD_PINS = 400;

  private _spreadOverlappingPins(points: [number, number][], zoom: number): [number, number][] {
    const L = this._L, map = this._map;
    if (!L || !map || points.length < 2) return points;
    if (points.length > BidSheetComponent.MAX_SPREAD_PINS) return points;
    const SPREAD_PX = 24;             // radius each overlapping pin is pushed from the cluster centroid
    const OVERLAP_PX = SPREAD_PX * 2; // pins closer than this (screen px) are treated as overlapping
    const pts = points.map(([la, ln]) => map.project(L.latLng(la, ln), zoom));

    // Union-find: group pins that overlap (transitively) into clusters.
    const parent = points.map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        if (dx * dx + dy * dy < OVERLAP_PX * OVERLAP_PX) parent[find(i)] = find(j);
      }
    }
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < pts.length; i++) {
      const r = find(i);
      const arr = clusters.get(r) ?? [];
      arr.push(i);
      clusters.set(r, arr);
    }

    const out: [number, number][] = points.slice();
    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      let cx = 0, cy = 0;
      for (const i of members) { cx += pts[i].x; cy += pts[i].y; }
      cx /= members.length; cy /= members.length;
      members.forEach((i, idx) => {
        const vx = pts[i].x - cx, vy = pts[i].y - cy;
        const d = Math.sqrt(vx * vx + vy * vy);
        let nx: number, ny: number;
        if (d < 0.001) {
          // Coincident at this zoom — fan out evenly on a circle, ordered by index.
          const ang = (2 * Math.PI * idx) / members.length;
          nx = cx + SPREAD_PX * Math.cos(ang);
          ny = cy + SPREAD_PX * Math.sin(ang);
        } else if (d < SPREAD_PX) {
          // Push outward to the spread radius (continuous: at d === SPREAD_PX this is a no-op).
          const s = SPREAD_PX / d;
          nx = cx + vx * s; ny = cy + vy * s;
        } else {
          return; // already far enough apart — keep the true position
        }
        const ll = map.unproject(L.point(nx, ny), zoom);
        out[i] = [ll.lat, ll.lng];
      });
    }
    return out;
  }

  private _buildStackedLabel(locs: BidSheetLocation[], bg: string, border: string, statusDriven = false): string {
    // Both greys the map can hand us: the light sentinel, and the neutral itself (darkened alongside
    // _neutralPinColors -- these two MUST move together or this stops matching and the substitution
    // below silently never fires).
    const isGrey = bg === '#d1d5db' || bg === '#6b7280';
    const textColor = '#fff';
    const labelBg = isGrey ? '#6b7280' : bg;
    const labelBorder = isGrey ? '#4b5563' : border;
    const maxWidth = Math.min(150, Math.max(85, ...locs.map(l => l.name.length * 7 + 22)));
    // Both cues are per NAME, not per pin: a stacked label can hold several locations at one
    // coordinate and only some may be ours. Painting the whole stack from one flag would mark a
    // competitor as ours just for sharing a coordinate with a Scoular elevator.
    //   no reference → green FILL on our lines only
    //   reference set → status fill kept, green RING on our lines only (a green ring on a green
    //                   fill would be invisible, which is why these are exclusive)
    // Per LOCATION, not per name: two elevators can share a label, and painting by name marked a
    // competitor as ours for it.
    const scoular = this.scoularLocationIds();
    const linesHtml = locs.map(l => {
      const n = l.name;
      const mine = scoular.has(l.id);
      const lineBg = !statusDriven && mine ? BidSheetComponent.SCOULAR_BG : labelBg;
      const lineBorder = !statusDriven && mine ? BidSheetComponent.SCOULAR_BORDER : labelBorder;
      return `<div style="background:${lineBg};border:2px solid ${lineBorder};border-radius:5px;padding:4px 8px;font-size:11px;font-weight:700;color:${textColor};white-space:nowrap;line-height:1.2;overflow:hidden;text-overflow:ellipsis;max-width:${maxWidth}px;${this._scoularRingCss(statusDriven && mine)}">${this._esc(n)}</div>`;
    }).join('');
    return `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;">
      ${linesHtml}
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${labelBorder};margin:-1px auto 0;"></div>
    </div>`;
  }

  /**
   * Creates an expanded hover icon showing location name + bid value.
   *
   * Deliberately NOT which sheets the pin is on, though the grid row carries exactly that badge: on
   * the map it was a third line of small text on every hover, and the map is read at a glance for the
   * price. The grid is where you go to act on a row, and that is where the question is worth
   * answering. (User's call, 2026-09-16, after trying it.)
   */
  private _buildHoverIcon(name: string, bid: string, bg: string, border: string, isScoular = false): any {
    const L = this._L!;
    const nameHtml = `<div style="font-size:11px;font-weight:700;color:#fff;white-space:nowrap;line-height:1.2;">${this._esc(name)}</div>`;
    const bidLabel = bid || '--';
    const subHtml = bid
      ? `<div style="font-size:10px;font-weight:500;color:rgba(255,255,255,0.85);white-space:nowrap;line-height:1.2;margin-top:2px;">${this._esc(bidLabel)}</div>`
      : '';
    const textLen = Math.max(name.length, bidLabel.length + 3);
    const w = Math.max(100, textLen * 7 + 24);
    const h = bid ? 50 : 36;
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="position:relative;text-align:center;display:flex;flex-direction:column;align-items:center;">
        <div style="background:${bg};border:2px solid ${border};border-radius:8px;padding:5px 9px;box-shadow:${this._scoularRing(isScoular && bg !== BidSheetComponent.SCOULAR_BG)}0 3px 10px rgba(0,0,0,0.3);cursor:pointer;">${nameHtml}${subHtml}</div>
        <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${bg};margin:-1px auto 0;"></div>
      </div>`,
      iconSize: [w, h],
      iconAnchor: [w / 2, h]
    });
  }

  /** Binds hover expand behavior to a marker — swaps icon on mouseover/mouseout.
   *  Tracks the currently-hovered marker and force-resets it when another marker is hovered,
   *  which prevents stuck labels when markers sit close together and setIcon() eats the mouseout. */
  /** Collapses whichever pin is expanded, wherever the pointer went. */
  private _collapseHoveredMarker(): void {
    const hovered = this._hoveredMarker;
    if (!hovered) return;
    try {
      hovered.marker.setIcon(hovered.resetIcon);
      hovered.marker.setZIndexOffset(0);
    } catch { /* marker may have been removed */ }
    this._hoveredMarker = null;
  }

  private _bindHoverExpand(marker: any, originalIcon: any, name: string, bid: string, bg: string, border: string, isScoular = false): void {
    const hoverIcon = this._buildHoverIcon(name, bid, bg, border, isScoular);
    marker.on('mouseover', () => {
      // At most one pin is ever expanded; whatever was before this one collapses first.
      if (this._hoveredMarker?.marker !== marker) this._collapseHoveredMarker();
      marker.setIcon(hoverIcon);
      // Raise above neighbors so the expanded bid is never hidden behind an overlapping pin
      try { marker.setZIndexOffset(2000); } catch { /* ignore */ }
      this._hoveredMarker = { marker, resetIcon: originalIcon };
    });
    marker.on('mouseout', () => {
      marker.setIcon(originalIcon);
      try { marker.setZIndexOffset(0); } catch { /* ignore */ }
      if (this._hoveredMarker?.marker === marker) this._hoveredMarker = null;
    });
  }

  /**
   * Scoular facilities read as GREEN in both map modes — the expression just changes with what the
   * fill is already being used for:
   *
   *   no reference set  → green FILL (replaces the gray "no status" fill)
   *   reference set     → status FILL kept (blue/red/yellow), green RING added
   *
   * Splitting it this way is what lets our facilities stand out regionally without ever destroying
   * the bid comparison the map exists for. Keyed on the reference alone — selecting a crop is not a
   * comparison, and gating on crop is what once made the ring appear with no reference chosen.
   */
  private static readonly SCOULAR_BG = '#00875F';
  private static readonly SCOULAR_BORDER = '#006B4C';
  /** Ring green is the brighter brand green, not the darker SCOULAR_BG used for fills. The fill has
   *  white text on it so it needs the accessible darker shade; the ring carries no text, and the
   *  brighter green is far easier to pick out against a red or blue pill. */
  private static readonly SCOULAR_RING = '#00A36F';

  /** Green "ours" ring as a box-shadow prefix, for use when the fill is carrying bid status.
   *  Sits flush against the pin border (no white gap) and 4px thick, so it reads as a green band
   *  around the pin rather than a hairline. box-shadow (not border/outline) so it takes no layout
   *  space and Leaflet's icon anchors stay correct. */
  private _scoularRing(isScoular: boolean): string {
    return isScoular ? `0 0 0 4px ${BidSheetComponent.SCOULAR_RING},` : '';
  }

  /** Same ring as a complete `box-shadow:` declaration, for elements that carry no shadow of their
   *  own — appending to `box-shadow:none` would be invalid CSS and silently drop the ring. */
  private _scoularRingCss(isScoular: boolean): string {
    return isScoular ? `box-shadow:0 0 0 4px ${BidSheetComponent.SCOULAR_RING};` : '';
  }

  private _esc(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  private _destroyMap(): void {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._map) {
      this._map.remove();
      this._map = null;
      this._clusterGroup = null;
      this._catalogLayer = null;
      this._streetLayer = null;
      this._satelliteLayer = null;
      this._satelliteImageryLayer = null;
      this._isMapInitialized = false;
    }
  }

}
