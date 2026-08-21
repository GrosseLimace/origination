namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// Shared constants for the BarChart bid feed. These are referenced from several call sites — the
/// ingest pipeline, the picker, and the create-location path — and drift between them would show up as
/// bid rows the bridge no longer recognizes as its own.
/// </summary>
public static class BarchartFeedDefaults
{
    /// <summary>
    /// Vendor price type published to the Bid Sheet. Basis quotes land in the same tables but aren't
    /// displayed yet, so only cash bids are bridged.
    /// </summary>
    public const string InstrumentType = "bidCash";

    /// <summary>
    /// Actor stamped on feed-written rows. Machine callers have no user identity, and using one constant
    /// everywhere keeps authorship consistent whether the bridge ran from the pipeline or from the UI.
    /// </summary>
    public const string Actor = "barchart-feed";

    /// <summary>
    /// How old a vendor quote may be and still be published to the Bid Sheet.
    ///
    /// Set from the first live quote run (2026-08-21): the vendor returns two populations, one updated
    /// within a day or two and one averaging 181 days old, and both arrive in the same payload. The stale
    /// half is worse than no bid — it put soybeans at $3.51 for Sep 2026 immediately beside $11.70 for
    /// Aug and Oct, which reads as a price collapse rather than as missing data.
    /// </summary>
    public const int MaxQuoteAgeDays = 7;

    /// <summary>
    /// Lowest price treated as a real bid. The vendor uses tiny values (observed: 0.0025) as a
    /// no-bid placeholder on some elevators, for corn and soybeans alike.
    /// </summary>
    public const decimal MinPublishablePrice = 0.01m;

    /// <summary>
    /// Highest price treated as a real bid. Deliberately generous rather than a $/bu band, because units
    /// vary by commodity: canola quotes legitimately land around 800 (per metric tonne). The value this
    /// actually excludes is the vendor's sentinel 214748.3647, which is int.MaxValue / 10000.
    /// </summary>
    public const decimal MaxPublishablePrice = 100000m;
}
