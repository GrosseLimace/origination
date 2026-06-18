using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Dashboard planning datasets (planting estimates, market shares, actual harvest) — reads,
/// the combined summary, transactional upserts, and actual-harvest delete. Upserts are attributed to
/// the current user.</summary>
public interface IDashboardService
{
    Task<DashboardSummaryResponse> GetSummaryAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken);
    Task<List<DashboardPlantingEstimateResponse>> GetPlantingEstimatesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken);
    Task UpsertPlantingEstimatesAsync(List<UpsertDashboardEstimateRequest> estimates, CancellationToken cancellationToken);
    Task<List<DashboardMarketShareResponse>> GetMarketSharesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken);
    Task UpsertMarketSharesAsync(List<UpsertDashboardMarketShareRequest> shares, CancellationToken cancellationToken);
    Task<List<DashboardActualHarvestResponse>> GetActualHarvestAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken);
    Task UpsertActualHarvestAsync(List<UpsertDashboardActualHarvestRequest> items, CancellationToken cancellationToken);
    Task DeleteActualHarvestAsync(int id, CancellationToken cancellationToken);
}
