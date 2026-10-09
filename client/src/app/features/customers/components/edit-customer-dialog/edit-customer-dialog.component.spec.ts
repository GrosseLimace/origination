import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { EditCustomerDialogComponent } from './edit-customer-dialog.component';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { AppStateService } from '@core/services/app-state.service';
import { Customer, PlantingIntention } from '@models';
import { MAX_BIN_SITES } from '@shared/utils/coordinates';

// Removing a trade unit doesn't unplant the acres. When the producer has planting intentions
// recorded against the trade unit being removed, the dialog asks where those acres should count
// instead — otherwise they would sit on a trade unit the producer has left and be counted on no
// dashboard at all.

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: '', location: '',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, ...over,
  };
}

function makeIntention(over: Partial<PlantingIntention> = {}): PlantingIntention {
  return {
    id: 1, customerId: 42, customerName: 'Sample Farms', customerCode: 'SAMPFRM', tradeUnit: '2210',
    plantingYear: 2026, crop: 'YSB', acres: 390, createdAt: '2026-01-01', createdBy: 'x', ...over,
  };
}

type Membership = { tradeUnit: string; isManual: boolean; hasOpenActivity: boolean; isActive: boolean };
const manual = (tradeUnit: string): Membership => ({ tradeUnit, isManual: true, hasOpenActivity: false, isActive: true });
const locked = (tradeUnit: string): Membership => ({ tradeUnit, isManual: false, hasOpenActivity: true, isActive: true });

