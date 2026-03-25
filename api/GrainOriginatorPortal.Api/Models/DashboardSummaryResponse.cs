namespace GrainOriginatorPortal.Api.Models;

public class DashboardSummaryResponse
{
    public List<DashboardPlantingEstimate> Estimates { get; set; } = [];
    public List<DashboardMarketShare> MarketShares { get; set; } = [];
    public List<DashboardActualHarvest> ActualHarvest { get; set; } = [];
}
