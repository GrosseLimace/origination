import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService, NlqFilterContext } from './nlq-filter.service';
import { Customer } from '@models';

/** Minimal customer with just the fields the state filter reads. Neutral names so name-search
 *  can't interfere. `extendedStateProvince` is the producer's own state; `stateProvince` is
 *  where the trade unit merchandises — the two can legitimately differ. */
function customer(id: number, name: string, extendedStateProvince?: string, stateProvince?: string): Customer {
  return {
    id, name, farm: '', location: '', phone: '', email: '',
    totalAcres: 0, linkedProducerIds: [], eSignEnabled: false,
    extendedStateProvince, stateProvince,
  } as Customer;
}

function ctx(customers: Customer[]): NlqFilterContext {
  return { customers, contracts: [], tickets: [], notes: [], plantingIntentions: [], storedGrain: [] };
}

describe('NlqFilterService — state detection covers all 50 states, not just the original 15', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  it('detects a state outside the original hardcoded 15 (Georgia)', () => {
    expect(svc.detectStateInQuery('producers in Georgia')).toBe('georgia');
  });

  it('filters correctly for that state — does not silently match every producer', () => {
    const georgia = customer(1, 'Alpha Farms', 'Georgia');
    const iowa = customer(2, 'Bravo Farms', 'Iowa');
    const ids = svc.parseAndFilter('producers in Georgia', ctx([georgia, iowa]))
      .customers.map(c => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([1]);
  });

  it('getStateDisplayName renders a proper-cased name for a state outside the original 15', () => {
    expect(svc.getStateDisplayName('georgia')).toBe('Georgia');
    expect(svc.getStateDisplayName('north carolina')).toBe('North Carolina');
  });
});

describe('NlqFilterService — state field precedence matches the refine-panel chips', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  it('prefers extendedStateProvince (the producer\'s own state) over stateProvince (where the TU merchandises), same as the refine chips', () => {
    // The TU merchandises in Iowa, but the producer's own address is Nebraska — a free-text
    // "producers in Nebraska" query and a Nebraska refine chip must agree on this producer.
    const mixed = customer(1, 'Alpha Farms', 'Nebraska', 'Iowa');
    const ids = svc.parseAndFilter('producers in Nebraska', ctx([mixed])).customers.map(c => c.id);
    expect(ids).toEqual([1]);
  });

  it('a producer with neither state field set never matches a state filter', () => {
    const blank = customer(1, 'Alpha Farms');
    const ids = svc.parseAndFilter('producers in Iowa', ctx([blank])).customers.map(c => c.id);
    expect(ids).toEqual([]);
  });
});
