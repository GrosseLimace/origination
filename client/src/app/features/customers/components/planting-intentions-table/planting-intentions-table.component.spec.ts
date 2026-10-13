import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { NEVER, of } from 'rxjs';
import { PlantingIntentionsTableComponent } from './planting-intentions-table.component';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { AppStateService } from '@core/services/app-state.service';
import { Customer, PlantingIntention } from '@models';

// Which trade unit a planting intention is recorded for. A test producer is on Pratt (2190) and
// Tribune (2210); the form offers THAT PRODUCER's trade units, auto-fills when there is only one
// answer, and otherwise makes the originator choose.

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: '', location: 'Pratt, KS',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, ...over,
  };
}

function makeIntention(over: Partial<PlantingIntention> = {}): PlantingIntention {
  return {
    id: 1, customerId: 42, customerName: 'Sample Farms', customerCode: 'SAMPFRM', tradeUnit: '2190',
    plantingYear: 2026, crop: 'YSB', category: 'Soybeans', acres: 390, createdAt: '2026-01-01', createdBy: 'x', ...over,
  };
}

type Membership = { tradeUnit: string; isManual: boolean; hasOpenActivity: boolean; isActive: boolean };
const member = (tradeUnit: string, isActive = true): Membership => ({ tradeUnit, isManual: false, hasOpenActivity: false, isActive });

