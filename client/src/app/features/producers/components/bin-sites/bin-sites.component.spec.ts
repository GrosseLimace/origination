import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Customer, ProducerDetails } from '@models';
import { producerProfilesFake, profilesOf, provideProducerProfiles, withProfile } from '@testing/producer-profiles.fake';
import { CUSTOMER_SCREEN_SOURCE, CustomerScreenLink, SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { BinSitesComponent } from './bin-sites.component';

/** A producer, with the given saved details (their bin sites, contacts, acres, grain on farm) as their profile. */
const producer = ({ id = 1, name = 'Smith Farms', ...details }: Omit<Partial<ProducerDetails>, 'id'> & { id?: number; name?: string } = {}) =>
  withProfile({ id, name } as Customer, details);

describe('BinSitesComponent', () => {
  const customer = signal<Customer | null>(null);
  const profiles = producerProfilesFake();
  let fixture: ComponentFixture<BinSitesComponent>;
  let sites: BinSitesComponent;
  let tracking: { trackBinSiteMapClick: ReturnType<typeof vi.fn> };

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => (host().textContent ?? '').replace(/\s+/g, ' ').trim();

  /** Puts `who` on screen, with their saved details. */
  function show(who: Customer | null): void {
    customer.set(who);
    profiles.set(who ? [...profilesOf([who]).values()] : []);
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.clear();
    tracking = { trackBinSiteMapClick: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: CUSTOMER_SCREEN_SOURCE, useValue: { customer, linkedCustomers: signal([]), link: signal<CustomerScreenLink>({}) } },
        SelectedCustomerContext,
        provideProducerProfiles(profiles),
        { provide: UsageTrackingService, useValue: tracking },
      ],
    });
    fixture = TestBed.createComponent(BinSitesComponent);
    sites = fixture.componentInstance;
  });

  it('builds one row per site, in saved order, with every cell formatted', () => {
    show(producer({
      binSites: [
        { name: 'Anderson Site', latitude: 39.115876, longitude: -95.143955, capacity: 50000, sortOrder: 0 },
        { name: 'North Quarter', latitude: 40.5, longitude: -96, capacity: 30000, sortOrder: 1 },
      ],
    }));

    const [first, second] = sites.rows();
    expect(first).toMatchObject({ name: 'Anderson Site', capacity: '50,000' });
    expect(second).toMatchObject({ name: 'North Quarter', capacity: '30,000' });
  });

  it('links each site with coordinates to its exact point in Google Maps', () => {
    show(producer({ binSites: [{ name: 'Anderson Site', latitude: 41.39034548435109, longitude: -95.00754031349179 }] }));

    expect(sites.rows()[0].url).toBe('https://www.google.com/maps/search/?api=1&query=41.39034548435109%2C-95.00754031349179');
  });

  it('gives a site without coordinates no map link', () => {
    show(producer({ binSites: [{ name: 'Home place', capacity: 20000 }] }));

    expect(sites.rows()[0]).toMatchObject({ name: 'Home place', url: null });
  });

  it('shows nothing for a producer with no bin sites, or no producer', () => {
    show(producer());
    expect(sites.rows()).toEqual([]);
    expect(text()).toBe('');

    show(null);
    expect(text()).toBe('');
  });

  it('shows a single site on its own line, with no "Bin Sites (1)" toggle', () => {
    show(producer({ binSites: [{ name: 'Only one', latitude: 39.1, longitude: -95.1, capacity: 50000 }] }));

    expect(text()).toContain('Only one · 50,000 bu');
    expect(text()).not.toContain('Bin Sites');
    expect(host().querySelector('a[aria-label="Open Only one in Google Maps"]')).not.toBeNull();
  });

  it('puts two or more sites behind the toggle, which starts open, and closes', () => {
    show(producer({ binSites: [{ name: 'A' }, { name: 'B' }] }));
    expect(text()).toContain('Bin Sites (2)');
    expect(host().querySelector('#bin-sites-table')).not.toBeNull();

    host().querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();

    expect(host().querySelector('#bin-sites-table')).toBeNull();
  });

  // Open until the user closes it; a close sticks across producers and reloads, which a new instance stands in for.
  it('remembers an explicit close, and an explicit reopen', () => {
    show(producer({ binSites: [{ name: 'A' }, { name: 'B' }] }));
    sites.toggle();
    expect(TestBed.createComponent(BinSitesComponent).componentInstance.expanded()).toBe(false);

    sites.toggle();
    expect(TestBed.createComponent(BinSitesComponent).componentInstance.expanded()).toBe(true);
  });

  it('counts a map click against the producer, under its own subfeature', () => {
    show(producer({ id: 42, binSites: [{ name: 'Only one', latitude: 39.1, longitude: -95.1 }] }));

    // Followed, the link would have the test DOM load Google Maps over the network.
    host().addEventListener('click', event => event.preventDefault());
    host().querySelector<HTMLAnchorElement>('a')!.click();

    expect(tracking.trackBinSiteMapClick).toHaveBeenCalledWith('42');
  });
});
