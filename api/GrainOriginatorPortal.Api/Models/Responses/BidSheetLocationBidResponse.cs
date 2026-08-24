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

    /// <summary>Who owns this cell: <c>Manual</c> (a user typed it) or <c>Barchart</c> (fed, read-only).</summary>
    public string Source { get; init; } = "Manual";

    /// <summary>Vendor symbol behind a fed cell; null on manual cells.</summary>
    public string? BarchartSymbol { get; init; }

    /// <summary>When the elevator last updated a fed bid — the "as of" shown in the UI.</summary>
    public DateTime? QuoteAsOf { get; init; }

    /// <summary>The basis bid for this cell, in cents against the board (negative = under).</summary>
    public string? BasisBid { get; init; }

    /// <summary>Vendor symbol behind the basis bid.</summary>
    public string? BasisSymbol { get; init; }

    /// <summary>When the elevator last updated the basis bid.</summary>
    public DateTime? BasisQuoteAsOf { get; init; }
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public string? ModifiedBy { get; init; }
    public DateTime? ModifiedAt { get; init; }
}
