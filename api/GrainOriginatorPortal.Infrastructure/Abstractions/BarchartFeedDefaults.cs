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
}
