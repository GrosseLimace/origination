import { ProducerDetails } from '@models';

/** The commodities the user added to the producer's profile, from its comma-separated list. None without a profile. */
export function profileCommodities(profile: ProducerDetails | undefined): string[] {
  return profile?.commodities ? profile.commodities.split(',').map(c => c.trim()) : [];
}

/** The producer codes the producer's profile links to, from its comma-separated list. None without a profile. */
export function profileLinkedIds(profile: ProducerDetails | undefined): string[] {
  return profile?.linkedProducerIds ? profile.linkedProducerIds.split(',').filter(Boolean) : [];
}
