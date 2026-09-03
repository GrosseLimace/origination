import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { BarchartCatalogLocation, BidSheet, BidSheetLocation, BidSheetLocationBid } from '@models';

import { BidSheetComponent } from './bid-sheet.component';

/**
 * Covers how the Bid Sheet decides what a bid CELL says — the board symbols, the per-column consensus
 * behind them, and what print puts on paper. None of it had tests: it arrived across a fast run of UI
 * commits, and an audit afterwards found several defects in exactly this logic (a symbol reappearing on
 * a hand-typed number, print stamping a board on an unsaved override, a basis edit never going clean).
 *
 * The component is driven through its signals rather than its network calls: every method under test
 * reads bidLocations / editBidsRows, so a stubbed API is enough to construct it.
 */

function bid(overrides: Partial<BidSheetLocationBid> = {}): BidSheetLocationBid {
  return {
    id: 1,
    locationId: 1,
    commodityCode: 'YC',
    cropYear: 2026,
    month: 8,
    bid: '4.98',
    source: 'Barchart',
    underlyingFuture: 'ZCU26',
    createdBy: 'barchart-feed',
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function location(name: string, bids: BidSheetLocationBid[]): BidSheetLocation {
  return {
    id: bids[0]?.locationId ?? 1,
    name,
    tradeUnitCode: '2038',
    createdBy: 'test',
    createdAt: '2026-08-01T00:00:00Z',
    bids,
  };
}

describe('BidSheetComponent — board symbols and printed values', () => {
  let component: BidSheetComponent;

  beforeEach(() => {
    const api = {
      getBidSheetLocations: () => of([]),
      getAllBidSheetLocations: () => of([]),
      getBidCropYears: () => of([2026]),
      getBidCommodities: () => of(['YC']),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
      getBidSheetLocationOrder: () => of(null),
      setBidSheetLocationOrder: () => of(null),
      getElevators: () => of([]),
      getBarchartCoverage: () => of(null),
      searchBarchartLocations: () => of([]),
      getBidSheets: () => of([]),
      getBidSheet: () => of(null),
      createBidSheet: () => of(null),
      renameBidSheet: () => of(null),
      deleteBidSheet: () => of(undefined),
      setBidSheetShares: () => of(null),
      setBidSheetLayout: () => of(null),
      addBidSheetLocation: () => of(null),
      removeBidSheetLocation: () => of(null),
      setBidSheetRowOrder: () => of(null),
      getBidSheetLocationSheetCount: () => of(0),
      getEntitlementsCatalog: () => of({ people: [], tradeUnits: [], groups: [] }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {}, info: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {} } },
      ],
    });
    // happy-dom + JIT cannot fetch this component's templateUrl, and it is not what is under test.
    TestBed.overrideComponent(BidSheetComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    TestBed.inject(AppStateService);
    component = TestBed.createComponent(BidSheetComponent).componentInstance;
  });

  /**
   * Puts locations in the map cache AND on a single active sheet -- bidEntries (what most of this
   * suite exercises) reads bidLocations, which is now the active sheet's locations, not the whole
   * map cache.
   */
  function seed(...locs: BidSheetLocation[]): void {
    component.allMapLocations.set(locs);
    const sheet: BidSheet = {
      id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
      createdBy: 'test', createdAt: '2026-08-01T00:00:00Z',
      shares: [], locations: locs,
    };
    component.sheets.set([sheet]);
    component.activeSheetId.set(1);
  }

  // ── the column's board ────────────────────────────────────────────────────────────────────────

  it('names the board most of a column quotes against', () => {
    seed(
      location('A', [bid({ locationId: 1, underlyingFuture: 'ZCU26' })]),
      location('B', [bid({ locationId: 2, underlyingFuture: 'ZCU26' })]),
      location('C', [bid({ locationId: 3, underlyingFuture: 'ZCZ26' })]),
    );

    expect(component.boardConsensus('YC', 2026, 8)).toBe('ZCU26');
  });

  // Without a deterministic tie-break the header would flip between loads on an even split, which is
  // exactly the HRWW case on Dev: one location on Kansas City, one on Chicago.
  it('breaks a tie alphabetically so the header never flip-flops', () => {
    seed(
      location('A', [bid({ locationId: 1, commodityCode: 'HRWW', month: 12, underlyingFuture: 'ZWZ26' })]),
      location('B', [bid({ locationId: 2, commodityCode: 'HRWW', month: 12, underlyingFuture: 'KEZ26' })]),
    );

    expect(component.boardConsensus('HRWW', 2026, 12)).toBe('KEZ26');
  });

  it('has no consensus for a Year column, whose value is per-location by construction', () => {
    seed(location('A', [bid({ month: 0 })]));
    expect(component.boardConsensus('YC', 2026, 0)).toBe('');
  });

  it('ignores manual cells when deciding the column board', () => {
    seed(
      location('A', [bid({ locationId: 1, underlyingFuture: 'ZCU26' })]),
      // Stale provenance is retained on an overridden cell, so it must not get a vote.
      location('B', [bid({ locationId: 2, source: 'Manual', underlyingFuture: 'ZCZ26' })]),
      location('C', [bid({ locationId: 3, source: 'Manual', underlyingFuture: 'ZCZ26' })]),
    );

    expect(component.boardConsensus('YC', 2026, 8)).toBe('ZCU26');
  });

  // ── the cell's board ─────────────────────────────────────────────────────────────────────────

  it("reports a fed cell's board, and nothing for a manual one", () => {
    seed(
      location('Fed', [bid({ locationId: 1 })]),
      location('Typed', [bid({ locationId: 2, source: 'Manual', underlyingFuture: 'ZCU26' })]),
    );

    expect(component.cellBoardFor('Fed', 2026, 'YC', 8)).toBe('ZCU26');
    // The symbol describes the FEED's number; a cell the user took over must not wear it.
    expect(component.cellBoardFor('Typed', 2026, 'YC', 8)).toBe('');
  });

  it('names the contract on a fed Year cell', () => {
    seed(location('A', [bid({ month: 0, underlyingFuture: 'KEU26' })]));
    expect(component.yearContractFor('A', 2026, 'YC', 0)).toBe('KEU26');
  });

  // ── what a printed cell says ─────────────────────────────────────────────────────────────────

  /** A grid row as _buildEditGrid produces it, with the cell clean (current === original). */
  function row(name: string, key: string, value: string, board = 'ZCU26') {
    return {
      name, type: 'entry' as const,
      bids: { [key]: value }, originalBids: { [key]: value },
      basisBids: {}, originalBasisBids: {},
      yearFrom: {}, boardChips: { [key]: board },
      agingCells: new Set<string>(), isBarchartLinked: true,
    };
  }

  it('prints a board only on a cell that disagrees with its column', () => {
    seed(
      location('Majority', [bid({ locationId: 1, underlyingFuture: 'ZCU26' })]),
      location('Rolled', [bid({ locationId: 2, underlyingFuture: 'ZCZ26' })]),
      location('Also', [bid({ locationId: 3, underlyingFuture: 'ZCU26' })]),
    );
    component.editBidsYears.set([2026]);
    const col = { crop: 'YC', month: 8, year: 2026 };

    // On the column's own board the header already says it -- repeating it on every cell is what
    // widened the columns enough to shrink the whole printed sheet.
    expect(component.printCellValue(row('Majority', 'YC#2026#8', '4.98') as never, col)).toBe('4.98');
    expect(component.printCellValue(row('Rolled', 'YC#2026#8', '5.02') as never, col)).toBe('5.02 (ZCZ26)');
  });

  it('prints the contract on every fed Year cell, which has no column board to lean on', () => {
    seed(location('A', [bid({ month: 0, underlyingFuture: 'ZCZ26' })]));
    component.editBidsYears.set([2026]);

    const printed = component.printCellValue(
      row('A', 'YC#2026#0', '4.30') as never, { crop: 'YC', month: 0, year: 2026 });

    expect(printed).toBe('4.30 (ZCZ26)');
  });

  // The value comes from the live grid so unsaved edits print; the board comes from the saved entry.
  // Together they stamped a hand-typed price with a board it was never quoted against.
  it('does not print a board on an unsaved override', () => {
    seed(location('A', [bid({ underlyingFuture: 'ZCU26' })]));
    component.editBidsYears.set([2026]);
    const dirty = { ...row('A', 'YC#2026#8', '9.99'), originalBids: { 'YC#2026#8': '4.98' } };

    const printed = component.printCellValue(dirty as never, { crop: 'YC', month: 8, year: 2026 });

    expect(printed).toBe('9.99');
  });

  it('leaves an empty cell empty rather than printing a bare board', () => {
    seed(location('A', [bid()]));
    component.editBidsYears.set([2026]);

    expect(component.printCellValue(row('A', 'YC#2026#8', '') as never, { crop: 'YC', month: 8, year: 2026 })).toBe('');
  });

  // -- the sheet is no longer scoped by trade unit ---------------------------------------------
  // Adding a location used to need a destination desk, and the BarChart picker created one row per
  // desk selected. A location belongs to nobody now, so there is nothing to choose and nothing to
  // multiply -- both of those computeds are gone, and adding needs only a name and a place.

  it('needs only a name and coordinates to add a location by hand', () => {
    component.newLocationName.set('Kansas West');
    component.newLocationLat.set(38.5);
    component.newLocationLng.set(-98.0);

    expect(component.canSaveLocation()).toBe(true);

    // A name alone is not enough -- the map click is what gives it a place.
    component.newLocationLat.set(null);
    expect(component.canSaveLocation()).toBe(false);
  });

  it('never locks the grid', () => {
    // The grid used to go read-only whenever no single trade unit was selected, because a bid had to
    // be saved against a desk. A bid names its own location now, so there is always somewhere to save.
    expect(component.cellReadOnly()).toBe(false);
  });

  it('saves every screen setting under one key per user', () => {
    // Was the sorted list of selected trade units, so each desk kept its own arrangement -- and an
    // empty selection produced an empty key, which every save path silently discarded.
    expect(component.preferenceKey()).toBe('__global__');
    expect(component.preferenceKey()).not.toBe('');
  });

  // ── saving marks a cell clean ────────────────────────────────────────────────────────────────
  //
  // A cell counts as dirty while current !== original, and that drives three things at once: the green
  // "unsaved" highlight, whether the next blur re-sends it, and whether a background refresh is allowed
  // to rebuild the grid. Only the cash side was ever marked clean, so a basis edit stayed dirty for the
  // rest of the session and quietly disabled the refresh.

  /** Reaches the private clean-up the save path calls once the server confirms. */
  function markSaved(rows: unknown[], dirty: unknown[]): unknown[] {
    component.editBidsRows.set(rows as never);
    (component as unknown as { _clearDirtyForSaved(d: unknown[]): void })._clearDirtyForSaved(dirty);
    return component.editBidsRows() as unknown[];
  }

  it('marks a saved basis edit clean, not just a cash one', () => {
    const dirtyRow = {
      ...row('A', 'YC#2026#8', '4.98'),
      basisBids: { 'YC#2026#8': '-40Z' }, originalBasisBids: { 'YC#2026#8': '-30' },
    };

    const [saved] = markSaved([dirtyRow], [
      { name: 'A', commodityCode: 'YC', cropYear: 2026, month: 8, bid: '4.98', basisBid: '-40Z' },
    ]) as Array<{ originalBids: Record<string, string>; originalBasisBids: Record<string, string> }>;

    expect(saved.originalBasisBids['YC#2026#8']).toBe('-40Z');
    expect(saved.originalBids['YC#2026#8']).toBe('4.98');
  });

  it('drops the board symbol from a cell the user has taken over', () => {
    const [saved] = markSaved([row('A', 'YC#2026#8', '9.99')], [
      { name: 'A', commodityCode: 'YC', cropYear: 2026, month: 8, bid: '9.99', basisBid: '' },
    ]) as Array<{ boardChips: Record<string, string> }>;

    // Left in place, it re-attached to the hand-typed number the moment the cell counted as clean.
    expect(saved.boardChips['YC#2026#8']).toBeUndefined();
  });

  // Without this the grid rebuilt from a cache that still held the pre-edit basis, so switching year
  // and coming back showed the old value -- the exact staleness the local cache exists to prevent.
  it('keeps a saved basis in the local cache so a year switch does not revert it', () => {
    seed(location('A', [bid({ basisBid: '-30' })]));

    (component as unknown as { _applyBidsToLocalCache(d: unknown[]): void })._applyBidsToLocalCache([
      { name: 'A', commodityCode: 'YC', cropYear: 2026, month: 8, bid: '4.98', basisBid: '-40Z' },
    ]);

    const cached = component.allMapLocations()[0].bids[0];
    expect(cached.basisBid).toBe('-40Z');
    // Ownership moves with the value, so the row stops reading as fed.
    expect(cached.source).toBe('Manual');
    expect(cached.underlyingFuture).toBeUndefined();
  });
  // ── multiple crop years at once ──────────────────────────────────────────────────────────────
  // The grid used to show one year, stepped with arrows, so entering old crop against new crop meant
  // navigating away and back. Every selected year is editable, which means every cell has to carry its
  // own year through the save.

  it('lays columns out crop then month then year, so the same month is adjacent across years', () => {
    component.crops.set(['YC']);
    component.editBidsYears.set([2026, 2027]);
    component.editBidsMonths.set([9, 12]);

    const keys = component.editGridColumns().map(c => c.key);

    // Sep-26 beside Sep-27 -- year-over-year is the comparison, so the years sit together.
    expect(keys).toEqual(['YC#2026#9', 'YC#2027#9', 'YC#2026#12', 'YC#2027#12']);
    expect(component.editGridColumns().map(c => c.year)).toEqual([2026, 2027, 2026, 2027]);
  });

  it('bands contiguous runs of a year for the header row', () => {
    component.crops.set(['YC']);
    component.editBidsYears.set([2026, 2027]);
    component.editBidsMonths.set([9, 12]);

    // Four columns alternating year => four bands of one, one per column.
    expect(component.editGridYearBands()).toEqual([
      { year: 2026, span: 1 }, { year: 2027, span: 1 },
      { year: 2026, span: 1 }, { year: 2027, span: 1 },
    ]);
    // A single year needs no band row at all.
    component.editBidsYears.set([2026]);
    expect(component.editGridYearBands()).toEqual([]);
  });

  it('saves a cell against its own column year, not the primary one', () => {
    component.crops.set(['YC']);
    component.editBidsYears.set([2026, 2027]);
    component.editBidsMonths.set([9]);
    component.editBidsRows.set([{
      ...row('A', 'YC#2027#9', '5.55'),
      originalBids: { 'YC#2027#9': '' },
    }] as never);

    const dirty = (component as unknown as { _buildDirtyBids(): Array<{ cropYear: number; bid: string }> })._buildDirtyBids();

    expect(dirty).toHaveLength(1);
    expect(dirty[0].cropYear).toBe(2027);
    expect(dirty[0].bid).toBe('5.55');
  });

  // The sharpest edge in the whole change: the clean-up keys off the save payload, and dropping the
  // year from that key marks the OTHER year's twin clean -- clearing its highlight and board symbol,
  // and re-arming the background refresh that is gated on a clean grid, which would then rebuild over
  // an edit the user has not saved.
  it('marking one year clean leaves the other year dirty', () => {
    const both = {
      ...row('A', 'YC#2026#9', '4.98'),
      bids: { 'YC#2026#9': '4.98', 'YC#2027#9': '9.99' },
      originalBids: { 'YC#2026#9': '4.00', 'YC#2027#9': '5.00' },
      boardChips: { 'YC#2026#9': 'ZCU26', 'YC#2027#9': 'ZCU27' },
    };

    const [saved] = markSaved([both], [
      { name: 'A', commodityCode: 'YC', cropYear: 2026, month: 9, bid: '4.98', basisBid: '' },
    ]) as Array<{ originalBids: Record<string, string>; boardChips: Record<string, string> }>;

    expect(saved.originalBids['YC#2026#9']).toBe('4.98');   // saved year went clean
    expect(saved.originalBids['YC#2027#9']).toBe('5.00');   // the other year did NOT
    expect(saved.boardChips['YC#2026#9']).toBeUndefined();
    expect(saved.boardChips['YC#2027#9']).toBe('ZCU27');
  });

  it('collapses the picker label and refuses to exceed the year cap or empty the grid', () => {
    component.editBidsYears.set([2026]);
    expect(component.editBidsYearsLabel()).toBe('2026');
    component.editBidsYears.set([2026, 2027]);
    expect(component.editBidsYearsLabel()).toBe('2 Years');

    component.openYearDropdown();
    component.toggleEditYear(2028);
    expect(component.pendingYears()).toEqual([2026, 2027, 2028]);

    // At the cap, a fourth is refused rather than silently dropping one.
    component.toggleEditYear(2029);
    expect(component.pendingYears()).toEqual([2026, 2027, 2028]);
    expect(component.yearAtLimit(2029)).toBe(true);

    // The last year cannot be removed -- a grid with no years has no columns.
    component.pendingYears.set([2026]);
    component.toggleEditYear(2026);
    expect(component.pendingYears()).toEqual([2026]);
  });

  it('offers the years with bids plus one beyond, so a new crop year can be started', () => {
    component.cropYears.set([2025, 2026]);

    // The extra year beyond the latest is what makes the first 2027 bid enterable here at all.
    expect(component.editBidsYearChoices()).toEqual([2025, 2026, 2027]);
  });
});

