import type { Contract, Ticket } from '@models';

/** Distinct commodity codes a producer's tickets (ProductCode) and contracts (CommodityCode) carry,
 *  tickets' first. */
export function commodityCodesFrom(tickets: Ticket[], contracts: Contract[]): string[] {
  const ticketCommodities = [...new Set(tickets.map(t => t.productCode || '').filter(Boolean))];
  const contractCommodities = [...new Set(contracts.map(c => c.commodityCode || '').filter(Boolean))];
  return [...new Set([...ticketCommodities, ...contractCommodities])];
}
