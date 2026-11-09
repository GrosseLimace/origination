using GrainOriginatorPortal.Api.Platform.Preferences.Models.Responses;


namespace GrainOriginatorPortal.Api.Platform.Preferences;

/// <summary>The current user's trade-unit assignments (from the TradeUnitPreferences DB, grouped by AD
/// group), with a CustomerTradeUnit fallback when entitlements are unavailable.</summary>
public interface IUserTradeUnitService
{
    Task<List<UserTradeUnitGroupResponse>> GetForCurrentUserAsync(CancellationToken cancellationToken);
}
