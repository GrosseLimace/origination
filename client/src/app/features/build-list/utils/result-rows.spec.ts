import { describe, it, expect } from 'vitest';
import { Contract, Customer, DpContract, PlantingIntention, StoredGrain, Ticket } from '@models';
import { buildLinkedProducerComponents } from '@shared/utils/linked-producers';
import {
  binSiteGrainHiddenLabel, binSiteGrainSummary, commodityCategoryByKey, contractsByCustomerCode, cropsByCustomer, dpBreakdown,
  formattedLocation, grainOnFarmBreakdown, groupByCustomerId, hasBinSiteGrain, initials, linkedProducerInfo, storageBreakdown,
  storageTotalBushels,
} from './result-rows';

const customer = (id: number, over: Partial<Customer> = {}): Customer => ({
  id, name: `P${id}`, scoularId: `C${id}`, farm: '', location: '', phone: '', email: '', totalAcres: 0,
  linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
});
const contract = (id: number, ctrmCustomerId: string | undefined, over: Partial<Contract> = {}) =>
  ({ id, ctrmCustomerId, commodityCode: 'YC', ...over }) as Contract;

describe('contractsByCustomerCode', () => {
  const contracts = [contract(1, 'C1'), contract(2, 'C1', { closedDate: new Date() }), contract(3, 'C2'), contract(4, undefined)];

  it('groups every contract with a customer code, or open ones only', () => {
    const all = contractsByCustomerCode(contracts);
    expect([...all.entries()].map(([k, v]) => [k, v.map(c => c.id)])).toEqual([['C1', [1, 2]], ['C2', [3]]]);
    const open = contractsByCustomerCode(contracts, true);
    expect(open.get('C1')!.map(c => c.id)).toEqual([1]);
  });
});

describe('groupByCustomerId', () => {
  it('groups rows by numeric customer id, keeping their order', () => {
    const rows = [{ customerId: 2, n: 'a' }, { customerId: 1, n: 'b' }, { customerId: 2, n: 'c' }];
    expect([...groupByCustomerId(rows).entries()]).toEqual([[2, [rows[0], rows[2]]], [1, [rows[1]]]]);
  });
});

describe('linkedProducerInfo', () => {
  it('lists the other loaded, non-excluded members of each customer\'s linked component', () => {
    const customers = [customer(1, { linkedProducerIds: ['C2', 'C9'] }), customer(2, { linkedProducerIds: ['C3'] }), customer(3), customer(4)];
    const components = buildLinkedProducerComponents(customers);
    const info = linkedProducerInfo(customers, new Set([3]), components);
    expect(info.get(1)).toEqual({ count: 1, producers: [customers[1]] });
    expect(info.get(2)!.producers.map(p => p.id)).toEqual([1]);
    expect(info.get(3)!.producers.map(p => p.id).sort()).toEqual([1, 2]);
    expect(info.has(4)).toBe(false);
  });
});

describe('cropsByCustomer', () => {
  it('merges details, contracts, plantings, tickets and storage, de-duplicated, first five', () => {
    const customers = [customer(1, { commodities: ['Corn', ' corn', 'Soybeans'] }), customer(2, { scoularId: undefined }), customer(3)];
    const map = cropsByCustomer(
      contractsByCustomerCode([contract(1, 'C1', { commodityCode: 'YC' }), contract(2, 'C1', { commodityCode: 'YC' }), contract(3, 'C1', { commodityCode: '' })]),
      [{ customerId: 1, crop: 'WHT' }, { customerId: 2, crop: 'SB' }] as PlantingIntention[],
      [{ customerId: 1, productCode: 'MILO' }, { customerId: 3, productCode: 'YC' }, { customerId: 3 }] as Ticket[],
      [{ customerId: 1, crop: 'OATS' }, { customerId: 3, crop: 'yc' }] as StoredGrain[],
      customers,
    );
    expect(map.get(1)).toEqual(['Corn', 'Soybeans', 'YC', 'WHT', 'MILO']);
    expect(map.get(2)).toEqual(['SB']);
    expect(map.get(3)).toEqual(['YC']);
  });
});

