import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectorRef, ComponentRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CustomerProfileComponent } from './customer-profile.component';
import { ApiService } from '@core/services/api.service';
import { ThemeService } from '@core/services/theme.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { AppStateService } from '@core/services/app-state.service';
import { Contract, Customer, DpContract, PlantingIntention, SavedList, StoredGrain, Ticket } from '@models';
import { provideSelectedProducerActivity } from '@testing/selected-producer-activity.fake';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SelectedProducerProduction } from '@core/context/selected-producer-production';
import { providePermissions } from '@testing/permission.stub';

// Covers the Add-to-List "Team Lists" manager extension: the dropdown stages membership across
// BOTH the user's own saved lists and (for managers) team lists, and the toggle is manager-gated.

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1, scoularId: 'CUST1', name: 'Test Farm', farm: 'Test Farm LLC', location: 'Omaha, NE',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, ...over,
  };
}

function makeList(over: Partial<SavedList> = {}): SavedList {
  return { id: 1, name: 'List', query: 'corn', createdAt: '2026-01-01', ...over };
}

describe('CustomerProfileComponent — Add to List (Team Lists)', () => {
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        provideSelectedProducerActivity(),
        SelectedCustomerContext,
        providePermissions(),
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {} } },
      ],
    });
    // happy-dom + JIT can't fetch templateUrl, and the child imports carry their own templates.
    // Blank template + imports so JIT compiles a bare shell; the staging logic is class-level.
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(CustomerProfileComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer({ id: 42 }));
  });

  it('stages changes across both own and team lists into one diff (manager)', () => {
    ref.setInput('canEditTeamLists', true);
    ref.setInput('savedListsForCustomer', [makeList({ id: 1, name: 'My List' })]);
    ref.setInput('teamListsForCustomer', [makeList({ id: 2, name: "Joe's List", createdBy: 'Joe' })]);

    const emitted: { listId: number; add: boolean }[][] = [];
    component.onSaveSavedListMembership.subscribe(c => emitted.push(c));

    component.toggleAddToListMenu();           // seed staged from both sets (both currently out)
    component.toggleStaged(makeList({ id: 1 })); // add producer to own list
    component.toggleStaged(makeList({ id: 2 })); // add producer to team list
    expect(component.hasStagedChanges()).toBe(true);
    component.saveAddToList();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(
      expect.arrayContaining([
        { listId: 1, add: true },
        { listId: 2, add: true },
      ]),
    );
    expect(emitted[0]).toHaveLength(2);
    expect(component.showAddToListMenu()).toBe(false); // menu closed after save
  });

  it('ignores team lists in the staging diff when the user is not a manager', () => {
    ref.setInput('canEditTeamLists', false);
    ref.setInput('savedListsForCustomer', [makeList({ id: 1, name: 'My List' })]);
    ref.setInput('teamListsForCustomer', [makeList({ id: 2, name: "Joe's List", createdBy: 'Joe' })]);

    const emitted: { listId: number; add: boolean }[][] = [];
    component.onSaveSavedListMembership.subscribe(c => emitted.push(c));

    component.toggleAddToListMenu();
    component.toggleStaged(makeList({ id: 1 }));
    component.toggleStaged(makeList({ id: 2 })); // staged, but not a known non-manager list
    component.saveAddToList();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual([{ listId: 1, add: true }]); // team list 2 excluded
  });

  it('activeAddToLists follows the selected tab', () => {
    ref.setInput('canEditTeamLists', true);
    ref.setInput('savedListsForCustomer', [makeList({ id: 1, name: 'My List' })]);
    ref.setInput('teamListsForCustomer', [makeList({ id: 2, name: "Joe's List" })]);

    component.addToListTab.set('saved');
    expect(component.activeAddToLists().map(l => l.id)).toEqual([1]);
    component.addToListTab.set('team');
    expect(component.activeAddToLists().map(l => l.id)).toEqual([2]);
  });
});

