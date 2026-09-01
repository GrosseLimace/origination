import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { BidSheetLocation, BidSheetLocationBid } from '@models';

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

  /** Puts locations in the map cache, which bidEntries reads when no trade unit is active. */
  function seed(...locs: BidSheetLocation[]): void {
    component.allMapLocations.set(locs);
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
    component.editBidsYear.set(2026);
    const col = { crop: 'YC', month: 8, year: 2026 };

    // On the column's own board the header already says it -- repeating it on every cell is what
    // widened the columns enough to shrink the whole printed sheet.
    expect(component.printCellValue(row('Majority', 'YC#8', '4.98') as never, col)).toBe('4.98');
    expect(component.printCellValue(row('Rolled', 'YC#8', '5.02') as never, col)).toBe('5.02 (ZCZ26)');
  });

  it('prints the contract on every fed Year cell, which has no column board to lean on', () => {
    seed(location('A', [bid({ month: 0, underlyingFuture: 'ZCZ26' })]));
    component.editBidsYear.set(2026);

    const printed = component.printCellValue(
      row('A', 'YC#0', '4.30') as never, { crop: 'YC', month: 0, year: 2026 });

    expect(printed).toBe('4.30 (ZCZ26)');
  });

  // The value comes from the live grid so unsaved edits print; the board comes from the saved entry.
  // Together they stamped a hand-typed price with a board it was never quoted against.
  it('does not print a board on an unsaved override', () => {
    seed(location('A', [bid({ underlyingFuture: 'ZCU26' })]));
    component.editBidsYear.set(2026);
    const dirty = { ...row('A', 'YC#8', '9.99'), originalBids: { 'YC#8': '4.98' } };

    const printed = component.printCellValue(dirty as never, { crop: 'YC', month: 8, year: 2026 });

    expect(printed).toBe('9.99');
  });

  it('leaves an empty cell empty rather than printing a bare board', () => {
    seed(location('A', [bid()]));
    component.editBidsYear.set(2026);

    expect(component.printCellValue(row('A', 'YC#8', '') as never, { crop: 'YC', month: 8, year: 2026 })).toBe('');
  });

  // ── where an added location lands ────────────────────────────────────────────────────────────

  // This used to fall back to every trade unit the user could reach, so ticking three elevators with
  // nothing selected silently created placements across the whole book.
  it('offers no BarChart destination until a trade unit is selected', () => {
    expect(component.addLocationTus()).toEqual([]);
  });

  // The manual form is the opposite shape -- one dropdown, one row -- so it may offer the whole book.
  // Narrowing BOTH to the selection left that dropdown with nothing to pick and no way to add a
  // location by hand from an unfiltered map.
  it('still offers the manual add form a trade unit to pick when none is selected', () => {
    const appState = TestBed.inject(AppStateService) as unknown as {
      userGroups: { set(v: unknown): void };
    };
    appState.userGroups.set([{ groupName: 'G', tradeUnitCodes: ['2190', '2038'] }]);

    expect(component.manualAddTuChoices()).toEqual(['2038', '2190']);
    // ...while the BarChart path stays strict.
    expect(component.addLocationTus()).toEqual([]);
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
      ...row('A', 'YC#8', '4.98'),
      basisBids: { 'YC#8': '-40Z' }, originalBasisBids: { 'YC#8': '-30' },
    };

    const [saved] = markSaved([dirtyRow], [
      { name: 'A', commodityCode: 'YC', month: 8, bid: '4.98', basisBid: '-40Z' },
    ]) as Array<{ originalBids: Record<string, string>; originalBasisBids: Record<string, string> }>;

    expect(saved.originalBasisBids['YC#8']).toBe('-40Z');
    expect(saved.originalBids['YC#8']).toBe('4.98');
  });

  it('drops the board symbol from a cell the user has taken over', () => {
    const [saved] = markSaved([row('A', 'YC#8', '9.99')], [
      { name: 'A', commodityCode: 'YC', month: 8, bid: '9.99', basisBid: '' },
    ]) as Array<{ boardChips: Record<string, string> }>;

    // Left in place, it re-attached to the hand-typed number the moment the cell counted as clean.
    expect(saved.boardChips['YC#8']).toBeUndefined();
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
});
