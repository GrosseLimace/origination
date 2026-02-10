export interface PlantingIntention {
  id: string;
  customerId: number;     // FK to Customer - maps to bigint in C# API
  farmId: string;
  crop: string;
  acres: number;
  variety: string;
  plantingDate: Date;
  estimatedYield: number;
}
