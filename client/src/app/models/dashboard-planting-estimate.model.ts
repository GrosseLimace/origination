export interface DashboardPlantingEstimate {
  id: number;
  tradeUnitKey: string;
  crop: string;
  plantingYear: number;
  yieldEstimate?: number;
}
