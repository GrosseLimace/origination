import { describe, expect, it } from 'vitest';
import { BidSheetLocation, BidSheetLocationBid } from '@models';
import { buildBidLookup, flattenBidEntries } from './bid-math';
import { EXPANDED_PIN_GREY, PIN_GREY, SCOULAR_BG, STATUS_COLORS } from './map-markers';
import { MarkerPlanInput, planMarkers } from './marker-plan';

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const bid = (locationId: number, commodityCode: string, value: string): BidSheetLocationBid => ({
  id: locationId, locationId, commodityCode, cropYear: 2026, month: 0, bid: value, createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z',
});
const loc = (id: number, name: string, lat: number, lng: number, bids: BidSheetLocationBid[], over: Partial<BidSheetLocation> = {}): BidSheetLocation => ({
  id, name, tradeUnitCode: '2040', createdBy: 'rep', createdAt: '2026-09-01T00:00:00Z', latitude: lat, longitude: lng, bids, ...over,
});

const ALPHA = loc(1, 'Alpha', 37.6, -98.7, [bid(1, 'YC', '4.10')]);
const BRAVO = loc(2, 'Bravo', 37.9, -98.2, [bid(2, 'YC', '4.25')]);
const OURS = loc(3, 'Ours', 38.2, -98.4, [], { isScoularFacility: true });
const RIVAL = loc(4, 'Rival', 38.2004, -98.4004, [bid(4, 'YC', '4.00')]); // rounds to Ours' coordinate
const NOWHERE = loc(5, 'Nowhere', 0, 0, [bid(5, 'YC', '9.99')]);           // 0,0 = no coordinates
const OTHER_TU = loc(6, 'Other', 39, -99, [bid(6, 'YC', '3.00')], { tradeUnitCode: '2050' });
const ALL = [ALPHA, BRAVO, OURS, RIVAL, NOWHERE, OTHER_TU];

function input(over: Partial<MarkerPlanInput> = {}): MarkerPlanInput {
  return {
    locations: ALL, activeTus: [], crop: 'YC', year: 2026, month: 0, refName: '', panelOpenName: '', searchQuery: '',
    panelNames: new Set(), hasIndividualTu: true, zoom: 10, scoularNames: new Set(['Ours']),
    lookup: buildBidLookup(flattenBidEntries(ALL)), ...over,
  };
}
const kinds = (plan: ReturnType<typeof planMarkers>) => plan.map(p => p.icon.html.includes('width:14px') ? 'dot'
  : p.zIndexOffset === 1000 ? 'panel' : p.icon.html.includes('border-radius:6px') ? 'pills' : 'label');

describe('planMarkers — grouping and filtering', () => {
  it('groups locations sharing a coordinate (3 d.p.), skips those without one, and keeps the first location as target', () => {
    const plan = planMarkers(input({ crop: '' }));
    expect(plan.map(p => p.target.name)).toEqual(['Alpha', 'Bravo', 'Ours', 'Other']);
    expect(plan[2].position).toEqual([38.2, -98.4]);
    expect(plan[2].icon.html).toContain('>Rival</div>');
  });

  it('with a crop selected, drops groups where nobody bids it', () => {
    const plan = planMarkers(input({ crop: 'SB' }));
    expect(plan).toEqual([]);
  });

  it('with a trade unit active, only draws groups listed in the panel', () => {
    const plan = planMarkers(input({ activeTus: ['2040'], panelNames: new Set(['Bravo', 'Rival']) }));
    expect(plan.map(p => p.target.name)).toEqual(['Bravo', 'Ours']);
  });

  it('a search keeps groups with any matching name (case-insensitive)', () => {
    expect(planMarkers(input({ searchQuery: 'RIV' })).map(p => p.target.name)).toEqual(['Ours']);
  });
});

describe('planMarkers — presentation', () => {
  it('zoomed in with a crop: bid pills with a hover showing the first location and its bid', () => {
    const plan = planMarkers(input());
    expect(kinds(plan)).toEqual(['pills', 'pills', 'pills', 'pills']);
    expect(plan[0].hover).toEqual({ name: 'Alpha', bid: '4.10', bg: STATUS_COLORS['none'].bg, border: STATUS_COLORS['none'].border });
    expect(plan[0].zIndexOffset).toBeUndefined();
  });

  it('outside the active trade unit the pin falls back to a name label', () => {
    const plan = planMarkers(input({ activeTus: ['2050'], panelNames: new Set(['Alpha', 'Other']) }));
    expect(plan.map(p => [p.target.name, kinds([p])[0]])).toEqual([['Alpha', 'label'], ['Other', 'pills']]);
  });

  it('below zoom 6 groups are dots, unless a search is running', () => {
    expect(kinds(planMarkers(input({ zoom: 5 })))).toEqual(['dot', 'dot', 'dot', 'dot']);
    expect(kinds(planMarkers(input({ zoom: 5, searchQuery: 'a' })))).not.toContain('dot');
  });

  it('dots and labels follow the reference / status / Scoular / grey order', () => {
    const plan = planMarkers(input({ zoom: 5, refName: 'Alpha' }));
    expect(plan.map(p => p.hover!.bg)).toEqual([STATUS_COLORS['reference'].bg, STATUS_COLORS['beating'].bg, STATUS_COLORS['none'].bg, STATUS_COLORS['none'].bg]);
    const noRef = planMarkers(input({ zoom: 5, crop: '' }));
    expect(noRef.map(p => p.hover!.bg)).toEqual([PIN_GREY.bg, PIN_GREY.bg, SCOULAR_BG, PIN_GREY.bg]);
  });

  it('the panel-open location is expanded on top, without a hover swap', () => {
    const plan = planMarkers(input({ panelOpenName: 'Bravo', refName: 'Alpha' }));
    const open = plan.find(p => p.zIndexOffset === 1000)!;
    expect(open.target.name).toBe('Bravo');
    expect(open.hover).toBeNull();
    expect(open.icon.html).toContain('>Bravo</div>');
    expect(open.icon.html).toContain(`background:${STATUS_COLORS['beating'].bg}`);
    const noRef = planMarkers(input({ panelOpenName: 'Bravo' })).find(p => p.zIndexOffset === 1000)!;
    expect(noRef.icon.html).toContain(`background:${EXPANDED_PIN_GREY.bg}`);
  });

  it('the reference pill shows "--" when the reference has no bid for the crop', () => {
    const plan = planMarkers(input({ refName: 'Ours' }));
    const ours = plan.find(p => p.target.name === 'Ours')!;
    expect(ours.icon.html).toContain('>--</div>');
    expect(ours.icon.html).toContain('>4.00</div>');
  });
});
