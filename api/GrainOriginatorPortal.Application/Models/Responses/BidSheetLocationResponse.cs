namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a bid-sheet location and its bids. Entity-shaped (Decision 1).</summary>
public record BidSheetLocationResponse
{
    public int Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? Address { get; init; }
    public string? City { get; init; }
    public string? State { get; init; }
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public string? ElevatorCode { get; init; }
    public string TradeUnitCode { get; init; } = string.Empty;
    public string? GroupName { get; init; }
    public bool IsScoularFacility { get; init; }
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public string? ModifiedBy { get; init; }
    public DateTime? ModifiedAt { get; init; }
    public List<BidSheetLocationBidResponse> Bids { get; init; } = [];
}