/**
 * The profile surfaces only the two most recent crop years. Producers accumulate seasons forever,
 * and the Planting tab plus the Growth Opportunity year picker must agree on which ones exist.
 */
describe('CustomerProfileComponent — crop year scoping', () => {
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;

  const intention = (id: number, plantingYear: number) =>
    ({ id, customerId: 42, plantingYear, crop: 'YC', acres: 100 }) as PlantingIntention;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        provideSelectedProducerActivity(),
        SelectedCustomerContext,
        providePermissions(),
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(CustomerProfileComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer({ id: 42 }));
  });

  it('offers only the two most recent planting years', () => {
    ref.setInput('plantingIntentions', [intention(1, 2025), intention(2, 2026), intention(3, 2027)]);
    expect(component.plantingYearOptions()).toEqual([2027, 2026]);
  });

  it('drops intentions from years outside that window', () => {
    ref.setInput('plantingIntentions', [intention(1, 2025), intention(2, 2026), intention(3, 2027)]);
    expect(component.visiblePlantingIntentions().map(pi => pi.plantingYear).sort()).toEqual([2026, 2027]);
  });

  it('rolls the window forward when a newer year is added', () => {
    ref.setInput('plantingIntentions', [intention(1, 2025), intention(2, 2026)]);
    expect(component.plantingYearOptions()).toEqual([2026, 2025]);

    // Adding 2027 pushes 2025 out of view.
    ref.setInput('plantingIntentions', [intention(1, 2025), intention(2, 2026), intention(3, 2027)]);
    expect(component.plantingYearOptions()).toEqual([2027, 2026]);
    expect(component.visiblePlantingIntentions().some(pi => pi.plantingYear === 2025)).toBe(false);
  });

  it('falls back to contract crop years when no intentions exist', () => {
    ref.setInput('plantingIntentions', []);
    ref.setInput('contracts', [
      { id: 1, cropYear: 2026 } as Contract,
      { id: 2, cropYear: 2024 } as Contract,
      { id: 3, cropYear: 2025 } as Contract,
    ]);
    expect(component.plantingYearOptions()).toEqual([2026, 2025]);
  });

  it('keeps a deep-linked older year visible so the picker never omits the active selection', () => {
    ref.setInput('plantingIntentions', [intention(1, 2025), intention(2, 2026), intention(3, 2027)]);
    component.selectPlantingYear(2025);

    expect(component.availablePlantingYears).toEqual([2027, 2026, 2025]);
    expect(component.visiblePlantingIntentions().some(pi => pi.plantingYear === 2025)).toBe(true);
  });
});

