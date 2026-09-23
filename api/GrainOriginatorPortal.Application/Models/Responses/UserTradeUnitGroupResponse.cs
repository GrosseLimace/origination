namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>A user's trade-unit assignments grouped by Azure AD group name.</summary>
public record UserTradeUnitGroupResponse
{
    public string GroupName { get; init; } = string.Empty;
    public List<string> TradeUnitCodes { get; init; } = [];

    /// <summary>Trade units in this group paired with their description/location (e.g. "Pratt, KS").
    /// Parallel to <see cref="TradeUnitCodes"/>; kept alongside it so existing code-only callers are
    /// unaffected while the selector can show the location next to each code.</summary>
    public List<TradeUnitOptionResponse> TradeUnits { get; init; } = [];
}
