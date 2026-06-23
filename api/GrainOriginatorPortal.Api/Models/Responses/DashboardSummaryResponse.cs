namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Bundles the three dashboard datasets (estimates, market shares, actual harvest) in a
/// single response so the client makes one round-trip. Holds response DTOs, not EF entities.</summary>
public class DashboardSummaryResponse
{
    public List<DashboardPlantingEstimateResponse> Estimates { get; set; } = [];
    public List<DashboardMarketShareResponse> MarketShares { get; set; } = [];
    public List<DashboardActualHarvestResponse> ActualHarvest { get; set; } = [];
}
