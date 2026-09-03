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
