import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { CustomerProfileComponent } from './customer-profile.component';
import { ApiService } from '@core/services/api.service';
import { ThemeService } from '@core/services/theme.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Contract, Customer, PlantingIntention, SavedList } from '@models';

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
    ref.setInput('isManager', true);
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
    ref.setInput('isManager', false);
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
    ref.setInput('isManager', true);
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
describe('CustomerProfileComponent — bin site table', () => {
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;
  let tracking: { trackBinSiteMapClick: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tracking = { trackBinSiteMapClick: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
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

  it('builds one table row per site, in saved order, with every cell formatted', () => {
    ref.setInput('customer', makeCustomer({
      binSites: [
        { name: 'Anderson Site', latitude: 39.115876, longitude: -95.143955, capacity: 50000, sortOrder: 0 },
        { name: 'North Quarter', latitude: 40.5, longitude: -96, capacity: 30000, sortOrder: 1 },
      ],
    }));

    const [first, second] = component.binSiteRows();
    expect(first).toMatchObject({ name: 'Anderson Site', capacity: '50,000' });
    expect(second).toMatchObject({ name: 'North Quarter', capacity: '30,000' });
  });

  it('links each site with coordinates to its exact point in Google Maps', () => {
    ref.setInput('customer', makeCustomer({
      binSites: [{ name: 'Anderson Site', latitude: 41.39034548435109, longitude: -95.00754031349179 }],
    }));

    expect(component.binSiteRows()[0].url)
      .toBe('https://www.google.com/maps/search/?api=1&query=41.39034548435109%2C-95.00754031349179');
  });


  it('gives a site without coordinates no map link', () => {
    ref.setInput('customer', makeCustomer({ binSites: [{ name: 'Home place', capacity: 20000 }] }));

    const [row] = component.binSiteRows();
    expect(row.url).toBeNull();
    expect(row.name).toBe('Home place');
  });

  it('has no rows when the producer has no bin sites', () => {
    ref.setInput('customer', makeCustomer());

    expect(component.binSiteRows()).toEqual([]);
  });

  it('shows a single site on its own line, with no "Bin Sites (1)" toggle', () => {
    ref.setInput('customer', makeCustomer({ binSites: [{ name: 'Only one', latitude: 39.1, longitude: -95.1, capacity: 50000 }] }));

    expect(component.singleBinSite()).toMatchObject({ name: 'Only one', capacity: '50,000' });
    expect(component.singleBinSite()?.url).toContain('39.1');
  });

  it('two or more sites start collapsed behind the toggle, and toggle open', () => {
    ref.setInput('customer', makeCustomer({ binSites: [{ name: 'A' }, { name: 'B' }] }));

    expect(component.singleBinSite()).toBeNull();
    expect(component.binSitesExpanded()).toBe(false);
    component.toggleBinSites();
    expect(component.binSitesExpanded()).toBe(true);
  });

  it('closes the table again when a different producer is shown', () => {
    const sites = [{ name: 'A', latitude: 39.1, longitude: -95.1 }];
    ref.setInput('customer', makeCustomer({ id: 1, binSites: sites }));
    component.toggleBinSites();

    ref.setInput('customer', makeCustomer({ id: 2, binSites: sites }));

    expect(component.binSitesExpanded()).toBe(false);
  });

  it('tracks a map click under its own subfeature', () => {
    ref.setInput('customer', makeCustomer({ id: 42 }));

    component.trackBinSiteMapClick();

    expect(tracking.trackBinSiteMapClick).toHaveBeenCalledWith('42');
  });

  it('lists grain on farm grouped by bin site, in site order, rows without a site last', () => {
    ref.setInput('customer', makeCustomer({
      binSites: [{ siteKey: 'north', name: 'North Bins' }, { siteKey: 'home', name: 'Home Place' }],
      grainOnFarm: [
        { binSiteKey: null, commodityCode: 'WH', bushelsOnHand: 90000 },
        { binSiteKey: 'home', binSiteName: 'Home Place', commodityCode: 'YC', bushelsOnHand: 5000 },
        { binSiteKey: 'north', binSiteName: 'North Bins', commodityCode: 'SB', bushelsOnHand: 1000 },
        { binSiteKey: 'north', binSiteName: 'North Bins', commodityCode: 'YC', bushelsOnHand: 30000 },
      ],
    }));

    expect(component.grainOnFarmRows().map(g => `${g.binSiteName ?? '—'} ${g.commodityCode}`))
      .toEqual(['North Bins YC', 'North Bins SB', 'Home Place YC', '— WH']);
    // The headline total still adds up every row, at every site.
    expect(component.grainOnFarmTotal()).toBe(126000);
  });

  it('groups the table by site name, labelling rows without a site only when sites are present too', () => {
    ref.setInput('customer', makeCustomer({
      binSites: [{ siteKey: 'north', name: 'North Quarter Home Place Bins by the Creek' }],
      grainOnFarm: [
        { binSiteKey: 'north', binSiteName: 'North Quarter Home Place Bins by the Creek', commodityCode: 'YC', bushelsOnHand: 30000 },
        { binSiteKey: null, commodityCode: 'WH', bushelsOnHand: 100 },
      ],
    }));
    expect(component.grainOnFarmGroups().map(g => [g.label, g.rows.map(r => r.commodityCode)]))
      .toEqual([['North Quarter Home Place Bins by the Creek', ['YC']], ['Not tied to a bin site', ['WH']]]);

    ref.setInput('customer', makeCustomer({ grainOnFarm: [{ commodityCode: 'WH', bushelsOnHand: 100 }] }));
    expect(component.grainOnFarmGroups().map(g => g.label)).toEqual(['']);
  });

  it('with grain at more than one site, every site starts closed and opens on its own', () => {
    const twoSites = (id: number) => makeCustomer({
      id,
      binSites: [{ siteKey: 'north', name: 'North Bins' }, { siteKey: 'home', name: 'Home Place' }],
      grainOnFarm: [
        { binSiteKey: 'north', binSiteName: 'North Bins', commodityCode: 'YC', bushelsOnHand: 30000 },
        { binSiteKey: 'north', binSiteName: 'North Bins', commodityCode: 'SB', bushelsOnHand: 5000 },
        { binSiteKey: 'home', binSiteName: 'Home Place', commodityCode: 'YC', bushelsOnHand: 1000 },
      ],
    });
    ref.setInput('customer', twoSites(1));

    expect(component.grainGroupsCollapsible()).toBe(true);
    expect([component.isGrainGroupOpen(0), component.isGrainGroupOpen(1)]).toEqual([false, false]);
    expect(component.anyGrainGroupOpen()).toBe(false);
    expect(component.grainGroupSummary(component.grainOnFarmGroups()[0].rows)).toBe('2 crops · 35,000 bu');

    component.toggleGrainGroup(1);
    expect([component.isGrainGroupOpen(0), component.isGrainGroupOpen(1)]).toEqual([false, true]);
    expect(component.anyGrainGroupOpen()).toBe(true);

    // Another producer starts closed again.
    ref.setInput('customer', twoSites(2));
    expect(component.isGrainGroupOpen(1)).toBe(false);
  });

  it('with grain at one site (or none), the table shows open as before', () => {
    ref.setInput('customer', makeCustomer({
      binSites: [{ siteKey: 'north', name: 'North Bins' }, { siteKey: 'home', name: 'Home Place' }],
      grainOnFarm: [{ binSiteKey: 'north', binSiteName: 'North Bins', commodityCode: 'YC', bushelsOnHand: 30000 }],
    }));
    expect(component.grainGroupsCollapsible()).toBe(false);
    expect(component.isGrainGroupOpen(0)).toBe(true);
    expect(component.anyGrainGroupOpen()).toBe(true);
  });
});

// Covers the organic producer badge: which producers get it, and the header-panel spacing computed
// it introduced. The gate itself is unit-tested in @shared/utils/organic-visibility.spec.ts — these
// assert the component wires the producer's own fields into it and nothing else.
describe('CustomerProfileComponent — organic producer badge', () => {
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(CustomerProfileComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
  });

  it('shows the badge on the organic industry code alone', () => {
    ref.setInput('customer', makeCustomer({ industryCode2: 'OR' }));
    expect(component.showOrganicBadge()).toBe(true);
  });

  it('shows the badge on a real NOP id alone — the five producers coded CV or DA', () => {
    ref.setInput('customer', makeCustomer({ industryCode2: 'CV', nopId: '1234567890' }));
    expect(component.showOrganicBadge()).toBe(true);
  });

  it('hides the badge for a conventional producer', () => {
    ref.setInput('customer', makeCustomer({ industryCode2: 'CV' }));
    expect(component.showOrganicBadge()).toBe(false);
  });

  it('hides the badge when the producer carries neither signal', () => {
    ref.setInput('customer', makeCustomer());
    expect(component.showOrganicBadge()).toBe(false);
  });

  it('opens and closes the detail panel independently of the badge', () => {
    ref.setInput('customer', makeCustomer({ industryCode2: 'OR' }));
    expect(component.showOrganicDetail()).toBe(false);

    component.showOrganicDetail.set(true);
    expect(component.showOrganicBadge()).toBe(true);
    expect(component.anyHeaderPanelOpen()).toBe(true);
  });

  it('reports no header panel open when both are closed', () => {
    ref.setInput('customer', makeCustomer({ industryCode2: 'OR', eSignEnabled: true }));
    expect(component.anyHeaderPanelOpen()).toBe(false);
  });

  it('still reports the eSign panel — the spacing binding was eSign-only before the organic panel', () => {
    ref.setInput('customer', makeCustomer({ eSignEnabled: true }));
    component.showESignRecipients.set(true);
    expect(component.anyHeaderPanelOpen()).toBe(true);
  });

  it('does not treat an open eSign panel as open when the producer has no eSign', () => {
    ref.setInput('customer', makeCustomer({ eSignEnabled: false }));
    component.showESignRecipients.set(true);
    expect(component.anyHeaderPanelOpen()).toBe(false);
  });
});