describe('PlantingIntentionsTableComponent — trade unit on a row', () => {
  let component: PlantingIntentionsTableComponent;
  let ref: ComponentRef<PlantingIntentionsTableComponent>;
  let memberships: Membership[];
  let tradeUnitCalls: unknown[][];
  // When set, the trade-units request never answers, as when it is queued behind slow CTRM reads.
  let tradeUnitsNeverAnswer: boolean;
  const inScopeTradeUnitCodes = signal<readonly string[]>(['2190']);

  beforeEach(() => {
    memberships = [];
    tradeUnitCalls = [];
    tradeUnitsNeverAnswer = false;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApiService,
          useValue: {
            getCommodities: () => of([]),
            getPlantingCommodities: () => of([]),
            getCustomerTradeUnits: (...args: unknown[]) => { tradeUnitCalls.push(args); return tradeUnitsNeverAnswer ? NEVER : of(memberships); },
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {} } },
        {
          provide: AppStateService,
          useValue: {
            inScopeTradeUnitCodes,
            inScopeGroupNames: signal<readonly string[]>([]),
            tradeUnitDescriptions: signal(new Map([['2190', 'Pratt, KS'], ['2210', 'Tribune, KS']])),
          },
        },
      ],
    });
    // happy-dom + JIT can't fetch templateUrl; the rules under test are class-level.
    TestBed.overrideComponent(PlantingIntentionsTableComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(PlantingIntentionsTableComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer());
  });

  // ── Escape in the crop search boxes ───────────────────────────────────────
  // The add and edit forms live in an app-dialog that closes on Escape. Escape pressed to dismiss
  // the crop suggestion list must close the list and stop there, or the whole form is lost.
  it('Escape in a crop search box with suggestions open closes the list and claims the keypress', () => {
    for (const which of ['add', 'edit'] as const) {
      if (which === 'add') component.showAddCropSuggestions = true;
      else component.showEditCropSuggestions = true;
      const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

      component.onCropSearchEscape(esc, which);

      expect(which === 'add' ? component.showAddCropSuggestions : component.showEditCropSuggestions).toBe(false);
      expect(esc.defaultPrevented).toBe(true);
    }
  });

  it('Escape in a crop search box with no suggestions open is left for the dialog', () => {
    component.showAddCropSuggestions = false;
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    component.onCropSearchEscape(esc, 'add');

    expect(esc.defaultPrevented).toBe(false);
  });

  // ── Add dialog defaults ────────────────────────────────────────────────────

  it('offers the PRODUCER\'s trade units, not the header selection', () => {
    memberships = [member('2210'), member('2190'), member('9999', false)];
    ref.setInput('tradeUnits', ['2080']);

    component.openAddDialog();

    expect(component.tradeUnitOptions).toEqual(['2190', '2210']); // active only, sorted
  });

  it('auto-fills when the producer is on exactly one trade unit', () => {
    memberships = [member('2210')];
    ref.setInput('tradeUnits', []);

    component.openAddDialog();

    expect(component.addForm.tradeUnit).toBe('2210');
  });

  it('preselects the one of the producer\'s trade units that is selected in the header', () => {
    memberships = [member('2190'), member('2210')];
    ref.setInput('tradeUnits', ['2210']);

    component.openAddDialog();

    expect(component.addForm.tradeUnit).toBe('2210');
  });

  it('forces a choice when the header selects none or several of the producer\'s trade units', () => {
    memberships = [member('2190'), member('2210')];

    ref.setInput('tradeUnits', []);
    component.openAddDialog();
    expect(component.addForm.tradeUnit).toBe('');

    ref.setInput('tradeUnits', ['2190', '2210']);
    component.openAddDialog();
    expect(component.addForm.tradeUnit).toBe('');
  });

  it('is not saveable until a trade unit is chosen', () => {
    memberships = [member('2190'), member('2210')];
    ref.setInput('tradeUnits', []);
    component.openAddDialog();
    component.addForm.crop = 'YSB';
    component.addForm.acres = '100';

    expect(component.isAddFormValid()).toBe(false);
    component.addForm.tradeUnit = '2190';
    expect(component.isAddFormValid()).toBe(true);
  });

  it('falls back to the user\'s in-scope trade units for a producer with no assignment yet', () => {
    memberships = [];
    inScopeTradeUnitCodes.set(['2190']);
    ref.setInput('tradeUnits', ['2190']);

    component.openAddDialog();

    expect(component.usingFallbackTradeUnits).toBe(true);
    expect(component.tradeUnitOptions).toEqual(['2190']);
    expect(component.addForm.tradeUnit).toBe('2190');
  });

  it('asks for the codes only, skipping the server\'s slow open-activity check', () => {
    // The activity check is a contract and ticket read for the producer. The picker never reads
    // hasOpenActivity, so both dialogs must opt out of it.
    memberships = [member('2190')];

    component.openAddDialog();
    component.openEditDialog(makeIntention({ id: 7 }));

    expect(tradeUnitCalls).toEqual([
      [42, { includeActivity: false }],
      [42, { includeActivity: false }],
    ]);
  });

  it('offers the trade units the customer list carries at once, without waiting on the request', () => {
    // The 30s-plus wait in QA: the request queued behind slow CTRM reads. With the codes already on
    // the customer, the picker must be usable even if that request never comes back.
    tradeUnitsNeverAnswer = true;
    ref.setInput('customer', makeCustomer({ activeTradeUnits: ['2210', '2190'] }));
    ref.setInput('tradeUnits', ['2210']);

    component.openAddDialog();

    expect(component.isLoadingProducerTradeUnits).toBe(false);
    expect(component.tradeUnitOptions).toEqual(['2190', '2210']);
    expect(component.addForm.tradeUnit).toBe('2210');
  });

  it('still refreshes from the server behind the list it already showed', () => {
    // A membership can change after the customer list loaded; the answer, when it lands, wins.
    memberships = [member('2190')];
    ref.setInput('customer', makeCustomer({ activeTradeUnits: ['2190', '2210'] }));

    component.openAddDialog();

    expect(tradeUnitCalls.length).toBe(1);
    expect(component.tradeUnitOptions).toEqual(['2190']);
  });

  it('falls back to the loading state when the customer carries no trade units', () => {
    // A customer fetched on its own (not from the list) has no activeTradeUnits: behave as before.
    tradeUnitsNeverAnswer = true;

    component.openAddDialog();

    expect(component.isLoadingProducerTradeUnits).toBe(true);
  });

  it('labels a code with its description', () => {
    memberships = [member('2190')];
    component.openAddDialog();
    expect(component.tradeUnitLabel('2190')).toBe('2190 — Pratt, KS');
  });

  // ── Add → separate rows per trade unit ────────────────────────────────────

  it('adds a second row instead of merging when only the trade unit differs', () => {
    memberships = [member('2190'), member('2210')];
    ref.setInput('plantingIntentions', [makeIntention({ id: 1, tradeUnit: '2190', acres: 390 })]);
    const added: { tradeUnit: string; acres: number }[] = [];
    const edited: { intentionId: number; acres: number }[] = [];
    component.add.subscribe(e => added.push(e));
    component.edit.subscribe(e => edited.push(e));

    component.openAddDialog();
    component.addForm.crop = 'YSB';
    component.addForm.acres = '100';
    component.addForm.plantingYear = '2026';
    component.addForm.tradeUnit = '2210';
    component.submitAdd();

    expect(edited).toEqual([]);
    expect(added).toEqual([expect.objectContaining({ tradeUnit: '2210', acres: 100 })]);
  });

  it('still accumulates acres onto the existing row for the same crop, year AND trade unit', () => {
    memberships = [member('2190'), member('2210')];
    ref.setInput('plantingIntentions', [makeIntention({ id: 1, tradeUnit: '2190', acres: 390 })]);
    const added: unknown[] = [];
    const edited: { intentionId: number; acres: number }[] = [];
    component.add.subscribe(e => added.push(e));
    component.edit.subscribe(e => edited.push(e));

    component.openAddDialog();
    component.addForm.crop = 'YSB';
    component.addForm.acres = '10';
    component.addForm.plantingYear = '2026';
    component.addForm.tradeUnit = '2190';
    component.submitAdd();

    expect(added).toEqual([]);
    expect(edited).toEqual([expect.objectContaining({ intentionId: 1, acres: 400 })]);
  });

  // ── Edit dialog ───────────────────────────────────────────────────────────

  it('sends the trade unit on edit only when it was changed', () => {
    memberships = [member('2190'), member('2210')];
    const row = makeIntention({ id: 7, tradeUnit: '2190', acres: 390 });
    const edited: { tradeUnit?: string; acres: number }[] = [];
    component.edit.subscribe(e => edited.push(e));

    // Acres-only edit → trade unit not sent (server leaves it untouched).
    component.openEditDialog(row);
    component.editForm.acres = '400';
    component.submitEdit();
    expect(edited.at(-1)).toEqual(expect.objectContaining({ acres: 400, tradeUnit: undefined }));

    // Move the row to Tribune → trade unit sent.
    component.openEditDialog(row);
    component.editForm.tradeUnit = '2210';
    expect(component.hasEditFormChanged()).toBe(true);
    component.submitEdit();
    expect(edited.at(-1)).toEqual(expect.objectContaining({ tradeUnit: '2210' }));
  });

  // ── Row list ──────────────────────────────────────────────────────────────

  it('sorts rows by trade unit (the column that replaced Created On)', () => {
    ref.setInput('plantingIntentions', [
      makeIntention({ id: 1, tradeUnit: '2210', crop: 'YSB' }),
      makeIntention({ id: 2, tradeUnit: '2190', crop: 'YC' }),
    ]);

    component.handleSort('tradeUnit');
    expect(component.sortedIntentions.map(r => r.tradeUnit)).toEqual(['2190', '2210']);

    component.handleSort('tradeUnit'); // second click flips direction
    expect(component.sortedIntentions.map(r => r.tradeUnit)).toEqual(['2210', '2190']);
  });

  it('keeps a stale tag visible in the edit options and flags it', () => {
    // Craig was removed from Tribune, but this row still says Tribune.
    memberships = [member('2190')];
    component.openEditDialog(makeIntention({ id: 7, tradeUnit: '2210' }));

    expect(component.editTradeUnitOptions).toEqual(['2190', '2210']);
    expect(component.tradeUnitLabel('2210')).toBe('2210 — Tribune, KS (no longer assigned)');
  });
});
