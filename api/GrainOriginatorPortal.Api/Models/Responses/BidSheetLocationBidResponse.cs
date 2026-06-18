namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a single bid on a bid-sheet location. Entity-shaped (Decision 1) minus
/// the JSON-ignored Location back-reference.</summary>
public record BidSheetLocationBidResponse
{
    public int Id { get; init; }
    public int LocationId { get; init; }
    public string CommodityCode { get; init; } = string.Empty;
    public string? CommodityName { get; init; }
    public string? CommodityCategory { get; init; }
    public int CropYear { get; init; }
    public int Month { get; init; }
    public string Bid { get; init; } = string.Empty;
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public string? ModifiedBy { get; init; }
    public DateTime? ModifiedAt { get; init; }
}
