import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { BidSheet, BidSheetLocation, BidSheetLocationBid } from '@models';

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

  it('offers a default span of years around today even with no bid data anywhere', () => {
    const now = new Date().getFullYear();
    expect(component.cropYears()).toEqual([]);
    expect(component.filterableYears()).toEqual([now - 1, now, now + 1, now + 2]);
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
