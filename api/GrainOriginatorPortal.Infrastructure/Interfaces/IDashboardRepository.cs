using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Persistence for the dashboard's manually-maintained planning tables (planting estimates,
/// market shares, actual harvest) in the Origination database. Upserts take fully-formed
/// entities — for estimates/market-shares a null value field (YieldEstimate/MarketSharePct)
/// signals "remove this crop"; the owning username is passed in by the caller.
/// </summary>
public interface IDashboardRepository
{
    Task<List<DashboardPlantingEstimate>> GetPlantingEstimatesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken);
    Task UpsertPlantingEstimatesAsync(List<DashboardPlantingEstimate> estimates, string username, CancellationToken cancellationToken);
    Task<List<DashboardMarketShare>> GetMarketSharesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken);
    Task UpsertMarketSharesAsync(List<DashboardMarketShare> shares, string username, CancellationToken cancellationToken);
    Task<List<DashboardActualHarvest>> GetActualHarvestAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken);
    Task UpsertActualHarvestAsync(List<DashboardActualHarvest> items, string username, CancellationToken cancellationToken);
    Task DeleteActualHarvestAsync(int id, CancellationToken cancellationToken);
}
