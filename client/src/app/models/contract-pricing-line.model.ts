export interface ContractPricingLine {
  // Identifiers — contractId = SourceContractId, links to Contract.sourceContractId
  contractId: string;
  contractNumber?: string;
  customerName?: string;

  // Pricing
  priceSequence?: number;
  priceQuantity?: number;
  priceUom?: string;
  flatPrice?: number;
  basisPrice?: number;
  hedgePrice?: number;
  priceDate?: string;
  priceCurrency?: string;

  // Trader
  traderInitials?: string;
  trader?: string;

  // Quantities
  priceOpenQuantity?: number;
  priceAppliedQuantity?: number;
  priceSettledQuantity?: number;
  priceOpenWeight?: number;
  priceAppliedWeight?: number;
  priceSettledWeight?: number;

  // Confirmation statuses
  customerConfirmStatus?: string;
  brokerConfirmStatus?: string;
  confirmationStatus?: string;

  // Dates
  createdDate?: string;
  modifiedDate?: string;

  // Computed aliases (populated by API, derived from stored columns)
  pricedQty?: number;   // = priceQuantity (quantity assigned a price, not deliveries)
  cashPrice?: number;   // = flatPrice
}
