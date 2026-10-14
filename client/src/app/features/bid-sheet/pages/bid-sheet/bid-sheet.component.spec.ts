import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { MsalService } from '@azure/msal-angular';
import { Observable, Subject, of, throwError } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { BidSheetLocation, BidSheetLocationBid, Commodity } from '@models';

import { BidSheetComponent } from './bid-sheet.component';

// Behaviour safety net for the bid sheet page ahead of its refactor (OnPush clean-up, `any` removal,
// decomposition). Everything is driven through the public signals / computeds / methods the template
// binds to, so private fields and helpers can move freely underneath.
//
// Template: BLANKED (template: '', imports: []). These tests exercise the component's logic, and the
// real template pulls in TradeUnitSelectorComponent (its own service graph) plus the #mapEl container
// that feeds Leaflet. With no template there is no #mapEl, so the map code never gets an element.
//
// Leaflet: the component lazy-loads it with `await import('leaflet')` and swallows a failed import.
// The mock below makes that import reject, so the map initialiser bails out on its first line — no
// Leaflet code runs and no 200 ms retry loop is left polling for a map element after a test ends.
vi.mock('leaflet', () => {
  throw new Error('Leaflet is not loaded in BidSheetComponent unit tests');
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Date frozen (timers stay real) so the "current year" defaults are always 2026. */
const NOW = new Date('2026-10-13T12:00:00');

type BulkBids = Parameters<ApiService['bulkUpsertBidSheetBids']>[0];
type Preference = NonNullable<ApiService['getBidSheetPreference'] extends (k: string) => Observable<infer P> ? P : never>;

let bidSeq = 100;
function makeBid(locationId: number, commodityCode: string, cropYear: number, bid: string, over: Partial<BidSheetLocationBid> = {}): BidSheetLocationBid {
  return {
    id: bidSeq++,
    locationId,
    commodityCode,
    cropYear,
    month: 0,
    bid,
    createdBy: 'rep@scoular.com',
    createdAt: '2026-09-01T12:00:00Z',
    ...over,
  };
}

function makeLocation(over: Partial<BidSheetLocation> & Pick<BidSheetLocation, 'id' | 'name'>): BidSheetLocation {
  return {
    tradeUnitCode: '2040',
    createdBy: 'rep@scoular.com',
    createdAt: '2026-09-01T12:00:00Z',
    bids: [],
    ...over,
  };
}

/** TU 2040: Alpha (corn both years + soybeans), Bravo (corn both years), Charlie (Scoular, no bids). */
function alpha(): BidSheetLocation {
  return makeLocation({
    id: 1, name: 'Alpha Coop', address: '1 Main St', city: 'Pratt', state: 'KS',
    latitude: 37.6, longitude: -98.7, elevatorCode: 'ALP', groupName: 'Kansas', isScoularFacility: false,
    bids: [makeBid(1, 'YC', 2026, '4.10'), makeBid(1, 'YC', 2025, '3.90'), makeBid(1, 'SB', 2026, '10.00')],
  });
}
function bravo(): BidSheetLocation {
  return makeLocation({
    id: 2, name: 'Bravo Grain', latitude: 37.9, longitude: -98.2, elevatorCode: 'BRV', groupName: 'Kansas',
    bids: [makeBid(2, 'YC', 2026, '4.25'), makeBid(2, 'YC', 2025, '3.90')],
  });
}
function charlie(): BidSheetLocation {
  return makeLocation({ id: 3, name: 'Charlie Elevator', latitude: 38.2, longitude: -98.4, isScoularFacility: true, groupName: 'Kansas' });
}
/** TU 2050: one corn location bidding the 2024 crop only. */
function delta(): BidSheetLocation {
  return makeLocation({
    id: 4, name: 'Delta Farms', tradeUnitCode: '2050', latitude: 39.0, longitude: -99.0, groupName: 'Kansas',
    bids: [makeBid(4, 'YC', 2024, '3.50')],
  });
}

const tu2040 = (): BidSheetLocation[] => [alpha(), bravo(), charlie()];
const allMap = (): BidSheetLocation[] => [alpha(), bravo(), charlie(), delta()];

const COMMODITIES: Commodity[] = [
  { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true },
  { id: 2, code: 'SB', name: 'Soybeans', category: 'Soybeans', isActive: true },
];

const GROUPS = [{ groupName: 'Kansas', tradeUnitCodes: ['2040', '2050'] }];

function makePref(over: Partial<Preference> = {}): Preference {
  return {
    tradeUnitKey: '2040', cropCode: null, month: null, cropYear: null,
    cropOrder: null, hiddenCrops: null, selectedMonths: null, printLayout: null, ...over,
  };
}

function makeApi() {
  return {
    getCommodities: vi.fn(() => of(COMMODITIES)),
    getPlantingCommodities: vi.fn(() => of<Commodity[]>([])),
    getAllBidSheetLocations: vi.fn((): Observable<BidSheetLocation[]> => of(allMap())),
    getBidSheetLocations: vi.fn((tu: string): Observable<BidSheetLocation[]> => of(tu === '2040' ? tu2040() : [delta()])),
    getBidCropYears: vi.fn((tu: string): Observable<number[]> => of(tu === '2040' ? [2025, 2026] : [2024])),
    getBidCommodities: vi.fn((tu: string): Observable<string[]> => of(tu === '2040' ? ['YC', 'SB'] : ['YC'])),
    getBidSheetLocationOrder: vi.fn((_key: string): Observable<{ locationOrder: string } | null> => of(null)),
    setBidSheetLocationOrder: vi.fn((_key: string, _order: string): Observable<void> => of(undefined)),
    getBidSheetPreference: vi.fn((_key: string): Observable<Preference | null> => of(null)),
    setBidSheetPreference: vi.fn((..._args: Parameters<ApiService['setBidSheetPreference']>): Observable<void> => of(undefined)),
    bulkUpsertBidSheetBids: vi.fn((_bids: BulkBids): Observable<void> => of(undefined)),
    updateBidSheetLocation: vi.fn((id: number, loc: Partial<BidSheetLocation>): Observable<BidSheetLocation> => of({ ...alpha(), ...loc, id })),
    deleteBidSheetLocation: vi.fn((_id: number, _tu: string): Observable<void> => of(undefined)),
  };
}

function makeAppState(tus: string[], groups: string[]) {
  const selectedTradeUnits = signal<string[]>(tus);
  const selectedGroupNames = signal<string[]>(groups);
  return {
    selectedTradeUnits,
    selectedGroupNames,
    userGroups: signal(GROUPS),
    inScopeGroupNames: signal<readonly string[]>([]),
    inScopeTradeUnitCodes: signal<readonly string[]>([]),
    setSelectedGroupNames: vi.fn((names: string[]) => selectedGroupNames.set(names)),
    setTradeUnits: vi.fn((codes: string[]) => selectedTradeUnits.set(codes)),
  };
}

/** CdkDragDrop carries container/item refs the component never reads — only the two indices matter. */
function drop<T>(previousIndex: number, currentIndex: number): CdkDragDrop<T> {
  return { previousIndex, currentIndex } as CdkDragDrop<T>;
}

// ── Map harness ───────────────────────────────────────────────────────────────
// Leaflet never loads in these tests (see the mock above). For the marker tests a tiny fake stands in:
// divIcon returns its options, markers record their handlers, and the map projects lat/lng linearly
// (256px tiles × 2^zoom per 360°) so the pin-spread maths runs on predictable pixels.

interface FakeIcon { className: string; html: string; iconSize: [number, number]; iconAnchor: [number, number] }

class FakeMarker {
  readonly handlers: Record<string, () => void> = {};
  icon: FakeIcon;
  zIndex = 0;
  constructor(readonly latlng: [number, number], readonly opts: { icon: FakeIcon; zIndexOffset?: number }) { this.icon = opts.icon; }
  on(event: string, fn: () => void): this { this.handlers[event] = fn; return this; }
  setIcon(icon: FakeIcon): this { this.icon = icon; return this; }
  setZIndexOffset(z: number): this { this.zIndex = z; return this; }
  addTo(): this { return this; }
}

type FakeLatLng = { lat: number; lng: number };

/** Hooks a fake Leaflet map onto the component's private map fields and returns the drawn markers. */
function attachFakeMap(component: BidSheetComponent, zoom: number) {
  const scale = (z: number) => (256 * 2 ** z) / 360;
  const toLatLng = (p: FakeLatLng | [number, number]): FakeLatLng => Array.isArray(p) ? { lat: p[0], lng: p[1] } : p;
  const markers: FakeMarker[] = [];
  const L = {
    divIcon: (o: FakeIcon) => o,
    marker: (ll: [number, number], o: { icon: FakeIcon; zIndexOffset?: number }) => new FakeMarker(ll, o),
    latLng: (lat: number, lng: number): FakeLatLng => ({ lat, lng }),
    point: (x: number, y: number) => ({ x, y }),
  };
  const map = {
    getZoom: () => zoom,
    project: (p: FakeLatLng | [number, number], z: number) => {
      const { lat, lng } = toLatLng(p);
      const s = scale(z);
      return { x: lng * s, y: -lat * s, add: ([dx, dy]: [number, number]) => ({ x: lng * s + dx, y: -lat * s + dy }) };
    },
    unproject: (pt: { x: number; y: number }, z: number): FakeLatLng => ({ lat: -pt.y / scale(z), lng: pt.x / scale(z) }),
    flyTo: vi.fn(), closePopup: vi.fn(), setView: vi.fn(), fitBounds: vi.fn(), removeLayer: vi.fn(), remove: vi.fn(),
  };
  const cluster = { clearLayers: () => { markers.length = 0; }, addLayer: (m: FakeMarker) => { markers.push(m); } };
  const internals = component as unknown as {
    _L: unknown; _map: unknown; _clusterGroup: unknown;
    _refreshMapMarkers(): void; _onMapClick(e: { latlng: FakeLatLng }): void;
  };
  internals._L = L;
  internals._map = map;
  internals._clusterGroup = cluster;
  return {
    markers, map, scale,
    refresh: () => internals._refreshMapMarkers(),
    click: (lat: number, lng: number) => internals._onMapClick({ latlng: { lat, lng } }),
  };
}

// ── Harness ───────────────────────────────────────────────────────────────────

describe('BidSheetComponent', () => {
  let api: ReturnType<typeof makeApi>;
  let appState: ReturnType<typeof makeAppState>;
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> };
  let usage: { postClickEvent: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<BidSheetComponent>;
  let c: BidSheetComponent;

  /** Creates the component with the given trade-unit / group selection and flushes the initial load
   *  (all calls are synchronous of(...) so one change-detection pass runs the TU effect end to end). */
  function build(tus: string[] = ['2040'], groups: string[] = []): BidSheetComponent {
    appState = makeAppState(tus, groups);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AppStateService, useValue: appState },
        { provide: ToastService, useValue: toast },
        { provide: UsageTrackingService, useValue: usage },
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => ({ username: 'rep@scoular.com' }), getAllAccounts: () => [] } } },
      ],
    });
    TestBed.overrideComponent(BidSheetComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    fixture = TestBed.createComponent(BidSheetComponent);
    fixture.detectChanges();
    c = fixture.componentInstance;
    return c;
  }

  /** Runs pending effects after a signal the component reacts to (e.g. the TU selection) changes. */
  function flush(): void {
    fixture.detectChanges();
  }

  /** Row index of a location in the edit grid. */
  const rowOf = (name: string): number => c.editBidsRows().findIndex(r => r.name === name);
  const panelNames = (): string[] => c.filteredBidItems().map(i => i.name);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    api = makeApi();
    toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn() };
    usage = { postClickEvent: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial load & trade-unit switching ───────────────────────────────────

  describe('trade-unit load', () => {
    it('loads the selected trade unit and derives sorted crops, crop years and a default crop', () => {
      build(['2040']);

      expect(api.getBidSheetLocations).toHaveBeenCalledWith('2040');
      expect(c.bidLocations().map(l => l.name)).toEqual(['Alpha Coop', 'Bravo Grain', 'Charlie Elevator']);
      expect(c.crops()).toEqual(['SB', 'YC']);
      expect(c.cropYears()).toEqual([2025, 2026]);
      expect(c.selectedCrop()).toBe('SB');
      expect(c.selectedYear()).toBe(2026);
      expect(c.oldYear()).toBe(2025);
      expect(c.newYear()).toBe(2026);
      expect(c.isLoading()).toBe(false);
      expect(c.editBidsReadOnly()).toBe(false);
    });

    it('auto-selects the parent group when a trade unit is picked without one', () => {
      build(['2040'], []);
      expect(appState.setSelectedGroupNames).toHaveBeenCalledWith(['Kansas']);
    });

    it('falls back to every trade unit in the selected group and keys preferences by the sorted set', () => {
      build([], ['Kansas']);

      expect(api.getBidSheetLocations).toHaveBeenCalledWith('2040');
      expect(api.getBidSheetLocations).toHaveBeenCalledWith('2050');
      expect(c.activeTradeUnitKey()).toBe('2040,2050');
      expect(c.bidLocations().map(l => l.name)).toEqual(['Alpha Coop', 'Bravo Grain', 'Charlie Elevator', 'Delta Farms']);
      expect(c.cropYears()).toEqual([2024, 2025, 2026]);
      expect(api.getBidSheetPreference).toHaveBeenCalledWith('2040,2050');
      expect(api.getBidSheetLocationOrder).toHaveBeenCalledWith('2040,2050');
    });

    it('switching to another trade unit replaces the locations and re-validates crop and year', () => {
      build(['2040']);
      appState.selectedTradeUnits.set(['2050']);
      flush();

      expect(api.getBidSheetLocations).toHaveBeenLastCalledWith('2050');
      expect(c.bidLocations().map(l => l.name)).toEqual(['Delta Farms']);
      expect(c.crops()).toEqual(['YC']);
      expect(c.selectedCrop()).toBe('YC'); // SB is not bid in 2050
      expect(c.selectedYear()).toBe(2024); // 2026 has no bids and is not current-year data
    });

    it('clearing the trade unit drops to read-only All Producers and derives filters from every location', () => {
      build(['2040']);
      c.selectedBasis.set('beating');
      appState.selectedTradeUnits.set([]);
      appState.selectedGroupNames.set([]);
      flush();

      expect(c.bidLocations()).toEqual([]);
      expect(c.editBidsReadOnly()).toBe(true);
      expect(c.selectedBasis()).toBe('all');
      expect(c.crops()).toEqual(['SB', 'YC']);
      expect(c.cropYears()).toEqual([2024, 2025, 2026]);
    });

    it('All Producers never fetches per-TU bids and compares across every location', () => {
      build([], []);

      expect(api.getBidSheetLocations).not.toHaveBeenCalled();
      expect(c.editBidsReadOnly()).toBe(true);
      expect(c.selectedCrop()).toBe('SB');
      expect(c.selectedYear()).toBe(2026);
      // Only Alpha bids soybeans; the bid map is built from allMapLocations here.
      expect(c.filteredBidItems().map(i => [i.name, i.oldBid, i.newBid])).toEqual([['Alpha Coop', '', '10.00']]);
    });
  });

  // ── Panel list derivation ─────────────────────────────────────────────────

  describe('panel list (filterBids)', () => {
    it('lists only locations bidding the selected crop, alphabetically, with old/new year bids', () => {
      build(['2040']);
      c.selectedCrop.set('YC');
      c.onFilterChange();

      expect(c.filteredBidItems().map(i => [i.name, i.oldBid, i.newBid, i.isScoular])).toEqual([
        ['Alpha Coop', '3.90', '4.10', false],
        ['Bravo Grain', '3.90', '4.25', false],
      ]);
    });

    it('with no crop filter also lists locations that have no bids yet, flagging Scoular facilities', () => {
      build(['2040']);
      c.selectedCrop.set('');
      c.onFilterChange();

      expect(panelNames()).toEqual(['Alpha Coop', 'Bravo Grain', 'Charlie Elevator']);
      const charlieItem = c.filteredBidItems().find(i => i.name === 'Charlie Elevator');
      expect(charlieItem).toMatchObject({ isScoular: true, oldBid: '', newBid: '', status: 'none' });
      expect(c.scoularLocationNames().has('Charlie Elevator')).toBe(true);
      expect(c.scoularLocationIds().has(3)).toBe(true);
    });

    it('shows the most recently modified bid when a cell has duplicates', () => {
      api.getBidSheetLocations.mockImplementation(() => of([
        makeLocation({
          id: 2, name: 'Bravo Grain', bids: [
            makeBid(2, 'YC', 2026, '4.40', { modifiedAt: '2026-10-01T12:00:00Z' }),
            makeBid(2, 'YC', 2026, '4.00', { modifiedAt: '2026-09-15T12:00:00Z' }),
          ],
        }),
      ]));
      api.getBidCommodities.mockImplementation(() => of(['YC']));
      build(['2040']);

      expect(c.filteredBidItems().find(i => i.name === 'Bravo Grain')?.newBid).toBe('4.40');
    });

    it('a reference location sorts first and every other row is graded against it; the basis filter keeps the reference', () => {
      build(['2040']);
      c.selectedCrop.set('YC');
      c.panelSelectedLocation.set('Alpha Coop');
      c.panelSetReference();

      expect(c.selectedLocationName()).toBe('Alpha Coop');
      expect(usage.postClickEvent).toHaveBeenCalledWith('interaction', 'bidsheet', 'reference-set', 'Alpha Coop');
      expect(c.filteredBidItems().map(i => [i.name, i.oldStatus, i.newStatus, i.status])).toEqual([
        ['Alpha Coop', 'reference', 'reference', 'reference'],
        ['Bravo Grain', 'matching', 'beating', 'beating'],
      ]);

      c.selectedBasis.set('matching');
      c.filterBids();
      expect(panelNames()).toEqual(['Alpha Coop']);

      // Clicking again clears the reference
      c.selectedBasis.set('all');
      c.panelSetReference();
      expect(c.selectedLocationName()).toBe('');
      expect(c.filteredBidItems().every(i => !i.isRef)).toBe(true);
    });

    it('panelLocationBids lists the open location\'s crops with statuses relative to the reference', () => {
      build(['2040']);
      c.panelSelectedLocation.set('Bravo Grain');
      c.panelSetReference();
      c.panelSelectedLocation.set('Alpha Coop');

      expect(c.panelLocationBids()).toEqual([
        { crop: 'SB', oldBid: '', newBid: '10.00', oldStatus: 'none', newStatus: 'none' },
        { crop: 'YC', oldBid: '3.90', newBid: '4.10', oldStatus: 'matching', newStatus: 'none' },
      ]);
      expect(c.panelSelectedIsScoular()).toBe(false);
    });

    it('monthly navigation rolls the year over at January/December and persists the preference', () => {
      build(['2040']);
      c.onMonthDropdownChange(1);
      api.setBidSheetPreference.mockClear();

      c.shiftYearsBack();
      expect([c.selectedMonth(), c.selectedYear()]).toEqual([12, 2025]);
      expect(c.oldDisplay()).toEqual({ month: 11, year: 2025 });
      expect(api.setBidSheetPreference).toHaveBeenCalledWith('2040', 'SB', 12, 2025);
      expect(api.setBidSheetPreference).toHaveBeenCalledWith('__global__', 'SB', 12, 2025);

      c.shiftYearsForward();
      expect([c.selectedMonth(), c.selectedYear()]).toEqual([1, 2026]);
      expect(c.oldDisplay()).toEqual({ month: 12, year: 2025 });
    });
  });

  // ── Preferences ───────────────────────────────────────────────────────────

  describe('preferences', () => {
    it('per-trade-unit preference wins, missing fields fall back to the global preference', () => {
      api.getBidSheetPreference.mockImplementation((key: string) => of(
        key === '2040' ? makePref({ cropCode: 'YC' }) : makePref({ tradeUnitKey: '__global__', cropCode: 'SB', cropYear: 2025, month: 0 }),
      ));
      build(['2040']);

      expect(api.getBidSheetPreference).toHaveBeenCalledWith('2040');
      expect(api.getBidSheetPreference).toHaveBeenCalledWith('__global__');
      expect(c.selectedCrop()).toBe('YC');
      expect(c.selectedYear()).toBe(2025);
      expect(c.newYear()).toBe(2025);
      expect(c.yearOffset()).toBe(-1);
    });

    it('applies saved hidden crops, crop order and selected months to the edit grid columns', () => {
      api.getBidSheetPreference.mockImplementation((key: string) => of(
        key === '2040' ? makePref({ cropOrder: '["YC","SB"]', selectedMonths: '[0,5]' }) : null,
      ));
      build(['2040']);

      expect(c.editBidsCrops()).toEqual(['YC', 'SB']);
      expect(c.editBidsMonthsLabel()).toBe('1 Month + Year');
      expect(c.editGridColumns().map(col => [col.key, col.label])).toEqual([
        ['YC#0', 'YC 2026'], ['YC#5', 'YC May'], ['SB#0', 'SB 2026'], ['SB#5', 'SB May'],
      ]);

      c.hiddenCrops.set(new Set(['YC']));
      expect(c.editGridColumns().map(col => col.key)).toEqual(['SB#0', 'SB#5']);
    });

    it('hidden crops from the preference are excluded; corrupt JSON degrades to all visible', () => {
      api.getBidSheetPreference.mockImplementation((key: string) => of(key === '2040' ? makePref({ hiddenCrops: '["SB"]' }) : null));
      build(['2040']);
      expect(c.editBidsCrops()).toEqual(['YC']);

      appState.selectedTradeUnits.set([]);
      flush();
      api.getBidSheetPreference.mockImplementation((key: string) => of(key === '2040' ? makePref({ hiddenCrops: '{not json' }) : null));
      appState.selectedTradeUnits.set(['2040']);
      flush();
      expect(c.hiddenCrops().size).toBe(0);
      expect(c.editBidsCrops()).toEqual(['SB', 'YC']);
    });
  });

  // ── Edit grid ─────────────────────────────────────────────────────────────

  describe('edit grid', () => {
    it('openEditBids builds one row per location (bid-less locations last) keyed by crop#month', () => {
      build(['2040']);
      c.openEditBids();

      expect(c.editBidsMode()).toBe(true);
      expect(c.editBidsYear()).toBe(2026);
      expect(c.editBidsRows().map(r => [r.name, r.bids])).toEqual([
        ['Alpha Coop', { 'SB#0': '10.00', 'YC#0': '4.10' }],
        ['Bravo Grain', { 'SB#0': '', 'YC#0': '4.25' }],
        ['Charlie Elevator', { 'SB#0': '', 'YC#0': '' }],
      ]);
      expect(usage.postClickEvent).toHaveBeenCalledWith('interaction', 'bidsheet', 'edit-bids-opened');
    });

    it('applies the saved location order, unknown locations going to the end', () => {
      api.getBidSheetLocationOrder.mockImplementation(() => of({ locationOrder: '["Charlie Elevator","Bravo Grain"]' }));
      build(['2040']);
      c.openEditBids();

      expect(c.editBidsRows().map(r => r.name)).toEqual(['Charlie Elevator', 'Bravo Grain', 'Alpha Coop']);
    });

    it('dragging a row persists the full new location order for the trade unit', () => {
      build(['2040']);
      c.openEditBids();
      c.onRowDrop(drop(2, 0));

      expect(c.editBidsRows().map(r => r.name)).toEqual(['Charlie Elevator', 'Alpha Coop', 'Bravo Grain']);
      expect(api.setBidSheetLocationOrder).toHaveBeenCalledWith('2040', '["Charlie Elevator","Alpha Coop","Bravo Grain"]');
      expect(toast.success).toHaveBeenCalledWith('Location order saved');
    });

    it('dragging a crop column moves every month of that crop and saves the order without touching crop/month/year', () => {
      build(['2040']);
      c.editBidsMonths.set([0, 5]);
      c.openEditBids();
      api.setBidSheetPreference.mockClear();

      // Columns: SB#0, SB#5, YC#0, YC#5 → drag SB#0 onto YC#5
      c.onCropColumnDrop(drop(0, 3));

      expect(c.editBidsCrops()).toEqual(['YC', 'SB']);
      expect(c.editGridColumns().map(col => col.key)).toEqual(['YC#0', 'YC#5', 'SB#0', 'SB#5']);
      expect(api.setBidSheetPreference).toHaveBeenCalledTimes(1);
      expect(api.setBidSheetPreference).toHaveBeenCalledWith('2040', 'SB', 0, 2026, '["YC","SB"]');
      expect(toast.success).toHaveBeenCalledWith('Crop order saved');
    });

    it('keeps hidden crops parked at the end of the saved crop order', () => {
      api.getBidCommodities.mockImplementation(() => of(['YC', 'SB', 'WHT']));
      build(['2040']);
      c.hiddenCrops.set(new Set(['SB']));
      c.openEditBids();
      api.setBidSheetPreference.mockClear();

      // Visible: WHT, YC → drag WHT after YC
      c.onCropColumnDrop(drop(0, 1));

      expect(c.editBidsCrops()).toEqual(['YC', 'WHT']);
      expect(api.setBidSheetPreference).toHaveBeenCalledWith('2040', 'SB', 0, 2026, '["YC","WHT","SB"]');
    });

    it('a failed crop-order save shows an error toast', () => {
      api.setBidSheetPreference.mockImplementation(() => throwError(() => new Error('down')));
      build(['2040']);
      c.openEditBids();
      c.onCropColumnDrop(drop(0, 1));

      expect(toast.error).toHaveBeenCalledWith('Failed to save crop order');
    });

    it('confirming a month selection orders Yearly first, persists selectedMonths and rebuilds the grid', () => {
      build(['2040']);
      c.openEditBids();
      c.openMonthDropdown();
      c.toggleEditMonth(6);
      c.toggleEditMonth(3);
      api.setBidSheetPreference.mockClear();
      c.confirmMonthSelection();

      expect(c.editBidsMonths()).toEqual([0, 3, 6]);
      expect(c.showMonthDropdown()).toBe(false);
      expect(api.setBidSheetPreference).toHaveBeenCalledWith('2040', 'SB', 0, 2026, undefined, undefined, '[0,3,6]');
      expect(toast.success).toHaveBeenCalledWith('Month selection saved');
      expect(Object.keys(c.editBidsRows()[0].bids)).toEqual(['SB#0', 'SB#3', 'SB#6', 'YC#0', 'YC#3', 'YC#6']);
    });

    it('un-ticking every month falls back to Yearly', () => {
      build(['2040']);
      c.openMonthDropdown();
      c.toggleEditMonth(0);
      expect(c.pendingMonths()).toEqual([0]);
    });
  });

  // ── Bid editing & auto-save ───────────────────────────────────────────────

  describe('bid editing and auto-save', () => {
    it('blur saves only the changed cell with the full upsert payload, then clears the dirty state and updates the panel', () => {
      build(['2040']);
      c.selectedCrop.set('YC');
      c.openEditBids();
      c.updateBid(rowOf('Alpha Coop'), 'YC#0', ' 4.30 ');
      c.onBidBlur();

      expect(api.bulkUpsertBidSheetBids).toHaveBeenCalledTimes(1);
      expect(api.bulkUpsertBidSheetBids).toHaveBeenCalledWith([{
        name: 'Alpha Coop',
        latitude: 37.6,
        longitude: -98.7,
        elevatorCode: 'ALP',
        tradeUnitCode: '2040',
        groupName: 'Kansas',
        commodityCode: 'YC',
        commodityName: 'Yellow Corn',
        commodityCategory: 'Corn',
        cropYear: 2026,
        bid: '4.30',
        month: 0,
      }]);
      const row = c.editBidsRows()[rowOf('Alpha Coop')];
      expect(row.originalBids['YC#0']).toBe('4.30');
      expect(toast.success).not.toHaveBeenCalled(); // silent

      c.filterBids();
      expect(c.filteredBidItems().find(i => i.name === 'Alpha Coop')?.newBid).toBe('4.30');
    });

    it('blur with no changes makes no API call', () => {
      build(['2040']);
      c.openEditBids();
      c.updateBid(rowOf('Bravo Grain'), 'YC#0', '4.25'); // same as saved
      c.onBidBlur();
      expect(api.bulkUpsertBidSheetBids).not.toHaveBeenCalled();
    });

    it('a failed auto-save shows the error toast and keeps the edit dirty', () => {
      api.bulkUpsertBidSheetBids.mockImplementation(() => throwError(() => new Error('boom')));
      build(['2040']);
      c.openEditBids();
      c.updateBid(rowOf('Alpha Coop'), 'YC#0', '4.30');
      c.onBidBlur();

      expect(toast.error).toHaveBeenCalledWith('Failed to save bids: boom');
      const row = c.editBidsRows()[rowOf('Alpha Coop')];
      expect(row.bids['YC#0']).toBe('4.30');
      expect(row.originalBids['YC#0']).toBe('4.10');
      expect(c.editBidsMode()).toBe(true);
    });

    it('edits made while a save is in flight are coalesced into exactly one follow-up save', () => {
      const inFlight = new Subject<void>();
      api.bulkUpsertBidSheetBids.mockImplementationOnce(() => inFlight);
      build(['2040']);
      c.openEditBids();

      c.updateBid(rowOf('Alpha Coop'), 'YC#0', '4.30');
      c.onBidBlur();
      c.updateBid(rowOf('Bravo Grain'), 'YC#0', '4.35');
      c.onBidBlur();
      c.onBidBlur();
      expect(api.bulkUpsertBidSheetBids).toHaveBeenCalledTimes(1);

      inFlight.next();
      inFlight.complete();

      expect(api.bulkUpsertBidSheetBids).toHaveBeenCalledTimes(2);
      const second = api.bulkUpsertBidSheetBids.mock.calls[1][0];
      expect(second.map(b => [b.name, b.commodityCode, b.bid])).toEqual([['Bravo Grain', 'YC', '4.35']]);
    });

    it('changing the edit year saves first; on save failure the year does not change', () => {
      api.bulkUpsertBidSheetBids.mockImplementation(() => throwError(() => new Error('boom')));
      build(['2040']);
      c.openEditBids();
      c.updateBid(rowOf('Alpha Coop'), 'YC#0', '4.30');
      c.prevEditYear();

      expect(api.bulkUpsertBidSheetBids).toHaveBeenCalledTimes(1);
      expect(api.bulkUpsertBidSheetBids.mock.calls[0][0][0]).toMatchObject({ cropYear: 2026, bid: '4.30' });
      expect(c.editBidsYear()).toBe(2026);
      expect(c.editBidsRows()[rowOf('Alpha Coop')].bids['YC#0']).toBe('4.30');
    });

    it('changing the month columns flushes edits against the CURRENT columns first', () => {
      build(['2040']);
      c.openEditBids();
      c.updateBid(rowOf('Bravo Grain'), 'SB#0', '9.80');
      c.openMonthDropdown();
      c.toggleEditMonth(4);
      c.confirmMonthSelection();

      expect(api.bulkUpsertBidSheetBids.mock.calls[0][0]).toEqual([
        expect.objectContaining({ name: 'Bravo Grain', commodityCode: 'SB', month: 0, bid: '9.80', cropYear: 2026 }),
      ]);
      expect(c.editBidsMonths()).toEqual([0, 4]);
    });

    it('Done flushes remaining edits, reports the session total, tracks the location and reloads', () => {
      build(['2040']);
      c.openEditBids();
      c.updateBid(rowOf('Alpha Coop'), 'YC#0', '4.30');
      c.onBidBlur(); // auto-saved: counts toward the session total
      c.updateBid(rowOf('Bravo Grain'), 'YC#0', '4.35');
      api.getBidSheetLocations.mockClear();

      c.doneEditBids();

      expect(api.bulkUpsertBidSheetBids).toHaveBeenCalledTimes(2);
      expect(usage.postClickEvent).toHaveBeenCalledWith('interaction', 'bidsheet', 'bids-changed', 'Bravo Grain');
      expect(toast.success).toHaveBeenCalledWith('Saved 2 bid changes successfully', 4000);
      expect(c.editBidsMode()).toBe(false);
      expect(c.editBidsSaving()).toBe(false);
      expect(api.getBidSheetLocations).toHaveBeenCalledWith('2040');
    });

    it('a failed Done keeps the grid open with the edit intact', () => {
      build(['2040']);
      c.openEditBids();
      c.updateBid(rowOf('Alpha Coop'), 'YC#0', '4.30');
      api.bulkUpsertBidSheetBids.mockImplementation(() => throwError(() => new Error('boom')));
      c.doneEditBids();

      expect(toast.error).toHaveBeenCalledWith('Failed to save bids: boom');
      expect(c.editBidsMode()).toBe(true);
      expect(c.editBidsSaving()).toBe(false);
      expect(c.editBidsRows()[rowOf('Alpha Coop')].bids['YC#0']).toBe('4.30');
    });
  });

  // ── Location rename / Scoular toggle ──────────────────────────────────────

  describe('location rename and Scoular status', () => {
    it('saveLocationName sends the trimmed name with every other field unchanged, then reloads', () => {
      build(['2040']);
      c.panelSelectedLocation.set('Alpha Coop');
      c.startEditLocationName();
      expect(c.editLocationNameValue()).toBe('Alpha Coop');
      c.editLocationNameValue.set('  Alpha Co-op West  ');
      api.getAllBidSheetLocations.mockClear();
      api.getBidSheetLocations.mockClear();

      c.saveLocationName();

      expect(api.updateBidSheetLocation).toHaveBeenCalledWith(1, {
        name: 'Alpha Co-op West',
        address: '1 Main St',
        city: 'Pratt',
        state: 'KS',
        latitude: 37.6,
        longitude: -98.7,
        elevatorCode: 'ALP',
        tradeUnitCode: '2040',
        groupName: 'Kansas',
        isScoularFacility: false,
      });
      expect(c.panelSelectedLocation()).toBe('Alpha Co-op West');
      expect(c.selectedLocationName()).toBe('Alpha Co-op West');
      expect(c.editingLocationName()).toBe(false);
      expect(toast.success).toHaveBeenCalledWith('Location renamed to Alpha Co-op West');
      expect(api.getAllBidSheetLocations).toHaveBeenCalledTimes(1);
      expect(api.getBidSheetLocations).toHaveBeenCalledWith('2040');
    });

    it('a blank or unchanged name cancels the edit without calling the API', () => {
      build(['2040']);
      c.panelSelectedLocation.set('Alpha Coop');
      c.startEditLocationName();
      c.editLocationNameValue.set('   ');
      c.saveLocationName();
      c.startEditLocationName();
      c.saveLocationName(); // unchanged

      expect(api.updateBidSheetLocation).not.toHaveBeenCalled();
      expect(c.editingLocationName()).toBe(false);
    });

    it('a failed rename shows an error and leaves the selection on the old name', () => {
      api.updateBidSheetLocation.mockImplementation(() => throwError(() => new Error('down')));
      build(['2040']);
      c.panelSelectedLocation.set('Alpha Coop');
      c.startEditLocationName();
      c.editLocationNameValue.set('Renamed');
      c.saveLocationName();

      expect(toast.error).toHaveBeenCalledWith('Failed to rename location');
      expect(c.panelSelectedLocation()).toBe('Alpha Coop');
      expect(c.editingLocationName()).toBe(true);
    });

    it('toggleLocationScoularStatus sends the flipped flag with every other field unchanged and updates both caches', () => {
      build(['2040']);
      c.panelSelectedLocation.set('Charlie Elevator');
      expect(c.panelSelectedIsScoular()).toBe(true);

      c.toggleLocationScoularStatus();

      expect(api.updateBidSheetLocation).toHaveBeenCalledWith(3, {
        name: 'Charlie Elevator',
        address: undefined,
        city: undefined,
        state: undefined,
        latitude: 38.2,
        longitude: -98.4,
        elevatorCode: undefined,
        tradeUnitCode: '2040',
        groupName: 'Kansas',
        isScoularFacility: false,
      });
      expect(c.panelSelectedIsScoular()).toBe(false);
      expect(c.scoularLocationNames().has('Charlie Elevator')).toBe(false);
      expect(c.bidLocations().find(l => l.id === 3)?.isScoularFacility).toBe(false);
      expect(toast.success).toHaveBeenCalledWith('Charlie Elevator unmarked as Scoular facility');

      c.panelSelectedLocation.set('Alpha Coop');
      c.toggleLocationScoularStatus();
      expect(api.updateBidSheetLocation).toHaveBeenLastCalledWith(1, expect.objectContaining({ name: 'Alpha Coop', isScoularFacility: true }));
      expect(toast.success).toHaveBeenLastCalledWith('Alpha Coop marked as Scoular facility');
    });

    it('a failed Scoular toggle shows an error and leaves the flag unchanged', () => {
      api.updateBidSheetLocation.mockImplementation(() => throwError(() => new Error('down')));
      build(['2040']);
      c.panelSelectedLocation.set('Charlie Elevator');
      c.toggleLocationScoularStatus();

      expect(toast.error).toHaveBeenCalledWith('Failed to update Scoular status');
      expect(c.panelSelectedIsScoular()).toBe(true);
    });
  });

  // ── Read-only (All Producers) ─────────────────────────────────────────────

  describe('read-only mode (no trade unit)', () => {
    it('blocks bid edits, auto-save, rename, Scoular toggle and delete', () => {
      build([], []);
      c.openEditBids();
      const alphaRow = rowOf('Alpha Coop');
      expect(alphaRow).toBeGreaterThanOrEqual(0);

      c.updateBid(alphaRow, 'SB#0', '99.00');
      expect(c.editBidsRows()[alphaRow].bids['SB#0']).toBe('10.00');
      c.onBidBlur();

      c.panelSelectedLocation.set('Alpha Coop');
      c.editLocationNameValue.set('Renamed');
      c.saveLocationName();
      c.toggleLocationScoularStatus();
      c.confirmDeleteLocation();

      expect(api.bulkUpsertBidSheetBids).not.toHaveBeenCalled();
      expect(api.updateBidSheetLocation).not.toHaveBeenCalled();
      expect(api.deleteBidSheetLocation).not.toHaveBeenCalled();
    });
  });

  // ── Map markers (fake Leaflet) ────────────────────────────────────────────

  describe('map markers', () => {
    const html = (m: FakeMarker): string => m.icon.html;
    const at = (m: FakeMarker): [number, number] => m.latlng;

    it('a selected crop draws one bid pill per bidding location, grey with no reference', () => {
      build(['2040']);
      c.selectedCrop.set('YC');
      c.filterBids();
      const map = attachFakeMap(c, 10);
      map.refresh();

      // Charlie has no corn bid; Delta is outside the trade unit — neither gets a pin.
      expect(map.markers.map(at)).toEqual([[37.6, -98.7], [37.9, -98.2]]);
      expect(html(map.markers[0])).toContain('>4.10</div>');
      expect(html(map.markers[1])).toContain('>4.25</div>');
      expect(html(map.markers[0])).toContain('background:#6b7280;border:2px solid #4b5563');
      expect(map.markers[0].icon.iconSize).toEqual([58, 44]);
      expect(map.markers[0].icon.iconAnchor).toEqual([29, 44]);
      expect(map.markers[0].icon.className).toBe('custom-marker');
    });

    it('a reference location turns its pill blue and grades the others (beating = red)', () => {
      build(['2040']);
      c.selectedCrop.set('YC');
      c.selectedLocationName.set('Alpha Coop');
      c.filterBids();
      const map = attachFakeMap(c, 10);
      map.refresh();

      expect(html(map.markers[0])).toContain('background:#2563eb;border:2px solid #1d4ed8');
      expect(html(map.markers[0])).toContain('border-top:8px solid #2563eb');
      expect(html(map.markers[1])).toContain('background:#dc2626;border:2px solid #991b1b');
    });

    it('name labels: a Scoular facility is filled green with no reference, ringed green once one is set', () => {
      build(['2040']);
      c.selectedCrop.set('');
      c.filterBids();
      const map = attachFakeMap(c, 10);
      map.refresh();

      const charlie = () => map.markers.find(m => html(m).includes('Charlie Elevator'))!;
      expect(map.markers).toHaveLength(3);
      expect(html(charlie())).toContain('background:#00875F;border:2px solid #006B4C');
      expect(html(charlie())).not.toContain('#00A36F');
      const alphaLabel = map.markers.find(m => html(m).includes('Alpha Coop'))!;
      expect(html(alphaLabel)).toContain('background:#6b7280;border:2px solid #4b5563'); // grey #9ca3af maps to the darker label grey
      expect(alphaLabel.icon.iconSize).toEqual([80, 34]);

      c.selectedLocationName.set('Alpha Coop');
      c.filterBids();
      map.refresh();
      expect(html(charlie())).toContain('box-shadow:0 0 0 4px #00A36F;');
      expect(html(map.markers.find(m => html(m).includes('Alpha Coop'))!)).toContain('background:#2563eb');
    });

    it('below zoom 6 locations are dots, spread apart when they would overlap on screen', () => {
      build(['2040']);
      c.selectedCrop.set('');
      c.filterBids();
      const map = attachFakeMap(c, 5);
      map.refresh();

      expect(map.markers).toHaveLength(3);
      expect(map.markers.map(m => m.icon.iconSize)).toEqual([[14, 14], [14, 14], [14, 14]]);
      expect(html(map.markers[0])).toContain('background:#9ca3af;border:2px solid #6b7280');
      expect(html(map.markers[2])).toContain('background:#00875F;border:2px solid #006B4C'); // Charlie (Scoular)
      expect(html(map.markers[2])).toContain('box-shadow:0 1px 3px'); // no ring without a reference

      // All three sit within 48px of each other at zoom 5, so each is pushed 24px out from their centroid.
      const s = map.scale(5);
      const raw = [[37.6, -98.7], [37.9, -98.2], [38.2, -98.4]].map(([lat, lng]) => ({ x: lng * s, y: -lat * s }));
      const cx = raw.reduce((a, p) => a + p.x, 0) / 3, cy = raw.reduce((a, p) => a + p.y, 0) / 3;
      for (const m of map.markers) {
        const [lat, lng] = at(m);
        expect(Math.hypot(lng * s - cx, -lat * s - cy)).toBeCloseTo(24, 6);
      }
    });

    it('hovering swaps in the expanded name + bid icon, raises it, and resets the previously hovered pin', () => {
      build(['2040']);
      c.selectedCrop.set('YC');
      c.filterBids();
      const map = attachFakeMap(c, 5);
      map.refresh();
      const [a, b] = map.markers;
      const original = a.icon;

      a.handlers['mouseover']();
      expect(html(a)).toContain('>Alpha Coop</div>');
      expect(html(a)).toContain('>4.10</div>');
      expect(a.icon.iconSize).toEqual([100, 50]);
      expect(a.zIndex).toBe(2000);

      b.handlers['mouseover'](); // a's mouseout never fired — it must still be reset
      expect(a.icon).toBe(original);
      expect(a.zIndex).toBe(0);

      b.handlers['mouseout']();
      expect(b.zIndex).toBe(0);
      expect(html(b)).not.toContain('Bravo Grain');
    });

    it('the location open in the panel is drawn expanded with its status colour', () => {
      build(['2040']);
      c.selectedCrop.set('YC');
      c.selectedLocationName.set('Alpha Coop');
      c.panelSelectedLocation.set('Bravo Grain');
      c.filterBids();
      const map = attachFakeMap(c, 10);
      map.refresh();

      const open = map.markers.find(m => m.opts.zIndexOffset === 1000)!;
      expect(html(open)).toContain('>Bravo Grain</div>');
      expect(html(open)).toContain('>4.25</div>');
      expect(html(open)).toContain('background:#dc2626;border:2px solid #991b1b');
    });

    it('a search filters the pins and forces labels even below zoom 6', () => {
      build(['2040']);
      c.selectedCrop.set('YC');
      c.filterBids();
      c.searchQuery.set('BRAV');
      const map = attachFakeMap(c, 5);
      map.refresh();

      expect(map.markers).toHaveLength(1);
      expect(html(map.markers[0])).toContain('>4.25</div>');
      expect(at(map.markers[0])).toEqual([37.9, -98.2]);
    });

    it('clicking a pin sets it as the reference and opens the panel; clicking again clears it', () => {
      build(['2040']);
      c.selectedCrop.set('YC');
      c.filterBids();
      const map = attachFakeMap(c, 10);
      map.refresh();

      map.markers[1].handlers['click']();
      expect(c.selectedLocationName()).toBe('Bravo Grain');
      expect(c.showPanel()).toBe(true);
      expect(map.map.flyTo).toHaveBeenCalled();

      map.markers.find(m => html(m).includes('4.25'))!.handlers['click']();
      expect(c.selectedLocationName()).toBe('');
    });

    it('stacked labels colour and escape each name on its own line', () => {
      const shared = { latitude: 40.1, longitude: -97.5, tradeUnitCode: '2040', groupName: 'Kansas' };
      api.getAllBidSheetLocations.mockImplementation(() => of([
        makeLocation({ id: 10, name: `O'Neil <Grain> & Co "East"`, ...shared }),
        makeLocation({ id: 11, name: 'Scoular Plant', isScoularFacility: true, ...shared }),
      ]));
      build([], []);
      c.selectedCrop.set('');
      c.filterBids();
      const map = attachFakeMap(c, 10);
      map.refresh();

      expect(map.markers).toHaveLength(1);
      const label = html(map.markers[0]);
      expect(label).toContain('O&#039;Neil &lt;Grain&gt; &amp; Co &quot;East&quot;');
      expect(label).not.toContain('<Grain>');
      expect(label).toContain('background:#6b7280;border:2px solid #4b5563;border-radius:5px'); // competitor line
      expect(label).toContain('background:#00875F;border:2px solid #006B4C;border-radius:5px'); // Scoular line
      expect(map.markers[0].icon.iconSize).toEqual([176, 60]);

      // The hover icon escapes too.
      map.markers[0].handlers['mouseover']();
      expect(html(map.markers[0])).toContain('>O&#039;Neil &lt;Grain&gt; &amp; Co &quot;East&quot;</div>');
    });

    it('add-location mode clears the pins; a map click drops the placement pin and opens the form', () => {
      build(['2040']);
      const map = attachFakeMap(c, 10);
      map.refresh();
      expect(map.markers.length).toBeGreaterThan(0);

      c.enterAddLocationMode();
      expect(map.markers).toHaveLength(0);
      map.click(39.5, -97.25);

      expect([c.newLocationLat(), c.newLocationLng()]).toEqual([39.5, -97.25]);
      expect(c.newLocationTu()).toBe('2040');
      expect(c.showAddLocationForm()).toBe(true);

      c.exitAddLocationMode();
      expect(map.map.removeLayer).toHaveBeenCalledTimes(1);
      expect(c.newLocationLat()).toBeNull();
    });
  });

  // ── Load failures ─────────────────────────────────────────────────────────

  describe('load failures', () => {
    beforeEach(() => {
      // Each per-TU fetch retries twice on a 400 ms timer — fake the timers so the test controls them.
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(NOW);
    });

    it('a trade unit that fails after retries keeps the previous data and shows an error', () => {
      api.getBidSheetLocations.mockImplementation((tu: string) => tu === '2050' ? throwError(() => new Error('down')) : of(tu2040()));
      build(['2040']);
      appState.selectedTradeUnits.set(['2050']);
      flush();
      vi.advanceTimersByTime(1000);

      expect(toast.error).toHaveBeenCalledWith('Failed to load bid data');
      expect(c.isLoading()).toBe(false);
      expect(c.bidLocations().map(l => l.name)).toEqual(['Alpha Coop', 'Bravo Grain', 'Charlie Elevator']);
      expect(c.crops()).toEqual(['SB', 'YC']);
    });

    it('a failed post-save refresh is a soft notice, never a save error', () => {
      build(['2040']);
      c.openEditBids();
      c.updateBid(rowOf('Alpha Coop'), 'YC#0', '4.30');
      api.getBidSheetLocations.mockImplementation(() => throwError(() => new Error('down')));
      c.doneEditBids();
      vi.advanceTimersByTime(1000);

      expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('Your changes were saved'));
      expect(toast.error).not.toHaveBeenCalled();
      expect(c.editBidsMode()).toBe(false);
      // The optimistic local update still shows the saved bid.
      c.selectedCrop.set('YC');
      c.filterBids();
      expect(c.filteredBidItems().find(i => i.name === 'Alpha Coop')?.newBid).toBe('4.30');
    });

    it('a failed map-location load shows an error and leaves the panel empty', () => {
      api.getAllBidSheetLocations.mockImplementation(() => throwError(() => new Error('down')));
      build([], []);

      expect(toast.error).toHaveBeenCalledWith('Failed to load map locations');
      expect(c.allMapLocations()).toEqual([]);
      expect(c.filteredBidItems()).toEqual([]);
    });

    it('a failed commodity-list load tells the user rather than leaving the crop search empty', () => {
      // The full list names crops, colours the print view and backs the crop search; losing it
      // silently made "No crops found" look like a real answer.
      api.getCommodities.mockImplementation(() => throwError(() => new Error('down')));
      build(['2040']);

      expect(c.filteredCommodities('corn')).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith('Failed to load the commodity list — crop names, colors and the crop search may be incomplete.');
    });

    it('a failed curated crop list stays quiet: the full commodity list covers the crop search', () => {
      api.getPlantingCommodities.mockImplementation(() => throwError(() => new Error('down')));
      build(['2040']);

      expect(c.filteredCommodities('corn').map(x => x.code)).toEqual(['YC']);
      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});
