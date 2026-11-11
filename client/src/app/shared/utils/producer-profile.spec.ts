import { describe, it, expect } from 'vitest';
import { producerProfile } from '@testing/producer-profiles.fake';
import { profileCommodities, profileLinkedIds } from './producer-profile';

describe('the comma-separated lists in a producer profile', () => {
  it('reads the commodities, trimmed, as the profile shows them', () => {
    expect(profileCommodities(producerProfile(1, { commodities: 'YC, sb ,HRW' }))).toEqual(['YC', 'sb', 'HRW']);
  });

  it('reads the linked producer codes, dropping empty entries', () => {
    expect(profileLinkedIds(producerProfile(1, { linkedProducerIds: 'A1,,B2,' }))).toEqual(['A1', 'B2']);
  });

  it('reads none from a profile without them, or no profile', () => {
    expect(profileCommodities(producerProfile(1))).toEqual([]);
    expect(profileLinkedIds(producerProfile(1, { linkedProducerIds: '' }))).toEqual([]);
    expect(profileCommodities(undefined)).toEqual([]);
    expect(profileLinkedIds(undefined)).toEqual([]);
  });
});
