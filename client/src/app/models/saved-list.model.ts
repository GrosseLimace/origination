export interface SavedList {
  id: number;
  name: string;
  query: string;
  tradeUnits?: string; // Comma-separated trade unit keys (e.g. "TU1,TU2")
  customerIds?: number[];  // Computed client-side, NOT stored in DB
  createdOn: string;
}
