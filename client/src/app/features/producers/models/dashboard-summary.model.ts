import { DashboardPlantingEstimate } from '@models';
import { DashboardMarketShare } from './dashboard-market-share.model';
import { DashboardActualHarvest } from './dashboard-actual-harvest.model';

export interface DashboardSummary {
  estimates: DashboardPlantingEstimate[];
  marketShares: DashboardMarketShare[];
  actualHarvest: DashboardActualHarvest[];
}
