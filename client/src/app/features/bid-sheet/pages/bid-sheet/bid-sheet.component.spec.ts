import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject, of } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { BarchartCatalogBid, BarchartCatalogLocation, BarchartCatalogLocationDetail, BidSheet, BidSheetLocation, BidSheetLocationBid } from '@models';

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
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
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

  // ── what a printed cell says ─────────────────────────────────────────────────────────────────

  /** A grid row as _buildEditGrid produces it, with the cell clean (current === original). */
  function row(name: string, key: string, value: string, board = 'ZCU26') {
    return {
      name, type: 'entry' as const,
      bids: { [key]: value }, originalBids: { [key]: value },
      basisBids: {}, originalBasisBids: {},
      coverageChips: {}, boardChips: { [key]: board },
      isBarchartLinked: true,
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

  // The map's crop filter answers to what the map is SHOWING. On a sheet it must offer only what that
  // sheet has priced -- a commodity nobody on it quotes can only produce an empty panel with no
  // visible cause. In "All locations" it has to offer everything, because the catalog layer draws
  // elevators nobody has added and narrowing those by commodity is the point of the filter there.
  it('offers only the open sheet\'s commodities, and every commodity in All locations', () => {
    component.plantingCommodities.set([
      { id: 1, code: 'YC', name: 'Yellow Corn' },
      { id: 2, code: 'HRWW', name: 'Hard Red Winter Wheat' },
      { id: 3, code: 'SOR', name: 'Sorghum' },
    ]);
    // What this sheet actually has priced.
    component.crops.set(['YC']);
    component.sheets.set([{
      id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
      createdBy: 'test', createdAt: '2026-08-01T00:00:00Z', shares: [], locations: [],
    } as BidSheet]);
    component.activeSheetId.set(1);

    expect(component.mapCropChoices()).toEqual(['YC']);

    component.setMapScope('all');

    expect(component.mapCropChoices()).toEqual(['HRWW', 'SOR', 'YC']);
  });

  // With no sheet open there is nothing to narrow to, so the wider list is the only sensible answer --
  // the same fallback showingAllLocations() makes everywhere else.
  it('offers every commodity when no sheet is open at all', () => {
    component.plantingCommodities.set([{ id: 1, code: 'YC', name: 'Yellow Corn' }]);
    component.crops.set([]);
    component.activeSheetId.set(null);

    expect(component.mapCropChoices()).toEqual(['YC']);
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
 * The Cash/Basis/Both choice is saved per user and restored on load. Both was saved correctly and then
 * restored as cash, because the guard only recognised 'basis' and sent everything else to the
 * fallback -- so a sheet set to Both came back cash on every visit, and printed, exported and coloured
 * its pins as cash. Dev had a user in exactly that state.
 */
describe('BidSheetComponent — the saved price mode survives a reload', () => {
  let component: BidSheetComponent;
  let savedMode: string | null;

  /** Re-reads the preference with whatever savedMode currently holds. */
  function reload(saved: string | null): BidSheetComponent {
    savedMode = saved;
    (component as unknown as { _loadPreference(): void })._loadPreference();
    return component;
  }

  beforeEach(() => {
    savedMode = null;
    const api = {
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(savedMode === null ? null : { priceMode: savedMode }),
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

  it('restores Both rather than quietly downgrading it to cash', () => {
    expect(reload('both').priceMode()).toBe('both');
  });

  it('restores basis and cash', () => {
    expect(reload('basis').priceMode()).toBe('basis');
    expect(reload('cash').priceMode()).toBe('cash');
  });

  it('falls back to cash for a missing or unrecognised value', () => {
    expect(reload(null).priceMode()).toBe('cash');
    expect(reload('').priceMode()).toBe('cash');
    expect(reload('futures').priceMode()).toBe('cash');
  });

  it('names the mode on the printed sheet, so a basis sheet cannot read as a cash one', () => {
    reload('cash');
    expect(component.printPriceModeCaption()).toBe('Cash bids');
    component.priceMode.set('basis');
    expect(component.printPriceModeCaption()).toBe('Basis bids');
    expect(component.priceModeLabel()).toBe('Basis');
    component.priceMode.set('both');
    expect(component.printPriceModeCaption()).toBe('Cash and basis bids');
    expect(component.priceModeLabel()).toBe('Cash / Basis');
  });
});

/**
 * The catalog popup lists every bid a listing publishes, across future months. The vendor sends cash
 * and basis as separate instruments, so the same crop and month arrives as two rows told apart only by
 * isBasis -- which the popup printed as duplicate crops under a column headed "Price", ignoring the
 * Cash/Basis/Both toggle entirely.
 */
describe('BidSheetComponent — the catalog popup answers the price toggle', () => {
  let component: BidSheetComponent;

  const bid = (over: Partial<BarchartCatalogBid> = {}): BarchartCatalogBid => ({
    vendorCommodity: 'Corn', commodityCode: 'YC', cropYear: 2026, month: 9,
    symbol: 'ZCPU26-1-1.CM', isMapped: true, isBasis: false, ...over,
  });

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
    component.catalogDetail.set({
      location: { locationKey: 'K1', instrumentCount: 2, commodityCount: 1, placements: [] },
      bids: [bid({ price: 4.98 }), bid({ price: -30, isBasis: true, symbol: 'ZCBU26-1-1.CM' })],
      unmappedBidCount: 0,
    });
  });

  it('pairs the vendor cash and basis rows into one row per crop and period', () => {
    component.priceMode.set('both');
    const rows = component.catalogDetailRows();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ crop: 'YC', cropYear: 2026, month: 9, cash: 4.98, basis: -30 });
  });

  it('shows only the selected price in a single-price mode', () => {
    component.priceMode.set('cash');
    expect(component.catalogDetailRows()[0].cash).toBe(4.98);
    component.priceMode.set('basis');
    expect(component.catalogDetailRows()[0].basis).toBe(-30);
  });

  it('drops a period the elevator does not quote in the selected mode', () => {
    component.catalogDetail.set({
      location: { locationKey: 'K1', instrumentCount: 1, commodityCount: 1, placements: [] },
      bids: [bid({ price: 4.98 })],
      unmappedBidCount: 0,
    });
    component.priceMode.set('basis');
    expect(component.catalogDetailRows()).toEqual([]);
    component.priceMode.set('cash');
    expect(component.catalogDetailRows().length).toBe(1);
  });

  it('keeps a half-quoted period in Both mode rather than hiding a real bid', () => {
    component.catalogDetail.set({
      location: { locationKey: 'K1', instrumentCount: 1, commodityCount: 1, placements: [] },
      bids: [bid({ price: -30, isBasis: true })],
      unmappedBidCount: 0,
    });
    component.priceMode.set('both');
    const rows = component.catalogDetailRows();
    expect(rows.length).toBe(1);
    expect(rows[0].cash).toBeNull();
    expect(rows[0].basis).toBe(-30);
  });

  it('narrows to the crop the dropdown has chosen, and shows the whole book on All Crops', () => {
    component.catalogDetail.set({
      location: { locationKey: 'K1', instrumentCount: 4, commodityCount: 2, placements: [] },
      bids: [
        bid({ price: 4.98 }), bid({ price: -30, isBasis: true }),
        bid({ price: 11.2, commodityCode: 'YSB' }), bid({ price: -45, commodityCode: 'YSB', isBasis: true }),
      ],
      unmappedBidCount: 0,
    });
    component.priceMode.set('both');

    component.selectedCrop.set('');
    expect(component.catalogDetailRows().length).toBe(2);

    component.selectedCrop.set('YSB');
    const rows = component.catalogDetailRows();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ crop: 'YSB', cash: 11.2, basis: -45 });
  });

  // An unmapped vendor commodity has no code to match, and cannot reach the sheet either.
  it('drops an unmapped commodity once a crop is chosen, but keeps it on All Crops', () => {
    component.catalogDetail.set({
      location: { locationKey: 'K1', instrumentCount: 2, commodityCount: 2, placements: [] },
      bids: [bid({ price: 4.98 }), bid({ price: 9.1, commodityCode: undefined, vendorCommodity: 'Rye', isMapped: false })],
      unmappedBidCount: 1,
    });
    component.priceMode.set('cash');

    component.selectedCrop.set('');
    expect(component.catalogDetailRows().length).toBe(2);

    component.selectedCrop.set('YC');
    expect(component.catalogDetailRows().map(r => r.crop)).toEqual(['YC']);
  });

  it('says why the table is empty — quiet elevator, wrong crop, or wrong price type', () => {
    component.selectedCrop.set('');
    component.priceMode.set('cash');
    component.catalogDetail.set({
      location: { locationKey: 'K1', instrumentCount: 0, commodityCount: 0, placements: [] },
      bids: [], unmappedBidCount: 0,
    });
    expect(component.catalogDetailEmptyMessage()).toBe('No active bids published right now.');

    component.catalogDetail.set({
      location: { locationKey: 'K1', instrumentCount: 1, commodityCount: 1, placements: [] },
      bids: [bid({ price: -30, isBasis: true })], unmappedBidCount: 0,
    });
    expect(component.catalogDetailEmptyMessage()).toBe('No cash bids published right now.');

    component.selectedCrop.set('YSB');
    expect(component.catalogDetailEmptyMessage()).toBe('No YSB cash bids published right now.');

    component.priceMode.set('both');
    expect(component.catalogDetailEmptyMessage()).toBe('No YSB cash or basis bids published right now.');
  });

  it('knows when the listing is already on the open sheet, so Add is not offered twice', () => {
    component.allMapLocations.set([]);
    expect(component.catalogDetailOnActiveSheet()).toBe(false);

    const loc: BidSheetLocation = {
      id: 7, name: 'Already Added', barchartLocationKey: 'K1', bids: [],
    } as unknown as BidSheetLocation;
    const sheet: BidSheet = {
      id: 1, name: 'S', ownerUserId: 'u', isOwner: true, shares: [], locations: [loc],
    } as unknown as BidSheet;
    component.sheets.set([sheet]);
    component.activeSheetId.set(1);

    expect(component.catalogDetailOnActiveSheet()).toBe(true);
  });

  it('keeps separate crops and separate months apart', () => {
    component.catalogDetail.set({
      location: { locationKey: 'K1', instrumentCount: 3, commodityCount: 2, placements: [] },
      bids: [bid({ price: 4.98 }), bid({ price: 5.06, month: 10 }), bid({ price: 11.2, commodityCode: 'YSB' })],
      unmappedBidCount: 0,
    });
    component.priceMode.set('cash');
    expect(component.catalogDetailRows().length).toBe(3);
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

  // A manually pin-dropped location has to land ON the open sheet, not just in the company-wide list --
  // otherwise the person who added it sees nothing appear, and nobody sharing the sheet ever sees it.
  it('links a manually added location to the open sheet, so everyone sharing it sees the location', () => {
    component.sheets.set([NEW_SHEET]);
    component.activeSheetId.set(NEW_SHEET.id);
    component.newLocationName.set('Back Forty Bin');
    component.newLocationLat.set(41.5);
    component.newLocationLng.set(-93.6);

    component.confirmAddLocation();

    // location() gives the created row id 1, since its first bid has no locationId override.
    expect(addBidSheetLocation).toHaveBeenCalledWith(NEW_SHEET.id, 1);
  });

  // The guard that makes the above possible: with no sheet there is nowhere for the location to go, so
  // it must refuse rather than create an orphan row nobody can see.
  it('refuses a manual add when no sheet is open, instead of creating an orphan', () => {
    component.activeSheetId.set(null);
    component.newLocationName.set('Back Forty Bin');
    component.newLocationLat.set(41.5);
    component.newLocationLng.set(-93.6);

    component.confirmAddLocation();

    expect(addBidSheetLocation).not.toHaveBeenCalled();
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
    expect(component.scopedLocations().map(l => l.name)).toEqual(['On The Sheet']);
  });

  it('draws every added location once scope is switched to All', () => {
    component.activeSheetId.set(1);

    component.setMapScope('all');

    expect(component.scopedLocations().map(l => l.name)).toEqual(['On The Sheet', "Someone Else's"]);
  });

  // The scope switch has to reach the DATA the map prices from, not just which pins get drawn.
  // bidEntries feeds the lookup behind every pin's price, hover and status colour -- so when it stayed
  // on the sheet, "All locations" drew other people's locations as bidless dots. The panel and grid
  // also read it, but they're hidden in All scope, so this only ever shows on the map.
  it('prices every added location\'s pins in All scope, only the sheet\'s otherwise', () => {
    component.activeSheetId.set(1);

    expect(component.bidEntries().map(e => e.name)).toEqual(['On The Sheet']);

    component.setMapScope('all');

    expect(component.bidEntries().map(e => e.name).sort()).toEqual(['On The Sheet', "Someone Else's"]);
  });

  // The grid is the SHEET's. If it could open in All scope it would build rows from everyone's
  // locations with no sheet to own their order -- so opening it narrows the map back first, whatever
  // path got there (the panel's Edit button is hidden in All scope, but add-location flows also open it).
  it('narrows back to the sheet before opening the Edit Bids grid', () => {
    component.activeSheetId.set(1);
    component.setMapScope('all');
    expect(component.mapScope()).toBe('all');

    component.openEditBids();

    expect(component.mapScope()).toBe('sheet');
    expect(component.bidEntries().map(e => e.name)).toEqual(['On The Sheet']);
  });

  // Nothing is "open in the panel" when the panel shows nothing -- otherwise the pin for whatever WAS
  // open stays drawn in its expanded, hover-style form among the dots.
  it('clears the panel selection when widening to All locations', () => {
    component.activeSheetId.set(1);
    component.panelSelectedLocation.set('On The Sheet');

    component.setMapScope('all');

    expect(component.panelSelectedLocation()).toBe('');
  });

  // The panel's own sheet menu calls selectSheet directly. In All scope the sheet is usually still
  // active underneath, so a version that checked "same id -> return" BEFORE narrowing did nothing at
  // all: the panel kept saying "Showing all locations" and the user had to reach for the map dropdown.
  it('narrows back to the sheet when the already-active sheet is re-picked from the panel menu', () => {
    component.activeSheetId.set(1);
    component.setMapScope('all');
    expect(component.mapScope()).toBe('all');

    component.selectSheet(1); // same sheet -- the only thing that should change is the scope

    expect(component.mapScope()).toBe('sheet');
    expect(component.activeSheetId()).toBe(1);
    expect(component.scopedLocations().map(l => l.name)).toEqual(['On The Sheet']);
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
    expect(component.scopedLocations().map(l => l.name)).toEqual(['On The Sheet']);
  });

  it('falls back to everything when no sheet is open, since there is nothing to narrow to', () => {
    component.activeSheetId.set(null);

    expect(component.mapScope()).toBe('sheet'); // the setting stands…
    expect(component.scopedLocations()).toHaveLength(2); // …but has nothing to apply to
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

    expect(neutral('dot')).toEqual({ bg: '#6b7280', border: '#4b5563' });
    expect(neutral('pill')).toEqual({ bg: '#6b7280', border: '#4b5563' });
  });
});

/**
 * "Which of these moved today?" — the map badge. Reads three timestamps rather than just the feed's,
 * because a MANUAL bid has no quoteAsOf at all: it has to be caught by modifiedAt (an edit) or
 * createdAt (first entry), or a hand-typed location would never flag while the elevator beside it did.
 */
describe('BidSheetComponent — bid moved in the last 24 hours', () => {
  let component: BidSheetComponent;

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

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

  /** Seeds one location whose single bid carries the given timestamps. */
  function seedBid(overrides: Partial<BidSheetLocationBid>): void {
    const loc = location('Elevator A', [bid({ locationId: 1, ...overrides })]);
    component.allMapLocations.set([loc]);
    component.sheets.set([{
      id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
      createdBy: 'test', createdAt: '2026-08-01T00:00:00Z', shares: [], locations: [loc],
    } as BidSheet]);
    component.activeSheetId.set(1);
  }

  function moved(): boolean {
    return (component as unknown as {
      _locationChangedWithin24h(n: string, y: number | null, c: string, m: number): boolean;
    })._locationChangedWithin24h('Elevator A', 2026, 'YC', 8);
  }

  // A fed cell is judged by basisChangedAt, which the bridge sets only when the value really differs.
  // quoteAsOf is the vendor's re-post stamp: it refreshed on 410 of 431 Dev cells while only 64 basis
  // values had moved, so reading it lit up nearly every pin every day.
  it('flags a fed bid whose basis changed within 24h, and not one that only got re-posted', () => {
    seedBid({ source: 'Barchart', basisChangedAt: hoursAgo(2), quoteAsOf: hoursAgo(2), createdAt: '2026-08-01T00:00:00Z' });
    expect(moved()).toBe(true);

    // Re-posted an hour ago, unchanged for three days.
    seedBid({ source: 'Barchart', basisChangedAt: hoursAgo(72), quoteAsOf: hoursAgo(1), createdAt: '2026-08-01T00:00:00Z' });
    expect(moved()).toBe(false);
  });

  // A brand-new fed cell has no basisChangedAt at all -- nothing to have moved from.
  it('does not flag a fed cell that has never changed', () => {
    seedBid({ source: 'Barchart', basisChangedAt: undefined, quoteAsOf: hoursAgo(1), createdAt: hoursAgo(1) });
    expect(moved()).toBe(false);
  });

  // The case the feed timestamp alone would miss entirely.
  it('flags a MANUAL bid edited within 24h, which carries no quoteAsOf at all', () => {
    seedBid({ source: 'Manual', quoteAsOf: undefined, modifiedAt: hoursAgo(3), createdAt: '2026-08-01T00:00:00Z' });
    expect(moved()).toBe(true);
  });

  it('flags a manual bid entered for the first time within 24h', () => {
    seedBid({ source: 'Manual', quoteAsOf: undefined, modifiedAt: undefined, createdAt: hoursAgo(1) });
    expect(moved()).toBe(true);
  });

  // modifiedAt is the live value once a cell has been edited, so an old edit must not be rescued by a
  // recent createdAt -- that would flag every row on a freshly imported sheet forever.
  it('prefers modifiedAt over createdAt, so an old edit does not read as fresh', () => {
    seedBid({ source: 'Manual', quoteAsOf: undefined, modifiedAt: hoursAgo(100), createdAt: hoursAgo(1) });
    expect(moved()).toBe(false);
  });

  // Basis is the elevator's own decision, so a basis move flags even while the cash side sits still.
  it('flags a basis move on a cell whose cash has not moved in months', () => {
    seedBid({ source: 'Barchart', quoteAsOf: hoursAgo(90 * 24), basisChangedAt: hoursAgo(4), createdAt: '2026-08-01T00:00:00Z' });
    expect(moved()).toBe(true);
  });

  it('says no when there is no crop or period to judge a cell by', () => {
    seedBid({ source: 'Barchart', quoteAsOf: hoursAgo(1), createdAt: '2026-08-01T00:00:00Z' });
    const check = (component as unknown as {
      _locationChangedWithin24h(n: string, y: number | null, c: string, m: number): boolean;
    })._locationChangedWithin24h;
    expect(check.call(component, 'Elevator A', 2026, '', 8)).toBe(false);
    expect(check.call(component, 'Elevator A', null, 'YC', 8)).toBe(false);
  });
});

/**
 * Sharing a sheet with a person, a desk, a trade-unit group, or a Daily Recap group. The picker is
 * tabbed like Manage Groups because a bare name means something different in each list.
 *
 * The recap-group rule the user asked for — "only if that user is inside that group" — is enforced by
 * the SERVER: getRecapGroups() already returns only groups the caller created or belongs to. So these
 * tests pin that the client shows exactly what that endpoint gave it and invents nothing.
 */
describe('BidSheetComponent — sharing with people, desks and groups', () => {
  let component: BidSheetComponent;

  const SHEET: BidSheet = {
    id: 1, name: 'West Desk', ownerUserId: 'CEgr', isOwner: true,
    createdBy: 'CEgr', createdAt: '2026-09-01T00:00:00Z', shares: [], locations: [],
  } as BidSheet;

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
      getEntitlementsCatalog: () => of({
        people: [
          { userId: 'JDoe', displayName: 'Jane Doe', email: 'JDoe@scoular.com', tradeUnitCodes: ['2190'] },
          { userId: 'CEgr', displayName: 'Caden Egr', email: 'CEgr@scoular.com', tradeUnitCodes: ['2190'] },
        ],
        tradeUnits: [{ code: '2190', description: 'Kansas West' }],
        groups: [{ groupId: 7, name: 'Organics & IP', tradeUnitCodes: ['2090', '2093'] }],
      }),
      // Stands in for the server's own filtering: only groups this caller is in come back.
      getRecapGroups: () => of([
        { id: '9', name: 'Iowa Territory', deliveryMethod: 'email', members: [{ id: 'm1' }], ccList: [], enabled: true, isOwner: true, canEdit: true, createdBy: 'CEgr' },
      ]),
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
    component.sheets.set([SHEET]);
    component.activeSheetId.set(1);
    component.openShareSheet();
  });

  it('offers all four kinds, each on its own tab', () => {
    expect(component.shareTab()).toBe('person');
    // The owner is filtered out — sharing a sheet with its own owner is a no-op the server drops.
    expect(component.shareOptions().map(o => o.memberId)).toEqual(['JDoe']);

    component.shareTab.set('trade-unit');
    expect(component.shareOptions().map(o => o.memberId)).toEqual(['2190']);

    component.shareTab.set('trade-unit-group');
    expect(component.shareOptions().map(o => o.memberId)).toEqual(['7']);

    component.shareTab.set('recap-group');
    expect(component.shareOptions().map(o => o.memberId)).toEqual(['9']);
  });

  it('stages a desk share with its type, not as a person', () => {
    component.shareTab.set('trade-unit');

    component.addShareCandidate(component.shareOptions()[0]);

    const staged = component.pendingShares();
    expect(staged).toHaveLength(1);
    expect(staged[0].memberType).toBe('trade-unit');
    expect(staged[0].memberId).toBe('2190');
    // userId must stay empty for a non-person, or a desk code reads as somebody's user id.
    expect(staged[0].userId).toBe('');
  });

  it('keeps a person and a desk that share an id string apart', () => {
    component.shareTab.set('trade-unit');
    component.addShareCandidate({ memberType: 'trade-unit', memberId: '2190', label: 'Kansas West' });
    component.addShareCandidate({ memberType: 'person', memberId: '2190', label: 'Odd Name' });
    expect(component.pendingShares()).toHaveLength(2);

    // Removing one must not take the other with it — hence keying on type AND id.
    component.removeShareCandidate('trade-unit', '2190');

    expect(component.pendingShares().map(s => s.memberType)).toEqual(['person']);
  });

  it('drops an already-staged member from the list, so it cannot be added twice', () => {
    component.shareTab.set('recap-group');
    const group = component.shareOptions()[0];

    component.addShareCandidate(group);

    expect(component.shareOptions()).toHaveLength(0);
  });

  it('labels each staged kind, since an id alone is ambiguous', () => {
    expect(component.shareKindLabel('person')).toBe('Person');
    expect(component.shareKindLabel('trade-unit')).toBe('Trade unit');
    expect(component.shareKindLabel('trade-unit-group')).toBe('Group');
    expect(component.shareKindLabel('recap-group')).toBe('Recap group');
  });
});

/**
 * Renaming a location must stay ON THE SHEET, from BOTH places it can be done — the side panel and the
 * Edit Bids grid.
 *
 * The grid's rename was missed when the per-sheet rename went in: it still wrote the shared location
 * row, so a private label became the elevator's REAL name for every sheet holding it. The user caught
 * it by removing a location and re-adding it from the catalog — the old label came back, because it had
 * become the canonical name. These tests pin both paths at the API boundary.
 */
describe('BidSheetComponent — renaming a location stays on the sheet', () => {
  let component: BidSheetComponent;
  let setBidSheetLocationName: ReturnType<typeof vi.fn>;
  let updateBidSheetLocation: ReturnType<typeof vi.fn>;

  const CANONICAL = 'GPC-MUSCATINE';
  const SHEET_LABEL = 'My Own Label';

  beforeEach(() => {
    setBidSheetLocationName = vi.fn(() => of({
      id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
      createdBy: 'test', createdAt: '2026-09-01T00:00:00Z', shares: [], locations: [],
    } as BidSheet));
    updateBidSheetLocation = vi.fn(() => of(location(CANONICAL, [])));

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
      setBidSheetLocationName: (s: number, l: number, n: string | null) => setBidSheetLocationName(s, l, n),
      updateBidSheetLocation: (id: number, body: unknown) => updateBidSheetLocation(id, body),
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

    // The company-wide row keeps its canonical name; the SHEET shows a per-sheet label, which is what
    // the server's DisplayName ?? Name resolution produces.
    component.allMapLocations.set([location(CANONICAL, [])]);
    component.sheets.set([{
      id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
      createdBy: 'test', createdAt: '2026-09-01T00:00:00Z', shares: [],
      locations: [location(SHEET_LABEL, [])],
    } as BidSheet]);
    component.activeSheetId.set(1);
  });

  // The bug the user hit: this used to call updateBidSheetLocation, renaming the shared row.
  it('renames from the Edit Bids grid via the per-sheet endpoint, not the shared row', () => {
    component.renameRowDraft.set('Renamed In Grid');

    component.saveRenameRow(SHEET_LABEL);

    expect(setBidSheetLocationName).toHaveBeenCalledWith(1, 1, 'Renamed In Grid');
    expect(updateBidSheetLocation).not.toHaveBeenCalled();
  });

  it('renames from the side panel via the same endpoint', () => {
    component.panelSelectedLocation.set(SHEET_LABEL);
    component.editLocationNameValue.set('Renamed In Panel');

    component.saveLocationName();

    expect(setBidSheetLocationName).toHaveBeenCalledWith(1, 1, 'Renamed In Panel');
    expect(updateBidSheetLocation).not.toHaveBeenCalled();
  });

  // Names are identity on this screen (grid rows are tracked by name, lookups resolve by name), so a
  // rename that would give two rows one name is refused before any request goes out. Case-insensitive
  // and trimmed, matching the server's own check.
  describe('refuses a name another location on the sheet already shows', () => {
    const OTHER_LABEL = 'Other Label';

    beforeEach(() => {
      component.sheets.update(list => list.map(s => ({
        ...s, locations: [location(SHEET_LABEL, []), { ...location(OTHER_LABEL, []), id: 2 }],
      })));
    });

    it('from the grid, with a toast naming the clash', () => {
      const error = vi.spyOn(TestBed.inject(ToastService), 'error');
      component.renameRowDraft.set('  other label ');

      component.saveRenameRow(SHEET_LABEL);

      expect(setBidSheetLocationName).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('other label'));
    });

    it('from the panel, leaving the edit box open so it can be corrected', () => {
      component.panelSelectedLocation.set(SHEET_LABEL);
      component.editingLocationName.set(true);
      component.editLocationNameValue.set('OTHER LABEL');

      component.saveLocationName();

      expect(setBidSheetLocationName).not.toHaveBeenCalled();
      expect(component.editingLocationName()).toBe(true);
    });

    // The location itself is excluded from the comparison, so re-casing its own name is a rename, not
    // a collision with itself.
    it('but not the location itself, re-cased', () => {
      component.renameRowDraft.set(SHEET_LABEL.toUpperCase());

      component.saveRenameRow(SHEET_LABEL);

      expect(setBidSheetLocationName).toHaveBeenCalledWith(1, 1, SHEET_LABEL.toUpperCase());
    });
  });

  // The second leak: the Scoular toggle DOES write the shared row (that flag is genuinely global), and
  // the endpoint replaces the whole record — so it has to send the CANONICAL name. Sending the sheet's
  // label would publish one sheet's private name as the elevator's real one.
  it('sends the canonical name when toggling Scoular, never the sheet label', () => {
    component.toggleRowScoular(SHEET_LABEL);

    expect(updateBidSheetLocation).toHaveBeenCalledTimes(1);
    const [, body] = updateBidSheetLocation.mock.calls[0];
    expect((body as { name: string }).name).toBe(CANONICAL);
    expect((body as { isScoularFacility: boolean }).isScoularFacility).toBe(true);
  });

  // Lookups searched only the company-wide list by name, so once a location had a per-sheet label
  // nothing matched it and the toggle silently did nothing on exactly the rows the user had renamed.
  it('finds a location by its per-sheet label, not just its canonical name', () => {
    const find = (component as unknown as {
      _findLocationByName(n: string): BidSheetLocation | undefined;
    })._findLocationByName.bind(component);

    expect(find(SHEET_LABEL)?.id).toBe(1);
    expect(find(CANONICAL)?.id).toBe(1);
  });
});

