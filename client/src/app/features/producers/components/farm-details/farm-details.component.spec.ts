import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Commodity, Customer, ProducerDetails } from '@models';
import { producerProfilesFake, profilesOf, provideProducerProfiles, withProfile } from '@testing/producer-profiles.fake';
import { CUSTOMER_SCREEN_SOURCE, CustomerScreenLink, SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { AppStateService } from '@core/services/app-state.service';
import { provideSelectedProducerProduction, selectedProducerProductionFake, SelectedProducerProductionFake } from '@testing/selected-producer-production.fake';
import { FarmDetailsComponent } from './farm-details.component';

/** A producer, with the given saved details (their bin sites, contacts, acres, grain on farm) as their profile. */
const producer = ({ id = 1, name = 'Smith Farms', ...details }: Omit<Partial<ProducerDetails>, 'id'> & { id?: number; name?: string } = {}) =>
  withProfile({ id, name } as Customer, details);
const twoSites = (id: number) => producer({
  id,
  binSites: [{ siteKey: 'north', name: 'North Bins' }, { siteKey: 'home', name: 'Home Place' }],
  grainOnFarm: [
    { binSiteKey: 'north', binSiteName: 'North Bins', commodityCode: 'YC', bushelsOnHand: 30000 },
    { binSiteKey: 'north', binSiteName: 'North Bins', commodityCode: 'SB', bushelsOnHand: 5000 },
    { binSiteKey: 'home', binSiteName: 'Home Place', commodityCode: 'YC', bushelsOnHand: 1000 },
  ],
});

describe('FarmDetailsComponent', () => {
  const customer = signal<Customer | null>(null);
  const profiles = producerProfilesFake();
  const commodities = signal<Commodity[]>([]);
  let production: SelectedProducerProductionFake;
  let fixture: ComponentFixture<FarmDetailsComponent>;
  let farm: FarmDetailsComponent;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => (host().textContent ?? '').replace(/\s+/g, ' ').trim();
  const table = () => host().querySelector<HTMLElement>('#grain-on-farm-table');

  /** Puts `who` on screen, with their saved details. */
  function show(who: Customer | null): void {
    customer.set(who);
    profiles.set(who ? [...profilesOf([who]).values()] : []);
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.clear();
    commodities.set([]);
    production = selectedProducerProductionFake();
    TestBed.configureTestingModule({
      providers: [
        { provide: CUSTOMER_SCREEN_SOURCE, useValue: { customer, linkedCustomers: signal([]), link: signal<CustomerScreenLink>({}) } },
        SelectedCustomerContext,
        provideProducerProfiles(profiles),
        provideSelectedProducerProduction(production),
        { provide: AppStateService, useValue: { commodities } },
      ],
    });
    fixture = TestBed.createComponent(FarmDetailsComponent);
    farm = fixture.componentInstance;
  });

  it("shows the producer's acres and the commodities they deal in", () => {
    production.commodityCodes.set(['SB', 'YC']);
    show(producer({ totalAcres: 1200 }));

    expect(text()).toContain('Farm Details');
    expect(text()).toContain('1,200 acres');
    expect(Array.from(host().querySelectorAll('span.bg-amber-100')).map(chip => chip.textContent)).toEqual(['SB', 'YC']);
  });

  it('says so when they deal in no commodities, and shows nothing without a producer', () => {
    show(producer());
    expect(text()).toContain('0 acres');
    expect(text()).toContain('No commodities');

    show(null);
    expect(text()).toBe('');
  });

  it('lists grain on farm grouped by bin site, in site order, rows without a site last', () => {
    show(producer({
      binSites: [{ siteKey: 'north', name: 'North Bins' }, { siteKey: 'home', name: 'Home Place' }],
      grainOnFarm: [
        { binSiteKey: null, commodityCode: 'WH', bushelsOnHand: 90000 },
        { binSiteKey: 'home', binSiteName: 'Home Place', commodityCode: 'YC', bushelsOnHand: 5000 },
        { binSiteKey: 'north', binSiteName: 'North Bins', commodityCode: 'SB', bushelsOnHand: 1000 },
        { binSiteKey: 'north', binSiteName: 'North Bins', commodityCode: 'YC', bushelsOnHand: 30000 },
      ],
    }));

    expect(farm.rows().map(g => `${g.binSiteName ?? '—'} ${g.commodityCode}`))
      .toEqual(['North Bins YC', 'North Bins SB', 'Home Place YC', '— WH']);
    // The headline total still adds up every row, at every site.
    expect(farm.total()).toBe(126000);
    expect(text()).toContain('126,000 bu on farm');
  });

  it('groups the table by site name, labelling rows without a site only when sites are present too', () => {
    show(producer({
      binSites: [{ siteKey: 'north', name: 'North Quarter Home Place Bins by the Creek' }],
      grainOnFarm: [
        { binSiteKey: 'north', binSiteName: 'North Quarter Home Place Bins by the Creek', commodityCode: 'YC', bushelsOnHand: 30000 },
        { binSiteKey: null, commodityCode: 'WH', bushelsOnHand: 100 },
      ],
    }));
    expect(farm.groups().map(g => [g.label, g.rows.map(r => r.commodityCode)]))
      .toEqual([['North Quarter Home Place Bins by the Creek', ['YC']], ['Not tied to a bin site', ['WH']]]);

    show(producer({ grainOnFarm: [{ commodityCode: 'WH', bushelsOnHand: 100 }] }));
    expect(farm.groups().map(g => g.label)).toEqual(['']);
  });

  it('with grain at more than one site, starts every site closed and opens each on its own, until the next producer', () => {
    show(twoSites(1));

    expect(farm.groupsCollapsible()).toBe(true);
    expect([farm.isGroupOpen(0), farm.isGroupOpen(1)]).toEqual([false, false]);
    expect(farm.anyGroupOpen()).toBe(false);
    expect(farm.groupSummary(farm.groups()[0].rows)).toBe('2 crops · 35,000 bu');

    farm.toggleGroup(1);
    expect([farm.isGroupOpen(0), farm.isGroupOpen(1)]).toEqual([false, true]);
    expect(farm.anyGroupOpen()).toBe(true);

    show(twoSites(2));
    expect(farm.isGroupOpen(1)).toBe(false);
  });

  it('with grain at one site (or none), shows the table open', () => {
    show(producer({
      binSites: [{ siteKey: 'north', name: 'North Bins' }, { siteKey: 'home', name: 'Home Place' }],
      grainOnFarm: [{ binSiteKey: 'north', binSiteName: 'North Bins', commodityCode: 'YC', bushelsOnHand: 30000 }],
    }));
    expect(farm.groupsCollapsible()).toBe(false);
    expect(farm.isGroupOpen(0)).toBe(true);
    expect(farm.anyGroupOpen()).toBe(true);
  });

  // The profile finds the open table by details-span to make room for it, and the table places itself last.
  it('opens the table as a details row item of its own, placed last, and closes it from the bushels line', () => {
    show(producer({ grainOnFarm: [{ commodityCode: 'YC', bushelsOnHand: 100 }] }));
    expect(table()!.classList).toContain('details-span');
    expect(table()!.classList).toContain('order-last');
    expect(table()!.textContent).toContain('YC');

    host().querySelector<HTMLElement>('[aria-controls="grain-on-farm-table"]')!.click();
    fixture.detectChanges();

    expect(table()).toBeNull();
  });

  it('has no table, and nothing to open, without grain on the farm', () => {
    show(producer());
    farm.toggle();
    fixture.detectChanges();

    expect(farm.expanded()).toBe(true);
    expect(table()).toBeNull();
    expect(host().querySelector('[aria-controls="grain-on-farm-table"]')!.getAttribute('aria-expanded')).toBeNull();
  });

  // Open until the user closes it; a close sticks across producers and reloads, which a new instance stands in for.
  it('remembers an explicit close, and an explicit reopen', () => {
    show(producer({ grainOnFarm: [{ commodityCode: 'YC', bushelsOnHand: 100 }] }));
    farm.toggle();
    expect(TestBed.createComponent(FarmDetailsComponent).componentInstance.expanded()).toBe(false);

    farm.toggle();
    expect(TestBed.createComponent(FarmDetailsComponent).componentInstance.expanded()).toBe(true);
  });

  it("names each crop's commodity on hover", () => {
    commodities.set([{ id: 1, code: 'YC', name: 'YELLOW CORN' } as Commodity]);
    show(producer({ grainOnFarm: [{ commodityCode: 'YC', bushelsOnHand: 100 }] }));

    expect(table()!.querySelector('td[title="YELLOW CORN"]')?.textContent).toBe('YC');
  });
});
