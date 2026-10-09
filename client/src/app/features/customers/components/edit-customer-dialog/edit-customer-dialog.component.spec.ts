import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { EditCustomerDialogComponent } from './edit-customer-dialog.component';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { AppStateService } from '@core/services/app-state.service';
import { Customer, PlantingIntention } from '@models';

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
      { commodityCode: 'YC', bushelsOnHand: '80,000', bushelsSold: '30,000', grade: '', targetBushels: '-0.25', lastBid: '-$0.3525' },
      { commodityCode: 'YSB', bushelsOnHand: '40000', bushelsSold: '', grade: '', targetBushels: '$12.50', lastBid: '' },
    ]);

    component.onSave();

    const grain = (saved.at(-1) as unknown as { grainOnFarm: { commodityCode: string; bushelsSold?: number; targetBushels?: number; lastBid?: number }[] }).grainOnFarm;
    expect(grain).toEqual([
      expect.objectContaining({ commodityCode: 'YC', bushelsSold: 30000, targetBushels: -0.25, lastBid: -0.3525 }),
      expect.objectContaining({ commodityCode: 'YSB', bushelsSold: undefined, targetBushels: 12.5, lastBid: undefined }),
    ]);
  });
});
