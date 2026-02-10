export interface Note {
  id: string;
  customerId: number;     // FK to Customer - maps to bigint in C# API
  farmId?: string;
  createdBy: string;
  createdAt: Date;
  content: string;
  isPinned: boolean;
}
