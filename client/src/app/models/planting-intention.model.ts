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
  // Shared GUID linking the two rows of a "Double Crop" intention; absent for single crops.
  // The UI uses it to collapse the pair into one display line and edit/delete them together.
  doubleCropGroupId?: string;
  createdAt: string;
  createdBy: string;
  modifiedAt?: string;
  modifiedBy?: string;
}
