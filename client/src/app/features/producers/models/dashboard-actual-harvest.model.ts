export interface DashboardActualHarvest {
  id: number;
  tradeUnitKey: string;
  cropCategory: string;
  plantingYear: number;
  bushels: number;
  createdAt?: string;
  createdBy?: string;
  modifiedAt?: string;
  modifiedBy?: string;
}
