export interface StoredGrain {
  id: string;
  customerId: string;
  farmId: string;
  crop: string;
  quantity: number;
  storageStartDate: Date;
  storageRate: number;
  bin: string;
  bushels: number;
  dateReceived: Date;
  accumulatedStorageCost: number;
}
