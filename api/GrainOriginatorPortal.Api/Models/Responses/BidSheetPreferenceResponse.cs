namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a user's per-trade-unit bid-sheet UI preferences. Entity-shaped (Decision 1).</summary>
public record BidSheetPreferenceResponse
{
    public int Id { get; init; }
    public string UserId { get; init; } = string.Empty;
    public string TradeUnitKey { get; init; } = string.Empty;
    public string? CropCode { get; init; }
    public int? Month { get; init; }
    public int? CropYear { get; init; }
    public string? CropOrder { get; init; }
    public string? HiddenCrops { get; init; }
    public string? SelectedMonths { get; init; }

    /// <summary>JSON array of crop years shown in the Edit Bids grid.</summary>
    public string? SelectedYears { get; init; }
    public string? PrintLayout { get; init; }
    public string? PriceMode { get; init; }
    public string? SelectedBidSheetIds { get; init; }
    public DateTime ModifiedAt { get; init; }
}
