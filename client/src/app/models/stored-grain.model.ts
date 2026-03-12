export interface StoredGrain {
  id: string;
  customerId: number;        // Numeric CustomerId from vw_CurrentCustomers JOIN
  customerCode: string;      // CTRM CUSTOMER_ID (same as SourceCustomerId)
  crop: string;
  quantity: number;
  storageStartDate: Date;
  storageRate: number;
  bin: string;
  bushels: number;
  dateReceived: Date;
  accumulatedStorageCost: number;
}
