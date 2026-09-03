import { ChangeDetectionStrategy, Component, DestroyRef, effect, HostListener, inject, signal, computed, viewChild, ElementRef, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, map, Subject, switchMap, catchError, of, retry, timer } from 'rxjs';
import { CdkDragDrop, CdkDrag, CdkDropList, CdkDragHandle, moveItemInArray } from '@angular/cdk/drag-drop';
import type * as Leaflet from 'leaflet';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { BidSheet, BidSheetEntry, BidSheetLayoutUpdate, BidSheetLocation, BidSheetLocationBid, BidSheetShare, Elevator, Commodity } from '@models';
import type { EntitlementPerson } from '@features/daily-digest/models/entitlements-catalog.model';
import { environment } from '@env/environment';
import { BarchartPickerComponent, BarchartBulkAddRequest, BarchartSearchArea } from '../../components/barchart-picker/barchart-picker.component';
import { BarchartCatalogLocation, BarchartCatalogLocationDetail } from '@models';
import { commodityHex } from '@shared/utils/commodity-color';
import { barchartDisplayName, barchartSaveName } from '../../utils/barchart-location-name';
import {
  buildPrintLayout, cellStyleMap, DEFAULT_PRINT_LAYOUT_STYLE, parsePrintLayoutStyle, PRINT_GEOMETRY, renderPrintDocument, tableColWidthPcts,
  PrintCropGroup, PrintColumn, PrintLayoutModel, PrintLayoutStyle, PrintLocation
} from '../../utils/print-layout';

interface EditBidsRow {
  name: string;
  /**
   * The location this row is. Sent with every saved bid so the server writes to the row the user is
   * actually looking at -- locations are company-wide now, so a name no longer identifies one.
   */
  locationId?: number;
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
  /** Source month of a fed Year value, per column. Empty unless the column is Year and the cell fed. */
  yearFrom: Record<string, string>;
  /** Column key -> the board this fed cell is quoted against; '' on manual cells. */
  boardChips: Record<string, string>;
  /** Column keys whose fed bid hasn't moved in a while — shown muted so it can't read as today's price. */
  agingCells: Set<string>;
  /** True when the whole location is linked to a BarChart listing. */
  isBarchartLinked: boolean;
}

/** One row in the Yearly print columns builder. The resolved crop year = editBidsYear() + offset
 *  (relative, so it rolls over). oldNew picks the header style: '' = just the year, 'old'/'new' = "Old/New Crop (YYYY)". */
interface PrintYearRow {
  id: string;
  enabled: boolean;
  offset: number;            // -2..+2 relative to the viewed year
  oldNew: '' | 'old' | 'new';
}

/** Status for a bid value vs the session reference. */
type BidStatus = 'reference' | 'beating' | 'matching' | 'none';

/** Row in the panel list view (`filteredBidItems`). */
interface BidSheetPanelItem {
  type: 'entry';
  name: string;
  isScoular: boolean;
  isRef: boolean;
  latitude: number | null;
  longitude: number | null;
  /** Numeric value, used for status comparison. */
  oldBid: string;
  newBid: string;
  /** What the panel prints -- the same value in cash or basis mode, the pair in Both. */
  oldBidLabel?: string;
  newBidLabel?: string;
  oldStatus?: BidStatus;
  newStatus?: BidStatus;
  status: BidStatus;
}

/** Width threshold (px) below which the filter bar wraps the search/clear group to a centered second row. */
const FILTER_BAR_WRAP_WIDTH = 1050;

