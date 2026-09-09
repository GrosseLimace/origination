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
    /// <summary>Deletes one actual-harvest row after authorizing the row's own trade unit against the
    /// caller's entitlements. Returns the deleted row's trade unit key for auditing, or null when no
    /// row with that id exists. Throws ForbiddenException when the row belongs to another trade unit.</summary>
    Task<string?> DeleteActualHarvestAsync(int id, CancellationToken cancellationToken);
}
