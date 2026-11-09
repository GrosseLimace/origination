using GrainOriginatorPortal.Api.Platform.Preferences.Models.Responses;


namespace GrainOriginatorPortal.Api.Platform.Preferences;

/// <summary>The full trade-unit catalog for the onboarding picker (TradeUnitPreferences DB, with a
/// CustomerTradeUnit fallback). By product decision this lists every TU, not just entitled ones.</summary>
public interface ITradeUnitService
{
    Task<List<TradeUnitOptionResponse>> GetAllAsync(CancellationToken cancellationToken);
}