describe('initials and formattedLocation', () => {
  it('initials', () => {
    expect(initials('alpha acres farm')).toBe('AA');
    expect(initials('  Bravo  ')).toBe('BR');
    expect(initials('C')).toBe('??');
    expect(initials('')).toBe('??');
  });

  it('prefers the extended city/state, then the merchandising pair, then any single part', () => {
    expect(formattedLocation(customer(1, { extendedCity: 'Dodge City', extendedStateProvince: 'KS', location: 'Pratt', stateProvince: 'KS' }))).toBe('Dodge City, KS');
    expect(formattedLocation(customer(1, { extendedCity: 'Dodge City', location: 'Pratt', stateProvince: 'KS' }))).toBe('Pratt, KS');
    expect(formattedLocation(customer(1, { extendedCity: 'Dodge City', location: 'Pratt' }))).toBe('Dodge City');
    expect(formattedLocation(customer(1, { stateProvince: 'NE' }))).toBe('NE');
    expect(formattedLocation(customer(1))).toBe('');
  });
});

describe('grain on farm and bin sites', () => {
  it('sums a crop across bin sites, ignores empty rows, largest first', () => {
    const c = customer(1, { grainOnFarm: [
      { commodityCode: 'sb', bushelsOnHand: 100 }, { commodityCode: 'YC', bushelsOnHand: 50 },
      { commodityCode: 'SB', bushelsOnHand: 25 }, { commodityCode: 'HRW', bushelsOnHand: 0 }, { commodityCode: '', bushelsOnHand: 9 },
    ] });
    expect(grainOnFarmBreakdown(c)).toEqual([{ commodityCode: 'sb', bushelsOnHand: 125 }, { commodityCode: 'YC', bushelsOnHand: 50 }]);
  });

  it('summarises a site and labels the hidden ones', () => {
    const site = (n: number) => ({ name: 's', capacity: null, mapUrl: null, rows: Array.from({ length: n }, () => ({ commodityCode: 'YC', bushelsOnHand: 1500 })) });
    expect(binSiteGrainSummary(site(0))).toBe('No grain on farm');
    expect(binSiteGrainSummary(site(1))).toBe('1 crop · 1,500 bu');
    expect(binSiteGrainSummary(site(2))).toBe('2 crops · 3,000 bu');
    const groups = [site(0), site(0), site(0), site(0), site(0), site(0)];
    expect(binSiteGrainHiddenLabel(groups, 4)).toBe('Show 2 more bin sites');
    expect(binSiteGrainHiddenLabel(groups.slice(0, 5), 4)).toBe('Show 1 more bin site');
    expect(binSiteGrainHiddenLabel(groups.slice(0, 3), 4)).toBeNull();
  });

  it('hasBinSiteGrain is true with a site or a grain row', () => {
    expect(hasBinSiteGrain(customer(1))).toBe(false);
    expect(hasBinSiteGrain(customer(1, { binSites: [{ name: 'x' }] }))).toBe(true);
    expect(hasBinSiteGrain(customer(1, { grainOnFarm: [{ commodityCode: 'YC' }] }))).toBe(true);
  });
});

describe('storage and DP chips', () => {
  const catByKey = commodityCategoryByKey([
    { id: 1, code: ' YC ', name: 'Yellow Corn', category: 'Corn', isActive: true },
    { id: 2, code: 'SOR', name: 'Sorghum', isActive: true },
    { id: 3, code: 'X', name: '', isActive: true },
  ]);

  it('maps codes and names to the crop category (name when no category)', () => {
    expect([...catByKey.entries()]).toEqual([['yc', 'Corn'], ['yellow corn', 'Corn'], ['sor', 'Sorghum'], ['sorghum', 'Sorghum']]);
  });

  it('storage totals and per-crop breakdown, largest first, colored by category', () => {
    const recs = [
      { crop: 'YC', quantity: 300 }, { crop: 'SOR', quantity: 500 }, { crop: 'YC ', quantity: 300 },
      { crop: '', quantity: 10 }, { crop: 'SB', quantity: 0 },
    ] as StoredGrain[];
    expect(storageTotalBushels(recs)).toBe(1110);
    expect(storageBreakdown(recs, catByKey)).toEqual([
      { crop: 'YC', bushels: 600, category: 'Corn' },
      { crop: 'SOR', bushels: 500, category: 'Sorghum' },
      { crop: 'Unknown', bushels: 10, category: 'Unknown' },
    ]);
  });

  it('DP breakdown counts each delivery once and drops zero-bushel crops', () => {
    const rows = [
      { id: 'a1', ticketKey: 'a', crop: 'YC', bushels: 700 }, { id: 'a2', ticketKey: 'a', crop: 'YC', bushels: 700 },
      { id: 'b', ticketKey: 'b', crop: 'SB', bushels: 0 },
    ] as DpContract[];
    expect(dpBreakdown(rows, catByKey)).toEqual([{ crop: 'YC', bushels: 700, category: 'Corn' }]);
  });
});
