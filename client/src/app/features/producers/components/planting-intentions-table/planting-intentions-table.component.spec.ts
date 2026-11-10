import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NEVER, of, Subject } from 'rxjs';
import { PlantingIntentionsTableComponent } from './planting-intentions-table.component';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { Commodity, Customer, PlantingIntention } from '@models';
import { CustomersApiService } from '@features/customers';
import { SelectedProducerProductionFake, provideSelectedProducerProduction, selectedProducerProductionFake } from '@testing/selected-producer-production.fake';

// The intentions, the crop year, the trade units the user works in and the add / edit / delete actions all come from
// the profile's SelectedProducerProduction, a fake here; the producer comes from the customer screen's context.

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
  /** The producer the customer screen shows. */
  const customer = signal<Customer | null>(null);
  let memberships: Membership[];
  let tradeUnitCalls: unknown[][];
  // When set, the trade-units request never answers, as when it is queued behind slow CTRM reads.
  let tradeUnitsNeverAnswer: boolean;
  let production: SelectedProducerProductionFake;
  const inScopeTradeUnitCodes = signal<readonly string[]>(['2190']);

  beforeEach(() => {
    production = selectedProducerProductionFake();
    customer.set(makeCustomer());
    memberships = [];
    tradeUnitCalls = [];
    tradeUnitsNeverAnswer = false;
    TestBed.configureTestingModule({
      providers: [
        { provide: CustomersApiService, useExisting: ApiService },
        {
          provide: ApiService,
          useValue: {
            getCommodities: () => of([]),
            getPlantingCommodities: () => of([]),
            getCustomerTradeUnits: (...args: unknown[]) => { tradeUnitCalls.push(args); return tradeUnitsNeverAnswer ? NEVER : of(memberships); },
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {} } },
        provideSelectedProducerProduction(production),
        { provide: SelectedCustomerContext, useValue: { customer } },
        {
          provide: TradeUnitContext,
          useValue: {
            inScopeTradeUnitCodes,
            inScopeGroupNames: signal<readonly string[]>([]),
            tradeUnitDescriptions: signal(new Map([['2190', 'Pratt, KS'], ['2210', 'Tribune, KS']])),
          },
        },
      ],
    });
    // The rules under test here are class-level, so the template is blanked; the "rendering"
    // describe at the end of this file covers the real template.
    TestBed.overrideComponent(PlantingIntentionsTableComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(PlantingIntentionsTableComponent);
    component = fixture.componentInstance;
  });

  // ── Escape in the crop search boxes ───────────────────────────────────────
  // Escape pressed to dismiss the crop suggestion list must close the list and claim the keypress.
  // The add and edit dialogs themselves do not close on Escape: a half-filled form would be lost.
  it('Escape in a crop search box with suggestions open closes the list and claims the keypress', () => {
    for (const which of ['add', 'edit'] as const) {
      if (which === 'add') component.showAddCropSuggestions.set(true);
      else component.showEditCropSuggestions.set(true);
      const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

      component.onCropSearchEscape(esc, which);

      expect(which === 'add' ? component.showAddCropSuggestions() : component.showEditCropSuggestions()).toBe(false);
      expect(esc.defaultPrevented).toBe(true);
    }
  });

  it('Escape in a crop search box with no suggestions open is left for the dialog', () => {
    component.showAddCropSuggestions.set(false);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    component.onCropSearchEscape(esc, 'add');

    expect(esc.defaultPrevented).toBe(false);
  });

  // ── Add dialog defaults ────────────────────────────────────────────────────

  it('offers the PRODUCER\'s trade units, not the header selection', () => {
    memberships = [member('2210'), member('2190'), member('9999', false)];
    production.tradeUnits.set(['2080']);

    component.openAddDialog();

    expect(component.tradeUnitOptions).toEqual(['2190', '2210']); // active only, sorted
  });

  it('auto-fills when the producer is on exactly one trade unit', () => {
    memberships = [member('2210')];
    production.tradeUnits.set([]);

    component.openAddDialog();

    expect(component.addForm.tradeUnit).toBe('2210');
  });

  it('preselects the one of the producer\'s trade units that is selected in the header', () => {
    memberships = [member('2190'), member('2210')];
    production.tradeUnits.set(['2210']);

    component.openAddDialog();

    expect(component.addForm.tradeUnit).toBe('2210');
  });

  it('forces a choice when the header selects none or several of the producer\'s trade units', () => {
    memberships = [member('2190'), member('2210')];

    production.tradeUnits.set([]);
    component.openAddDialog();
    expect(component.addForm.tradeUnit).toBe('');

    production.tradeUnits.set(['2190', '2210']);
    component.openAddDialog();
    expect(component.addForm.tradeUnit).toBe('');
  });

  it('is not saveable until a trade unit is chosen', () => {
    memberships = [member('2190'), member('2210')];
    production.tradeUnits.set([]);
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
    production.tradeUnits.set(['2190']);

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
    customer.set(makeCustomer({ activeTradeUnits: ['2210', '2190'] }));
    production.tradeUnits.set(['2210']);

    component.openAddDialog();

    expect(component.isLoadingProducerTradeUnits()).toBe(false);
    expect(component.tradeUnitOptions).toEqual(['2190', '2210']);
    expect(component.addForm.tradeUnit).toBe('2210');
  });

  it('still refreshes from the server behind the list it already showed', () => {
    // A membership can change after the customer list loaded; the answer, when it lands, wins.
    memberships = [member('2190')];
    customer.set(makeCustomer({ activeTradeUnits: ['2190', '2210'] }));

    component.openAddDialog();

    expect(tradeUnitCalls.length).toBe(1);
    expect(component.tradeUnitOptions).toEqual(['2190']);
  });

  it('falls back to the loading state when the customer carries no trade units', () => {
    // A customer fetched on its own (not from the list) has no activeTradeUnits: behave as before.
    tradeUnitsNeverAnswer = true;

    component.openAddDialog();

    expect(component.isLoadingProducerTradeUnits()).toBe(true);
  });

  it('labels a code with its description', () => {
    memberships = [member('2190')];
    component.openAddDialog();
    expect(component.tradeUnitLabel('2190')).toBe('2190 — Pratt, KS');
  });

  // ── Add → separate rows per trade unit ────────────────────────────────────

  it('adds a second row instead of merging when only the trade unit differs', () => {
    memberships = [member('2190'), member('2210')];
    production.visiblePlantingIntentions.set([makeIntention({ id: 1, tradeUnit: '2190', acres: 390 })]);

    component.openAddDialog();
    component.addForm.crop = 'YSB';
    component.addForm.acres = '100';
    component.addForm.plantingYear = '2026';
    component.addForm.tradeUnit = '2210';
    component.submitAdd();

    expect(production.editPlantingIntention).not.toHaveBeenCalled();
    expect(production.addPlantingIntention.mock.calls).toEqual([[expect.objectContaining({ tradeUnit: '2210', acres: 100 })]]);
  });

  it('still accumulates acres onto the existing row for the same crop, year AND trade unit', () => {
    memberships = [member('2190'), member('2210')];
    production.visiblePlantingIntentions.set([makeIntention({ id: 1, tradeUnit: '2190', acres: 390 })]);

    component.openAddDialog();
    component.addForm.crop = 'YSB';
    component.addForm.acres = '10';
    component.addForm.plantingYear = '2026';
    component.addForm.tradeUnit = '2190';
    component.submitAdd();

    expect(production.addPlantingIntention).not.toHaveBeenCalled();
    expect(production.editPlantingIntention.mock.calls).toEqual([[expect.objectContaining({ intentionId: 1, acres: 400 })]]);
  });

  // ── Edit dialog ───────────────────────────────────────────────────────────

  it('sends the trade unit on edit only when it was changed', () => {
    memberships = [member('2190'), member('2210')];
    const row = makeIntention({ id: 7, tradeUnit: '2190', acres: 390 });
    const lastEdit = (): unknown => production.editPlantingIntention.mock.lastCall?.[0];

    // Acres-only edit → trade unit not sent (server leaves it untouched).
    component.openEditDialog(row);
    component.editForm.acres = '400';
    component.submitEdit();
    expect(lastEdit()).toEqual(expect.objectContaining({ acres: 400, tradeUnit: undefined }));

    // Move the row to Tribune → trade unit sent.
    component.openEditDialog(row);
    component.editForm.tradeUnit = '2210';
    expect(component.hasEditFormChanged()).toBe(true);
    component.submitEdit();
    expect(lastEdit()).toEqual(expect.objectContaining({ tradeUnit: '2210' }));
  });

  // ── Row list ──────────────────────────────────────────────────────────────

  it('sorts rows by trade unit (the column that replaced Created On)', () => {
    production.visiblePlantingIntentions.set([
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

// The same component through its REAL template. Everything above drives the class with the template
// blanked, which cannot show whether a change reaches the screen. These tests cover each way the view
// changes without a template event of its own: the parent opening the Add dialog through @ViewChild,
// the producer's trade units and the commodity lists answering after the dialog or table rendered,
// and the crop suggestions closing on a timer after the search box loses focus.
describe('PlantingIntentionsTableComponent — rendering', () => {
  let fixture: ComponentFixture<PlantingIntentionsTableComponent>;
  let component: PlantingIntentionsTableComponent;
  let tradeUnits$: Subject<Membership[]>;
  let commodities$: Subject<Commodity[]>;
  let plantingCommodities$: Subject<Commodity[]>;
  let production: SelectedProducerProductionFake;
  const customer = signal<Customer | null>(null);

  const SOY_ORGANIC: Commodity = { id: 1, code: 'YSBO', name: 'Organic Soybeans', category: 'Soybeans', plantingCategory: 'Organic Soybeans', isActive: true };
  const CORN: Commodity = { id: 2, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => (host().textContent ?? '').replace(/\s+/g, ' ');
  const openDialogTitles = (): string[] =>
    Array.from(host().querySelectorAll('app-dialog-title')).map(t => (t.textContent ?? '').trim());
  /** The select whose placeholder option reads "Select trade unit..." (Add dialog, several options). */
  const addTradeUnitSelect = (): HTMLSelectElement | undefined =>
    Array.from(host().querySelectorAll<HTMLSelectElement>('select'))
      .find(s => Array.from(s.options).some(o => o.text.trim() === 'Select trade unit...'));
  const cropSearch = (): HTMLInputElement =>
    host().querySelector<HTMLInputElement>('input[placeholder="Search crops by name or code..."]')!;
  /** Names in the open crop-suggestion list; empty when the list is closed. */
  const suggestions = (): string[] =>
    Array.from(host().querySelectorAll('div.absolute.z-10 button span.font-medium')).map(s => (s.textContent ?? '').trim());

  beforeEach(async () => {
    tradeUnits$ = new Subject<Membership[]>();
    commodities$ = new Subject<Commodity[]>();
    plantingCommodities$ = new Subject<Commodity[]>();
    production = selectedProducerProductionFake();
    customer.set(makeCustomer());
    await TestBed.configureTestingModule({
      imports: [PlantingIntentionsTableComponent],
      providers: [
        { provide: CustomersApiService, useExisting: ApiService },
        {
          provide: ApiService,
          useValue: {
            getCommodities: () => commodities$,
            getPlantingCommodities: () => plantingCommodities$,
            getCustomerTradeUnits: () => tradeUnits$,
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        provideSelectedProducerProduction(production),
        { provide: SelectedCustomerContext, useValue: { customer } },
        {
          provide: TradeUnitContext,
          useValue: {
            inScopeTradeUnitCodes: signal<readonly string[]>(['2190']),
            inScopeGroupNames: signal<readonly string[]>([]),
            tradeUnitDescriptions: signal(new Map([['2190', 'Pratt, KS'], ['2210', 'Tribune, KS']])),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PlantingIntentionsTableComponent);
    component = fixture.componentInstance;
    production.visiblePlantingIntentions.set([makeIntention({ id: 1, crop: 'YSBO', category: 'Soybeans' })]);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('opens the Add dialog when the parent calls openAddDialog()', () => {
    // customer-profile's own "Add" button calls this through @ViewChild: no event in THIS view.
    expect(openDialogTitles()).toEqual([]);

    component.openAddDialog();
    fixture.detectChanges();

    expect(openDialogTitles()).toEqual(['Add Planting Intention']);
  });

  it('swaps "Loading trade units..." for the producer\'s trade units, preselecting the header\'s, when they arrive after the dialog opened', async () => {
    production.tradeUnits.set(['2210']);
    host().querySelector<HTMLButtonElement>('app-table-head button')!.click();
    fixture.detectChanges();
    expect(text()).toContain('Loading trade units...');

    tradeUnits$.next([member('2190'), member('2210')]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text()).not.toContain('Loading trade units...');
    const select = addTradeUnitSelect();
    expect(Array.from(select!.options).map(o => o.text.trim())).toEqual(['Select trade unit...', '2190 — Pratt, KS', '2210 — Tribune, KS']);
    expect(select!.value).toBe('2210');
  });

  it('relabels a row and drops "Loading crops..." when the commodity list arrives after render', () => {
    // Stored category "Soybeans" defers to the commodity's planting label once the list is known.
    expect(text()).not.toContain('Organic Soybeans');
    component.openAddDialog();
    fixture.detectChanges();
    expect(text()).toContain('Loading crops...');

    commodities$.next([SOY_ORGANIC, CORN]);
    fixture.detectChanges();

    expect(text()).not.toContain('Loading crops...');
    expect(text()).toContain('Organic Soybeans');
  });

  it('closes the crop suggestions shortly after the search box loses focus', async () => {
    commodities$.next([SOY_ORGANIC, CORN]);
    plantingCommodities$.next([CORN]);
    component.openAddDialog();
    fixture.detectChanges();

    cropSearch().value = 'corn';
    cropSearch().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(suggestions()).toEqual(['Yellow Corn']);

    cropSearch().dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(suggestions()).toEqual(['Yellow Corn']); // still open: a click on a suggestion lands first

    await new Promise(resolve => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(suggestions()).toEqual([]);
  });

  it('names the producer the customer screen shows, and renders nothing without one', () => {
    component.openAddDialog();
    fixture.detectChanges();
    expect(text()).toContain('Record a new planting intention for Sample Farms');

    customer.set(null);
    fixture.detectChanges();
    expect(text().trim()).toBe('');
  });

  // ── The crop year and delete go to the profile ────────────────────────────

  it('asks the profile for a crop year when its divider is clicked, and highlights the year the profile has', () => {
    const divider = (): HTMLElement =>
      Array.from(host().querySelectorAll<HTMLElement>('div.cursor-pointer.group')).find(d => (d.textContent ?? '').includes('2026 Crop Year'))!;
    const highlighted = (): boolean => divider().querySelector('span')!.classList.contains('bg-scoular-green-accessible');
    expect(highlighted()).toBe(false);

    divider().click();
    expect(production.selectPlantingYear).toHaveBeenCalledWith(2026);

    production.selectedPlantingYear.set(2026);
    fixture.detectChanges();
    expect(highlighted()).toBe(true);
  });

  it('asks the profile to delete the row when the delete is confirmed', () => {
    component.openEditDialog(makeIntention({ id: 1 }));
    component.openDeleteConfirm();
    fixture.detectChanges();

    const deleteButtons = Array.from(host().querySelectorAll('button')).filter(b => (b.textContent ?? '').trim() === 'Delete');
    deleteButtons.at(-1)!.click();

    expect(production.deletePlantingIntention).toHaveBeenCalledWith(1);
  });

  // ── Escape and the delete prompt ──────────────────────────────────────────

  it('keeps the Add and Edit dialogs open on Escape, so a half-filled form is not lost', () => {
    component.openAddDialog();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(openDialogTitles()).toContain('Add Planting Intention');
    component.closeAddDialog();

    component.openEditDialog(makeIntention({ id: 1 }));
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(openDialogTitles()).toContain('Edit Planting Intention');
  });

  it('does not carry an open delete prompt over to the next row edited', () => {
    component.openEditDialog(makeIntention({ id: 1 }));
    component.openDeleteConfirm();
    fixture.detectChanges();
    expect(text()).toContain('Delete Planting Intention?');

    component.closeEditDialog();
    component.openEditDialog(makeIntention({ id: 2 }));
    fixture.detectChanges();

    expect(component.showDeleteConfirm()).toBe(false);
    expect(text()).not.toContain('Delete Planting Intention?');
  });
});
