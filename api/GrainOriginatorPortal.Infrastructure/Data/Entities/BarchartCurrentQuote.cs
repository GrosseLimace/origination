namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// The latest known price for a BarChart instrument — exactly one row per
/// <see cref="BarchartInstrument.Symbol"/>, overwritten in place by each price load. This is what
/// the bridge copies onto the Bid Sheet.
///
/// Loaded from the vendor's <c>getQuote</c> payload via <c>api/barchart-ingest/quotes</c>. Quote
/// freshness varies per row — the vendor happily returns a bid an elevator last updated days ago —
/// so <see cref="TradeTimestamp"/> is surfaced in the UI as an "as of" rather than assumed current.
/// </summary>
public class BarchartCurrentQuote
{
    /// <summary>Primary key and foreign key to <see cref="BarchartInstrument"/>.</summary>
    public string Symbol { get; set; } = string.Empty;

    /// <summary>The posted cash bid in $/bu, e.g. 4.4100. Null when the vendor returns no price.</summary>
    public decimal? LastPrice { get; set; }

    /// <summary>Change versus the prior session.</summary>
    public decimal? NetChange { get; set; }

    public decimal? PercentChange { get; set; }

    public decimal? OpenPrice { get; set; }
    public decimal? HighPrice { get; set; }
    public decimal? LowPrice { get; set; }
    public decimal? ClosePrice { get; set; }

    /// <summary>Vendor unit code (observed "4" = $/bu).</summary>
    public string? UnitCode { get; set; }

    /// <summary>Vendor session-day letter.</summary>
    public string? DayCode { get; set; }

    /// <summary>
    /// How the vendor delivered this quote, per BarChart's getQuote docs: real-time ("R"), delayed ("I")
    /// or end-of-day ("D"). Recorded for diagnostics only — it describes the delivery type, not whether
    /// the bid is any good, so nothing filters on it. We only ever receive "i" and "d".
    /// </summary>
    public string? QuoteMode { get; set; }

    /// <summary>
    /// Vendor session flag: "c" market closed, "p" pre-open, "s" settled (a final settlement price).
    /// In practice cash grain only ever arrives as "s" or empty, so it carries no usable signal for us.
    /// </summary>
    public string? QuoteFlag { get; set; }

    /// <summary>
    /// When the <em>elevator</em> last updated this bid, stored UTC. Surfaced on the Bid Sheet as the
    /// cell's "as of" time so staleness is visible instead of silently wrong.
    /// </summary>
    public DateTime? TradeTimestamp { get; set; }

    /// <summary>Vendor server time for the quote, stored UTC.</summary>
    public DateTime? ServerTimestamp { get; set; }

    /// <summary>When our load last wrote this row.</summary>
    public DateTime UpdatedAtUtc { get; set; }
}
