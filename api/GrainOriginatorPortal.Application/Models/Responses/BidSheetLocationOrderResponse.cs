namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a user's saved bid-sheet location order. Entity-shaped (Decision 1).</summary>
public record BidSheetLocationOrderResponse
{
    public int Id { get; init; }
    public string UserId { get; init; } = string.Empty;
    public string TradeUnitKey { get; init; } = string.Empty;
    public string LocationOrder { get; init; } = "[]";
    public DateTime ModifiedAt { get; init; }
}
