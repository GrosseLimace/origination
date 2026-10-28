import { Customer, ProducerDetails } from '@models';

/**
 * A producer with their saved details (dbo.ProducerDetails and its child sets) laid over the customer
 * record: what the user entered wins, and anything they didn't enter keeps the customer's value.
 *
 * The one place this is done. The home page used to spell it out at five call sites, and the copy used
 * when a producer is clicked in the list had dropped grain on farm and primary phone — so the profile
 * showed whatever (possibly stale) grain the list row carried (QA, RUNDMAP, 2026-10-12).
 */
export function applyProducerDetails(customer: Customer, pd: ProducerDetails): Customer {
  return {
    ...customer,
    totalAcres: pd.totalAcres ?? customer.totalAcres,
    grainOnFarm: pd.grainOnFarm ?? customer.grainOnFarm,
    primaryContact: pd.primaryContact ?? customer.primaryContact,
    primaryPhone: pd.primaryPhone ?? customer.primaryPhone,
    contacts: pd.contacts ?? customer.contacts,
    binSites: pd.binSites ?? customer.binSites,
    commodities: pd.commodities ? pd.commodities.split(',').map(c => c.trim()) : customer.commodities,
    linkedProducerIds: pd.linkedProducerIds ? pd.linkedProducerIds.split(',').filter(Boolean) : customer.linkedProducerIds,
  };
}
