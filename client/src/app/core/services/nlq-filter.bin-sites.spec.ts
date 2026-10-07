import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService, NlqFilterContext } from './nlq-filter.service';
import { Customer, ProducerBinSiteItem } from '@models';

/**
 * Build a List queries on bin sites (the lat/long locations under a producer's address):
 * "with bin sites", "without bin sites", "more than N" / "at least N" / "multiple" bin sites.
 * "Bin" also means bin CAPACITY, so the two must never trigger each other.
 */
const site = (lat: number): ProducerBinSiteItem => ({ name: null, latitude: lat, longitude: -95.1 });

function customer(id: number, over: { binSites?: ProducerBinSiteItem[]; binCapacity?: number } = {}): Customer {
  return {
    id, name: `Farm ${id}`, farm: '', location: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false,
    email: '', phone: '', ...over,
  } as Customer;
}

function ctx(customers: Customer[]): NlqFilterContext {
  return { customers, contracts: [], tickets: [], notes: [], plantingIntentions: [], storedGrain: [] };
}

describe('NlqFilterService — bin sites', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  const none = customer(1);
  const one = customer(2, { binSites: [site(39.1)] });
  const two = customer(3, { binSites: [site(39.1), site(39.2)] });
  const three = customer(4, { binSites: [site(39.1), site(39.2), site(39.3)] });
  // Capacity but no sites, and sites but no capacity — the collision cases.
  const capacityOnly = customer(5, { binCapacity: 50_000 });
  const sitesNoCapacity = customer(6, { binSites: [site(40.1)], binCapacity: 0 });

  const all = [none, one, two, three, capacityOnly, sitesNoCapacity];
  const ids = (q: string) => svc.parseAndFilter(q, ctx(all)).customers.map(c => c.id).sort((a, b) => a - b);
  const patterns = (q: string) => svc.parseAndFilter(q, ctx(all)).matchedPatterns;

  it.each([
    'producers with bin sites',
    'producers that have bin sites',
    'producers with a bin site',
    'growers with bin locations',
    'producers with bin coordinates',
  ])('"%s" lists producers that have at least one site', q => {
    expect(ids(q)).toEqual([2, 3, 4, 6]);
  });

  it.each([
    'producers without bin sites',
    'producers with no bin sites',
    "producers that don't have any bin sites",
    'producers missing bin locations',
  ])('"%s" lists producers with none', q => {
    expect(ids(q)).toEqual([1, 5]);
  });

  it.each([
    ['producers with more than 1 bin site', [3, 4]],
    ['producers with more than 2 bin sites', [4]],
    ['producers with at least 2 bin sites', [3, 4]],
    ['producers with 3+ bin sites', [4]],
    ['producers with 2 or more bin sites', [3, 4]],
    ['producers with multiple bin sites', [3, 4]],
    ['producers with more than one bin site', [3, 4]],
  ])('"%s" filters on the count', (q, expected) => {
    expect(ids(q)).toEqual(expected);
  });

  it('reports bin-site queries as recognised, not as bin capacity', () => {
    expect(patterns('producers with bin sites')).toContain('has_bin_sites');
    expect(patterns('producers with bin sites')).not.toContain('has_bin_capacity');
    expect(patterns('producers without bin sites')).toContain('no_bin_sites');
    expect(patterns('producers without bin sites')).not.toContain('no_bin_capacity');
    expect(patterns('producers with multiple bin sites')).toContain('bin_sites_count');
  });

  // The collision, both directions.
  it('a bin-site query never filters on bin capacity', () => {
    expect(ids('producers with bin sites')).toContain(6);       // sites, zero capacity
    expect(ids('producers without bin sites')).toContain(5);    // capacity, no sites
  });

  it('a bin-capacity query still means capacity, not sites', () => {
    expect(ids('producers with bin capacity')).toEqual([5]);
    expect(ids('producers that have bin capacity')).toEqual([5]);
    expect(patterns('producers with bin capacity')).not.toContain('has_bin_sites');
  });
});
