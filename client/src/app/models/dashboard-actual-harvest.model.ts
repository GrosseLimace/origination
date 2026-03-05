export interface DashboardActualHarvest {
  id: number;
  tradeUnitKey: string;
  cropCategory: string;
  plantingYear: number;
  bushels: number;
  createdOn?: string;
  createdBy?: string;
  modifiedOn?: string;
  modifiedBy?: string;
}
