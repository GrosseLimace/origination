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
  bushels: number;
  dateReceived: Date;
  accumulatedStorageCost: number;
}
