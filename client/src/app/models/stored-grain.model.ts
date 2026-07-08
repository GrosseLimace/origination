export interface StoredGrain {
  id: string;             // Composite: WHR_RECEIPT_NUMBER|LOCATION_CODE (unique per row)
  receiptNumber: string;  // WHR_RECEIPT_NUMBER — group key
  customerId: number;        // Numeric CustomerId from vw_CurrentCustomers JOIN
  customerCode: string;      // CTRM CUSTOMER_ID (same as SourceCustomerId)
  crop: string;
  quantity: number;       // NET_QUANTITY
  grossQuantity: number;  // GROSS_QUANTITY
  storageStartDate: Date;
  storageRate: number;
  bin: string;
  receivableAmount: number;   // RECEIVABLE_AMOUNT — accumulated cost from CTRM
  storageDays: number;        // STORAGE_DAYS — days in storage from CTRM (decimal)
  chargedFromDate: Date | null;
  chargedThruDate: Date | null;
  locationCity: string;       // vw_GNP003.Location_City (facility city, by LOCATION_CODE)
  locationState: string;      // vw_GNP003.Location_State
  bushels: number;
  dateReceived: Date;
}
