using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>Values for <see cref="BidSheetLocationBid.Source"/> — who owns a bid cell.</summary>
public static class BidSources
{
    /// <summary>
    /// Entered by a user. Includes a cell they typed over a fed one: the override takes ownership, and
    /// the feed reclaims it on its next run if it still publishes that cell.
    /// </summary>
    public const string Manual = "Manual";

    /// <summary>
    /// Written by the BarChart bridge. Editable — a user may override it, which flips the cell to
    /// <see cref="Manual"/>. Fed cells were read-only in the first cut; that rule was dropped so an
    /// originator can correct a wrong vendor price without waiting for the vendor.
    /// </summary>
    public const string Barchart = "Barchart";
}

public class BidSheetLocationBid
{
    public int Id { get; set; }
    public int LocationId { get; set; }
    public string CommodityCode { get; set; } = string.Empty;
    public string? CommodityName { get; set; }
    public string? CommodityCategory { get; set; }
    public int CropYear { get; set; }
    public int Month { get; set; } // 0=yearly, 1-12=monthly
    public string Bid { get; set; } = string.Empty;

    /// <summary>Who owns this cell: <see cref="BidSources.Manual"/> (user) or <see cref="BidSources.Barchart"/> (feed).</summary>
    public string Source { get; set; } = BidSources.Manual;

    /// <summary>The barchart.Instrument symbol that fed this cell (feed-owned rows only).</summary>
    public string? BarchartSymbol { get; set; }

    /// <summary>UTC time the elevator last updated the fed bid — the "as of" shown in the UI.</summary>
    public DateTime? QuoteAsOf { get; set; }

    /// <summary>
    /// The basis bid for this same cell, quoted in cents against the futures board (so "-30" reads as
    /// thirty under). Held alongside the cash bid rather than as its own row: the Bid Sheet's unique
    /// index allows one row per location/commodity/crop year/month, and every publishable cell observed
    /// in the feed carries both a cash and a basis quote.
    /// </summary>
    public string? BasisBid { get; set; }

    /// <summary>The barchart.Instrument symbol behind <see cref="BasisBid"/>.</summary>
    public string? BasisSymbol { get; set; }

    /// <summary>UTC time the elevator last updated the basis bid.</summary>
    public DateTime? BasisQuoteAsOf { get; set; }

    /// <summary>
    /// The futures contract this cell's bid is quoted against, e.g. <c>ZCZ26</c> for December 2026 corn.
    /// This is NOT the delivery month: Kansas City wheat delivering in January trades against the March
    /// board (<c>KEBF27</c> -> <c>KEH27</c>). Originators compare bids by the contract behind them, so a
    /// Year cell showing a price without it is not comparable to anything.
    /// </summary>
    public string? UnderlyingFuture { get; set; }

    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }

    [JsonIgnore]
    public BidSheetLocation Location { get; set; } = null!;
}
