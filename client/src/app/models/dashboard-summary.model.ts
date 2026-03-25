import { DashboardPlantingEstimate } from './dashboard-planting-estimate.model';
import { DashboardMarketShare } from './dashboard-market-share.model';
import { DashboardActualHarvest } from './dashboard-actual-harvest.model';

export interface DashboardSummary {
  estimates: DashboardPlantingEstimate[];
  marketShares: DashboardMarketShare[];
  actualHarvest: DashboardActualHarvest[];
}
