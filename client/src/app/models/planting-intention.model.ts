export interface PlantingIntention {
  id: string;
  customerId: string;
  farmId: string;
  crop: string;
  acres: number;
  variety: string;
  plantingDate: Date;
  estimatedYield: number;
}