describe('BidSheetComponent — removing locations from the sheet', () => {
  let component: BidSheetComponent;
  let removeBidSheetLocations: ReturnType<typeof vi.fn>;

  const sheetOf = (locations: BidSheetLocation[]): BidSheet => ({
    id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
    createdBy: 'test', createdAt: '2026-09-01T00:00:00Z', shares: [], locations,
  } as BidSheet);

  beforeEach(() => {
    removeBidSheetLocations = vi.fn(() => of(sheetOf([])));
    const api = {
      getAllBidSheetLocations: () => of([]),
      getCommodities: () => of([]),
      getPlantingCommodities: () => of([]),
      getBidSheetPreference: () => of(null),
      setBidSheetPreference: () => of(null),
      getBarchartCoverage: () => of(null),
      searchBarchartLocations: () => of([]),
      getBidSheets: () => of([]),
      removeBidSheetLocations: (s: number, ids: number[]) => removeBidSheetLocations(s, ids),
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

    const rows = [location('A', []), { ...location('B', []), id: 2 }];
    component.allMapLocations.set(rows);
    component.sheets.set([sheetOf(rows)]);
    component.activeSheetId.set(1);
  });

  // _saveDirtyBids deliberately never calls back when the bid save fails (it keeps the edit and aborts
  // whatever was queued behind it). The busy flag therefore has to be raised INSIDE the callback: set
  // before the flush, a failed save left "Removing..." up and the button dead until a reload.
  it('does not get stuck in the removing state when the bid flush never completes', () => {
    (component as any)._saveDirtyBids = vi.fn(); // a failed flush: the callback is never invoked
    component.showRemoveLocations.set(true);
    component.removeLocationIds.set(new Set([1]));

    component.confirmRemoveLocations();

    expect(removeBidSheetLocations).not.toHaveBeenCalled();
    expect(component.removingLocations()).toBe(false);
    expect(component.showRemoveLocations()).toBe(true); // still there, ready to retry
  });

  it('removes every ticked location in one request once the flush completes, and clears the dialog', () => {
    (component as any)._saveDirtyBids = vi.fn((done: () => void) => done());
    component.showRemoveLocations.set(true);
    component.removeLocationIds.set(new Set([1, 2]));

    component.confirmRemoveLocations();

    expect(removeBidSheetLocations).toHaveBeenCalledTimes(1);
    expect(removeBidSheetLocations.mock.calls[0][0]).toBe(1);
    expect([...removeBidSheetLocations.mock.calls[0][1]].sort()).toEqual([1, 2]);
    expect(component.removingLocations()).toBe(false);
    expect(component.showRemoveLocations()).toBe(false);
    expect(component.removeLocationIds().size).toBe(0);
    expect(component.bidLocations()).toEqual([]); // the response's sheet is what the screen now shows
  });

  // The UI disables the button with nothing ticked; this is the backstop behind it.
  it('does nothing with nothing ticked', () => {
    (component as any)._saveDirtyBids = vi.fn((done: () => void) => done());

    component.confirmRemoveLocations();

    expect(removeBidSheetLocations).not.toHaveBeenCalled();
  });
});

describe('BidSheetComponent — the Yearly period is retired', () => {
  let component: BidSheetComponent;

  function fedBid(overrides: Partial<BidSheetLocationBid>): BidSheetLocationBid {
    return bid({ source: 'Barchart', commodityCode: 'YC', cropYear: 2026, month: 10, ...overrides });
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

  function seed(...bids: BidSheetLocationBid[]): void {
    const loc = location('A', bids);
    component.allMapLocations.set([loc]);
    component.sheets.set([{
      id: 1, name: 'Test Sheet', ownerUserId: 'test', isOwner: true,
      createdBy: 'test', createdAt: '2026-09-01T00:00:00Z', shares: [], locations: [loc],
    } as BidSheet]);
    component.activeSheetId.set(1);
  }

  // The business dropped the Yearly period: a fed Year cell meant the nearest open month and a typed one
  // the crop year, and the two sat side by side as if comparable. Every view now opens on a real month.
  it('opens on the current month everywhere the Yearly period used to be the default', () => {
    const now = new Date().getMonth() + 1;
    expect(component.selectedMonth()).toBe(now);
    expect(component.editBidsMonths()).toEqual([now]);
    expect(component.pendingMonths()).toEqual([now]);
    expect(component.editBidsMonthsLabel()).toBe('1 Month');
  });

  // Preferences saved before the change carry 0, alone or mixed in with real months.
  it('cleans a saved month selection: no 0, no junk, never empty', () => {
    expect(BidSheetComponent.cleanMonths([0, 3, 3, 15, 'x', 11])).toEqual([3, 11]);
    expect(BidSheetComponent.cleanMonths([0])).toEqual([new Date().getMonth() + 1]);
    expect(BidSheetComponent.cleanMonths('nonsense')).toEqual([new Date().getMonth() + 1]);
  });

  it('keeps the last ticked month rather than falling back to Yearly', () => {
    component.pendingMonths.set([10]);
    component.toggleEditMonth(10);
    expect(component.pendingMonths()).toEqual([10]);
  });

  it('orders months by calendar, with nothing pinned in front', () => {
    component.pendingMonths.set([11, 3, 10]);
    component.editBidsMonths.set([1]);
    component.confirmMonthSelection();
    expect(component.editBidsMonths()).toEqual([3, 10, 11]);
  });

  // One vendor bid in five delivers before its contract month; the bridge fills those months with the
  // covering bid and marks them. The grid says which month the number really belongs to.
  it('labels a covered cell with the covering contract month, and an own bid with nothing', () => {
    const covered = fedBid({ month: 10, coveredByCropYear: 2026, coveredByMonth: 11, underlyingFuture: 'ZCZ26' });
    const own = fedBid({ month: 11, underlyingFuture: 'ZCZ26' });
    seed(covered, own);
    expect(component.coverageLabelFor('A', 2026, 'YC', 10)).toBe('Nov');
    expect(component.coverageLabelFor('A', 2026, 'YC', 11)).toBe('');
    expect(component.coverageChipFor(null)).toBe('');
    expect(component.coverageChipFor({ ...component.bidEntries()[0], source: 'Manual' })).toBe('');
  });

  // The vendor re-stamps most bids daily whether or not they moved; only a real basis change pulses.
  it('pulses a fed cell only when its basis actually changed, ignoring the re-post stamp', () => {
    const justNow = new Date().toISOString();
    const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString();
    seed(
      fedBid({ month: 10, quoteAsOf: justNow, basisQuoteAsOf: justNow, modifiedAt: justNow, basisChangedAt: lastWeek }),
      fedBid({ month: 11, quoteAsOf: lastWeek, basisChangedAt: justNow }),
    );
    const moved = (month: number) => (component as any)._locationChangedWithin24h('A', 2026, 'YC', month) as boolean;
    expect(moved(10)).toBe(false);  // fresh stamps, stale basis: a re-post
    expect(moved(11)).toBe(true);   // stale stamp, fresh basis: a move
  });

  it('still pulses a manual cell on an edit', () => {
    seed(bid({ source: 'Manual', commodityCode: 'YC', cropYear: 2026, month: 10, modifiedAt: new Date().toISOString() }));
    expect((component as any)._locationChangedWithin24h('A', 2026, 'YC', 10)).toBe(true);
  });
});

/**
 * Clicking a second pin while the first is still loading.
 *
 * The catalog SEARCH has carried a generation guard for a while; the detail popup did not. So the
 * slower of two overlapping requests won: it wrote its bids into a popup whose header already named
 * the other location, which looked exactly like the popup refusing to switch. A stale FAILED request
 * was worse -- its error handler closed the popup the user had just opened.
 */
describe('BidSheetComponent — the popup follows the last pin clicked', () => {
  let component: BidSheetComponent;
  let pending: Map<string, Subject<BarchartCatalogLocationDetail>>;

  const detailFor = (key: string): BarchartCatalogLocationDetail => ({
    location: { locationKey: key, instrumentCount: 1, commodityCount: 1, placements: [] },
    bids: [],
    unmappedBidCount: 0,
  });

  beforeEach(() => {
    pending = new Map();
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
      getBarchartLocationDetail: (key: string) => {
        const subject = new Subject<BarchartCatalogLocationDetail>();
        pending.set(key, subject);
        return subject.asObservable();
      },
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

  it('shows the second location even when the first response lands last', () => {
    component.openCatalogDetail('A');
    component.openCatalogDetail('B');

    pending.get('B')!.next(detailFor('B'));
    pending.get('A')!.next(detailFor('A')); // the slow one, arriving after it was superseded

    expect(component.catalogDetailKey()).toBe('B');
    expect(component.catalogDetail()?.location.locationKey).toBe('B');
    expect(component.catalogDetailLoading()).toBe(false);
  });

  it('still caches a superseded response, so going back to that pin is instant', () => {
    component.openCatalogDetail('A');
    component.openCatalogDetail('B');
    pending.get('A')!.next(detailFor('A'));
    pending.get('B')!.next(detailFor('B'));

    pending.delete('A');
    component.openCatalogDetail('A');

    expect(component.catalogDetail()?.location.locationKey).toBe('A');
    expect(component.catalogDetailLoading()).toBe(false);
    expect(pending.has('A')).toBe(false); // served from cache, no second request
  });

  it('does not let a stale failure close the popup the user just opened', () => {
    component.openCatalogDetail('A');
    component.openCatalogDetail('B');

    pending.get('A')!.error(new Error('slow request failed'));

    expect(component.catalogDetailKey()).toBe('B');
  });

  it('does not repopulate a popup that has been closed', () => {
    component.openCatalogDetail('A');
    component.closeCatalogDetail();

    pending.get('A')!.next(detailFor('A'));

    expect(component.catalogDetailKey()).toBeNull();
    expect(component.catalogDetail()).toBeNull();
  });
});