describe('EditCustomerDialogComponent — removing a trade unit with planting intentions', () => {
  let component: EditCustomerDialogComponent;
  let ref: ComponentRef<EditCustomerDialogComponent>;
  let intentions: PlantingIntention[];
  // The dialog emits the moves; the parent runs them, because it owns the cached intention lists.
  let saved: { intentionMoves: { from: string; to: string }[] }[];

  beforeEach(() => {
    intentions = [];
    saved = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApiService,
          useValue: {
            getAllTradeUnits: () => of([]),
            getCommodities: () => of([]),
            getPlantingCommodities: () => of([]),
            getCustomerTradeUnits: () => of([]),
            getCustomers: () => of([]),
            getPlantingIntentionsByCustomer: () => of(intentions),
            removeDormantTradeUnit: () => of(undefined),
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {} } },
        {
          provide: AppStateService,
          useValue: {
            inScopeGroupNames: signal<readonly string[]>([]),
            inScopeTradeUnitCodes: signal<readonly string[]>(['2190', '2210']),
          },
        },
      ],
    });
    // happy-dom + JIT can't fetch templateUrl; these rules are class-level.
    TestBed.overrideComponent(EditCustomerDialogComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(EditCustomerDialogComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer());
    component.save.subscribe(payload => saved.push(payload));
  });

  /** The moves the dialog handed the parent on the last Save. */
  function emittedMoves(): { from: string; to: string }[] {
    return saved.at(-1)?.intentionMoves ?? [];
  }

  /** Put the producer on the given memberships without going through the open-dialog effect. */
  function withMemberships(...memberships: Membership[]): void {
    component.currentTradeUnits.set(memberships);
    component.selectedTuCodes.set(memberships.filter(m => m.isManual && m.isActive).map(m => m.tradeUnit));
  }

  it('removes the trade unit with no prompt when nothing is planted for it', () => {
    withMemberships(manual('2190'), manual('2210'));
    intentions = [];

    component.removeTradeUnit('2210');

    expect(component.tuRemovalPrompt()).toBeNull();
    expect(component.selectedTuCodes()).toEqual(['2190']);
  });

  it('asks where the acres go, with the counts for that trade unit only', () => {
    withMemberships(manual('2190'), manual('2210'));
    intentions = [
      makeIntention({ id: 1, tradeUnit: '2210', acres: 390, plantingYear: 2026 }),
      makeIntention({ id: 2, tradeUnit: '2210', acres: 110, plantingYear: 2025 }),
      makeIntention({ id: 3, tradeUnit: '2190', acres: 999, plantingYear: 2026 }),
    ];

    component.removeTradeUnit('2210');

    const prompt = component.tuRemovalPrompt();
    expect(prompt).not.toBeNull();
    expect(prompt!.code).toBe('2210');
    expect(prompt!.count).toBe(2);
    expect(prompt!.acres).toBe(500);
    expect(prompt!.years).toEqual([2026, 2025]);
    // Not removed yet — the chip stays until the prompt is answered.
    expect(component.selectedTuCodes()).toContain('2210');
  });

  it('preselects the only remaining trade unit and moves the acres there on save', () => {
    withMemberships(manual('2190'), manual('2210'));
    intentions = [makeIntention({ tradeUnit: '2210' })];

    component.removeTradeUnit('2210');
    expect(component.tuRemovalPrompt()!.targets).toEqual(['2190']);
    expect(component.tuRemovalTarget()).toBe('2190');

    component.confirmTradeUnitRemoval();
    expect(component.selectedTuCodes()).toEqual(['2190']);

    component.onSave();
    expect(emittedMoves()).toEqual([{ from: '2210', to: '2190' }]);
  });

  it('makes the user choose when more than one trade unit remains', () => {
    withMemberships(manual('2190'), manual('2210'), locked('2080'));
    intentions = [makeIntention({ tradeUnit: '2210' })];

    component.removeTradeUnit('2210');

    expect(component.tuRemovalPrompt()!.targets).toEqual(['2080', '2190']);
    expect(component.tuRemovalTarget()).toBe('');
  });

  it('leaves the acres alone when the user declines to move them', () => {
    withMemberships(manual('2190'), manual('2210'));
    intentions = [makeIntention({ tradeUnit: '2210' })];

    component.removeTradeUnit('2210');
    component.tuRemovalTarget.set('');   // "leave them"
    component.confirmTradeUnitRemoval();

    expect(component.selectedTuCodes()).toEqual(['2190']);
    component.onSave();
    expect(emittedMoves()).toEqual([]);
  });

  it('keeps the trade unit when the prompt is cancelled', () => {
    withMemberships(manual('2190'), manual('2210'));
    intentions = [makeIntention({ tradeUnit: '2210' })];

    component.removeTradeUnit('2210');
    component.cancelTradeUnitRemoval();

    expect(component.tuRemovalPrompt()).toBeNull();
    expect(component.selectedTuCodes()).toContain('2210');
    component.onSave();
    expect(emittedMoves()).toEqual([]);
  });

  it('drops a staged move when the trade unit is added back', () => {
    withMemberships(manual('2190'), manual('2210'));
    intentions = [makeIntention({ tradeUnit: '2210' })];

    component.removeTradeUnit('2210');
    component.confirmTradeUnitRemoval();      // stages 2210 → 2190
    component.addTradeUnit('2210');           // undo

    component.onSave();
    expect(emittedMoves()).toEqual([]);
  });

  it('offers no destination when the producer keeps no other trade unit', () => {
    withMemberships(manual('2210'));
    intentions = [makeIntention({ tradeUnit: '2210' })];

    component.removeTradeUnit('2210');

    expect(component.tuRemovalPrompt()!.targets).toEqual([]);
    expect(component.tuRemovalTarget()).toBe('');
  });

  it('never offers a trade unit added in this same dialog, which is not a membership yet', () => {
    withMemberships(manual('2210'));
    intentions = [makeIntention({ tradeUnit: '2210' })];

    component.addTradeUnit('2190');  // staged, not yet saved
    component.removeTradeUnit('2210');

    expect(component.tuRemovalPrompt()!.targets).toEqual([]);
  });

  it('still removes the trade unit when the intention lookup fails', () => {
    withMemberships(manual('2190'), manual('2210'));
    TestBed.inject(ApiService).getPlantingIntentionsByCustomer = () => throwError(() => new Error('boom'));

    component.removeTradeUnit('2210');

    expect(component.tuRemovalPrompt()).toBeNull();
    expect(component.selectedTuCodes()).toEqual(['2190']);
  });

  // Not a trade-unit rule, but this suite already drives onSave(): Target and Last bid are basis
  // values that can be negative, so the minus sign must survive parsing ("$" and commas don't).
  it('saves grain-on-farm Target and Last bid as signed numbers, blank as not entered', () => {
    withMemberships(manual('2190'));
    component.editGrainOnFarm.set([
      { siteKey: null, commodityCode: 'YC', bushelsOnHand: '80,000', bushelsSold: '30,000', grade: '', targetBushels: '-0.25', lastBid: '-$0.3525' },
      { siteKey: null, commodityCode: 'YSB', bushelsOnHand: '40000', bushelsSold: '', grade: '', targetBushels: '$12.50', lastBid: '' },
    ]);

    component.onSave();

    const grain = (saved.at(-1) as unknown as { grainOnFarm: { commodityCode: string; bushelsSold?: number; targetBushels?: number; lastBid?: number }[] }).grainOnFarm;
    expect(grain).toEqual([
      expect.objectContaining({ commodityCode: 'YC', bushelsSold: 30000, targetBushels: -0.25, lastBid: -0.3525 }),
      expect.objectContaining({ commodityCode: 'YSB', bushelsSold: undefined, targetBushels: 12.5, lastBid: undefined }),
    ]);
  });
});

