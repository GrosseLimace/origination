using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>The full trade-unit catalog for the onboarding picker (entitlements DB, with a
/// CustomerTradeUnit fallback). By product decision this lists every TU, not just entitled ones.</summary>
public interface ITradeUnitService
{
    Task<List<TradeUnitOptionResponse>> GetAllAsync(CancellationToken cancellationToken);
}
