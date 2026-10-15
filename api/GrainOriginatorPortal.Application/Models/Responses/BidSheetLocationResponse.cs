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

    /// <summary>BarChart location this row is linked to; null on a normal manually managed location.</summary>
    public string? BarchartLocationKey { get; init; }
    /// <summary>
    /// The desk that first added this location. Provenance only -- locations are company-wide and
    /// nothing scopes on this. Null when a location was added with no trade unit in view.
    /// </summary>
    public string? TradeUnitCode { get; init; }
    public string? GroupName { get; init; }
    public bool IsScoularFacility { get; init; }
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public string? ModifiedBy { get; init; }
    public DateTime? ModifiedAt { get; init; }
    public List<BidSheetLocationBidResponse> Bids { get; init; } = [];
}