// The profile is the SelectedProducerProduction for the Planting, Storage and DP Contracts tabs rendered inside it:
// they read the producer's intentions, crop year, stored grain and DP contracts from it, and their add / edit /
// delete come back out as the profile's outputs.
describe('CustomerProfileComponent — as the SelectedProducerProduction', () => {
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;
  let production: SelectedProducerProduction;

  const intention = (id: number, plantingYear: number) =>
    ({ id, customerId: 42, plantingYear, crop: 'YC', acres: 100 }) as PlantingIntention;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        provideSelectedProducerActivity(),
        SelectedCustomerContext,
        providePermissions(),
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(CustomerProfileComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    production = fixture.debugElement.injector.get(SelectedProducerProduction);
    ref.setInput('customer', makeCustomer({ id: 42 }));
  });

  it('provides itself to what renders inside it', () => {
    expect(production).toBe(component);
  });

  it('offers the commodity codes from the producer\'s tickets and their profile, once each, sorted', () => {
    ref.setInput('tickets', [{ productCode: 'YSB' }, { productCode: 'YC' }, { productCode: '' }, { productCode: 'YC' }] as Ticket[]);
    ref.setInput('customer', makeCustomer({ id: 42, commodities: ['HRW', 'YSB'] }));

    expect(production.commodityCodes()).toEqual(['HRW', 'YC', 'YSB']);
  });

  it('shares the year picker: the years it offers, the year picked, and the intentions in view', () => {
    ref.setInput('plantingIntentions', [intention(1, 2024), intention(2, 2025), intention(3, 2026)]);

    production.selectPlantingYear(2024);

    expect(production.selectedPlantingYear()).toBe(2024);
    expect(production.plantingYears()).toEqual([2026, 2025, 2024]);
    expect(production.visiblePlantingIntentions().map(pi => pi.id)).toEqual([1, 2, 3]);
  });

  it('hands over the trade units, stored grain and DP contracts it is given, with their loading flags', () => {
    const grain = [{ receiptNumber: '1' }] as StoredGrain[];
    const dp = [{ id: 'a|2' }] as DpContract[];
    ref.setInput('selectedTradeUnits', ['2190']);
    ref.setInput('storedGrain', grain);
    ref.setInput('dpContracts', dp);
    ref.setInput('isLoadingPlanting', true);
    ref.setInput('isLoadingStoredGrain', true);
    ref.setInput('isLoadingDpContracts', true);

    expect(production.tradeUnits()).toEqual(['2190']);
    expect(production.storedGrain()).toBe(grain);
    expect(production.dpContracts()).toBe(dp);
    expect([production.isLoadingPlanting(), production.isLoadingStoredGrain(), production.isLoadingDpContracts()]).toEqual([true, true, true]);
  });

  it('passes an add, an edit and a delete up as its outputs', () => {
    const added = vi.fn();
    const edited = vi.fn();
    const deleted = vi.fn();
    component.onAddPlanting.subscribe(added);
    component.onEditPlanting.subscribe(edited);
    component.onDeletePlanting.subscribe(deleted);
    const draft = { crop: 'YC', acres: 100, plantingYear: 2026, tradeUnit: '2190' };
    const change = { intentionId: 7, crop: 'YC', acres: 120, plantingYear: 2026 };

    production.addPlantingIntention(draft);
    production.editPlantingIntention(change);
    production.deletePlantingIntention(7);

    expect(added).toHaveBeenCalledWith(draft);
    expect(edited).toHaveBeenCalledWith(change);
    expect(deleted).toHaveBeenCalledWith(7);
  });
});

// Covers the click-to-open-in-Google-Maps address link: which address gets mapped, when the
// link is suppressed, and that opening one is recorded for usage reporting.
describe('CustomerProfileComponent — address map link', () => {
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;
  let tracking: { trackMapClick: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tracking = { trackMapClick: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        provideSelectedProducerActivity(),
        SelectedCustomerContext,
        providePermissions(),
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {}, ...tracking } },
      ],
    });
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(CustomerProfileComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
  });

  it('displays and maps the Extended address, including the ZIP', () => {
    ref.setInput('customer', makeCustomer({
      addressLine1: 'PO Box 5', location: 'Omaha', stateProvince: 'IA',
      extendedAddressLine1: '1234 County Rd 12', extendedCity: 'Hastings',
      extendedStateProvince: 'NE', extendedPostalCode: '68901',
    }));

    expect(component.getContactAddress()).toBe('1234 County Rd 12, Hastings, NE 68901');
    expect(component.getMapsUrl()).toContain('1234%20County%20Rd%2012');
  });

  it('suppresses the link when only a state is known', () => {
    ref.setInput('customer', makeCustomer({ location: '', stateProvince: 'NE' }));

    expect(component.getMapsUrl()).toBeNull();
  });

  it('tracks the click so map opens show up in usage reporting', () => {
    ref.setInput('customer', makeCustomer({ id: 42, location: 'Hastings', stateProvince: 'NE' }));

    component.trackMapClick();

    expect(tracking.trackMapClick).toHaveBeenCalledWith('42');
  });
});

