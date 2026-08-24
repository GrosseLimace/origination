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
    /// The vendor's basis price type, published alongside cash into its own columns so the Bid Sheet can
    /// switch between the two. Basis is quoted in cents against the futures board and is normally
    /// negative — "-30" reads as thirty under — which is why it can't share the cash price bounds.
    /// </summary>
    public const string BasisInstrumentType = "bidBasis";

    /// <summary>
    /// Actor stamped on feed-written rows. Machine callers have no user identity, and using one constant
    /// everywhere keeps authorship consistent whether the bridge ran from the pipeline or from the UI.
    /// </summary>
    public const string Actor = "barchart-feed";

    /// <summary>
    /// Far outer bound on quote age — a backstop, not the main filter.
    ///
    /// Publishing is gated on the vendor's own mode flag instead: <c>d</c> quotes are dead records and
    /// never publish, <c>i</c> quotes are live and publish at any age with their age surfaced in the UI.
    /// This started at 7 days, which turned out to be a proxy for mode and a lossy one — measured on the
    /// feed, no live quote exceeds 90 days while every quote past 90 days is mode <c>d</c>, so the cutoff
    /// was hiding roughly 1,245 real bids to block a population that mode identifies exactly. An elevator
    /// that posts a new-crop bid and leaves it for two months is behaving normally, and the delivery
    /// month already tells the user which period a bid covers.
    ///
    /// Kept only in case mode ever stops being trustworthy; <c>apply-bids</c> can override it per call.
    /// </summary>
    public const int MaxQuoteAgeDays = 365;

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
