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
    /// <summary>
    /// Delivery month, 1-12. The value 0 was the retired "Yearly" period: the sheet no longer offers it
    /// and the feed no longer writes it, but hand-typed rows carrying 0 may still exist in a database
    /// until they are converted or removed -- they are simply never shown.
    /// </summary>
    public int Month { get; set; }
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

    /// <summary>
    /// Set when this cell's price is not the elevator's own bid for this month but the bid for a LATER
    /// contract month whose delivery window covers this one -- Cargill's "Nov 26" corn delivers from
    /// 1 Oct, so October shows November's price with these pointing at (2026, 11). Null means the cell
    /// is the elevator's own bid for the month. One in five vendor bids opens its window before the
    /// contract month; without this those months read as if the elevator had no bid at all.
    /// </summary>
    public int? CoveredByCropYear { get; set; }

    /// <summary>The contract month (1-12) whose bid covers this cell. See <see cref="CoveredByCropYear"/>.</summary>
    public int? CoveredByMonth { get; set; }

    /// <summary>
    /// UTC time the CASH value last actually changed, maintained by the feed's MERGE. Distinct from
    /// <see cref="QuoteAsOf"/> on purpose: that is the vendor's re-post stamp and refreshes most days
    /// whether or not the number moved, so "moved in the last 24h" reads this instead. Null until the
    /// first change after the cell appeared -- a brand-new cell has nothing to have moved from.
    /// </summary>
    public DateTime? CashChangedAt { get; set; }

    /// <summary>UTC time the basis value last actually changed. See <see cref="CashChangedAt"/>.</summary>
    public DateTime? BasisChangedAt { get; set; }

    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }

    [JsonIgnore]
    public BidSheetLocation Location { get; set; } = null!;
}
