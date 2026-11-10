export interface PlantingIntention {
  id: number;
  customerId: number;
  customerName: string;
  customerCode: string;
  tradeUnit: string;
  plantingYear: number;
  crop: string;
  category?: string;
  type?: string;
  description?: string;
  acres: number;
  createdAt: string;
  createdBy: string;
  modifiedAt?: string;
  modifiedBy?: string;
}

/** A planting intention as the user entered it in the Planting tab's add form. */
export interface PlantingIntentionDraft {
  crop: string;
  category?: string;
  type?: string;
  description?: string;
  acres: number;
  plantingYear: number;
  tradeUnit: string;
}

/** A change the user made to an existing planting intention in the Planting tab. */
export interface PlantingIntentionEdit {
  intentionId: number;
  crop: string;
  category?: string;
  type?: string;
  description?: string;
  acres: number;
  plantingYear: number;
  tradeUnit?: string;
}
