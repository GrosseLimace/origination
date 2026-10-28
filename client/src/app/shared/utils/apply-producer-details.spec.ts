import { describe, it, expect } from 'vitest';
import { Customer, ProducerDetails } from '@models';
import { applyProducerDetails } from './apply-producer-details';

const customer = (over: Partial<Customer> = {}): Customer =>
  ({ id: 93434, name: 'Farm', scoularId: 'RUNDMAP', totalAcres: 0, linkedProducerIds: [], ...over } as Customer);
const details = (over: Partial<ProducerDetails> = {}): ProducerDetails =>
  ({ customerId: 93434, ...over } as ProducerDetails);

describe('applyProducerDetails', () => {
  it('carries the saved grain on farm and bin sites over a list row that has none (the RUNDMAP bug)', () => {
    const grain = [{ binSiteKey: 'b3', binSiteName: 'Bin 3', commodityCode: 'YC', bushelsOnHand: 50000 }];
    const sites = [{ siteKey: 'b3', name: 'Bin 3', capacity: 1000000 }];

    const out = applyProducerDetails(customer({ grainOnFarm: [] }), details({ grainOnFarm: grain, binSites: sites } as never));

    expect(out.grainOnFarm).toEqual(grain);
    expect(out.binSites).toEqual(sites);
  });

  it('carries every saved field, primary phone included', () => {
    const out = applyProducerDetails(customer(), details({
      totalAcres: 1200, primaryContact: 'Pat', primaryPhone: '555-0100',
      contacts: [{ name: 'Pat', phone: '555-0100', isPrimary: true }],
      commodities: 'YC, SB', linkedProducerIds: 'ABC,,DEF',
    } as never));

    expect(out).toMatchObject({
      totalAcres: 1200, primaryContact: 'Pat', primaryPhone: '555-0100',
      commodities: ['YC', 'SB'], linkedProducerIds: ['ABC', 'DEF'],
    });
    expect(out.contacts).toHaveLength(1);
  });

  it('keeps the customer value for anything not saved', () => {
    const grain = [{ commodityCode: 'SB', bushelsOnHand: 10 }];
    const out = applyProducerDetails(
      customer({ totalAcres: 300, grainOnFarm: grain as never, commodities: ['SB'], linkedProducerIds: ['X'] }),
      details());

    expect(out).toMatchObject({ totalAcres: 300, grainOnFarm: grain, commodities: ['SB'], linkedProducerIds: ['X'] });
  });
});
