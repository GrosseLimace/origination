namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>A user's trade-unit assignments grouped by Azure AD group name.</summary>
public record UserTradeUnitGroupResponse
{
    public string GroupName { get; init; } = string.Empty;
    public List<string> TradeUnitCodes { get; init; } = [];
}
