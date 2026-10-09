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
});

// Bin sites: an optional name plus one "lat, lng" paste field per row, as many as needed, enforced
// against the North American rules before Save is allowed. The rules themselves are unit-tested in
// @shared/utils/coordinates.spec.ts — these cover the dialog's row handling and the emitted payload.
describe('EditCustomerDialogComponent — bin sites', () => {
  let component: EditCustomerDialogComponent;
  let ref: ComponentRef<EditCustomerDialogComponent>;
  let saved: { binCapacity: number; commodities: string[]; binSites: { name?: string; latitude: number; longitude: number; capacity?: number; commodityCode?: string }[] }[];

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

    expect(component.editBinSites()).toEqual([{ name: 'Anderson Site', coords: '39.115876, -95.143955', capacity: '', commodityCode: '' }]);
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
      name: 'Home place', latitude: undefined, longitude: undefined, capacity: 20000,
      commodityCode: undefined,
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
    expect(component.editBinSites()[0]).toEqual({ name: 'North Bins', coords: '', capacity: '', commodityCode: '' });

    component.clearBinSiteField(0, 'name');
    expect(component.editBinSites()[0]).toEqual({ name: '', coords: '', capacity: '', commodityCode: '' });
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

  it('saves each site capacity, and leaves the typed Bin Capacity alone', () => {
    // The sites are deliberately NOT summed into Bin Capacity (deferred by the user 2026-10-08).
    open(makeCustomer({ binCapacity: 40000 }));
    component.addBinSiteRow();
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', 'Site 1');
    component.updateBinSiteField(1, 'name', 'Site 2');
    component.updateBinSiteField(0, 'coords', '41.39, -95.01');
    component.onBinSiteCapacityInput(0, '50,000');
    component.updateBinSiteField(1, 'coords', '40.5, -96');

    component.onSave();

    expect(saved.at(-1)?.binSites.map(s => s.capacity)).toEqual([50000, undefined]);
    expect(saved.at(-1)?.binCapacity).toBe(40000);
  });

  // ── Commodity ───────────────────────────────────────────────────────────────
  it('asks for a name when only a commodity or capacity is entered', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.onBinSiteCapacityInput(0, '500');

    expect(component.binSiteErrors()[0]).toContain('name');
  });

  it('adds a new commodity to the chips, and takes it back off when the site changes it', () => {
    open(makeCustomer());
    component.addBinSiteRow();

    component.setBinSiteCommodity(0, 'YC');
    expect(component.editCommodities()).toContain('YC');

    component.setBinSiteCommodity(0, 'SB');
    expect(component.editCommodities()).toContain('SB');
    expect(component.editCommodities()).not.toContain('YC');

    component.removeBinSiteRow(0);
    expect(component.editCommodities()).not.toContain('SB');
  });

  it('never removes a chip the producer already had', () => {
    open(makeCustomer({ commodities: ['WH'] }));
    component.addBinSiteRow();

    component.setBinSiteCommodity(0, 'WH');
    component.setBinSiteCommodity(0, '');

    expect(component.editCommodities()).toContain('WH');
  });

  it('keeps a chip while another site still uses that commodity', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.addBinSiteRow();
    component.setBinSiteCommodity(0, 'YC');
    component.setBinSiteCommodity(1, 'YC');

    component.removeBinSiteRow(0);

    expect(component.editCommodities()).toContain('YC');
  });

  it('saves the commodity per site, and the new chip with the commodities', () => {
    open(makeCustomer());
    component.addBinSiteRow();
    component.updateBinSiteField(0, 'name', 'Site 1');
    component.updateBinSiteField(0, 'coords', '41.39, -95.01');
    component.onBinSiteCapacityInput(0, '50,000');
    component.setBinSiteCommodity(0, 'YC');

    component.onSave();

    expect(saved.at(-1)?.binSites[0]).toMatchObject({ capacity: 50000, commodityCode: 'YC' });
    expect(saved.at(-1)?.commodities).toContain('YC');
  });

  it('reopens a saved site with every field filled back in', () => {
    open(makeCustomer({ binSites: [{ name: 'N', latitude: 41.39, longitude: -95.01, capacity: 50000, commodityCode: 'YC' }] }));

    expect(component.editBinSites()[0]).toEqual({
      name: 'N', coords: '41.39, -95.01', capacity: '50,000', commodityCode: 'YC',
    });
    expect(component.hasChanges()).toBe(false);
  });
});