// Covers the bin-site mini-table at the bottom of the Contact column: formatted cells (dashes when
// empty), the exact-point map link only when a site has coordinates, and that the
// table starts collapsed and re-collapses per producer.
// The header's slots and the eSign recipients panel, rendered through the REAL template. The child
// components are dropped (NO_ERRORS_SCHEMA) because only this component's own markup is under test.
// The recipients are derived from the customer input; these pin what they show, that the derivation
// runs once per customer rather than on every change-detection pass, and that it follows the input.
describe('CustomerProfileComponent — header slots and ScoularView recipients (rendered)', () => {
  let fixture: ComponentFixture<CustomerProfileComponent>;
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

  const recipientChips = (): string[] => {
    const label = Array.from(host().querySelectorAll('p')).find(p => p.textContent?.trim() === 'ScoularView Recipients');
    return Array.from(label?.nextElementSibling?.querySelectorAll('span') ?? []).map(s => squash(s.textContent));
  };

  /** A change-detection pass that re-checks this OnPush view without changing any input. Marks the
   *  component's OWN view: marking the fixture's host view leaves an OnPush child unchecked. */
  const rerender = (): void => {
    fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        provideSelectedProducerActivity(),
        SelectedCustomerContext,
        providePermissions(),
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { imports: [CommonModule], schemas: [NO_ERRORS_SCHEMA] },
    });
    fixture = TestBed.createComponent(CustomerProfileComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
  });

  // Producers fills them: the Organic badge and its panel, the Insights button, the contacts, the bin sites, Farm
  // Details, Harvest Contract Pace, and the Insights panels and Activity Summary.
  it("hosts the modules' panels where the producer's details and summaries sat", () => {
    ref.setInput('customer', makeCustomer({ eSignEnabled: true, phone: '4025550100', email: 'office@farm.com' }));
    fixture.detectChanges();
    const slot = (name: string) => host().querySelector(`app-customer-slot[slot="${name}"]`)!;
    const heading = (title: string) => Array.from(host().querySelectorAll('h3')).find(h => h.textContent?.trim() === title)!;
    const contactColumn = heading('Contact and Locations').nextElementSibling!;

    expect(squash(slot('badges').parentElement!.textContent)).toContain('eSign');
    expect(slot('badge-panels')).not.toBeNull();
    expect(contactColumn.firstElementChild).toBe(slot('contacts'));
    expect(contactColumn.lastElementChild).toBe(slot('locations'));
    expect(squash(contactColumn.textContent)).toContain('office@farm.com');
    // The details row: Contact and Locations, then the modules' details.
    expect(slot('details').previousElementSibling).toBe(contactColumn.parentElement);
    expect(slot('details').nextElementSibling).toBeNull();
    // The actions sit in the row under the name, before the linked-producer picker.
    expect(slot('actions').parentElement!.classList).toContain('flex-wrap');
    // The summary sits between the header card and the tabs, in a column spaced by its gap.
    expect(slot('summary').parentElement!.className).toContain('gap-8');
    expect(squash(slot('summary').previousElementSibling!.textContent)).toContain('Contact and Locations');
    expect(slot('summary').nextElementSibling!.querySelector('.rounded-full')).not.toBeNull();
  });

  it('marks the open eSign panel as a header panel, which the farm line below takes more room from', () => {
    ref.setInput('customer', makeCustomer({ eSignEnabled: true, scoularViewRecipients: 'Al 402-555-0001' }));
    fixture.detectChanges();
    component.showESignRecipients.set(true);
    fixture.detectChanges();

    const farmLine = Array.from(host().querySelectorAll('p')).find(p => p.textContent?.trim() === 'Test Farm LLC')!;
    expect(squash(host().querySelector('.header-panel')?.textContent)).toContain('ScoularView Recipients');
    expect(farmLine.className).toContain('group-has-[.header-panel]/name:mt-3');
  });

  it('splits the ScoularView recipients on the commas between complete entries', () => {
    ref.setInput('customer', makeCustomer({
      eSignEnabled: true,
      scoularViewRecipients: 'Ade, Clay 785-555-1234, Bo Smith 402-555-9876,  , Trailing Note',
    }));
    fixture.detectChanges();
    component.showESignRecipients.set(true);
    fixture.detectChanges();

    expect(recipientChips()).toEqual(['Ade, Clay 785-555-1234', 'Bo Smith 402-555-9876, Trailing Note']);
  });

  it('parses the recipients once per customer, and again when the customer changes', () => {
    const parse = vi.spyOn(component, 'parseRecipients');
    ref.setInput('customer', makeCustomer({ eSignEnabled: true, scoularViewRecipients: 'Al 402-555-0001' }));
    fixture.detectChanges();
    component.showESignRecipients.set(true);
    fixture.detectChanges();
    rerender();
    rerender();

    expect(parse).toHaveBeenCalledTimes(1);
    expect(recipientChips()).toEqual(['Al 402-555-0001']);

    ref.setInput('customer', makeCustomer({ eSignEnabled: true, scoularViewRecipients: 'Bea 402-555-0002, Cy 402-555-0003' }));
    fixture.detectChanges();
    component.showESignRecipients.set(true);   // switching customers closes the panel
    fixture.detectChanges();

    expect(recipientChips()).toEqual(['Bea 402-555-0002', 'Cy 402-555-0003']);
    expect(parse).toHaveBeenCalledTimes(2);
  });
});