// Bin sites: an optional name plus one "lat, lng" paste field per row, as many as needed, enforced
// against the North American rules before Save is allowed. The rules themselves are unit-tested in
// @shared/utils/coordinates.spec.ts — these cover the dialog's row handling and the emitted payload.
describe('EditCustomerDialogComponent — bin sites', () => {
  let component: EditCustomerDialogComponent;
  let ref: ComponentRef<EditCustomerDialogComponent>;
  let saved: {
    commodities: string[];
    binSites: { siteKey: string; name?: string; latitude?: number; longitude?: number; capacity?: number }[];
    grainOnFarm: { binSiteKey?: string; commodityCode: string; bushelsOnHand?: number }[];
  }[];

  beforeEach(() => {
    saved = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApiService,
          useValue: {
            getAllTradeUnits: () => of([]),
            getCommodities: () => of([]),
            getPlantingCommodities: () => of([]),
            getCustomerTradeUnits: () => of([]),
            // Non-empty on purpose: the producer-search preload effect re-fetches while its cache
            // is empty, so a synchronous empty result would loop TestBed.tick() forever.
            getCustomers: () => of([makeCustomer({ id: 7, name: 'Other Farm' })]),
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {} } },
        {
          provide: AppStateService,
          useValue: {
            inScopeGroupNames: signal<readonly string[]>([]),
            inScopeTradeUnitCodes: signal<readonly string[]>([]),
          },
        },
      ],
    });
    TestBed.overrideComponent(EditCustomerDialogComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(EditCustomerDialogComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    component.save.subscribe(payload => saved.push(payload));
  });

  /** Opens the dialog on a producer so the open effect hydrates the rows and change snapshot. */
  function open(customer: Customer): void {
    ref.setInput('customer', customer);
    ref.setInput('isOpen', true);
    TestBed.tick();
  }

  it('hydrates saved sites as six-place coordinate text, unchanged until edited', () => {
    open(makeCustomer({ binSites: [{ name: 'Anderson Site', latitude: 39.115876, longitude: -95.143955 }] }));

    expect(component.editBinSites()).toEqual([{ key: expect.any(String), name: 'Anderson Site', coords: '39.115876, -95.143955', capacity: '' }]);
    expect(component.hasChanges()).toBe(false);
  });

  it('lets the user add more than three sites', () => {
    open(makeCustomer());

    for (let i = 0; i < 8; i++) component.addBinSiteRow();

    expect(component.editBinSites()).toHaveLength(8);
  });

  it('stops only at the server sanity ceiling, so it never builds a request the API rejects', () => {
    open(makeCustomer());

    for (let i = 0; i < MAX_BIN_SITES + 5; i++) component.addBinSiteRow();

    expect(component.editBinSites()).toHaveLength(MAX_BIN_SITES);
  });

  it('flags a row whose coordinates break the rules and blocks Save', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', 'North Bins');
    component.updateBinSiteField(0, 'coords', '39.115876, 95.143955');

    expect(component.binSiteErrors()[0]).toContain('minus sign');
    expect(component.binSiteCoordsInvalid()[0]).toBe(true);
    expect(component.binSitesInvalid()).toBe(true);
  });

  // Only the Name is required (user 2026-10-09).
  it('accepts a named row with nothing else', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', 'North Bins');

    expect(component.binSiteErrors()[0]).toBeNull();
    expect(component.binSitesInvalid()).toBe(false);
  });

  it('asks for a name once a row has anything in it, and outlines only the name', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'coords', '41.39, -95.01');

    expect(component.binSiteErrors()[0]).toContain('name');
    expect(component.binSiteNameMissing()[0]).toBe(true);
    expect(component.binSiteCoordsInvalid()[0]).toBe(false);
    expect(component.binSitesInvalid()).toBe(true);
  });

  it('saves a site with no coordinates, without latitude or longitude', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', 'Home place');
    component.onBinSiteCapacityInput(0, '20000');

    component.onSave();

    expect(saved.at(-1)?.binSites).toEqual([{
      siteKey: expect.any(String), name: 'Home place', latitude: undefined, longitude: undefined, capacity: 20000,
    }]);
  });

  it('does not count an added-then-left-blank row as a change or an error', () => {
    open(makeCustomer());
    component.addBinSiteRow();

    expect(component.binSitesInvalid()).toBe(false);
    expect(component.hasChanges()).toBe(false);
  });

  it('emits the full pasted precision in row order and drops blank rows', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.addBinSiteRow();
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', '  North Bins ');
    component.updateBinSiteField(0, 'coords', '41.39034548435109, -95.00754031349179');
    component.updateBinSiteField(2, 'name', 'South');
    component.updateBinSiteField(2, 'coords', '40.5,-96');
    expect(component.hasChanges()).toBe(true);

    component.onSave();

    expect(saved.at(-1)?.binSites.map(s => ({ name: s.name, latitude: s.latitude, longitude: s.longitude }))).toEqual([
      { name: 'North Bins', latitude: 41.39034548435109, longitude: -95.00754031349179 },
      { name: 'South', latitude: 40.5, longitude: -96 },
    ]);
  });

  it('reopens a saved long paste unshortened, so editing never loses digits', () => {
    open(makeCustomer({ binSites: [{ name: 'North Bins', latitude: 41.39034548435109, longitude: -95.00754031349179 }] }));

    expect(component.editBinSites()[0].coords).toBe('41.39034548435109, -95.00754031349179');
    expect(component.hasChanges()).toBe(false);
  });

  it('emits an empty list when every site is removed, so the server clears them', () => {
    open(makeCustomer({ binSites: [{ name: 'Old', latitude: 39.1, longitude: -95.1 }] }));

    component.removeBinSiteRow(0);
    expect(component.hasChanges()).toBe(true);
    component.onSave();

    expect(saved.at(-1)?.binSites).toEqual([]);
  });

  it('clears one input with its × and leaves the other alone', () => {
    open(makeCustomer({ binSites: [{ name: 'North Bins', latitude: 41.39, longitude: -95.01 }] }));

    component.clearBinSiteField(0, 'coords');
    expect(component.editBinSites()[0]).toEqual({ key: expect.any(String), name: 'North Bins', coords: '', capacity: '' });

    component.clearBinSiteField(0, 'name');
    expect(component.editBinSites()[0]).toEqual({ key: expect.any(String), name: '', coords: '', capacity: '' });
  });

  it('rewrites a valid free-hand entry as "lat, lng" when the field loses focus', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'coords', '41.39 N 95.01 W');

    component.normalizeBinSiteCoords(0);

    expect(component.editBinSites()[0].coords).toBe('41.39, -95.01');
  });

  it('leaves an invalid entry as typed so the user can fix it', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', 'Site 1');
    component.updateBinSiteField(0, 'coords', '39.9042, 116.4074'); // Beijing

    component.normalizeBinSiteCoords(0);

    expect(component.editBinSites()[0].coords).toBe('39.9042, 116.4074');
    expect(component.binSiteErrors()[0]).toContain('outside North America');
    expect(component.binSitesInvalid()).toBe(true);
  });

  it('saves a free-hand entry as the same decimal degrees the blur shows', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', 'Site 1');
    component.updateBinSiteField(0, 'coords', `41°23'25.2"N 95°00'27.1"W`);

    component.onSave();

    const [site] = saved.at(-1)!.binSites;
    expect(site.latitude).toBeCloseTo(41.390333333, 8);
    expect(site.longitude).toBeCloseTo(-95.007527778, 8);
  });

  // ── Capacity (bushels, per site) ────────────────────────────────────────────
  it('keeps capacity to digits and groups them as typed', () => {
    open(makeCustomer());
    component.addBinSiteRow();

    component.onBinSiteCapacityInput(0, '50000 bu');

    expect(component.editBinSites()[0].capacity).toBe('50,000');
  });

  it('asks for a name when only a capacity is entered', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.onBinSiteCapacityInput(0, '25000');

    expect(component.binSiteErrors()[0]).toContain('name');
    expect(component.binSitesInvalid()).toBe(true);
  });

  it('rejects a capacity over the Bin Capacity ceiling', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', 'Site 1');
    component.updateBinSiteField(0, 'coords', '41.39, -95.01');
    component.onBinSiteCapacityInput(0, '100000001');

    expect(component.binSiteErrors()[0]).toContain('at most 100,000,000');
  });

  it('reopens a saved capacity grouped, unchanged until edited', () => {
    open(makeCustomer({ binSites: [{ name: 'North Bins', latitude: 41.39, longitude: -95.01, capacity: 50000 }] }));

    expect(component.editBinSites()[0].capacity).toBe('50,000');
    expect(component.hasChanges()).toBe(false);
  });

  it('saves each site capacity, and sends no producer-level Bin Capacity', () => {
    // The producer-level Bin Capacity was removed 2026-10-09: capacity lives on each site.
    open(makeCustomer());
    component.addBinSiteRow();
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', 'Site 1');
    component.updateBinSiteField(1, 'name', 'Site 2');
    component.updateBinSiteField(0, 'coords', '41.39, -95.01');
    component.onBinSiteCapacityInput(0, '50,000');
    component.updateBinSiteField(1, 'coords', '40.5, -96');

    component.onSave();

    expect(saved.at(-1)?.binSites.map(s => s.capacity)).toEqual([50000, undefined]);
    expect(saved.at(-1)).not.toHaveProperty('binCapacity');
  });

  it('asks for a name when only a capacity is entered', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.onBinSiteCapacityInput(0, '500');

    expect(component.binSiteErrors()[0]).toContain('name');
  });

  it('reopens a saved site with every field filled back in', () => {
    open(makeCustomer({ binSites: [{ name: 'N', latitude: 41.39, longitude: -95.01, capacity: 50000 }] }));

    expect(component.editBinSites()[0]).toEqual({
      key: expect.any(String), name: 'N', coords: '41.39, -95.01', capacity: '50,000',
    });
    expect(component.hasChanges()).toBe(false);
  });

  // ── Grain on Farm tied to bin sites (2026-10-09) ───────────────────────────
  /** Adds a commodity row under a site the way the UI does: open its block, pick, Add. */
  function addGrain(siteKey: string, code: string): void {
    component.openGrainForSite(siteKey);
    component.selectGrainOption(code);
    component.addGrainRow(siteKey);
  }

  it('keeps a saved site\'s key, so its grain on farm stays linked', () => {
    open(makeCustomer({ binSites: [{ siteKey: 'site-north', name: 'North Bins' }] }));

    expect(component.editBinSites()[0].key).toBe('site-north');
  });

  it('gives each new site its own key', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.addBinSiteRow();

    const [a, b] = component.editBinSites().map(r => r.key);
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('"Add grain on farm" opens the site\'s block, and a picked commodity is tied to that site', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    const key = component.editBinSites()[0].key;
    expect(component.isGrainBlockOpen(key)).toBe(false);

    addGrain(key, 'YC');

    expect(component.isGrainBlockOpen(key)).toBe(true);
    expect(component.grainRowsFor(key).map(r => r.commodityCode)).toEqual(['YC']);
    expect(component.editCommodities()).toContain('YC');
  });

  it('allows the same commodity at two sites, but only once per site', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.addBinSiteRow();
    const [north, home] = component.editBinSites().map(r => r.key);

    addGrain(north, 'YC');
    addGrain(north, 'YC');
    addGrain(home, 'YC');

    expect(component.grainRowsFor(north)).toHaveLength(1);
    expect(component.grainRowsFor(home)).toHaveLength(1);
  });

  it('the picker only offers what its own site does not have yet', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.addBinSiteRow();
    const [north, home] = component.editBinSites().map(r => r.key);
    addGrain(north, 'YC');

    component.openGrainForSite(home);
    expect(component.grainPickerSite()).toBe(home);
    // Home has nothing yet, so its picker's "used" list is empty even though North has YC.
    expect(component.grainRowsFor(component.grainPickerSite())).toHaveLength(0);
  });

  it('saves each site with its key and each grain row with its site\'s key', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', 'North Bins');
    const key = component.editBinSites()[0].key;
    addGrain(key, 'YC');
    component.editGrainOnFarm()[0].bushelsOnHand = '30,000';

    component.onSave();

    const payload = saved.at(-1)!;
    expect(payload.binSites[0].siteKey).toBe(key);
    expect(payload.grainOnFarm).toEqual([expect.objectContaining({ binSiteKey: key, commodityCode: 'YC', bushelsOnHand: 30000 })]);
  });

  it('a site with grain on farm needs a name before it can save', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    addGrain(component.editBinSites()[0].key, 'YC');

    expect(component.binSiteErrors()[0]).toContain('name');
    expect(component.binSitesInvalid()).toBe(true);
    expect(component.binSiteNameMissing()[0]).toBe(true);
  });

  it('removing a site removes its grain rows, and the chip only they added', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.addBinSiteRow();
    const [north, home] = component.editBinSites().map(r => r.key);
    addGrain(north, 'YC');
    addGrain(north, 'SB');
    addGrain(home, 'SB');

    component.removeBinSiteRow(0);

    expect(component.grainRowsFor(north)).toHaveLength(0);
    expect(component.grainRowsFor(home).map(r => r.commodityCode)).toEqual(['SB']);
    expect(component.editCommodities()).not.toContain('YC');
    // Home still holds SB, so its chip stays.
    expect(component.editCommodities()).toContain('SB');
  });

  it('removing one grain row keeps a chip another site still uses', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.addBinSiteRow();
    const [north, home] = component.editBinSites().map(r => r.key);
    addGrain(north, 'YC');
    addGrain(home, 'YC');

    component.removeGrainRow(north, 'YC');

    expect(component.editCommodities()).toContain('YC');
    component.removeGrainRow(home, 'YC');
    expect(component.editCommodities()).not.toContain('YC');
  });

  it('hydrates saved grain onto its site, and rows without one into their own list', () => {
    open(makeCustomer({
      binSites: [{ siteKey: 'site-north', name: 'North Bins' }],
      grainOnFarm: [
        { binSiteKey: 'site-north', commodityCode: 'YC', bushelsOnHand: 30000 },
        { binSiteKey: null, commodityCode: 'SB', bushelsOnHand: 5000 },
        // A key naming no current site is shown as not tied, never hidden.
        { binSiteKey: 'site-gone', commodityCode: 'WH', bushelsOnHand: 100 },
      ],
    }));

    expect(component.grainRowsFor('site-north').map(r => r.commodityCode)).toEqual(['YC']);
    expect(component.unlinkedGrainRows().map(r => r.commodityCode)).toEqual(['SB', 'WH']);
    // Every site starts collapsed, so a producer with several sites isn't a wall of inputs.
    expect(component.isGrainBlockOpen('site-north')).toBe(false);
    expect(component.hasChanges()).toBe(false);
  });

  it('moves a row without a site onto a named site that does not hold that crop yet', () => {
    open(makeCustomer({
      binSites: [{ siteKey: 'site-north', name: 'North Bins' }, { siteKey: 'site-home', name: 'Home Place' }],
      grainOnFarm: [
        { binSiteKey: 'site-north', commodityCode: 'SB', bushelsOnHand: 1 },
        { binSiteKey: null, commodityCode: 'SB', bushelsOnHand: 5000 },
      ],
    }));

    // North already has SB, so only Home is offered.
    expect(component.grainMoveTargets('SB').map(t => t.name)).toEqual(['Home Place']);
    component.moveGrainRowToSite('SB', 'site-north');
    expect(component.unlinkedGrainRows()).toHaveLength(1);

    component.moveGrainRowToSite('SB', 'site-home');

    expect(component.unlinkedGrainRows()).toHaveLength(0);
    expect(component.grainRowsFor('site-home').map(r => r.bushelsOnHand)).toEqual(['5000']);
    expect(component.hasChanges()).toBe(true);
  });

  it('expands and collapses the grain under a site, and sums its bushels for the collapsed line', () => {
    open(makeCustomer({
      binSites: [{ siteKey: 'site-north', name: 'North Bins' }],
      grainOnFarm: [
        { binSiteKey: 'site-north', commodityCode: 'YC', bushelsOnHand: 30000 },
        { binSiteKey: 'site-north', commodityCode: 'SB', bushelsOnHand: 12500 },
      ],
    }));

    expect(component.grainSummaryFor('site-north')).toEqual({ count: 2, total: 42500 });
    component.toggleGrainForSite('site-north');
    expect(component.isGrainBlockOpen('site-north')).toBe(true);
    component.toggleGrainForSite('site-north');
    expect(component.isGrainBlockOpen('site-north')).toBe(false);
  });

  it('puts the picker away once a commodity is added, leaving the block open on the new row', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    const key = component.editBinSites()[0].key;

    component.openGrainForSite(key);
    expect(component.grainPickerSite()).toBe(key);
    component.selectGrainOption('YC');
    component.addGrainRow(key);

    expect(component.grainPickerSite()).toBeNull();
    expect(component.newGrainCode()).toBe('');
    expect(component.isGrainBlockOpen(key)).toBe(true);
    expect(component.grainRowsFor(key)).toHaveLength(1);
  });

  it('Cancel puts the picker away without adding anything', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    const key = component.editBinSites()[0].key;
    component.openGrainForSite(key);
    component.selectGrainOption('YC');

    component.cancelGrainPicker();

    expect(component.grainPickerSite()).toBeNull();
    expect(component.grainRowsFor(key)).toHaveLength(0);
    expect(component.hasChanges()).toBe(false);
  });
});
