export interface StoredGrain {
  id: string;
  customerId: number;     // FK to Customer - maps to bigint in C# API
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