// A failed background load used to leave these two places reading as genuinely empty: the pace card
// said "No contract data available" and the Add to List menu said no saved lists match. Rendered
// through the real template, children dropped as above.
describe('CustomerProfileComponent — failed background loads (rendered)', () => {
  let fixture: ComponentFixture<CustomerProfileComponent>;
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;
  let state: AppStateService;

  const text = (): string => ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        provideSelectedProducerActivity(),
        SelectedCustomerContext,
        providePermissions(),
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { imports: [CommonModule], schemas: [NO_ERRORS_SCHEMA] },
    });
    state = TestBed.inject(AppStateService);
    fixture = TestBed.createComponent(CustomerProfileComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer({ id: 42 }));
  });

  describe('Add to List menu', () => {
    it('says the saved lists could not be loaded instead of "No saved lists match"', () => {
      state.setSavedListsLoadFailed(true);
      fixture.detectChanges();   // settle the customer effects first: a customer change closes the menu
      component.toggleAddToListMenu();
      fixture.detectChanges();

      expect(text()).toContain("Couldn't load your saved lists. Refresh the page to try again.");
      expect(text()).not.toContain('No saved lists match the selected trade unit(s).');
    });

    it('still says "No saved lists match" when nothing failed', () => {
      fixture.detectChanges();
      component.toggleAddToListMenu();
      fixture.detectChanges();

      expect(text()).toContain('No saved lists match the selected trade unit(s).');
      expect(text()).not.toContain("Couldn't load your saved lists");
    });

    it('lists the saved lists it has, whatever the flag says', () => {
      state.setSavedListsLoadFailed(true);
      ref.setInput('savedListsForCustomer', [makeList({ id: 1, name: 'My List' })]);
      fixture.detectChanges();
      component.toggleAddToListMenu();
      fixture.detectChanges();

      expect(text()).toContain('My List');
      expect(text()).not.toContain("Couldn't load your saved lists");
    });

    it("leaves a manager's Team Lists tab as it was — the flag is about the user's own lists", () => {
      state.setSavedListsLoadFailed(true);
      ref.setInput('canEditTeamLists', true);
      fixture.detectChanges();
      component.toggleAddToListMenu();
      component.addToListTab.set('team');
      fixture.detectChanges();

      expect(text()).toContain('No team lists tied to the selected trade unit(s).');
      expect(text()).not.toContain("Couldn't load your saved lists");
    });
  });
});