@Component({
  selector: 'app-bid-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule, CdkDropList, CdkDrag, CdkDragHandle, BarchartPickerComponent],
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
  selectedMonth = signal<number>(0); // 0=yearly, 1-12=monthly

  // --- Data ---
  allMapLocations = signal<BidSheetLocation[]>([]); // every added location, company-wide (for map)

  // --- Sheets ---
  // A sheet is the named, shareable working set of locations a user actually compares -- what
  // replaced the trade unit as the thing deciding what the panel and grid show. The map stays
  // unscoped (allMapLocations, above); only the panel/grid narrow to the active sheet.
  readonly sheets = signal<BidSheet[]>([]);
  readonly sheetsLoaded = signal<boolean>(false);
  readonly activeSheetId = signal<number | null>(null);
  readonly activeSheet = computed<BidSheet | null>(() =>
    this.sheets().find(s => s.id === this.activeSheetId()) ?? null);

  /**
   * The panel/grid location set: the active sheet's locations, cross-referenced against
   * allMapLocations so an in-place edit (a bid save, a rename, the Scoular flag) shows immediately
   * instead of waiting for the sheet to reload. Falls back to the sheet's own copy for a location
   * allMapLocations hasn't caught up to yet (e.g. one just linked from another tab).
   */
  readonly bidLocations = computed<BidSheetLocation[]>(() => {
    const sheet = this.activeSheet();
    if (!sheet) return [];
    const live = new Map(this.allMapLocations().map(l => [l.id, l]));
    return sheet.locations.map(l => live.get(l.id) ?? l);
  });

  /** Ids on the active sheet, for the BarChart picker's "already here" checkbox state. */
  readonly activeSheetLocationIds = computed<ReadonlySet<number>>(() =>
    new Set(this.bidLocations().map(l => l.id)));

  readonly showSheetMenu = signal<boolean>(false);
  readonly showCreateSheet = signal<boolean>(false);
  readonly newSheetName = signal<string>('');
  readonly creatingSheet = signal<boolean>(false);
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

  /** People with access who aren't already staged and aren't the owner, matching the search. */
  readonly shareCandidates = computed<EntitlementPerson[]>(() => {
    const q = this.shareSearch().trim().toLowerCase();
    const already = new Set(this.pendingShares().map(s => s.userId.toLowerCase()));
    const owner = (this.activeSheet()?.ownerUserId ?? '').toLowerCase();
    return this.shareCatalog()
      .filter(p => !already.has(p.userId.toLowerCase()) && p.userId.toLowerCase() !== owner)
      .filter(p => !q || p.displayName.toLowerCase().includes(q) || p.userId.toLowerCase().includes(q))
      .slice(0, 8);
  });

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
  /** Set of location names that are marked as Scoular facilities — used for row highlighting in edit bids grid (which keys rows by name). */
  readonly scoularLocationNames = computed<Set<string>>(() => {
    const names = new Set<string>();
    for (const loc of this.allMapLocations()) {
      if (loc.isScoularFacility) names.add(loc.name);
    }
    for (const loc of this.bidLocations()) {
      if (loc.isScoularFacility) names.add(loc.name);
    }
    return names;
  });
  /** True if the currently-selected panel location is a Scoular facility. */
  readonly panelSelectedIsScoular = computed<boolean>(() => {
    const name = this.panelSelectedLocation();
    if (!name) return false;
    return this.allMapLocations().some(l => l.name === name && l.isScoularFacility);
  });
  /**
   * Flattened view of every location and its bids.
   *
   * bidLocations used to hold the selected desks' locations and allMapLocations everything, and this
   * chose between them. They are the same list now. The distinction survives because it is what a
   * SHEET will restore: bidLocations becomes the sheet's locations and the map keeps everything.
   */
  readonly bidEntries = computed<BidSheetEntry[]>(() => {
    const source = this.bidLocations();
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
        underlyingFuture: bid.underlyingFuture,
        createdBy: bid.createdBy,
        createdAt: bid.createdAt,
        modifiedBy: bid.modifiedBy,
        modifiedAt: bid.modifiedAt
      }))
    );
  });
  /** Pre-computed lookup: "name|commodityCode|cropYear|month" → latest BidSheetEntry (by modifiedAt then createdAt). O(1) lookups instead of repeated filter+sort. */
  private readonly bidLookup = computed(() => {
    const lookup = new Map<string, BidSheetEntry>();
    for (const e of this.bidEntries()) {
      const key = `${e.name}|${e.commodityCode}|${e.cropYear}|${e.month}`;
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
   * Every commodity the crop FILTER can narrow by -- not just the ones the active sheet happens to
   * have bids for (that's crops(), which is a different thing: the Edit Bids grid's column order,
   * saved per sheet). The catalog map shows locations nobody has priced yet, so the filter has to
   * offer commodities before any sheet does, not after.
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
   * Every year the YEAR filter offers: a sensible default span around today plus whatever years the
   * active sheet actually has bids for, so a real priced year is never missing just because it falls
   * outside the default window.
   */
  readonly filterableYears = computed<number[]>(() => {
    const now = new Date().getFullYear();
    const years = new Set<number>([now - 1, now, now + 1, now + 2]);
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
  canShiftYearsBack = computed(() => {
    if (this.selectedMonth() > 0) return true; // monthly mode always allows shift back
    const years = this.cropYears();
    return years.length >= 2 && (years.length - 2 + this.yearOffset()) > 0;
  });
  canShiftYearsForward = computed(() => {
    if (this.selectedMonth() > 0) return true; // monthly mode always allows shift forward
    return this.yearOffset() < 0;
  });

  // --- Old/New (month, year) pair for the panel comparison columns ---
  // Yearly mode: returns just years (month=0).
  // Monthly mode: returns the previous month vs selected month, rolling years over at January.
  newDisplay = computed(() => ({ month: this.selectedMonth(), year: this.selectedYear() }));
  oldDisplay = computed(() => {
    const month = this.selectedMonth();
    const year = this.selectedYear();
    if (month === 0) {
      // Yearly mode — old year column (one less than new)
      return { month: 0, year: this.oldYear() ?? year - 1 };
    }
    // Monthly mode — previous month, rolling year at January
    if (month === 1) return { month: 12, year: year - 1 };
    return { month: month - 1, year };
  });
  /** Returns "Mar 26" / "Apr 26" / "2025" / "2026" depending on month context. */
  /** Whether the BarChart picker and fed-bid display are turned on for this environment. */
  readonly barchartEnabled = environment.barchartBidsEnabled === true;


  /**
   * How long a fed bid can sit unchanged before the UI mutes it. This is presentation only — the feed
   * publishes live quotes at any age, because an elevator leaving a new-crop bid alone for weeks is
   * normal. Muting means an old price can never be mistaken for today's without hiding it.
   */
  private static readonly AGING_QUOTE_DAYS = 7;

  /** True when a fed bid hasn't been touched by the elevator in a while. */
  isAgingQuote(asOf: string | undefined): boolean {
    if (!asOf) return false;
    const when = new Date(asOf);
    if (isNaN(when.getTime())) return false;
    const days = (Date.now() - when.getTime()) / 86_400_000;
    return days > BidSheetComponent.AGING_QUOTE_DAYS;
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
    if (month === 0) return year.toString();
    const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[month]} ${year.toString().slice(-2)}`;
  }

  // --- Crop column order (per trade unit, persisted in BidSheetPreferences.CropOrder) ---
  private cropOrderByTu = signal<Map<string, string[]>>(new Map());

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
  selectedLocationName = signal<string>('');
  panelSelectedLocation = signal<string>('');
  showDeleteLocationConfirm = signal(false);
  deleteMode = signal(false);
  showDeleteCropConfirm = signal(false);
  pendingDeleteCrop = signal<string>('');
  editingLocationName = signal(false);
  editLocationNameValue = signal('');

  /** All crop/bid rows for the location selected in the panel */
  readonly panelLocationBids = computed(() => {
    const name = this.panelSelectedLocation();
    if (!name) return [];
    const oldD = this.oldDisplay();
    const newD = this.newDisplay();
    const entries = this.bidEntries().filter(e => e.name === name);
    let cropSet = [...new Set(entries.map(e => e.commodityCode).filter(Boolean))].sort();
    // Only show crops that have bids for the displayed old/new periods
    cropSet = cropSet.filter(crop =>
      this._getLatestBid(name, newD.year, crop!, newD.month) ||
      this._getLatestBid(name, oldD.year, crop!, oldD.month));

    // Reference comparison — color-code each crop row vs the session reference, whichever kind
    // (an added location via selectedLocationName, or a catalog listing via catalogReferenceKey).
    const refName = this.selectedLocationName();
    const isRef = !!refName && refName === name;

    return cropSet.map(crop => {
      const oldBid = this._getLatestBid(name, oldD.year, crop!, oldD.month);
      const newBid = this._getLatestBid(name, newD.year, crop!, newD.month);
      // Get reference bid for this crop (if any). If reference doesn't have this crop → leave white (status 'none').
      const oldRefBid = this._hasReference() && !isRef ? this._referenceBid(oldD.year, crop!, oldD.month) : null;
      const newRefBid = this._hasReference() && !isRef ? this._referenceBid(newD.year, crop!, newD.month) : null;
      const oldStatus = isRef ? 'reference' : this._computeItemStatus(oldBid, false, oldRefBid);
      const newStatus = isRef ? 'reference' : this._computeItemStatus(newBid, false, newRefBid);
      // Feed provenance for the displayed periods, so the panel can say where a number came from and
      // when the elevator last touched it. Taken from the newer period when both are fed.
      const newEntry = this._getLatestEntry(name, newD.year, crop!, newD.month);
      const oldEntry = this._getLatestEntry(name, oldD.year, crop!, oldD.month);
      const fedEntry = newEntry?.source === 'Barchart' ? newEntry : (oldEntry?.source === 'Barchart' ? oldEntry : null);
      return {
        crop: crop!, oldBid, newBid, oldStatus, newStatus,
        oldBidLabel: this._getDisplayBid(name, oldD.year, crop!, oldD.month),
        newBidLabel: this._getDisplayBid(name, newD.year, crop!, newD.month),
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
   * Crop years shown in the grid, in column order. Canonical -- mirrors editBidsMonths.
   *
   * Multi-year exists so old crop and new crop can be entered and compared without stepping the year
   * and losing your place. Every selected year is editable; the server has always taken CropYear per
   * bid, and the client already holds every year's bids, so this is a display and keying concern only.
   */
  readonly editBidsYears = signal<number[]>([new Date().getFullYear()]);

  /**
   * The primary year: the first selected. Kept as a computed so the many single-year readers that only
   * need "which year is this grid anchored to" (print offsets, the panel hand-off) keep working while
   * the cell-level paths key off each column's own year.
   */
  readonly editBidsYear = computed(() => this.editBidsYears()[0] ?? new Date().getFullYear());

  /** Staged year selection, applied on Done. */
  readonly pendingYears = signal<number[]>([]);
  readonly showYearDropdown = signal(false);

  /**
   * Ceiling on selected years. Columns are crops x months x years and Both mode renders two inputs per
   * cell, so six crops x four months x three years is already 144 inputs a row -- and _buildEditGrid
   * rebuilds all of them on a price-mode toggle, a crop change, a rename and a star click.
   */
  static readonly MAX_EDIT_BIDS_YEARS = 3;
  readonly maxEditBidsYears = BidSheetComponent.MAX_EDIT_BIDS_YEARS;

  /** "2026" for one year, "3 Years" for several -- never a comma list; the toolbar has no room. */
  readonly editBidsYearsLabel = computed(() => {
    const years = this.editBidsYears();
    return years.length === 1 ? String(years[0]) : `${years.length} Years`;
  });

  /**
   * Years offered by the picker: every year the trade unit has bids for, plus one beyond the latest.
   * Without that extra year there would be no way to enter the first bid of a new crop year here.
   */
  readonly editBidsYearChoices = computed(() => {
    const known = this.cropYears();
    const base = known.length > 0 ? [...known] : [this.selectedYear() || new Date().getFullYear()];
    const next = Math.max(...base) + 1;
    return [...new Set([...base, next])].sort((a, b) => a - b);
  });

  editBidsMonths = signal<number[]>([0]); // [0]=yearly, [4,5,6]=Apr+May+Jun

  /** Label shown on the month-selector button.
   *  Year-only → "Year". Months only → "N Months". Mixed → "N Months + Year". */
  readonly editBidsMonthsLabel = computed(() => {
    const months = this.editBidsMonths();
    const hasYearly = months.includes(0);
    const specificCount = months.filter(m => m !== 0).length;
    if (specificCount === 0) return 'Year';
    const base = `${specificCount} Month${specificCount === 1 ? '' : 's'}`;
    return hasYearly ? `${base} + Year` : base;
  });
  showMonthDropdown = signal(false);
  /** Crop code currently being dragged (for group highlight). Empty when not dragging. */
  draggingCrop = signal<string>('');
  /** Pending month selection (staged until user clicks Done). */
  pendingMonths = signal<number[]>([0]);
  /** Pending hidden crop selection (staged until user clicks Done). */
  pendingHiddenCrops = signal<Set<string>>(new Set());
  editBidsRows = signal<EditBidsRow[]>([]);
  /** Set of crop codes hidden by the user via the multi-select crop dropdown. Empty = all visible. */
  hiddenCrops = signal<Set<string>>(new Set());
  showCropDropdown = signal(false);
  /**
   * Commodities added in the open Crops dropdown but not yet committed with Done, so Cancel can take
   * them back out. Also tells a background reload which crops it must not drop: a just-added crop has
   * no bids on the server, so the server's own commodity list does not know about it yet.
   */
  pendingAddedCrops = signal<Set<string>>(new Set());
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

  readonly editBidsCrops = computed(() => {
    const hidden = this.hiddenCrops();
    let result = [...this.crops()].filter(c => !hidden.has(c));
    // Apply saved crop column order (unknown crops go to end)
    const savedOrder = this.cropOrderByTu().get(this.preferenceKey());
    if (savedOrder && savedOrder.length > 0) {
      const orderMap = new Map(savedOrder.map((code, idx) => [code, idx]));
      result.sort((a, b) => {
        const ai = orderMap.get(a) ?? Number.MAX_SAFE_INTEGER;
        const bi = orderMap.get(b) ?? Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
    }
    return result;
  });

  /** Month name abbreviations for column labels. */
  private static readonly MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * Grid columns: crop × month × year.
   *
   * Nested crop → month → year on purpose, so the SAME month from each selected year lands side by
   * side ("Sep 26 | Sep 27 | Dec 26 | Dec 27"). Year-over-year is the comparison originators are
   * making, and grouping by year instead would put Sep-26 and Sep-27 at opposite ends of a crop block.
   * Crop stays outermost so onCropColumnDrop can keep moving a whole crop as one block.
   */
  readonly editGridColumns = computed(() => {
    const months = this.editBidsMonths();
    const crops = this.editBidsCrops();
    const years = this.editBidsYears();
    const multiYear = years.length > 1;
    // editBidsMonths is the canonical month order (Yearly first by default, reorderable via the print
    // dialog's Months list); editBidsYears is the canonical year order.
    return crops.flatMap(crop =>
      months.flatMap(m =>
        years.map(year => ({
          key: this._colKey(crop, year, m),
          crop,
          month: m,
          year,
          // With one year the header carries it, as before. With several, the year band row above the
          // headers carries it instead -- repeating it per column would trip over itself in the width
          // a bid column has.
          label: multiYear
            ? (m === 0 ? crop : `${crop} ${BidSheetComponent.MONTH_NAMES[m]}`)
            : (m === 0 ? `${crop} ${year}` : `${crop} ${BidSheetComponent.MONTH_NAMES[m]} ${year}`),
          // Named once here; only deviating cells repeat a board. Year columns have no consensus --
          // their value is per-location by construction, so each cell names its own contract.
          board: m === 0 ? '' : this.boardConsensus(crop, year, m)
        }))
      )
    );
  });

  /**
   * Column index → the year band above it, for the extra header row. One entry per contiguous run of
   * the same year, so a run of N columns yields one cell spanning N.
   */
  readonly editGridYearBands = computed(() => {
    const columns = this.editGridColumns();
    if (this.editBidsYears().length < 2) return [];
    const bands: Array<{ year: number; span: number }> = [];
    for (const col of columns) {
      const last = bands[bands.length - 1];
      if (last && last.year === col.year) last.span++;
      else bands.push({ year: col.year, span: 1 });
    }
    return bands;
  });

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
  newLocationTu = signal<string>('');
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
  private _barchartPlacedKeys = new Set<string>();
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

  /** The catalog pin the user clicked -- drives the detail popup. Null closes it. */
  readonly catalogDetailKey = signal<string | null>(null);
  readonly catalogDetailLoading = signal<boolean>(false);
  readonly catalogDetail = signal<BarchartCatalogLocationDetail | null>(null);
  readonly catalogDetailAdding = signal<boolean>(false);

  /**
   * The catalog (not-yet-added) location currently set as the comparison reference, mutually
   * exclusive with selectedLocationName (an ADDED location's reference). Kept as its own signal
   * rather than overloading selectedLocationName: that one is a NAME matched against bidLocations()
   * everywhere it's read (panel rows, _findLocationByName, ...), and a catalog listing's key isn't a
   * name in that sense -- reusing it would make every one of those lookups silently miss.
   */
  readonly catalogReferenceKey = signal<string | null>(null);
  /** Detail responses already fetched, by location key -- lets the reference comparison resolve a
   *  catalog reference's bid for any period without a new fetch each time the filters change, and
   *  the click-to-detail popup reuse whatever a prior click already has. */
  private readonly _catalogDetailCache = new Map<string, BarchartCatalogLocationDetail>();

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
    const source = this.plantingCommodities().length > 0 ? this.plantingCommodities() : this.allCommodities();
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
   * Reads bidLocations(), the ACTIVE SHEET's locations -- not allMapLocations(), which is everything
   * company-wide. A crop dropdown built from every location would routinely offer a crop nobody on
   * this sheet has priced, and picking it would show an empty panel with no visible cause.
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
   * Preference order: the sheet the preference row named (if it still exists -- it may have been
   * deleted, or unshared, since); otherwise, if there is exactly one sheet, that one, since a picker
   * would be pure friction with nothing to pick between. With zero sheets or more than one and no
   * saved choice, activeSheetId stays null and the empty state asks the user to create or pick one.
   */
  private _loadSheets(preferredSheetId: number | null): void {
    this.apiService.getBidSheets().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => {
        this.sheets.set(list);
        this.sheetsLoaded.set(true);
        if (preferredSheetId != null && list.some(s => s.id === preferredSheetId)) {
          this.activeSheetId.set(preferredSheetId);
        } else if (list.length === 1) {
          this.activeSheetId.set(list[0].id);
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

  selectSheet(id: number): void {
    this.showSheetMenu.set(false);
    if (this.activeSheetId() === id) return;
    this.activeSheetId.set(id);
    this._applyBidFilterSources();
    this.filterBids();
    this._refreshMapMarkers();
    this._saveSelectedSheet(id);
  }

  toggleSheetMenu(): void {
    this.showSheetMenu.update(v => !v);
  }

  /** Records which sheet is open, so a reload reopens the same one. */
  private _saveSelectedSheet(id: number): void {
    const cropCode = this.selectedCrop() || null;
    const month = this.selectedMonth();
    const cropYear = this.selectedYear() || null;
    this.apiService.setBidSheetPreference({
      tradeUnitKey: BidSheetComponent.GLOBAL_PREF_KEY, cropCode, month, cropYear, selectedBidSheetId: id
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      error: (err) => { if (isDevMode()) console.warn('Failed to save the open bid sheet', err); }
    });
  }

  openCreateSheet(): void {
    this.newSheetName.set('');
    this.showCreateSheet.set(true);
    this.showSheetMenu.set(false);
  }

  cancelCreateSheet(): void {
    this.showCreateSheet.set(false);
  }

  confirmCreateSheet(): void {
    const name = this.newSheetName().trim();
    if (!name || this.creatingSheet()) return;
    this.creatingSheet.set(true);
    this.apiService.createBidSheet(name).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (sheet) => {
        this.creatingSheet.set(false);
        this._applySheet(sheet);
        this.activeSheetId.set(sheet.id);
        this.showCreateSheet.set(false);
        this.toastService.success(`Created "${sheet.name}"`);
        this._saveSelectedSheet(sheet.id);
        this._applyBidFilterSources();
        this.filterBids();
        this._refreshMapMarkers();
      },
      error: (err) => {
        this.creatingSheet.set(false);
        this.toastService.error(err?.status === 409
          ? `You already have a bid sheet called "${name}"`
          : 'Failed to create bid sheet');
      }
    });
  }

  openRenameSheet(): void {
    const sheet = this.activeSheet();
    if (!sheet) return;
    this.renameSheetName.set(sheet.name);
    this.showRenameSheet.set(true);
    this.showSheetMenu.set(false);
  }

  cancelRenameSheet(): void {
    this.showRenameSheet.set(false);
  }

  confirmRenameSheet(): void {
    const sheet = this.activeSheet();
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

  openDeleteSheetConfirm(): void {
    if (!this.activeSheet()) return;
    this.showDeleteSheetConfirm.set(true);
    this.showSheetMenu.set(false);
  }

  cancelDeleteSheet(): void {
    this.showDeleteSheetConfirm.set(false);
  }

  confirmDeleteSheet(): void {
    const sheet = this.activeSheet();
    if (!sheet || this.deletingSheet()) return;
    this.deletingSheet.set(true);
    this.apiService.deleteBidSheet(sheet.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deletingSheet.set(false);
        this.showDeleteSheetConfirm.set(false);
        this.sheets.update(list => list.filter(s => s.id !== sheet.id));
        this.activeSheetId.set(null);
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

  openShareSheet(): void {
    const sheet = this.activeSheet();
    if (!sheet) return;
    this.pendingShares.set([...sheet.shares]);
    this.shareSearch.set('');
    this.showShareSheet.set(true);
    this.showSheetMenu.set(false);
    if (!this.shareCatalogLoaded() && !this.shareCatalogLoading()) {
      this.shareCatalogLoading.set(true);
      this.apiService.getEntitlementsCatalog().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (catalog) => {
          this.shareCatalog.set(catalog.people ?? []);
          this.shareCatalogLoaded.set(true);
          this.shareCatalogLoading.set(false);
        },
        error: () => {
          this.shareCatalogLoading.set(false);
          this.toastService.error('Failed to load the people directory');
        }
      });
    }
  }

  cancelShareSheet(): void {
    this.showShareSheet.set(false);
  }

  addShareCandidate(person: EntitlementPerson): void {
    this.pendingShares.update(list => [...list, { userId: person.userId, name: person.displayName, sharedBy: '', sharedAt: '' }]);
    this.shareSearch.set('');
  }

  removeShareCandidate(userId: string): void {
    this.pendingShares.update(list => list.filter(s => s.userId !== userId));
  }

  confirmShareSheet(): void {
    const sheet = this.activeSheet();
    if (!sheet || this.savingShares()) return;
    this.savingShares.set(true);
    const members = this.pendingShares().map(s => ({ userId: s.userId, name: s.name }));
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
            this.selectedMonth.set(desiredMonth);
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

          // Apply hidden crops if available
          const hiddenCropsJson = pref?.hiddenCrops ?? null;
          if (hiddenCropsJson) {
            try { this.hiddenCrops.set(new Set(JSON.parse(hiddenCropsJson))); }
            catch { this.hiddenCrops.set(new Set()); }
          } else {
            this.hiddenCrops.set(new Set());
          }

          // Apply selected months if available
          const selectedMonthsJson = pref?.selectedMonths ?? null;
          if (selectedMonthsJson) {
            try { this.editBidsMonths.set(JSON.parse(selectedMonthsJson)); }
            catch { this.editBidsMonths.set([0]); }
          }

          // Apply the Edit Bids year selection. Sanitized rather than trusted, like the print layout is:
          // malformed persisted data must not leave the grid with zero columns or hundreds of them.
          const selectedYearsJson = pref?.selectedYears ?? null;
          if (selectedYearsJson) {
            try {
              const parsed: unknown = JSON.parse(selectedYearsJson);
              const years = Array.isArray(parsed)
                ? [...new Set(parsed.map(y => Math.trunc(Number(y))).filter(y => y >= 1900 && y <= 2999))]
                    .sort((a, b) => a - b)
                    .slice(0, BidSheetComponent.MAX_EDIT_BIDS_YEARS)
                : [];
              if (years.length > 0) this.editBidsYears.set(years);
            } catch { /* invalid JSON — keep whatever openEditBids seeded */ }
          }

          // Apply crop column order if available
          const cropOrderJson = pref?.cropOrder ?? null;
          if (cropOrderJson) {
            try {
              const savedOrder: string[] = JSON.parse(cropOrderJson);
              const orderMap = new Map(this.cropOrderByTu());
              orderMap.set(key, savedOrder);
              this.cropOrderByTu.set(orderMap);
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

          // Restore the cash/basis choice. Validated rather than trusted: an unrecognised value falls
          // back to cash rather than putting the sheet in a mode nothing renders.
          this.priceMode.set(pref?.priceMode === 'basis' ? 'basis' : 'cash');

          // Apply saved print/export layout if available. Sanitize on read so malformed/out-of-range
          // persisted data can't break the year pickers.
          const printLayoutJson = pref?.printLayout ?? null;
          if (printLayoutJson) {
            try {
              const l = JSON.parse(printLayoutJson);
              if (Array.isArray(l?.yearlyRows) && l.yearlyRows.length) {
                this.printYearlyRows.set(
                  l.yearlyRows.slice(0, BidSheetComponent.MAX_PRINT_YEARLY_ROWS).map((r: { enabled?: unknown; offset?: unknown; oldNew?: unknown }) => ({
                    id: this._newRowId(),
                    enabled: r?.enabled !== false,
                    offset: Math.max(-2, Math.min(2, Math.trunc(Number(r?.offset)) || 0)),
                    oldNew: (r?.oldNew === 'old' || r?.oldNew === 'new') ? r.oldNew : '' as const
                  }))
                );
              }
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
          this._loadSheets(pref?.selectedBidSheetId ?? null);
        },
        // A failed preference load must not block the screen from showing sheets at all.
        error: (err) => { if (isDevMode()) console.warn('Failed to load bid sheet preference', err); this._loadSheets(null); }
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
    const refName = this.selectedLocationName();
    const refLoc = refName ? locs.find(l => l.name === refName) : null;
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
    // Monthly mode: shift by one month (rolling year at January)
    if (this.selectedMonth() > 0) {
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
      return;
    }
    // Yearly mode: shift the year offset
    if (this.canShiftYearsBack()) {
      this.yearOffset.update(o => o - 1);
      const yr = this.newYear();
      if (yr) this.selectedYear.set(yr);
      this.onFilterChange();
      this._loadCatalogLocations();
    }
  }

  shiftYearsForward(): void {
    // Monthly mode: shift by one month forward (rolling year at December)
    if (this.selectedMonth() > 0) {
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
      return;
    }
    if (this.canShiftYearsForward()) {
      this.yearOffset.update(o => o + 1);
      const yr = this.newYear();
      if (yr) this.selectedYear.set(yr);
      this.onFilterChange();
      this._loadCatalogLocations();
    }
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
    // Everything is in scope now, so the panel filter prunes map pins in every case. It used to
    // only prune when a trade unit was selected, which quietly left every pin on the map in All
    // Producers while the panel list narrowed.
    const hasTu = true;
    // Comparison/status applies for a single TU AND for All Producers (view-only) — both derive
    // crop-year data, so the reference/beating/matching logic runs identically; only editing differs.
    // Was "a trade unit is selected, OR we are in All Producers with data" -- both branches are
    // now the only branch, so bid values, statuses and reference comparison always render.
    const hasIndividualTu = true;
    const basis = this.selectedBasis();

    let items: BidSheetPanelItem[] = [];

    // Show the bid comparison whenever we have crop-year data — for a single TU, or for
    // All Producers (where crops/years are derived from every location's bids). Only fall back
    // to the name-only list when there's no bid data to compare yet.
    const canCompare = hasTu || this.cropYears().length > 0;

    if (!canCompare) {
      // No data yet — show all locations by name, no bid values
      const seen = new Set<string>();
      for (const loc of this.allMapLocations()) {
        if (seen.has(loc.name)) continue;
        seen.add(loc.name);
        items.push({
          type: 'entry',
          name: loc.name,
          isScoular: !!loc.isScoularFacility,
          isRef: false,
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
          oldBid: '',
          newBid: '',
          status: 'none'
        });
      }
    } else {
      const crop = this.selectedCrop();
      const oldD = this.oldDisplay();
      const newD = this.newDisplay();

      // Compute reference bids per period for status comparison. _referenceBid resolves whichever
      // kind of reference is set -- an added location (via bidLookup) or a catalog one (via its
      // cached detail, once hovered or clicked) -- so every other row's color follows either kind
      // the same way.
      const refName = this.selectedLocationName();
      const selectedYr = this.selectedYear();
      const month = this.selectedMonth();
      let oldRefBid: number | null = null;
      let newRefBid: number | null = null;
      let selectedRefBid: number | null = null;
      if (hasIndividualTu && this._hasReference()) {
        oldRefBid = this._referenceBid(oldD.year, crop, oldD.month);
        newRefBid = this._referenceBid(newD.year, crop, newD.month);
        selectedRefBid = this._referenceBid(selectedYr, crop, month);
      }

      // Add location entries — filter by crop if one is selected
      const entries = crop
        ? this.bidEntries().filter(e => e.commodityCode === crop)
        : this.bidEntries();
      const uniqueNames = new Set(entries.map(e => e.name));

      // Ensure reference location always appears even if it has no bid for the selected crop
      if (hasIndividualTu && refName && !uniqueNames.has(refName)) {
        uniqueNames.add(refName);
      }

      // Built once, not once per name: a .find() over bidEntries()/allMapLocations() inside the loop
      // below is O(names x entries), which is fine at a few dozen locations and stops being fine once
      // the map is showing the whole BarChart catalog.
      const entryByName = new Map<string, BidSheetEntry>();
      for (const e of this.bidEntries()) if (!entryByName.has(e.name)) entryByName.set(e.name, e);
      const scoularNamesForItems = this.scoularLocationNames();

      for (const name of uniqueNames) {
        const oldBid = this._getLatestBid(name, oldD.year, crop, oldD.month);
        const newBid = this._getLatestBid(name, newD.year, crop, newD.month);
        const selectedBid = this._getLatestBid(name, selectedYr, crop, month);
        const entryWithCoords = entryByName.get(name);
        const isRef = hasIndividualTu && name === refName;

        items.push({
          type: 'entry',
          name,
          isScoular: scoularNamesForItems.has(name),
          isRef,
          latitude: entryWithCoords?.latitude ?? null,
          longitude: entryWithCoords?.longitude ?? null,
          oldBid,
          newBid,
          oldBidLabel: this._getDisplayBid(name, oldD.year, crop, oldD.month),
          newBidLabel: this._getDisplayBid(name, newD.year, crop, newD.month),
          oldStatus: isRef ? 'reference' : (hasIndividualTu ? this._computeItemStatus(oldBid, false, oldRefBid) : 'none'),
          newStatus: isRef ? 'reference' : (hasIndividualTu ? this._computeItemStatus(newBid, false, newRefBid) : 'none'),
          status: isRef ? 'reference' : (hasIndividualTu ? this._computeItemStatus(selectedBid, false, selectedRefBid) : 'none')
        });
      }

      // Include locations with no bids yet (only when no crop filter is active)
      if (!crop) {
        for (const loc of this.bidLocations()) {
          if (uniqueNames.has(loc.name)) continue;
          const isRef = hasIndividualTu && loc.name === refName;
          items.push({
            type: 'entry',
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

  private _getLatestBid(name: string, year: number | null, commodityCode: string, month: number): string {
    if (!year || !commodityCode) return '';
    return this.bidLookup().get(`${name}|${commodityCode}|${year}|${month}`)?.bid ?? '';
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
      if (e.source !== 'Barchart' || e.month === 0) continue;
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
    if (!year || month === 0) return '';
    return this._columnBoards().get(`${crop}|${year}|${month}`) ?? '';
  }

  /**
   * The board a fed month cell is quoted against, '' on manual cells. Every fed bid shows this --
   * the business wants the contract on the number itself, so a producer never has to look away from
   * a bid to know what it is priced off. Deviation from the column consensus additionally turns the
   * label, so a cell against a different board than its column still declares it.
   */
  cellBoardFor(name: string, year: number | null, crop: string, month: number): string {
    if (month === 0) return '';
    const entry = this._getLatestEntry(name, year, crop, month);
    if (entry?.source !== 'Barchart') return '';
    return entry.underlyingFuture?.trim() ?? '';
  }

  private _getLatestEntry(name: string, year: number | null, commodityCode: string, month: number): BidSheetEntry | null {
    if (!year || !commodityCode) return null;
    return this.bidLookup().get(`${name}|${commodityCode}|${year}|${month}`) ?? null;
  }

  /**
   * The bid text a map pin or hover label shows. Cash and basis print the one selected price; Both
   * prints them together, because a pin has no room for a second line and "4.98 / -30" reads the way
   * an originator says it.
   *
   * Status colouring deliberately does NOT use this -- it keys off the cash value alone, because a
   * combined string has no numeric meaning and would compare as NaN against the reference.
   */
  private _getDisplayBid(name: string, year: number | null, crop: string, month: number): string {
    const primary = this._getLatestBid(name, year, crop, month);
    const basis = (this._getLatestEntry(name, year, crop, month)?.basisBid ?? '').trim();
    const value = this.priceMode() === 'both'
      ? (primary && basis ? `${primary} / ${basis}` : (primary || basis))
      : primary;
    // Every fed value names the contract it is quoted against: a Year cell because its value is one
    // month standing in for a year, a month cell because the board is what makes two bids comparable
    // at all. Manual cells stay bare -- there is no contract behind them to name.
    //
    // Full symbol for now ("-80 (KEU26)"), by request: the trade-notation letter ("-80U") is the
    // denser candidate, and the Dev feedback round decides between them. The full form also never
    // hides a cross-exchange split -- KEU26 and ZWU26 share a letter but not a market.
    const contract = value
      ? (month === 0 ? this.yearContractFor(name, year, crop, month) : this.cellBoardFor(name, year, crop, month))
      : '';
    return contract ? `${value} (${contract})` : value;
  }

  /**
   * The futures contract a fed Year value is quoted against, e.g. "ZCZ26".
   *
   * The feed has no year-level bid, so the Year cell borrows the nearest delivery month still open.
   * Naming the source is the difference between a number an originator can trust and one they cannot:
   * a bare 4.305 in the Year column looks like an elevator's year price when it is really one month.
   *
   * It names the CONTRACT rather than the month because that is what makes two bids comparable. The
   * contract is not always the delivery month -- Kansas City wheat delivering in January trades
   * against the March board -- so two elevators quoting the same month can be quoting different
   * boards, which a month label made look like a like-for-like comparison when it was not.
   */
  yearContract(entry: BidSheetEntry | null): string {
    return entry?.underlyingFuture?.trim() ?? '';
  }

  /** The Year cell's contract for a given crop/period, or '' when it is not a fed Year cell. */
  yearContractFor(name: string, year: number | null, crop: string, month: number): string {
    if (month !== 0) return '';
    const entry = this._getLatestEntry(name, year, crop, month);
    return entry?.source === 'Barchart' ? this.yearContract(entry) : '';
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
   * Adds a commodity from the Crops dropdown's search. The dropdown stays open on purpose: the new
   * crop appears ticked in the list above the search box, more can be added in one visit, and Done
   * commits the lot -- the same rhythm as ticking crops on and off.
   *
   * Appended, never re-sorted: the column order is the user's, persisted by the drag handles, and
   * re-sorting alphabetically here silently threw it away. Staged in pendingAddedCrops so Cancel
   * actually cancels -- it used to commit the crop regardless of which button was pressed.
   */
  selectEditBidCommodity(item: { code: string; name: string }): void {
    this.usageTracking.postClickEvent('interaction', 'bidsheet', 'commodities-added', item.code);
    if (!this.crops().includes(item.code)) {
      this.crops.update(arr => [...arr, item.code]);
      this.pendingAddedCrops.update(set => new Set(set).add(item.code));
    }
    this.addCommodityQuery.set('');
  }

  /**
   * Single entry point for adding a location. Asks where it should come from first, because the two
   * sources behave differently once chosen: a BarChart location arrives with the vendor's bids
   * already on it and refreshed nightly, a manual one is yours to type. Deciding up front beats
   * discovering that afterwards.
   *
   * With the feed turned off there's nothing to choose, so this goes straight to the manual flow —
   * the behaviour every environment had before the picker existed.
   */
  startAddLocation(origin: 'editBids' | 'map'): void {
    // A location has to land somewhere. With no sheet open there is no destination for it, so ask
    // for one first rather than opening a picker whose Add button would have nothing to do.
    if (!this.activeSheet()) {
      if (this.sheets().length === 0) { this.openCreateSheet(); } else { this.showSheetMenu.set(true); }
      return;
    }
    this.addLocationOrigin.set(origin === 'editBids' ? 'editBids' : null);
    if (!this.barchartEnabled) { this._startManualAdd(); return; }
    this.showAddSourceChoice.set(true);
  }

  chooseManualAdd(): void {
    this.showAddSourceChoice.set(false);
    this._startManualAdd();
  }

  chooseBarchartAdd(): void {
    this.showAddSourceChoice.set(false);
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
    const sheetId = this.activeSheetId();
    if (sheetId == null) { this.toastService.error('Create or select a bid sheet first'); return; }
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
        // Pass saved.name only as the grid's focus target — do NOT set panelSelectedLocation, or
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
        // editBidsGridLoading on (see _loadBidData) and show a grid spinner that the success path
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
   * Fetches every catalog listing in the current view and re-renders the map.
   *
   * Skipped while the map is repurposed for add-location or the BarChart picker -- same guard
   * _refreshMapMarkers already uses, so the two stay in step. take is generous (up to 5,000, the
   * request DTO's ceiling) because this is "what's here", not a curated picker list: the whole point
   * is a wide zoom-out showing most of what BarChart publishes at once.
   *
   * The crop and search filters narrow this same request (server-side, via the commodity mapping and
   * name/city match the search endpoint already supports) -- geography still applies too, unlike the
   * BarChart picker's own search, which drops it once you type. The map's search box is "find this
   * pin on my screen", not "search the whole catalog"; that broader search already exists as its own
   * feature (the picker).
   */
  private _loadCatalogLocations(): void {
    if (this.addLocationMode() || this.barchartMode()) return;
    const area = this._currentViewArea();
    if (!area) return;
    const gen = ++this._catalogLoadGen;
    const crop = this.selectedCrop() || undefined;
    const month = this.selectedMonth();
    // The "Year" column (month 0) is a materialized cell the feed bridge resolves onto an ADDED
    // location's own board once ingested -- there is no calendar month to price a not-yet-added
    // listing against, so catalog pins fall back to a plain dot in Year view, same as with no crop
    // selected. Only a real 1-12 month names a single instrument this endpoint can price.
    //
    // instrumentType rides along with the period: cash and basis are separate BarChart instruments
    // with independent quotes, not one price under two labels, so which one to price is part of
    // "what period" just as much as the year and month are. 'both' resolves to cash, the same
    // convention bidEntries() already uses for anything on this screen that shows one number.
    const instrumentType: 'bidCash' | 'bidBasis' = this.priceMode() === 'basis' ? 'bidBasis' : 'bidCash';
    const period = crop && month > 0
      ? { cropYear: this.selectedYear(), month, instrumentType }
      : {};
    this.apiService.searchBarchartLocations({
      latitude: area.latitude, longitude: area.longitude, radiusMiles: area.radiusMiles, take: 5000,
      commodityCode: crop,
      search: this.searchQuery().trim() || undefined,
      ...period
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (rows) => {
        if (gen !== this._catalogLoadGen) return; // a newer pan/zoom/filter already superseded this request
        this.catalogLocations.set(rows);
        this._refreshMapMarkers();
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
    // Hollow means the elevator is already on the sheet. It used to mean "already on one of the desks
    // I am adding to", because the same listing was stored once per desk; there is one row per
    // elevator now, so any placement at all is THE placement.
    this._barchartPlacedKeys = new Set(rows
      .filter(r => r.placements.length > 0)
      .map(r => r.locationKey));

    for (const loc of rows) {
      if (loc.latitude == null || loc.longitude == null) continue;
      const placed = this._barchartPlacedKeys.has(loc.locationKey);
      const marker = L.marker([loc.latitude, loc.longitude],
          { icon: this._barchartPinIcon(placed, loc.locationKey === this.barchartSelectedKey(), this.barchartTickedKeys().has(loc.locationKey)) })
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
   * Candidate pin. Green = a location in the feed, hollow = already on someone's bid sheet, and BLUE =
   * the one whose details are open in the panel, so it's obvious which pin the name on screen refers to.
   * Blue matches the reference-location colour the rest of the map already uses for "this is the one".
   */
  private _barchartPinIcon(placed: boolean, focused: boolean, ticked = false): any {
    const L = this._L!;
    // Two independent states. Blue says ticked for adding; the larger size says this is the pin whose
    // detail is open. Keeping them on different channels means a pin can be both without ambiguity.
    const size = focused ? 26 : 20;
    const border = ticked ? '#1d4ed8' : '#00875F';
    const fill = placed ? 'transparent' : (ticked ? '#2563eb' : '#00A36F');
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:3px solid ${border};background:${fill};box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  /** Re-styles the candidate pins so exactly one reads as selected, without redrawing the layer. */
  private _highlightBarchartPin(selectedKey: string | null): void {
    const ticked = this.barchartTickedKeys();
    for (const [key, marker] of this._barchartMarkers) {
      const focused = key === selectedKey;
      marker.setIcon(this._barchartPinIcon(this._barchartPlacedKeys.has(key), focused, ticked.has(key)));
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
    this._barchartPlacedKeys.clear();
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
  onBarchartAddMany(request: BarchartBulkAddRequest): void {
    if (this.barchartAdding()) return;
    if (request.locations.length === 0) return;
    const sheetId = this.activeSheetId();
    // No destination means nothing can be linked anywhere. Said out loud rather than returning
    // silently, which left the button looking broken.
    if (sheetId == null) {
      this.toastService.error('Create or select a bid sheet first, then add these locations');
      return;
    }
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
      // runs behind it and the open grid trues itself up when it lands (see _loadBidData).
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
    const year = this.selectedYear();
    // Focus target for the grid: an explicit name (e.g. a just-added location) or, by default, the
    // panel's selected location. Passing it as an argument avoids forcing the panel into detail mode.
    const focusLocation = focusLocationName ?? this.panelSelectedLocation();
    // Sync with the panel only when the grid is on a single year. A multi-year selection is the user's
    // deliberate arrangement, and openEditBids runs on every re-entry -- including the add-location
    // round trip -- so re-seeding unconditionally would silently collapse their columns back to one.
    if (this.editBidsYears().length <= 1) this.editBidsYears.set([year]);
    if (this.editBidsMonths().length === 1 && this.editBidsMonths()[0] === 0 && this.selectedMonth() > 0) {
      // No persisted multi-month — initialize from the panel's single month
      this.editBidsMonths.set([this.selectedMonth()]);
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
    const addedNames = new Set<string>();

    // Add locations that have bid entries
    const allEntries = this.bidEntries();
    const uniqueNames = [...new Set(allEntries.map(e => e.name))];
    // Built once rather than re-scanned per name: a .find() inside this loop is O(names x entries).
    const repByName = new Map<string, BidSheetEntry>();
    for (const e of allEntries) if (!repByName.has(e.name)) repByName.set(e.name, e);
    for (const name of uniqueNames) {
      addedNames.add(name);
      const rep = repByName.get(name);
      const bids: Record<string, string> = {};
      const basisBids: Record<string, string> = {};
      const originalBasisBids: Record<string, string> = {};
      const yearFrom: Record<string, string> = {};
      const boardChips: Record<string, string> = {};
      const agingCells = new Set<string>();
      for (const col of columns) {
        const entry = lookup.get(`${name}|${col.crop}|${col.year}|${col.month}`);
        // Each price lives in its own field whatever the toggle says. The template picks which to
        // show; the save writes each to its own column. Reading a mode-selected value into bids is
        // how a basis would end up filed as a cash price.
        bids[col.key] = entry?.cashBid ?? '';
        basisBids[col.key] = entry?.basisBid ?? '';
        originalBasisBids[col.key] = basisBids[col.key];
        yearFrom[col.key] = col.month === 0 && entry?.source === 'Barchart' ? this.yearContract(entry) : '';
        boardChips[col.key] = this.cellBoardFor(name, col.year, col.crop, col.month);
        // Cell-level, not row-level: a feed-linked location can still carry manual bids for crops or
        // months the vendor doesn't publish, and those age independently.
        if (entry?.source === 'Barchart' && this.isAgingQuote(entry.quoteAsOf)) agingCells.add(col.key);
      }
      rows.push({ name, locationId: rep?.locationId, type: 'entry', elevatorCode: rep?.elevatorCode, tradeUnitCode: rep?.tradeUnitCode, latitude: rep?.latitude, longitude: rep?.longitude, bids, originalBids: { ...bids }, basisBids, originalBasisBids, yearFrom, boardChips, agingCells, isBarchartLinked: !!rep?.barchartLocationKey });
    }

    // Also include locations with no bids yet (e.g. just added from Edit Bids)
    for (const loc of this.bidLocations()) {
      if (addedNames.has(loc.name)) continue;
      addedNames.add(loc.name);
      const bids: Record<string, string> = {};
      for (const col of columns) { bids[col.key] = ''; }
      rows.push({ name: loc.name, locationId: loc.id, type: 'entry', elevatorCode: loc.elevatorCode, tradeUnitCode: loc.tradeUnitCode, latitude: loc.latitude, longitude: loc.longitude, bids, originalBids: { ...bids }, basisBids: {}, originalBasisBids: {}, yearFrom: {}, boardChips: {}, agingCells: new Set<string>(), isBarchartLinked: !!loc.barchartLocationKey });
    }

    // No re-sort here. Row order used to be a separate, per-user, name-keyed lookup applied on top --
    // bidLocations() is already in the active sheet's own order (its SortOrder, shared with everyone
    // on it), because rows above were built by iterating bidEntries(), which flattens bidLocations().
    this.editBidsRows.set(rows);
  }

  onRowDrop(event: CdkDragDrop<EditBidsRow[]>): void {
    if (event.previousIndex === event.currentIndex) return;

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

  /** Called when a crop column header is dragged to a new position in the edit grid.
   *  Moving one column moves ALL of that crop's columns as a group — every month and, when several
   *  years are selected, every year too. Crop is the outermost nesting, so a crop is always one
   *  contiguous run and reordering stays a crop-level operation whatever is selected beneath it. */
  onCropColumnDrop(event: CdkDragDrop<string[]>): void {
    if (event.previousIndex === event.currentIndex) return;

    const columns = this.editGridColumns();
    const draggedCrop = columns[event.previousIndex]?.crop;
    const targetCrop = columns[event.currentIndex]?.crop;
    if (!draggedCrop || !targetCrop || draggedCrop === targetCrop) return;

    // Reorder at the CROP level (not individual columns) so all months for a crop move together
    const visible = [...this.editBidsCrops()];
    const fromIdx = visible.indexOf(draggedCrop);
    const toIdx = visible.indexOf(targetCrop);
    if (fromIdx === -1 || toIdx === -1) return;
    moveItemInArray(visible, fromIdx, toIdx);

    // Rebuild the full crops list: visible crops in new order, then hidden crops at the end
    const hidden = this.crops().filter(c => this.hiddenCrops().has(c));
    this.crops.set([...visible, ...hidden]);

    // Persist the new order
    const key = this.preferenceKey();
    if (!key) return;
    const orderedCrops = this.crops();
    const orderMap = new Map(this.cropOrderByTu());
    orderMap.set(key, orderedCrops);
    this.cropOrderByTu.set(orderMap);

    // Save via preference (cropOrder only — don't overwrite crop/month/year)
    this.apiService.setBidSheetPreference({ ...this._panelPrefFields(key), cropOrder: JSON.stringify(orderedCrops) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.toastService.success('Crop order saved'),
        error: (err) => { if (isDevMode()) console.warn('Failed to save crop order', err); this.toastService.error('Failed to save crop order'); }
      });
  }

  /** Opens the crop dropdown with the current hidden set staged as pending. */
  openCropDropdown(): void {
    this.pendingHiddenCrops.set(new Set(this.hiddenCrops()));
    this.pendingAddedCrops.set(new Set());
    this.addCommodityQuery.set('');
    this.showCropDropdown.set(true);
  }

  /** Toggles a crop's visibility in the pending set (not yet applied). */
  toggleCropVisibility(crop: string): void {
    this.pendingHiddenCrops.update(set => {
      const updated = new Set(set);
      if (updated.has(crop)) updated.delete(crop);
      else updated.add(crop);
      return updated;
    });
  }

  /** Applies the pending crop visibility and closes the dropdown. */
  confirmCropSelection(): void {
    const changed = [...this.pendingHiddenCrops()].sort().join(',') !== [...this.hiddenCrops()].sort().join(',');
    const added = this.pendingAddedCrops().size > 0;
    // Save edits against the CURRENT columns before hiddenCrops changes (which reshapes editGridColumns).
    this._saveDirtyBids(() => {
      this.hiddenCrops.set(new Set(this.pendingHiddenCrops()));
      this.pendingAddedCrops.set(new Set());
      this.showCropDropdown.set(false);
      this._buildEditGrid();
      // A newly added crop has no bids yet, so nothing on the server remembers it. Persisting the
      // column order is what makes it survive the next load -- without this it vanished on reopen.
      if (added) this._saveCropOrder(this.crops());
      if (changed) {
        this._saveHiddenCrops();
        this.toastService.success('Crop selection saved');
      }
    });
  }

  /** Cancels pending crop changes and closes the dropdown — including any commodity just added. */
  cancelCropSelection(): void {
    this.pendingHiddenCrops.set(new Set(this.hiddenCrops()));
    const added = this.pendingAddedCrops();
    if (added.size > 0) {
      this.crops.update(arr => arr.filter(c => !added.has(c)));
      this.pendingAddedCrops.set(new Set());
      this._buildEditGrid();
    }
    this.addCommodityQuery.set('');
    this.showCropDropdown.set(false);
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

  /** Persists the Edit Bids year selection, so it survives a reload and the add-location round trip. */
  private _saveSelectedYears(years: number[]): void {
    const key = this.preferenceKey();
    if (!key) return;
    this.apiService.setBidSheetPreference({ ...this._panelPrefFields(key), selectedYears: JSON.stringify(years) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save selected years', err); } });
  }

  /** Persists hidden crops to the preference API. */
  private _saveHiddenCrops(): void {
    const key = this.preferenceKey();
    if (!key) return;
    const hidden = [...this.hiddenCrops()];
    this.apiService.setBidSheetPreference({ ...this._panelPrefFields(key), hiddenCrops: JSON.stringify(hidden) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save hidden crops', err); } });
  }

  /**
   * Applies a new year selection. Flushes unsaved edits FIRST: the column set is about to change
   * shape, and _buildDirtyBids diffs against the columns that exist at call time, so an un-blurred
   * edit in a year being removed would be diffed against a column that no longer exists and lost.
   * On save error the selection does not change and the edit survives.
   */
  private _applyYearSelection(years: number[]): void {
    this._saveDirtyBids(() => {
      this.editBidsYears.set(years);
      this.editBidsGridLoading.set(true);
      requestAnimationFrame(() => {
        this._buildEditGrid();
        this.editBidsGridLoading.set(false);
      });
    });
  }

  /** Opens the year dropdown with the current selection staged as pending. */
  openYearDropdown(): void {
    this.pendingYears.set([...this.editBidsYears()]);
    this.showYearDropdown.set(true);
  }

  /** Stages a year on or off. Refuses to leave nothing selected, and caps the count. */
  toggleEditYear(year: number): void {
    this.pendingYears.update(years => {
      if (years.includes(year)) {
        // A grid with no years has no columns at all, so the last one cannot be removed.
        return years.length === 1 ? years : years.filter(y => y !== year);
      }
      if (years.length >= BidSheetComponent.MAX_EDIT_BIDS_YEARS) return years;
      return [...years, year].sort((a, b) => a - b);
    });
  }

  /** True when ticking this year would exceed the cap, so the checkbox can disable rather than no-op. */
  yearAtLimit(year: number): boolean {
    const pending = this.pendingYears();
    return !pending.includes(year) && pending.length >= BidSheetComponent.MAX_EDIT_BIDS_YEARS;
  }

  /** Applies the staged years and closes. */
  confirmYearSelection(): void {
    const years = [...this.pendingYears()].sort((a, b) => a - b);
    const changed = years.join(',') !== this.editBidsYears().join(',');
    this.showYearDropdown.set(false);
    if (!changed) return;
    this._applyYearSelection(years);
    this._saveSelectedYears(years);
  }

  /** Discards the staged years and closes. */
  cancelYearSelection(): void {
    this.pendingYears.set([...this.editBidsYears()]);
    this.showYearDropdown.set(false);
  }

  /** Opens the month dropdown with the current selection staged as pending. */
  openMonthDropdown(): void {
    this.pendingMonths.set([...this.editBidsMonths()]);
    this.showMonthDropdown.set(true);
  }

  /** Toggles a month in the pending selection (not yet applied). Yearly (0) can be selected alongside specific months. */
  toggleEditMonth(month: number): void {
    this.pendingMonths.update(arr => {
      let updated = [...arr];
      if (updated.includes(month)) {
        updated = updated.filter(m => m !== month);
      } else {
        updated.push(month);
      }
      // If nothing selected, fall back to yearly
      return updated.length === 0 ? [0] : updated;
    });
  }

  /** Default month ordering: Yearly (0) first, then months in calendar order. Custom order comes from drag. */
  private _defaultMonthOrder(months: number[]): number[] {
    return [...new Set(months)].sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b));
  }

  /** Applies the pending month selection and closes the dropdown. */
  confirmMonthSelection(): void {
    const changed = JSON.stringify(this.pendingMonths()) !== JSON.stringify(this.editBidsMonths());
    // Save edits against the CURRENT columns before editBidsMonths changes (which reshapes editGridColumns).
    this._saveDirtyBids(() => {
      // Selecting months (re)applies the default order (Yearly first); drag in the print dialog customizes it.
      this.editBidsMonths.set(this._defaultMonthOrder(this.pendingMonths()));
      this.showMonthDropdown.set(false);
      this._buildEditGrid();
      if (changed) {
        this._saveSelectedMonths();
        this.toastService.success('Month selection saved');
      }
    });
  }

  /** Reorders the period columns (grid + print) when a month is dragged in the print dialog's Months list.
   *  editBidsMonths is the canonical order; editGridColumns/printCropGroups react to it (bids are keyed by
   *  crop#month, so no grid rebuild is needed — and we avoid discarding any in-grid state). */
  onPrintMonthDrop(event: CdkDragDrop<number[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.editBidsMonths.update(months => {
      const updated = [...months];
      moveItemInArray(updated, event.previousIndex, event.currentIndex);
      return updated;
    });
    this._saveSelectedMonths();
  }

  /** Reorders the crop tables (grid + print) when a crop is dragged in the print dialog's Crops list.
   *  editBidsCrops follows the saved crop order, so updating it flows to both the grid and the print. */
  onPrintCropDrop(event: CdkDragDrop<string[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const visible = [...this.editBidsCrops()];
    moveItemInArray(visible, event.previousIndex, event.currentIndex);
    const hidden = this.crops().filter(c => this.hiddenCrops().has(c));
    const orderedCrops = [...visible, ...hidden]; // keep hidden crops parked at the end
    this.crops.set(orderedCrops);
    this._saveCropOrder(orderedCrops);
  }

  /** Persists the crop column order for the active TU (mirrors the grid's column-drag persistence). */
  private _saveCropOrder(orderedCrops: string[]): void {
    const key = this.preferenceKey();
    if (!key) return;
    const orderMap = new Map(this.cropOrderByTu());
    orderMap.set(key, orderedCrops);
    this.cropOrderByTu.set(orderMap);
    this.apiService.setBidSheetPreference({ ...this._panelPrefFields(key), cropOrder: JSON.stringify(orderedCrops) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save crop order', err); } });
  }

  /** Cancels the pending month selection and closes the dropdown. */
  cancelMonthSelection(): void {
    this.pendingMonths.set([...this.editBidsMonths()]);
    this.showMonthDropdown.set(false);
  }

  private _saveSelectedMonths(): void {
    const key = this.preferenceKey();
    if (!key) return;
    this.apiService.setBidSheetPreference({ ...this._panelPrefFields(key), selectedMonths: JSON.stringify(this.editBidsMonths()) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save selected months', err); } });
  }

  /** Pushes editBidsYear/editBidsMonths back to the panel/map state (selectedYear, selectedMonth, yearOffset) and saves preference. */
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

  private _buildDirtyBids(): Array<{ locationId?: number; name?: string; elevatorCode?: string; tradeUnitCode?: string; groupName?: string; latitude?: number; longitude?: number; commodityCode: string; commodityName?: string; commodityCategory?: string; cropYear: number; bid: string; basisBid: string; month?: number }> {
    const commodityLookup = new Map(this.allCommodities().map(c => [c.code, c]));
    const toCreate: Array<{ locationId?: number; name?: string; elevatorCode?: string; tradeUnitCode?: string; groupName?: string; latitude?: number; longitude?: number; commodityCode: string; commodityName?: string; commodityCategory?: string; cropYear: number; bid: string; basisBid: string; month?: number }> = [];

    for (const row of this.editBidsRows()) {
      for (const col of this.editGridColumns()) {
        // Fed cells are included now: overriding one is allowed, and the save is what makes the
        // override real. Unchanged fed cells fall out below on the value comparison, so a plain
        // re-save does not rewrite every fed row as manual.
        const current = (row.bids[col.key] ?? '').trim();
        const original = (row.originalBids[col.key] ?? '').trim();
        const currentBasis = (row.basisBids[col.key] ?? '').trim();
        const originalBasis = (row.originalBasisBids[col.key] ?? '').trim();
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
  private _clearDirtyForSaved(dirty: Array<{ name?: string; commodityCode: string; cropYear: number; month?: number; bid: string; basisBid: string }>): void {
    const savedByName = new Map<string, Map<string, { bid: string; basisBid: string }>>();
    for (const b of dirty) {
      if (!b.name) continue;
      // The year is part of the identity. Without it, saving 2026 corn would mark the 2027 corn cell
      // clean too: its highlight would clear, its board symbol and aging mute would be deleted, and
      // _buildDirtyBids would stop reporting it -- which also re-arms the background refresh that is
      // gated on a clean grid, so the rebuild would land on top of the still-unsaved edit.
      const colKey = this._colKey(b.commodityCode, b.cropYear, b.month ?? 0);
      const m = savedByName.get(b.name) ?? new Map<string, { bid: string; basisBid: string }>();
      m.set(colKey, { bid: b.bid, basisBid: b.basisBid });
      savedByName.set(b.name, m);
    }
    this.editBidsRows.update(rows => rows.map(row => {
      const saved = savedByName.get(row.name);
      if (!saved) return row;
      const originalBids = { ...row.originalBids };
      const originalBasisBids = { ...row.originalBasisBids };
      // BOTH sides, or a basis-only edit never goes clean: its green highlight would never clear, every
      // later blur would re-send it, and _buildDirtyBids would never report zero again -- which silently
      // switches off the background refresh that runs when the grid is open.
      // Everything that described the FEED's number has to go, because the cell is the user's now and
      // the row counts as clean again the moment originalBids is updated below. Three separate stores:
      //   boardChips  - the month-column board symbol
      //   yearFrom    - the SAME thing for a Year column, which cellBoardFor never fills (Yearly is the
      //                 default view, so missing this left the headline case broken)
      //   agingCells  - the "hasn't moved in a while" mute, which would otherwise fade the value the
      //                 user just typed, usually typed BECAUSE the fed one was stale
      // Per cell, not per side: the upsert writes both prices and the server flips the whole row to
      // Manual, so a basis-only edit takes the cash side with it.
      const boardChips = { ...row.boardChips };
      const yearFrom = { ...row.yearFrom };
      const agingCells = new Set(row.agingCells);
      for (const [colKey, val] of saved) {
        originalBids[colKey] = val.bid;
        originalBasisBids[colKey] = val.basisBid;
        delete boardChips[colKey];
        delete yearFrom[colKey];
        agingCells.delete(colKey);
      }
      return { ...row, originalBids, originalBasisBids, boardChips, yearFrom, agingCells };
    }));
  }

  /** Optimistically writes saved bids into the local location cache (bidLocations / allMapLocations),
   *  which feed the computed bidEntries → bidLookup that _buildEditGrid reads. Without this, navigating
   *  to another year and back rebuilds the grid from the stale cache and shows the pre-edit value until
   *  a full server refresh. Mirrors the optimistic update confirmAddLocation does for a new location. */
  private _applyBidsToLocalCache(dirty: Array<{ name?: string; tradeUnitCode?: string; commodityCode: string; commodityName?: string; commodityCategory?: string; cropYear: number; bid: string; basisBid: string; month?: number }>): void {
    if (dirty.length === 0) return;
    const now = new Date().toISOString();

    // Grouped once rather than re-filtered per location: this used to scan the whole dirty array for
    // EVERY location in allMapLocations(), which is fine at a few dozen locations and is real work
    // once that list is the whole BarChart catalog.
    const dirtyByName = new Map<string, typeof dirty>();
    for (const d of dirty) {
      const arr = dirtyByName.get(d.name ?? '');
      if (arr) arr.push(d); else dirtyByName.set(d.name ?? '', [d]);
    }

    const upsertInto = (locs: BidSheetLocation[]): BidSheetLocation[] => {
      let changed = false;
      const next = locs.map(loc => {
        const candidates = dirtyByName.get(loc.name);
        const forLoc = candidates?.filter(d => !d.tradeUnitCode || d.tradeUnitCode === loc.tradeUnitCode) ?? [];
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
  private _recordSaved(dirty: Array<{ name?: string; commodityCode: string; cropYear: number; month?: number }>): void {
    for (const b of dirty) {
      if (!b.name) continue;
      this._editBidsSavedKeys.add(`${b.name}|${b.commodityCode}|${b.cropYear}|${b.month ?? 0}`);
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
  printSelectedCrops = signal<Set<string>>(new Set());
  printSelectedMonths = signal<Set<number>>(new Set());
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
    const scoularNames = this.scoularLocationNames();
    return this.editBidsRows().map(row => ({
      name: row.name,
      isScoular: highlight && scoularNames.has(row.name),
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
  // Yearly export columns: a builder of rows the user adds (each = enable toggle + year + Old/New choice).
  // Year is an offset from the viewed year (rolls over). Header reads "Old Crop (2025)" / "New Crop (2025)"
  // or just "2025" when neither is picked. Persisted per trade unit.
  printYearlyRows = signal<PrintYearRow[]>([
    { id: 'yr-old', enabled: true, offset: -1, oldNew: 'old' },
    { id: 'yr-new', enabled: true, offset: 0, oldNew: 'new' }
  ]);
  static readonly MAX_PRINT_YEARLY_ROWS = 5;
  // Monthly columns have no separate config: each month picked in the Months list prints as "May (2026)"
  // for the viewed year. Year offsets are only used by the Yearly columns' year dropdown.
  static readonly PRINT_YEAR_OFFSETS: number[] = [-2, -1, 0, 1, 2];

  /** Stable id for a year row. Uses crypto.randomUUID where available (secure context), else a counter. */
  private _printRowSeq = 0;
  private _newRowId(): string {
    try { return crypto.randomUUID(); } catch { return `yr-${Date.now()}-${this._printRowSeq++}`; }
  }

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
   * Columns grouped by crop for the print preview — each group is one table section.
   * The Yearly view uses printYearlyRows (per-row year + Old/New → "Old Crop (2025)" / "2025"); each
   * specific month picked in the Months list renders one column for the viewed year, headed "May (2026)".
   * cropYear on each column resolves the right bid in printCellValue.
   */
  readonly printCropGroups = computed(() => {
    const selectedCrops = this.printSelectedCrops();
    const selectedMonths = this.printSelectedMonths();
    const viewedYear = this.editBidsYear();
    const yearlyRows = this.printYearlyRows().filter(r => r.enabled);
    // Preserve crop + month order from the grid (editBidsMonths is the canonical, user-orderable order).
    const crops = this.editBidsCrops().filter(c => selectedCrops.has(c));
    const months = this.editBidsMonths().filter(m => selectedMonths.has(m));

    return crops.map<PrintCropGroup>(crop => {
      const columns: PrintColumn[] = [];
      for (const m of months) {
        if (m === 0) {
          // Yearly: one column per enabled row. Header = "Old Crop (2025)" / "New Crop (2025)" / "2025".
          for (const row of yearlyRows) {
            const resolved = viewedYear + row.offset;
            const label = row.oldNew === 'old' ? `Old Crop (${resolved})`
              : row.oldNew === 'new' ? `New Crop (${resolved})`
              : String(resolved);
            // compactLabel is for the side-by-side layout, where a column is only a few percent of
            // the page and "Old Crop (2026)" overflows into its neighbour. It ABBREVIATES the same
            // column the user configured — it never renames it — so old crop still reads as old
            // crop, not as some other word.
            const yy = String(resolved).slice(-2);
            const compactLabel = row.oldNew === 'old' ? `O/C ${yy}`
              : row.oldNew === 'new' ? `N/C ${yy}`
              : String(resolved);
            for (const pt of this.printPriceTypes()) {
              columns.push({
                key: `${crop}#0#${row.id}${pt ? '#' + pt : ''}`, crop, month: 0, year: resolved,
                label: pt ? `${label} ${pt === 'cash' ? 'Cash' : 'Basis'}` : label,
                compactLabel: pt ? `${compactLabel} ${pt === 'cash' ? 'Cash' : 'Basis'}` : compactLabel,
                priceType: pt
              });
            }
          }
        } else {
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
              key: `${crop}#${m}${pt ? '#' + pt : ''}`, crop, month: m, year: viewedYear,
              label: `${this.getMonthName(m)} (${viewedYear})${suffix}${board ? ' · ' + board : ''}`,
              compactLabel: `${this.getMonthName(m)} ${String(viewedYear).slice(-2)}${suffix}`,
              priceType: pt
            });
          }
        }
      }
      return { crop, columns };
    });
  });

  /**
   * Resolve a printed cell's bid value. A year the GRID is showing reads the live edit-grid value, so
   * unsaved edits print; any other year reads the saved bid from the lookup. That test is now
   * "is this year on screen", not "is this the one viewed year" -- with several years in the grid,
   * several of print's columns are live.
   */
  printCellValue(row: EditBidsRow, col: { crop: string; month: number; year: number; priceType?: 'cash' | 'basis' }): string {
    const gridKey = this._colKey(col.crop, col.year, col.month);
    const live = this.editBidsYears().includes(col.year);
    // In cash or basis mode row.bids already holds whichever price is selected, so priceType is
    // absent and this reads exactly as it always did. Both mode sets it and splits the two apart.
    let value: string;
    if (col.priceType === 'basis') {
      value = live
        ? (row.basisBids[gridKey] ?? '').trim()
        : (this._getLatestEntry(row.name, col.year, col.crop, col.month)?.basisBid ?? '').trim();
    } else if (live) {
      value = (row.bids[gridKey] ?? '').trim();
    } else {
      value = this._getLatestBid(row.name, col.year, col.crop, col.month).trim();
    }
    if (!value) return value;

    // The board describes the FED number, and for the viewed year the value above may be an unsaved
    // override. Printing the two together stamped a hand-typed price with a board it was never quoted
    // against; the grid guards this the same way before showing its own symbol.
    const overridden = live && (col.priceType === 'basis'
      ? value !== (row.originalBasisBids[gridKey] ?? '').trim()
      : value !== (row.originalBids[gridKey] ?? '').trim());
    if (overridden) return value;

    // Paper says it once in the header and only repeats it on a cell that disagrees -- unlike the
    // screen, which labels every fed bid. Print cannot afford the repetition: the values feed the
    // fit-first column sizing, and a symbol on all of them widened columns enough to drop the whole
    // sheet to 9px type, or overflow the page outright in Both mode. A Year column has no consensus
    // to lean on (each location's value is its own nearest month), so those always name their own.
    if (col.month === 0) {
      const yearContract = this.yearContractFor(row.name, col.year, col.crop, 0);
      return yearContract ? `${value} (${yearContract})` : value;
    }
    const cellBoard = this.cellBoardFor(row.name, col.year, col.crop, col.month);
    const consensus = this.boardConsensus(col.crop, col.year, col.month);
    return cellBoard && cellBoard !== consensus ? `${value} (${cellBoard})` : value;
  }

  /**
   * Which price columns each period prints as. Cash and basis print one column carrying the selected
   * price; Both prints the pair, which is why this returns undefined rather than 'cash' in the single
   * cases -- an unset priceType keeps the column keys and headers exactly as they were.
   */
  private readonly printPriceTypes = computed<(('cash' | 'basis') | undefined)[]>(() =>
    this.priceMode() === 'both' ? ['cash', 'basis'] : [undefined]);

  printEditBids(): void {
    // Initialize period (crop/month) selection with whatever is currently visible on the edit grid.
    // The per-context year configs persist (loaded from preference / kept across opens).
    this.printSelectedCrops.set(new Set(this.editBidsCrops()));
    this.printSelectedMonths.set(new Set(this.editBidsMonths()));
    this.showPrintDialog.set(true);
  }

  /** True when the Yearly period (month 0) is among the selected print periods. */
  readonly printHasYearly = computed(() => this.printSelectedMonths().has(0));
  /** Candidate crop years for the Yearly year picker (viewed year ±2) — shown as concrete years, stored as offsets. */
  readonly printYearChoices = computed(() => {
    const y = this.editBidsYear();
    return BidSheetComponent.PRINT_YEAR_OFFSETS.map(offset => ({ offset, year: y + offset }));
  });

  // --- Yearly columns builder ---
  onPrintYearlyRowDrop(event: CdkDragDrop<PrintYearRow[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.printYearlyRows.update(rows => {
      const updated = [...rows];
      moveItemInArray(updated, event.previousIndex, event.currentIndex);
      return updated;
    });
    this._savePrintLayout();
  }

  addPrintYearlyRow(): void {
    this.printYearlyRows.update(rows => {
      if (rows.length >= BidSheetComponent.MAX_PRINT_YEARLY_ROWS) return rows;
      return [...rows, { id: this._newRowId(), enabled: true, offset: 0, oldNew: '' as const }];
    });
    this._savePrintLayout();
  }
  removePrintYearlyRow(id: string): void {
    this.printYearlyRows.update(rows => rows.length <= 1 ? rows : rows.filter(r => r.id !== id));
    this._savePrintLayout();
  }
  togglePrintYearlyRow(id: string): void {
    this.printYearlyRows.update(rows => rows.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
    this._savePrintLayout();
  }
  setPrintYearlyRowOffset(id: string, offset: number): void {
    const clamped = Math.max(-2, Math.min(2, offset));
    this.printYearlyRows.update(rows => rows.map(r => r.id === id ? { ...r, offset: clamped } : r));
    this._savePrintLayout();
  }
  setPrintYearlyRowOldNew(id: string, value: string): void {
    const oldNew: '' | 'old' | 'new' = value === 'old' || value === 'new' ? value : '';
    this.printYearlyRows.update(rows => rows.map(r => r.id === id ? { ...r, oldNew } : r));
    this._savePrintLayout();
  }

  /** Persists the print layout (Yearly columns + contact info + highlight) per-TU and globally (fire-and-forget). */
  private _savePrintLayout(): void {
    const layout = JSON.stringify({
      yearlyRows: this.printYearlyRows().map(({ enabled, offset, oldNew }) => ({ enabled, offset, oldNew })),
      address: this.printAddress(),
      phone: this.printPhone(),
      highlightScoular: this.printHighlightScoularLocations(),
      layoutStyle: this.printLayoutStyle()
    });
    const cropCode = this.selectedCrop() || null;
    const month = this.selectedMonth();
    const cropYear = this.selectedYear() || null;
    const key = this.preferenceKey();
    if (key) {
      this.apiService.setBidSheetPreference({ tradeUnitKey: key, cropCode, month, cropYear, printLayout: layout })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save per-TU print layout', err); } });
    }
    this.apiService.setBidSheetPreference({ tradeUnitKey: BidSheetComponent.GLOBAL_PREF_KEY, cropCode, month, cropYear, printLayout: layout })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err) => { if (isDevMode()) console.warn('Failed to save global print layout', err); } });
  }

  closePrintDialog(): void {
    this._savePrintLayout(); // persist contact info / any pending changes on close
    this.showPrintDialog.set(false);
  }

  togglePrintCrop(crop: string): void {
    this.printSelectedCrops.update(s => {
      const next = new Set(s);
      next.has(crop) ? next.delete(crop) : next.add(crop);
      return next;
    });
  }

  togglePrintMonth(month: number): void {
    this.printSelectedMonths.update(s => {
      const next = new Set(s);
      next.has(month) ? next.delete(month) : next.add(month);
      return next;
    });
  }

  getMonthName(month: number): string {
    if (month === 0) return 'Year';
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
      logoUrl: this.printLogoUrl
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
    this.newLocationTu.set('');
    this.newLocationIsScoular.set(false);
  }

  // =========================================================================
  // Panel helpers
  // =========================================================================

  selectItemFromTable(item: BidSheetPanelItem): void {
    // Open the detail view for this location — does NOT set it as the session reference.
    // Use the "Set as Reference" button in the detail view to make it the reference.
    const alreadyOpen = this.panelSelectedLocation() === item.name;
    this.panelSelectedLocation.set(alreadyOpen ? '' : item.name);
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
    const name = this.panelSelectedLocation();
    if (!name) return;
    // Toggle: clicking again clears the reference
    const isSetting = this.selectedLocationName() !== name;
    if (isSetting) {
      this.selectedLocationName.set(name);
      this.usageTracking.postClickEvent('interaction', 'bidsheet', 'reference-set', name);
    } else {
      this.selectedLocationName.set('');
    }
    this.filterBids();
    this._refreshMapMarkers();
  }

  panelGoBack(): void {
    // Close detail view but keep the session reference (selectedLocationName) intact
    this.panelSelectedLocation.set('');
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
    const loc = this._findLocationByName(this.panelSelectedLocation());
    if (!loc) return;
    this.apiService.getBidSheetLocationSheetCount(loc.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (count) => this.deleteLocationSheetCount.set(count),
      error: () => this.deleteLocationSheetCount.set(null)
    });
  }

  confirmDeleteLocation(): void {
    const name = this.panelSelectedLocation();
    if (!name) return;
    const loc = this._findLocationByName(name);
    if (!loc) return;
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
        this.panelSelectedLocation.set('');
        this.selectedLocationName.set('');
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
    const name = this.panelSelectedLocation();
    if (!crop || !name) return;
    const loc = this._findLocationByName(name);
    if (!loc) return;
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
    this.editLocationNameValue.set(this.panelSelectedLocation());
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
    return this.allMapLocations()
      .filter(l => l.name === name)
      .sort((a, b) => a.id - b.id)[0];
  }

  // -------------------------------------------------------------------------
  // Renaming and classifying from the Edit Bids grid
  //
  // Adding a batch from BarChart lands here, so this is where the vendor's names get corrected and
  // Scoular sites get confirmed. The side-panel versions below do the same job for whichever single
  // location the panel has selected; these are row-scoped so a whole batch can be worked through.
  // -------------------------------------------------------------------------

  /** Row currently being renamed, by location name. Empty when none is. */
  readonly renamingRow = signal('');
  readonly renameRowDraft = signal('');

  startRenameRow(name: string, event?: Event): void {
    event?.stopPropagation();
    this.renamingRow.set(name);
    this.renameRowDraft.set(name);
    // The template's `autofocus` does nothing here -- browsers honour it at parse time, not when an
    // element is inserted later -- so the user had to click the pencil and then click the box. Focus
    // after the input exists, and select the text so a full replacement is one keystroke away.
    setTimeout(() => {
      const el = document.getElementById(`rename-row-${name}`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }

  cancelRenameRow(): void {
    this.renamingRow.set('');
    this.renameRowDraft.set('');
  }

  /** A name is required: there is no sensible way to render a location without one. */
  readonly renameRowValid = computed(() => this.renameRowDraft().trim().length > 0);

  /** Empties the input so a long vendor name can be replaced without selecting it first. */
  clearRenameRow(event?: Event): void {
    event?.preventDefault();   // keep focus on the input; blurring it would commit the rename
    this.renameRowDraft.set('');
  }

  saveRenameRow(oldName: string): void {
    const newName = this.renameRowDraft().trim();
    // An empty name reverts rather than saving. Blur commits, so a user who clears the box and clicks
    // away must get the old name back instead of a nameless row.
    this.cancelRenameRow();
    if (!newName || newName === oldName) return;

    const loc = this._findLocationByName(oldName);
    if (!loc) return;
    // Row order is keyed by location id now, not name, so a rename cannot orphan it -- nothing to
    // carry over, unlike the old per-user JSON order this replaced.
    this._saveLocationFields(loc, { name: newName }, `Renamed to ${newName}`, 'Failed to rename location');
  }

  isRowScoular(name: string): boolean {
    // scoularLocationNames() is an O(1) set lookup; _findLocationByName is an O(n) scan over every
    // location, and this is called once per grid row on every change-detection pass -- O(rows x
    // locations) repeated many times a second. At catalog scale that stops being free.
    return this.scoularLocationNames().has(name);
  }

  toggleRowScoular(name: string, event?: Event): void {
    event?.stopPropagation();
    const loc = this._findLocationByName(name);
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
      name: loc.name,
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
        // and the open grid still trues itself up when the reload lands (see _loadBidData).
        if (this.editBidsMode()) this._buildEditGrid();
        this._loadAllMapLocations();
        this._loadAllMapLocations();
      },
      error: () => this.toastService.error(failureMessage)
    });
  }

  saveLocationName(): void {
    const newName = this.editLocationNameValue().trim();
    const oldName = this.panelSelectedLocation();
    if (!newName || newName === oldName) {
      this.cancelEditLocationName();
      return;
    }
    const loc = this._findLocationByName(oldName);
    if (!loc) return;

    this.apiService.updateBidSheetLocation(loc.id, {
      name: newName,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      latitude: loc.latitude,
      longitude: loc.longitude,
      elevatorCode: loc.elevatorCode,
      tradeUnitCode: loc.tradeUnitCode,
      groupName: loc.groupName,
      isScoularFacility: loc.isScoularFacility ?? false,
      bids: []
    } as any).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.editingLocationName.set(false);
        this.editLocationNameValue.set('');
        this.panelSelectedLocation.set(newName);
        this.selectedLocationName.set(newName);
        this.toastService.success(`Location renamed to ${newName}`);
        // Reload data to reflect the change
        this._loadAllMapLocations();
      },
      error: () => this.toastService.error('Failed to rename location')
    });
  }

  toggleLocationScoularStatus(): void {
    const name = this.panelSelectedLocation();
    if (!name) return;
    const loc = this._findLocationByName(name);
    if (!loc) return;
    const newValue = !(loc.isScoularFacility ?? false);

    this.apiService.updateBidSheetLocation(loc.id, {
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      latitude: loc.latitude,
      longitude: loc.longitude,
      elevatorCode: loc.elevatorCode,
      tradeUnitCode: loc.tradeUnitCode,
      groupName: loc.groupName,
      isScoularFacility: newValue,
      bids: []
    } as any).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    const alreadySelected = this.selectedLocationName() === loc.name;
    this.selectedLocationName.set(alreadySelected ? '' : loc.name);
    // Mutually exclusive with a catalog reference -- only one comparison anchor at a time.
    this.catalogReferenceKey.set(null);
    if (alreadySelected) {
      this._refreshMapMarkers();
      return;
    }

    // Open the panel BEFORE flying so the offset calculation knows about it
    this.panelSelectedLocation.set('');
    this.showPanel.set(true);
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
    this.selectedLocationName.set('');
    this.showPanel.set(false);
    this.panelSelectedLocation.set('');
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

    // Every location is in scope. The old pair asked which desks were selected so pins outside them
    // could be greyed and the panel filter could prune -- see the comment where hasTu is used.
    const hasTu = true;
    const zoom = this._map.getZoom();
    const month = this.selectedMonth();

    const locKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const crop = this.selectedCrop();
    const year = this.selectedYear();

    // refName identifies which ADDED-location pin, if any, IS the reference itself (its own special
    // styling below) -- a catalog reference is never one of these pins, so this stays tied to
    // selectedLocationName alone. refBid is the VALUE every OTHER pin compares against, and resolves
    // whichever kind of reference is actually set (_referenceBid), so comparison still works when the
    // reference is a catalog listing.
    const refName = this.selectedLocationName();
    const refBid = this._referenceBid(year, crop, month);

    const statusColors: Record<string, { bg: string; border: string }> = {
      reference: { bg: '#2563eb', border: '#1d4ed8' },
      beating:   { bg: '#dc2626', border: '#991b1b' },
      matching:  { bg: '#eab308', border: '#a16207' },
      none:      { bg: '#6b7280', border: '#4b5563' }
    };

    // Search query — only filter map pins, panel stays full
    const searchQ = this.searchQuery().toLowerCase();

    // Scoular pins switch presentation on ONE thing: whether a reference location is set.
    //   no reference  → whole pin green (fill), no ring
    //   reference set → status fill (blue/red/yellow) + green ring
    // Keyed on _hasReference(), NOT on crop: picking a crop alone doesn't produce a comparison, and
    // testing crop here is what previously made the ring appear with no reference selected.
    const comparingToRef = this._hasReference();
    const scoularNames = this.scoularLocationNames();

    // Group all map locations by coordinates
    const locsByPos = new Map<string, BidSheetLocation[]>();
    for (const loc of this.allMapLocations()) {
      if (!loc.latitude || !loc.longitude) continue;
      const key = locKey(loc.latitude, loc.longitude);
      const arr = locsByPos.get(key) || [];
      arr.push(loc);
      locsByPos.set(key, arr);
    }

    const selectedName = this.selectedLocationName();
    const panelOpenName = this.panelSelectedLocation();

    // Build set of location names visible in the panel (respects crop/TU/search filters)
    const panelNames = new Set(this.filteredBidItems().map(i => i.name));

    // View parity: All Producers (with derived crop-year data) renders bids/status like a single TU.
    // Was "a trade unit is selected, OR we are in All Producers with data" -- both branches are
    // now the only branch, so bid values, statuses and reference comparison always render.
    const hasIndividualTu = true;

    // Pass 1: decide which coordinate groups actually render a marker (apply the skip filters once)
    // and capture the per-group flags the draw pass needs.
    const renderGroups: { locs: BidSheetLocation[]; names: string[]; isActiveTu: boolean; isRef: boolean; isPanelOpen: boolean; }[] = [];
    for (const [, locs] of locsByPos) {
      // If searching, skip this pin group unless at least one location name matches
      if (searchQ && !locs.some(l => l.name.toLowerCase().includes(searchQ))) continue;
      const names = locs.map(l => l.name);
      // In All Producers (no TU filter) every location is "in scope"; with a TU, only its locations are.
      // Every location is in scope now that nothing is desk-filtered.
      const isActiveTu = true;
      const isRef = !!(hasIndividualTu && refName && names.includes(refName));
      const isPanelOpen = !!(panelOpenName && names.includes(panelOpenName));
      // When filters are active, only show locations that appear in the panel
      if (hasTu && !names.some(n => panelNames.has(n))) continue;
      // Skip locations with no bid for the selected crop/year/month
      if (crop && !names.some(n => this._getLatestBid(n, year, crop, month))) continue;
      renderGroups.push({ locs, names, isActiveTu, isRef, isPanelOpen });
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
      const { locs, names, isActiveTu, isRef, isPanelOpen } = g;
      const [lat, lng] = displayPos[gi];
      const showBidValues = isActiveTu && hasIndividualTu && crop;

      // Panel-open location — render expanded with name + bid (uses status color if reference, otherwise gray)
      if (isPanelOpen) {
        const bidStr = crop ? this._getLatestBid(panelOpenName, year, crop, month) : '';
        // This pin represents panelOpenName specifically, so key it to that name rather than to
        // "any location at this coordinate".
        const panelIsScoular = scoularNames.has(panelOpenName);
        let pinBg = '#6b7280', pinBorder = '#4b5563';
        if (isRef) { pinBg = '#2563eb'; pinBorder = '#1d4ed8'; }
        else if (this._hasReference() && bidStr) {
          const status = this._computeItemStatus(bidStr, false, refBid);
          const c = statusColors[status] ?? statusColors['none'];
          pinBg = c.bg; pinBorder = c.border;
        } else if (panelIsScoular) { pinBg = BidSheetComponent.SCOULAR_BG; pinBorder = BidSheetComponent.SCOULAR_BORDER; }
        const expandedIcon = this._buildHoverIcon(panelOpenName, bidStr, pinBg, pinBorder);
        const marker = L.marker([lat, lng], { icon: expandedIcon, zIndexOffset: 1000 });
        marker.on('click', () => this._selectMapLocation(locs[0]));
        this._clusterGroup.addLayer(marker);
        return;
      }

      // Below the bid-pin zoom threshold: colored dot — but when searching, always show name labels.
      // Lowered from 8 → 6 so the bid-value pins appear sooner (esp. in All Producers, which opens at
      // the wider US overview). Zoom 5 = national overview keeps dots; 6+ shows the bid pins.
      if (zoom < 6 && !searchQ) {
        // Dot stands for the whole coordinate group, so it counts as ours if ANY location here is.
        const dotIsScoular = names.some(n => scoularNames.has(n));
        // Compute dot color from bid status (matches the pill colors used when zoomed in)
        let color: string, border: string;
        if (isRef) {
          color = statusColors['reference'].bg; border = statusColors['reference'].border;
        } else if (this._hasReference() && crop) {
          // Use beating/matching/none color based on this location's bid vs the reference
          const bidVal = this._getLatestBid(locs[0].name, year, crop, month);
          const status = bidVal ? this._computeItemStatus(bidVal, false, refBid) : 'none';
          color = statusColors[status].bg; border = statusColors[status].border;
        } else if (dotIsScoular) {
          color = BidSheetComponent.SCOULAR_BG; border = BidSheetComponent.SCOULAR_BORDER;
        } else {
          color = '#9ca3af'; border = '#6b7280';
        }
        const dotIcon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="width:14px;height:14px;background:${color};border:2px solid ${border};border-radius:50%;box-shadow:${this._scoularRing(comparingToRef && dotIsScoular)}0 1px 3px rgba(0,0,0,0.3);cursor:pointer;"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7]
        });
        const m = L.marker([lat, lng], { icon: dotIcon });
        m.on('click', () => this._selectMapLocation(locs[0]));
        const hoverBid2 = crop ? this._getDisplayBid(locs[0].name, year, crop, month) : '';
        this._bindHoverExpand(m, dotIcon, locs[0].name, hoverBid2, color, border);
        this._clusterGroup.addLayer(m);
        return;
      }

      if (showBidValues) {
        // Active TU with crop selected — show bid values with status colors
        const bidItems = names
          .map(n => {
            const isNameRef = hasIndividualTu && n === refName;
            // bidVal drives presence and status comparison and must stay numeric; bidLabel is what
            // the pill prints, which in Both mode carries the basis alongside.
            const bidVal = this._getLatestBid(n, year, crop, month);
            const bidLabel = this._getDisplayBid(n, year, crop, month);
            const nameIsScoular = scoularNames.has(n);
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
            return `<div style="background:${pillBg};border:2px solid ${pillBorder};border-radius:6px;padding:5px 6px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:${this._scoularRing(comparingToRef && isScoular)}0 2px 4px rgba(0,0,0,0.3);line-height:1.2;cursor:pointer;">${this._esc(label)}</div>`;
          }).join('');
          const maxWidth = Math.max(58, ...bidItems.map(({ label }) => label.length * 7 + 16));
          const height = bidItems.length * 28 + 16;
          const primaryBg = bidItems[0].bg;
          const divIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;">
              ${linesHtml}
              <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${primaryBg};margin:-1px auto 0;"></div>
            </div>`,
            iconSize: [maxWidth, height],
            iconAnchor: [maxWidth / 2, height]
          });
          const marker = L.marker([lat, lng], { icon: divIcon });
          marker.on('click', () => this._selectMapLocation(locs[0]));
          const hoverBid3 = crop ? this._getDisplayBid(locs[0].name, year, crop, month) : '';
          this._bindHoverExpand(marker, divIcon, locs[0].name, hoverBid3, primaryBg, bidItems[0].border);
          this._clusterGroup.addLayer(marker);
          return;
        }
      }

      // Default: name labels — match the pill color story used elsewhere
      // Keyed to locs[0] specifically, not "any name here": this bg also drives the hover icon,
      // which shows locs[0]. Per-line fill for mixed groups is handled inside _buildStackedLabel.
      const labelIsScoular = scoularNames.has(locs[0].name);
      let bg: string, border: string;
      if (isRef) {
        bg = statusColors['reference'].bg; border = statusColors['reference'].border;
      } else if (this._hasReference() && crop) {
        // Use beating/matching/none color based on this location's bid vs the reference
        const bidVal = this._getLatestBid(locs[0].name, year, crop, month);
        const status = bidVal ? this._computeItemStatus(bidVal, false, refBid) : 'none';
        bg = statusColors[status].bg; border = statusColors[status].border;
      } else if (labelIsScoular) {
        bg = BidSheetComponent.SCOULAR_BG; border = BidSheetComponent.SCOULAR_BORDER;
      } else {
        bg = '#9ca3af'; border = '#6b7280';
      }
      // Must match _buildStackedLabel's own width maths, including its 150px cap -- the label clamps
      // and ellipsises at that width, so sizing the icon box by an uncapped estimate left a long
      // vendor name anchored ~110px off from the text actually drawn.
      const maxWidth = Math.min(150, Math.max(85, ...names.map(n => n.length * 7 + 22)));
      const nameIcon = L.divIcon({
        className: 'custom-marker',
        html: this._buildStackedLabel(names, bg, border, comparingToRef),
        iconSize: [maxWidth, names.length * 26 + 8],
        iconAnchor: [maxWidth / 2, names.length * 26 + 8]
      });
      const marker = L.marker([lat, lng], { icon: nameIcon });
      marker.on('click', () => this._selectMapLocation(locs[0]));
      const hoverBid4 = crop ? this._getDisplayBid(locs[0].name, year, crop, month) : '';
      this._bindHoverExpand(marker, nameIcon, locs[0].name, hoverBid4, bg, border);
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

  private _renderCatalogMarkers(): void {
    if (!this._map || !this._catalogLayer || !this._L) return;
    this._catalogLayer.clearLayers();
    if (this.addLocationMode() || this.barchartMode()) return;
    const L = this._L;
    const detailKey = this.catalogDetailKey();
    const refKey = this.catalogReferenceKey();
    const crop = this.selectedCrop();
    const year = this.selectedYear();
    const month = this.selectedMonth();
    const hasReference = this._hasReference();
    // Same reference value the added-location pass compares against, so a catalog pin recolors
    // consistently with everything else on the map when either kind of reference is set.
    const refBid = hasReference ? this._referenceBid(year, crop, month) : null;

    for (const loc of this.catalogLocations()) {
      if (loc.latitude == null || loc.longitude == null) continue;
      if (loc.placements.length > 0) continue; // already drawn as an added location above

      // "Selected" covers both the open detail popup AND being the comparison reference -- closing
      // the popup shouldn't make the pin you're actively comparing against look unselected.
      const isRef = loc.locationKey === refKey;
      const selected = loc.locationKey === detailKey || isRef;
      const price = loc.matchedBidPrice;

      const { marker, icon } = price != null
        ? this._buildCatalogPriceMarker(loc, price, isRef, hasReference, refBid, selected)
        : this._buildCatalogDotMarker(loc, selected);

      marker.on('click', () => this._selectCatalogLocation(loc));
      this._bindCatalogHover(marker, icon, loc, price ?? null);
      this._catalogLayer.addLayer(marker);
    }
  }

  /** No crop selected, or this listing has nothing for the current period: a plain, small dot. */
  private _buildCatalogDotMarker(loc: BarchartCatalogLocation, selected: boolean): { marker: Leaflet.Marker; icon: Leaflet.DivIcon } {
    const L = this._L!;
    const dotSize = selected ? BidSheetComponent.CATALOG_DOT_SIZE_SELECTED : BidSheetComponent.CATALOG_DOT_SIZE;
    const box = dotSize + BidSheetComponent.CATALOG_HIT_PADDING;
    const dotColor = selected ? '#2563eb' : '#93c5fd';
    const dotBorder = selected ? '#1d4ed8' : '#60a5fa';
    const icon = L.divIcon({
      className: 'custom-marker',
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
  private _buildCatalogPriceMarker(loc: BarchartCatalogLocation, price: number, isRef: boolean,
    hasReference: boolean, refBid: number | null, selected: boolean): { marker: Leaflet.Marker; icon: Leaflet.DivIcon } {
    const L = this._L!;
    const label = price.toString();
    let bg: string, border: string;
    if (isRef) {
      bg = '#2563eb'; border = '#1d4ed8';
    } else if (hasReference) {
      const status = this._computeItemStatus(label, false, refBid);
      const colors: Record<string, [string, string]> = {
        beating: ['#dc2626', '#991b1b'], matching: ['#eab308', '#a16207'], none: ['#6b7280', '#4b5563'], reference: ['#2563eb', '#1d4ed8']
      };
      [bg, border] = colors[status] ?? colors['none'];
    } else {
      bg = BidSheetComponent.CATALOG_PILL_BG; border = BidSheetComponent.CATALOG_PILL_BORDER;
    }
    const width = Math.max(44, label.length * 8 + 16);
    const height = selected ? 34 : 28;
    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="position:relative;text-align:center;">
        <div style="background:${bg};border:2px solid ${border};border-radius:6px;padding:4px 6px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);line-height:1.2;cursor:pointer;">${this._esc(label)}</div>
        <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${bg};margin:-1px auto 0;"></div>
      </div>`,
      iconSize: [width, height],
      iconAnchor: [width / 2, height]
    });
    return { marker: L.marker([loc.latitude!, loc.longitude!], { icon }), icon };
  }

  /**
   * Hover-expand for a catalog pin: name plus whatever the pin is already showing -- the matched
   * price when it has one (the same number the pill prints), city/state otherwise. No fetch: the
   * batched search response already carries every visible pin's price for the current period (see
   * _loadCatalogLocations), so there is nothing left to look up just because the pointer arrived.
   */
  private _bindCatalogHover(marker: Leaflet.Marker, icon: Leaflet.DivIcon, loc: BarchartCatalogLocation, price: number | null): void {
    const name = barchartDisplayName(loc);
    const subtitle = [loc.city, loc.state].filter(Boolean).join(', ');
    this._bindHoverExpand(marker, icon, name, price != null ? price.toString() : subtitle, '#2563eb', '#1d4ed8');
  }

  /**
   * Opens the detail popup for a catalog-only pin and fetches its live bids -- the read path already
   * existed for the picker's old confirm step; this is its only caller now. Uses the shared cache
   * first, so a pin already inspected via hover (or a prior click) doesn't fetch twice.
   */
  openCatalogDetail(locationKey: string): void {
    this.catalogDetailKey.set(locationKey);
    this._refreshMapMarkers(); // re-draw so the clicked pin highlights immediately

    const cached = this._catalogDetailCache.get(locationKey);
    if (cached) { this.catalogDetail.set(cached); this.catalogDetailLoading.set(false); return; }

    this.catalogDetail.set(null);
    this.catalogDetailLoading.set(true);
    this.apiService.getBarchartLocationDetail(locationKey).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (detail) => {
        this._catalogDetailCache.set(locationKey, detail);
        this.catalogDetailLoading.set(false);
        this.catalogDetail.set(detail);
      },
      error: () => {
        this.catalogDetailLoading.set(false);
        this.toastService.error('Failed to load this location');
        this.closeCatalogDetail();
      }
    });
  }

  closeCatalogDetail(): void {
    this.catalogDetailKey.set(null);
    this.catalogDetail.set(null);
    this._refreshMapMarkers();
  }

  /**
   * Toggles a catalog listing as the map's comparison reference -- the same click behaviour an ADDED
   * location's pin already has (_selectMapLocation), extended to a listing nobody has added yet.
   * Mutually exclusive with selectedLocationName: only one reference at a time, whichever kind.
   * Public (not the click handler itself) because the detail popup's own button calls it too, for a
   * location whose popup is already open.
   */
  toggleCatalogReference(locationKey: string): void {
    if (this.catalogReferenceKey() === locationKey) {
      this.catalogReferenceKey.set(null);
    } else {
      this.selectedLocationName.set('');
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
    this.apiService.getBarchartLocationDetail(locationKey).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (detail) => { this._catalogDetailCache.set(locationKey, detail); then(); },
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
    return !!this.selectedLocationName() || !!this.catalogReferenceKey();
  }

  /**
   * The reference's bid for one crop/year/month, whichever kind of reference is set. Added-location
   * references resolve through the normal bidLookup(); a catalog reference falls back to whatever's
   * cached from being hovered or clicked -- null (not compared) rather than blocking on a fetch, so
   * setting the reference doesn't freeze every other pin's color until a request round-trips.
   */
  private _referenceBid(year: number | null, crop: string, month: number): number | null {
    const refName = this.selectedLocationName();
    if (refName) return this._parseBid(this._getLatestBid(refName, year, crop, month));
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
    const sheetId = this.activeSheetId();
    if (!detail || this.catalogDetailAdding()) return;
    if (sheetId == null) { this.toastService.error('Create or select a bid sheet first'); return; }

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

  private _buildStackedLabel(names: string[], bg: string, border: string, statusDriven = false): string {
    const isGrey = bg === '#d1d5db' || bg === '#9ca3af';
    const textColor = '#fff';
    const labelBg = isGrey ? '#6b7280' : bg;
    const labelBorder = isGrey ? '#4b5563' : border;
    const maxWidth = Math.min(150, Math.max(85, ...names.map(n => n.length * 7 + 22)));
    // Both cues are per NAME, not per pin: a stacked label can hold several locations at one
    // coordinate and only some may be ours. Painting the whole stack from one flag would mark a
    // competitor as ours just for sharing a coordinate with a Scoular elevator.
    //   no reference → green FILL on our lines only
    //   reference set → status fill kept, green RING on our lines only (a green ring on a green
    //                   fill would be invisible, which is why these are exclusive)
    const scoular = this.scoularLocationNames();
    const linesHtml = names.map(n => {
      const mine = scoular.has(n);
      const lineBg = !statusDriven && mine ? BidSheetComponent.SCOULAR_BG : labelBg;
      const lineBorder = !statusDriven && mine ? BidSheetComponent.SCOULAR_BORDER : labelBorder;
      return `<div style="background:${lineBg};border:2px solid ${lineBorder};border-radius:5px;padding:4px 8px;font-size:11px;font-weight:700;color:${textColor};white-space:nowrap;line-height:1.2;overflow:hidden;text-overflow:ellipsis;max-width:${maxWidth}px;${this._scoularRingCss(statusDriven && mine)}">${this._esc(n)}</div>`;
    }).join('');
    return `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;">
      ${linesHtml}
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${labelBorder};margin:-1px auto 0;"></div>
    </div>`;
  }

  /** Creates an expanded hover icon showing location name + bid value. */
  private _buildHoverIcon(name: string, bid: string, bg: string, border: string): any {
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
        <div style="background:${bg};border:2px solid ${border};border-radius:8px;padding:5px 9px;box-shadow:${this._scoularRing(this.scoularLocationNames().has(name) && bg !== BidSheetComponent.SCOULAR_BG)}0 3px 10px rgba(0,0,0,0.3);cursor:pointer;">${nameHtml}${subHtml}</div>
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

  private _bindHoverExpand(marker: any, originalIcon: any, name: string, bid: string, bg: string, border: string): void {
    const hoverIcon = this._buildHoverIcon(name, bid, bg, border);
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