/**
 * The map filter bar's crop/year dropdowns used to be sourced from crops()/cropYears() -- the active
 * sheet's own bid data, which is also the Edit Bids grid's column order. That made sense before the
 * map showed the whole BarChart catalog: a brand-new or catalog-browsing sheet has no bids yet, so the
 * dropdowns went empty even though there was plenty on screen to filter. filterableCrops/filterableYears
 * are deliberately a SEPARATE source so fixing the filter can't quietly change what columns the grid
 * saves.
 */
describe('BidSheetComponent — filter dropdown sources', () => {
  let component: BidSheetComponent;

  beforeEach(() => {
    const api = {
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
      getBarchartCoverage: () => of(null),
      searchBarchartLocations: () => of([]),
      getBidSheets: () => of([]),
      getEntitlementsCatalog: () => of({ people: [], tradeUnits: [], groups: [] }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {}, info: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(BidSheetComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    TestBed.inject(AppStateService);
    component = TestBed.createComponent(BidSheetComponent).componentInstance;
  });

  it('offers every planting commodity, not just what the active sheet has priced', () => {
    component.plantingCommodities.set([
      { id: 1, code: 'YC', name: 'Yellow Corn' },
      { id: 2, code: 'HRWW', name: 'Hard Red Winter Wheat' },
      { id: 3, code: 'SOR', name: 'Sorghum' },
    ]);
    // The active sheet has never priced any of these -- crops() (the grid's own column order) is
    // untouched and empty, but the filter must not be.
    expect(component.crops()).toEqual([]);
    expect(component.filterableCrops()).toEqual(['HRWW', 'SOR', 'YC']);
  });

  it('excludes non-crop categories from the filter, same rule the add-commodity search uses', () => {
    component.plantingCommodities.set([
      { id: 1, code: 'YC', name: 'Yellow Corn', category: 'GRAIN' },
      { id: 2, code: 'USD', name: 'US Dollar', category: 'CURRENCY' },
    ]);
    expect(component.filterableCrops()).toEqual(['YC']);
  });

  it('falls back to the full commodity list when the curated planting list has not loaded', () => {
    component.allCommodities.set([{ id: 1, code: 'DNGS', name: 'Distillers Grains' }]);
    expect(component.filterableCrops()).toEqual(['DNGS']);
  });

  // Last year / this year / next year: the old crop still being priced out, the current one, and the
  // new crop being booked forward. Deliberately not a year further out -- that only appears if a bid
  // genuinely exists for it (next test), rather than offering a year with nothing behind it.
  it('offers last year, this year and next year even with no bid data anywhere', () => {
    const now = new Date().getFullYear();
    expect(component.cropYears()).toEqual([]);
    expect(component.filterableYears()).toEqual([now - 1, now, now + 1]);
  });

  it('keeps a real priced year even when it falls outside the default span', () => {
    const now = new Date().getFullYear();
    component.cropYears.set([now + 10]);
    expect(component.filterableYears()).toContain(now + 10);
    expect(component.filterableYears()).toEqual([...component.filterableYears()].sort((a, b) => a - b));
  });
});

/**
 * A catalog (not-yet-added) location can now be the map's comparison reference, not just an added
 * one -- clicking a BarChart pin nobody has added yet should still recolor the rest of the sheet's
 * bids as beating/matching/none, the same as clicking an added pin already does. That fallback
 * (_referenceBid / _hasReference) touches the exact comparison logic this file's own docstring says
 * was audited and fixed once already, so it gets its own direct coverage rather than trusting the
 * map-rendering path (which needs a real Leaflet instance) to exercise it incidentally.
 */
describe('BidSheetComponent — catalog location as comparison reference', () => {
  let component: BidSheetComponent;
  let getBarchartLocationDetail: (key: string) => ReturnType<typeof of>;

  beforeEach(() => {
    getBarchartLocationDetail = (key: string) => of({
      location: {
        locationKey: key, elevator: 'Competitor Co', instrumentCount: 1, commodityCount: 1, placements: [],
      },
      bids: [
        { commodityCode: 'YC', vendorCommodity: 'Corn', cropYear: 2026, month: 8, price: 4.50, symbol: 'ZCU26', isMapped: true, isBasis: false },
      ],
      unmappedBidCount: 0,
    });

    const api = {
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
      getBarchartCoverage: () => of(null),
      searchBarchartLocations: () => of([]),
      getBidSheets: () => of([]),
      getEntitlementsCatalog: () => of({ people: [], tradeUnits: [], groups: [] }),
      getBarchartLocationDetail: (key: string) => getBarchartLocationDetail(key),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {}, info: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(BidSheetComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    TestBed.inject(AppStateService);
    component = TestBed.createComponent(BidSheetComponent).componentInstance;

    // One added location, priced higher than the catalog reference set up below (5.00 vs 4.50), so
    // it should read as "beating" once the reference is in play.
    const loc = location('Elevator A', [bid({ locationId: 1, commodityCode: 'YC', cropYear: 2026, month: 8, bid: '5.00' })]);
    component.allMapLocations.set([loc]);
    component.sheets.set([{
      id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
      createdBy: 'test', createdAt: '2026-08-01T00:00:00Z', shares: [], locations: [loc],
    } as BidSheet]);
    component.activeSheetId.set(1);
    component.selectedCrop.set('YC');
    component.selectedYear.set(2026);
    component.selectedMonth.set(8);
  });

  it('sets the catalog key as reference and clears any added-location reference', () => {
    component.selectedLocationName.set('Some Added Location');

    component.toggleCatalogReference('CATKEY1');

    expect(component.catalogReferenceKey()).toBe('CATKEY1');
    expect(component.selectedLocationName()).toBe('');
  });

  it('toggles the same key off on a second call', () => {
    component.toggleCatalogReference('CATKEY1');
    component.toggleCatalogReference('CATKEY1');

    expect(component.catalogReferenceKey()).toBeNull();
  });

  it('recolors an added location\'s bid against the catalog reference once its detail is cached', () => {
    component.toggleCatalogReference('CATKEY1'); // fetches + caches CATKEY1's detail (mocked above)
    component.filterBids();

    const item = component.filteredBidItems().find(i => i.type === 'entry' && i.name === 'Elevator A');
    expect(item).toBeDefined();
    // 5.00 (Elevator A) > 4.50 (the catalog reference) → beating.
    expect((item as { status?: string })?.status).toBe('beating');
  });

  it('does not compare anything when the catalog reference has no bid for the selected period', () => {
    getBarchartLocationDetail = () => of({
      location: { locationKey: 'CATKEY2', elevator: 'Empty Co', instrumentCount: 0, commodityCount: 0, placements: [] },
      bids: [],
      unmappedBidCount: 0,
    });

    component.toggleCatalogReference('CATKEY2');
    component.filterBids();

    const item = component.filteredBidItems().find(i => i.type === 'entry' && i.name === 'Elevator A');
    expect((item as { status?: string })?.status).toBe('none');
  });

  // Regression coverage for the actual reported bug: cash and basis are separate BarChart instruments
  // with independent quotes, not one price under two labels. A catalog reference's cached detail
  // carries both as distinct rows, so basis-mode comparison must resolve the BASIS row -- not whichever
  // row happens to come back first, which is what made switching the toggle look like it did nothing.
  it('does not fall back to the catalog reference\'s cash bid while comparing in basis mode', () => {
    // Elevator A gets a real basis value so there is something to wrongly match against.
    const loc = location('Elevator A', [bid({ locationId: 1, commodityCode: 'YC', cropYear: 2026, month: 8, bid: '5.00', basisBid: '-20' })]);
    component.allMapLocations.set([loc]);
    component.sheets.update(sheets => sheets.map(s => ({ ...s, locations: [loc] })));
    component.priceMode.set('basis');

    getBarchartLocationDetail = () => of({
      location: { locationKey: 'CATKEY3', elevator: 'Competitor Co', instrumentCount: 1, commodityCount: 1, placements: [] },
      bids: [
        // Only a cash row exists for this reference -- chosen so a broken (type-blind) match would
        // read as -20 > -25 = "beating"; the correct answer is "none", since no basis was published.
        { commodityCode: 'YC', vendorCommodity: 'Corn', cropYear: 2026, month: 8, price: -25, symbol: 'ZCU26.CM', isMapped: true, isBasis: false },
      ],
      unmappedBidCount: 0,
    });

    component.toggleCatalogReference('CATKEY3');
    component.filterBids();

    const item = component.filteredBidItems().find(i => i.type === 'entry' && i.name === 'Elevator A');
    expect((item as { status?: string })?.status).toBe('none');
  });

  it('uses the catalog reference\'s basis bid, not its cash bid, while comparing in basis mode', () => {
    const loc = location('Elevator A', [bid({ locationId: 1, commodityCode: 'YC', cropYear: 2026, month: 8, bid: '5.00', basisBid: '-20' })]);
    component.allMapLocations.set([loc]);
    component.sheets.update(sheets => sheets.map(s => ({ ...s, locations: [loc] })));
    component.priceMode.set('basis');

    getBarchartLocationDetail = () => of({
      location: { locationKey: 'CATKEY4', elevator: 'Competitor Co', instrumentCount: 1, commodityCount: 1, placements: [] },
      bids: [
        // A broken (type-blind) match could pick either row; only the basis one (-30) is correct here.
        { commodityCode: 'YC', vendorCommodity: 'Corn', cropYear: 2026, month: 8, price: 4.50, symbol: 'ZCU26.CM', isMapped: true, isBasis: false },
        { commodityCode: 'YC', vendorCommodity: 'Corn', cropYear: 2026, month: 8, price: -30, symbol: 'ZCU26-80U.CM', isMapped: true, isBasis: true },
      ],
      unmappedBidCount: 0,
    });

    component.toggleCatalogReference('CATKEY4');
    component.filterBids();

    const item = component.filteredBidItems().find(i => i.type === 'entry' && i.name === 'Elevator A');
    // -20 (Elevator A's basis) > -30 (the reference's basis) → beating. Matching the cash row (4.50)
    // instead would give "none" (-20 is neither greater than nor equal to 4.50).
    expect((item as { status?: string })?.status).toBe('beating');
  });
});

/**
 * Regression coverage for "Both does not work": catalog pins hard-coded to a cash-only price lookup
 * regardless of price mode, so "Both" looked identical to "Cash". _loadCatalogLocations now fetches
 * cash and basis separately (they're independent BarChart instruments) and merges them client-side;
 * _catalogPriceLabel is the pure function that turns the merged pair into what the pin actually prints.
 */
describe('BidSheetComponent — catalog pin price label in Both mode', () => {
  let component: BidSheetComponent;

  function catalogLoc(overrides: Partial<BarchartCatalogLocation> = {}): BarchartCatalogLocation {
    return { locationKey: 'CATKEY1', instrumentCount: 1, commodityCount: 1, placements: [], ...overrides };
  }

  beforeEach(() => {
    const api = {
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
      getBarchartCoverage: () => of(null),
      searchBarchartLocations: () => of([]),
      getBidSheets: () => of([]),
      getEntitlementsCatalog: () => of({ people: [], tradeUnits: [], groups: [] }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {}, info: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(BidSheetComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    TestBed.inject(AppStateService);
    component = TestBed.createComponent(BidSheetComponent).componentInstance;
  });

  it('shows only the cash price outside Both mode, even when a basis price is merged in', () => {
    component.priceMode.set('cash');
    const label = (component as unknown as { _catalogPriceLabel(l: BarchartCatalogLocation): string | null })
      ._catalogPriceLabel(catalogLoc({ matchedBidPrice: 4.98, matchedBasisPrice: -30 }));
    expect(label).toBe('4.98');
  });

  it('combines cash and basis into one "cash / basis" label in Both mode', () => {
    component.priceMode.set('both');
    const label = (component as unknown as { _catalogPriceLabel(l: BarchartCatalogLocation): string | null })
      ._catalogPriceLabel(catalogLoc({ matchedBidPrice: 4.98, matchedBasisPrice: -30 }));
    expect(label).toBe('4.98 / -30');
  });

  it('falls back to whichever side is published when Both mode only has one', () => {
    component.priceMode.set('both');
    const label = (component as unknown as { _catalogPriceLabel(l: BarchartCatalogLocation): string | null })
      ._catalogPriceLabel;
    expect(label.call(component, catalogLoc({ matchedBidPrice: 4.98 }))).toBe('4.98');
    expect(label.call(component, catalogLoc({ matchedBasisPrice: -30 }))).toBe('-30');
  });

  it('returns null when neither price is published, regardless of mode', () => {
    component.priceMode.set('both');
    const label = (component as unknown as { _catalogPriceLabel(l: BarchartCatalogLocation): string | null })
      ._catalogPriceLabel(catalogLoc());
    expect(label).toBeNull();
  });
});

/**
 * Regression coverage for the panning/loading-performance ask: catalog fetches were a flat take: 5000
 * at every zoom level, so a zoomed-out view forced thousands of un-clustered DOM markers to draw on
 * every pan. _catalogTakeFor scales the request size down as the view widens.
 */
describe('BidSheetComponent — catalog fetch size scales with map radius', () => {
  let takeFor: (radiusMiles: number) => number;

  beforeEach(() => {
    takeFor = (BidSheetComponent as unknown as { _catalogTakeFor(r: number): number })._catalogTakeFor;
  });

  it('caps a wide, zoomed-out view at 500', () => {
    expect(takeFor(500)).toBe(500);
    expect(takeFor(300)).toBe(500);
  });

  it('caps a mid-range view at 1500', () => {
    expect(takeFor(299)).toBe(1500);
    expect(takeFor(100)).toBe(1500);
  });

  it('keeps the full 5000 for a close-in view', () => {
    expect(takeFor(99)).toBe(5000);
    expect(takeFor(10)).toBe(5000);
  });
});

/**
 * The "+ Add" entry point. Building a sheet used to mean creating an empty one and then hunting for
 * "Add Location"; now one menu offers "build a sheet" (pick a batch off the map, name it last) beside
 * the manual single-location add. The ordering is the point: naming is asked for AFTER the locations
 * are picked, and the sheet itself isn't created until the batch is confirmed -- so the flow has to
 * work with no sheet open at all, which is exactly what the old guard rejected.
 */
describe('BidSheetComponent — the "+ Add" menu and building a sheet from a batch', () => {
  let component: BidSheetComponent;
  let createBidSheet: ReturnType<typeof vi.fn>;
  let addBidSheetLocation: ReturnType<typeof vi.fn>;

  const NEW_SHEET: BidSheet = {
    id: 7, name: 'West Desk', ownerUserId: 'test', isOwner: true,
    createdBy: 'test', createdAt: '2026-09-03T00:00:00Z', shares: [], locations: [],
  } as BidSheet;

  /** One ticked catalog listing that already exists company-wide, so adding it is a link, not a create. */
  const BATCH = { locations: [{ locationKey: 'CATKEY1', name: 'Competitor Co — Ames', isScoularFacility: false, existingLocationId: 42 }] };

  beforeEach(() => {
    createBidSheet = vi.fn(() => of(NEW_SHEET));
    addBidSheetLocation = vi.fn((sheetId: number, locationId: number) => of({
      ...NEW_SHEET,
      id: sheetId,
      locations: [location('Competitor Co — Ames', [bid({ locationId })])],
    } as BidSheet));

    const api = {
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
      getBarchartCoverage: () => of(null),
      searchBarchartLocations: () => of([]),
      getBidSheets: () => of([]),
      getBidSheet: () => of(NEW_SHEET),
      getEntitlementsCatalog: () => of({ people: [], tradeUnits: [], groups: [] }),
      createBidSheet: (name: string) => createBidSheet(name),
      addBidSheetLocation: (sheetId: number, locationId: number) => addBidSheetLocation(sheetId, locationId),
      createBidSheetLocation: () => of(location('Manual', [])),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {}, info: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(BidSheetComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    TestBed.inject(AppStateService);
    component = TestBed.createComponent(BidSheetComponent).componentInstance;
  });

  it('opens the picker in new-sheet mode with no sheet open, rather than demanding one first', () => {
    expect(component.sheets()).toEqual([]);

    component.chooseBuildSheet();

    expect(component.barchartMode()).toBe(true);
    expect(component.barchartSheetMode()).toBe('new');
    expect(component.showCreateSheet()).toBe(false); // nothing named yet -- that comes after picking
  });

  it('asks for a name when a batch is confirmed without one, holding the batch rather than dropping it', () => {
    component.chooseBuildSheet();

    component.onBarchartAddMany(BATCH);

    expect(component.showCreateSheet()).toBe(true);
    expect(component.namingSheetForBatch()).toBe(true);
    expect(createBidSheet).not.toHaveBeenCalled();
  });

  it('creates the sheet from the name typed in the picker and adds the batch to it', () => {
    component.chooseBuildSheet();
    component.newSheetName.set('West Desk');

    component.onBarchartAddMany(BATCH);

    expect(createBidSheet).toHaveBeenCalledWith('West Desk');
    expect(addBidSheetLocation).toHaveBeenCalledWith(NEW_SHEET.id, 42);
    expect(component.activeSheetId()).toBe(NEW_SHEET.id);
    // The sheet exists now, so anything added next belongs to it rather than starting another one.
    expect(component.barchartSheetMode()).toBe('existing');
  });

  it('creates the sheet and adds the parked batch when the name comes from the dialog instead', () => {
    component.chooseBuildSheet();
    component.onBarchartAddMany(BATCH); // no name yet -> parked

    component.newSheetName.set('West Desk');
    component.confirmCreateSheet();

    expect(createBidSheet).toHaveBeenCalledWith('West Desk');
    expect(addBidSheetLocation).toHaveBeenCalledWith(NEW_SHEET.id, 42);
    expect(component.showCreateSheet()).toBe(false);
  });

  it('cancelling the name drops the parked batch but leaves the picker open to re-pick', () => {
    component.chooseBuildSheet();
    component.onBarchartAddMany(BATCH);

    component.cancelCreateSheet();

    expect(component.namingSheetForBatch()).toBe(false);
    expect(component.showCreateSheet()).toBe(false);
    expect(component.barchartMode()).toBe(true);
    expect(createBidSheet).not.toHaveBeenCalled();
  });

  it('still asks for a destination before a manual add, which has no sheet to create one from', () => {
    component.chooseManualAdd();

    expect(component.addLocationMode()).toBe(false);
    expect(component.showCreateSheet()).toBe(true); // no sheets exist -> name one first
    expect(component.namingSheetForBatch()).toBe(false);
  });
});

/**
 * Map scope. The panel has always shown only the open sheet's locations while the map drew every
 * added location company-wide -- so picking a sheet to compare a set of elevators got you a map
 * answering with bids from elevators that weren't in it. The map now follows the sheet by default,
 * with "All" as the explicit way back to browsing everything.
 */
describe('BidSheetComponent — map scope follows the open sheet', () => {
  let component: BidSheetComponent;

  const onSheet = location('On The Sheet', [bid({ locationId: 1 })]);
  const elsewhere = location('Someone Else\'s', [bid({ locationId: 2 })]);

  beforeEach(() => {
    const api = {
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
      getBarchartCoverage: () => of(null),
      searchBarchartLocations: () => of([]),
      getBidSheets: () => of([]),
      getEntitlementsCatalog: () => of({ people: [], tradeUnits: [], groups: [] }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {}, info: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(BidSheetComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    TestBed.inject(AppStateService);
    component = TestBed.createComponent(BidSheetComponent).componentInstance;

    // Two added locations company-wide; only one of them is on the open sheet.
    component.allMapLocations.set([onSheet, elsewhere]);
    component.sheets.set([{
      id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
      createdBy: 'test', createdAt: '2026-08-01T00:00:00Z', shares: [], locations: [onSheet],
    } as BidSheet]);
  });

  it('draws only the open sheet\'s locations by default', () => {
    component.activeSheetId.set(1);

    expect(component.mapScope()).toBe('sheet');
    expect(component.mapLocations().map(l => l.name)).toEqual(['On The Sheet']);
  });

  it('draws every added location once scope is switched to All', () => {
    component.activeSheetId.set(1);

    component.setMapScope('all');

    expect(component.mapLocations().map(l => l.name)).toEqual(['On The Sheet', "Someone Else's"]);
  });

  // Guards the trap that made "All locations" a no-op: map pins are pruned to whatever the panel's
  // filters left, but the panel only ever lists the SHEET's locations -- so an off-sheet pin, which by
  // construction has no panel row, was pruned every time and All rendered exactly what Sheet did.
  it('exempts off-sheet locations from the panel-parity prune, which never lists them', () => {
    const component_ = component as unknown as {
      _passesPanelPrune(n: string[], p: ReadonlySet<string>, s: ReadonlySet<string>): boolean;
    };
    const panelNames = new Set(['On The Sheet']);
    const sheetNames = new Set(['On The Sheet']);

    expect(component_._passesPanelPrune(["Someone Else's"], panelNames, sheetNames)).toBe(true);
    // On-sheet locations still answer to the panel, so a status filter narrows map and panel together.
    expect(component_._passesPanelPrune(['On The Sheet'], panelNames, sheetNames)).toBe(true);
    expect(component_._passesPanelPrune(['On The Sheet'], new Set<string>(), sheetNames)).toBe(false);
  });

  it('drives the toolbar dropdown from the scope, so "All locations" shows as selected', () => {
    component.activeSheetId.set(1);
    expect(component.sheetDropdownValue()).toBe('1');

    component.onSheetDropdownChange('all');

    expect(component.mapScope()).toBe('all');
    expect(component.sheetDropdownValue()).toBe('all');
    // The sheet stays open underneath -- the panel, the grid and Add all still need a destination.
    expect(component.activeSheetId()).toBe(1);
  });

  it('picking a sheet from the dropdown narrows back to it', () => {
    component.activeSheetId.set(1);
    component.onSheetDropdownChange('all');

    component.onSheetDropdownChange('1');

    expect(component.mapScope()).toBe('sheet');
    expect(component.mapLocations().map(l => l.name)).toEqual(['On The Sheet']);
  });

  it('falls back to everything when no sheet is open, since there is nothing to narrow to', () => {
    component.activeSheetId.set(null);

    expect(component.mapScope()).toBe('sheet'); // the setting stands…
    expect(component.mapLocations()).toHaveLength(2); // …but has nothing to apply to
  });
});

/**
 * Progressive disclosure on the map. The board symbol roughly doubles a pill's width, and once catalog
 * pins started carrying it a regional view became a wall of overlapping boxes. Labels now arrive in
 * stages as you zoom in — and both layers have to change at the SAME zoom in "All locations", or the
 * sheet's own pins look stuck on while every catalog pin around them is still a dot.
 */
describe('BidSheetComponent — map labels appear in stages as you zoom in', () => {
  let component: BidSheetComponent;

  function catalogLoc(overrides: Partial<BarchartCatalogLocation> = {}): BarchartCatalogLocation {
    return { locationKey: 'CATKEY1', instrumentCount: 1, commodityCount: 1, placements: [], ...overrides };
  }

  beforeEach(() => {
    const api = {
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
      getBarchartCoverage: () => of(null),
      searchBarchartLocations: () => of([]),
      getBidSheets: () => of([]),
      getEntitlementsCatalog: () => of({ people: [], tradeUnits: [], groups: [] }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {}, info: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(BidSheetComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    TestBed.inject(AppStateService);
    component = TestBed.createComponent(BidSheetComponent).componentInstance;
  });

  function priceLabel(loc: BarchartCatalogLocation, includeBoard?: boolean): string | null {
    return (component as unknown as {
      _catalogPriceLabel(l: BarchartCatalogLocation, b?: boolean): string | null;
    })._catalogPriceLabel(loc, includeBoard);
  }

  it('drops the board from a catalog pill when zoomed too far out for it', () => {
    const loc = catalogLoc({ matchedBidPrice: 4.98, matchedBidBoard: 'ZCU26' });

    expect(priceLabel(loc, true)).toBe('4.98 (ZCU26)');
    expect(priceLabel(loc, false)).toBe('4.98');
  });

  it('keeps the board out of a Both-mode pill too, without losing either price', () => {
    component.priceMode.set('both');
    const loc = catalogLoc({ matchedBidPrice: 4.98, matchedBasisPrice: -30, matchedBidBoard: 'ZCU26' });

    expect(priceLabel(loc, true)).toBe('4.98 / -30 (ZCU26)');
    expect(priceLabel(loc, false)).toBe('4.98 / -30');
  });

  it('defaults to naming the board, so hover and the panel are unaffected by the map gates', () => {
    expect(priceLabel(catalogLoc({ matchedBidPrice: 4.98, matchedBidBoard: 'ZCU26' }))).toBe('4.98 (ZCU26)');
  });
});

/**
 * Narrowing back to a sheet takes the catalog layer off the map, so anything anchored to it has to go
 * too. A catalog listing left as the comparison reference is the harmful one: every sheet pin would go
 * on colouring itself against a location the user can no longer see.
 */
describe('BidSheetComponent — narrowing scope clears catalog-anchored state', () => {
  let component: BidSheetComponent;

  beforeEach(() => {
    const api = {
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
      getBarchartCoverage: () => of(null),
      searchBarchartLocations: () => of([]),
      getBidSheets: () => of([]),
      getEntitlementsCatalog: () => of({ people: [], tradeUnits: [], groups: [] }),
      getBarchartLocationDetail: (key: string) => of({
        location: { locationKey: key, instrumentCount: 0, commodityCount: 0, placements: [] },
        bids: [], unmappedBidCount: 0,
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {}, info: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(BidSheetComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    TestBed.inject(AppStateService);
    component = TestBed.createComponent(BidSheetComponent).componentInstance;

    const loc = location('On The Sheet', [bid({ locationId: 1 })]);
    component.allMapLocations.set([loc]);
    component.sheets.set([{
      id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
      createdBy: 'test', createdAt: '2026-08-01T00:00:00Z', shares: [], locations: [loc],
    } as BidSheet]);
    component.activeSheetId.set(1);
    component.setMapScope('all');
  });

  it('drops a catalog reference when the catalog layer goes away', () => {
    component.toggleCatalogReference('CATKEY1');
    expect(component.catalogReferenceKey()).toBe('CATKEY1');

    component.setMapScope('sheet');

    expect(component.catalogReferenceKey()).toBeNull();
  });

  it('closes an open catalog detail popup on the way back to sheet scope', () => {
    component.openCatalogDetail('CATKEY1');
    expect(component.catalogDetailKey()).toBe('CATKEY1');

    component.setMapScope('sheet');

    expect(component.catalogDetailKey()).toBeNull();
    expect(component.catalogDetail()).toBeNull();
  });
});

/**
 * Pin parity in "All locations". An added location has no business looking different from a catalog
 * one just because somebody added it — the map is showing everything, and a pin that stands out should
 * stand out for a reason the user chose (reference, Scoular, a status). The catalog draws dots lighter
 * than pills, so matching has to be per shape: borrowing the pill colour for a dot is what made one
 * pin visibly darker than the thousands around it.
 */
describe('BidSheetComponent — added pins match catalog pins in All scope', () => {
  let component: BidSheetComponent;

  beforeEach(() => {
    const api = {
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
      getBarchartCoverage: () => of(null),
      searchBarchartLocations: () => of([]),
      getBidSheets: () => of([]),
      getEntitlementsCatalog: () => of({ people: [], tradeUnits: [], groups: [] }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {}, info: () => {} } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: UsageTrackingService, useValue: { postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(BidSheetComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    TestBed.inject(AppStateService);
    component = TestBed.createComponent(BidSheetComponent).componentInstance;

    const loc = location('On The Sheet', [bid({ locationId: 1 })]);
    component.allMapLocations.set([loc]);
    component.sheets.set([{
      id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
      createdBy: 'test', createdAt: '2026-08-01T00:00:00Z', shares: [], locations: [loc],
    } as BidSheet]);
    component.activeSheetId.set(1);
  });

  function neutral(shape?: 'pill' | 'dot'): { bg: string; border: string } {
    return (component as unknown as {
      _neutralPinColors(s?: 'pill' | 'dot'): { bg: string; border: string };
    })._neutralPinColors(shape);
  }

  it('uses the catalog DOT colours for an added dot, not the darker pill colours', () => {
    component.setMapScope('all');

    // #93c5fd/#60a5fa are the catalog dot pair; #60a5fa/#3b82f6 is the pill pair one step darker.
    expect(neutral('dot')).toEqual({ bg: '#93c5fd', border: '#60a5fa' });
    expect(neutral('pill')).toEqual({ bg: '#60a5fa', border: '#3b82f6' });
  });

  it('keeps the sheet view grey for both shapes, where there is no catalog to match', () => {
    expect(component.mapScope()).toBe('sheet');

    expect(neutral('dot')).toEqual({ bg: '#9ca3af', border: '#6b7280' });
    expect(neutral('pill')).toEqual({ bg: '#9ca3af', border: '#6b7280' });
  });
});
