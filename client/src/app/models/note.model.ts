export interface Note {
  id: number;             // Maps to long (bigint) in C# API
  customerId: number;     // FK to Customer - maps to bigint in C# API
  farmId?: string;
  createdBy: string;
  createdAt: Date;
  content: string;
  isPinned: boolean;
}
