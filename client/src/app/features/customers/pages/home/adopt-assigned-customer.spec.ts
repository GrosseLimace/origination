import { describe, it, expect } from 'vitest';
import { applyAdoptedCustomerId } from './adopt-assigned-customer';

/**
 * The server may assign trade units to an existing customer row with a different id than the one the
 * client requested (it matched the same producer by ScoularId). Writing details under the stale id
 * would split the producer again or be dropped silently.
 */
describe('applyAdoptedCustomerId', () => {
  const data = { customerId: 777, acres: 120, commodities: ['corn'] };

  it('returns the same object when the server kept the requested id', () => {
    expect(applyAdoptedCustomerId(data, { id: 777 })).toBe(data);
  });

  it('returns the same object when the response is null or undefined', () => {
    expect(applyAdoptedCustomerId(data, null)).toBe(data);
    expect(applyAdoptedCustomerId(data, undefined)).toBe(data);
  });

  it('rewrites customerId when the server adopted another row', () => {
    const adopted = applyAdoptedCustomerId(data, { id: 5000000000000042 });

    expect(adopted).not.toBe(data);
    expect(adopted).toEqual({ ...data, customerId: 5000000000000042 });
    expect(data.customerId).toBe(777);
  });
});
