import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService } from './nlq-filter.service';
import { Customer, Ticket } from '@models';

/** Minimal customer with just the fields the delivery-location filter reads. Neutral names so
 *  name-search can't interfere. */
function customer(id: number, name: string, scoularId: string): Customer {
  return {
    id, name, scoularId, farm: '', location: '', phone: '', email: '',
    totalAcres: 0, linkedProducerIds: [], eSignEnabled: false,
  } as Customer;
}

/** Minimal ticket carrying just customerCode + elevatorCity — the resolved "City, ST" display
 *  string dbo.MbpLocationSynonym produces server-side. */
function ticket(customerCode: string, elevatorCity?: string): Ticket {
  return { id: Math.random(), farmId: '', ticketNumber: 't', date: '2026-01-01', grossWeight: 0, tareWeight: 0, netWeight: 0, isApplied: true, isActive: true, customerCode, elevatorCity } as Ticket;
}

describe('NlqFilterService — Delivery Location refine (Ticket.elevatorCity)', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  const alpha = customer(1, 'Alpha Farms', 'S1'); // delivers to Madrid, NE
  const bravo = customer(2, 'Bravo Farms', 'S2');  // delivers to Pratt, KS
  const charlie = customer(3, 'Charlie Farms', 'S3'); // no ticket location resolved
  const all = [alpha, bravo, charlie];
  const tickets = [
    ticket('S1', 'Madrid, NE'),
    ticket('S2', 'Pratt, KS'),
    ticket('S3', undefined), // ticket exists but location never resolved
  ];

  it('dataNeedsForCriteria requires tickets when deliveryLocations is set, even with no query text', () => {
    expect(svc.dataNeedsForCriteria('', { deliveryLocations: ['Madrid, NE'] } as never).tickets).toBe(true);
    expect(svc.dataNeedsForCriteria('', {} as never).tickets).toBe(false);
  });

  it('keeps only producers with a matching elevatorCity on at least one ticket', () => {
    const ids = svc.applyRefinementFilters(all, { deliveryLocations: ['Madrid, NE'] } as never, [], [], { tickets })
      .map(c => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([1]);
  });

  it('matches ANY selected location (OR semantics), same as the crop/state chips', () => {
    const ids = svc.applyRefinementFilters(all, { deliveryLocations: ['Madrid, NE', 'Pratt, KS'] } as never, [], [], { tickets })
      .map(c => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]);
  });

  it('excludes a producer whose ticket has no resolved location', () => {
    const ids = svc.applyRefinementFilters(all, { deliveryLocations: ['Madrid, NE'] } as never, [], [], { tickets })
      .map(c => c.id);
    expect(ids).not.toContain(3);
  });

  it('is independent of crops/states — combines as an AND with them', () => {
    const withState = all.map(c => c.id === 1 ? { ...c, extendedStateProvince: 'Nebraska' } : c);
    const ids = svc.applyRefinementFilters(withState, { deliveryLocations: ['Madrid, NE'], states: ['Nebraska'] } as never, [], [], { tickets })
      .map(c => c.id);
    expect(ids).toEqual([1]);
  });
});

describe('NlqFilterService — "All producers" blank-start card', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  it('returns every producer unchanged, with no narrowing', () => {
    const alpha = customer(1, 'Alpha Farms', 'S1');
    const bravo = customer(2, 'Bravo Farms', 'S2');
    const ids = svc.parseAndFilter('All producers', { customers: [alpha, bravo], contracts: [], tickets: [], notes: [], plantingIntentions: [], storedGrain: [] })
      .customers.map(c => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]);
  });
});

describe('NlqFilterService — "Start with no producers" blank-start card', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  it('returns nobody, even though every other unrecognized query defaults to matching everyone', () => {
    const alpha = customer(1, 'Alpha Farms', 'S1');
    const bravo = customer(2, 'Bravo Farms', 'S2');
    const ids = svc.parseAndFilter('Start with no producers', { customers: [alpha, bravo], contracts: [], tickets: [], notes: [], plantingIntentions: [], storedGrain: [] })
      .customers.map(c => c.id);
    expect(ids).toEqual([]);
  });
});
