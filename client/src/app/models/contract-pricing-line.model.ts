export interface ContractPricingLine {
  priceSequence: number;
  contractId: string;       // Links to Contract.sourceContractId
  displayId: string;
  quantityUom?: string;
  commodityCode?: string;
  priceType: string;        // FLAT | PRICED | DEFERRED | UNPRICED | ERROR

  // Pricing
  adjustment?: number;
  basisPrice?: number;
  cashPrice?: number;
  futuresPrice?: number;
  futuresMonth?: string;
  currency?: string;

  // Quantities
  appliedQty?: number;
  pricedQty?: number;
  contractQty?: number;

  // Dates
  createdAt?: string;
  pricedAt?: string;
  deliveryPeriodStart?: string;
  deliveryPeriodEnd?: string;

  // Derived statuses from view
  signatureStatus: string;  // Signed | Unsigned
  deliveryStatus: string;   // Shipped | Partially Shipped | Not Shipped
  pricingStatus: string;    // Priced | Partially Priced | Not Priced

  // Location and org
  locationId?: string;
  companyCode?: string;
  divisionCode?: string;
  locationCode?: string;

  sequenceNumber: number;
  customerId?: string;
  prefixType?: string;
  prefixCode?: string;
  contractNumber?: string;
  contractSuffix?: string;
}
