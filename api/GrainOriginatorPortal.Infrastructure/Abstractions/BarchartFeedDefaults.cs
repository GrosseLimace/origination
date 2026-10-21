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
    /// How long a bid may go untouched by the elevator before we stop publishing it. This is the only
    /// staleness rule; <c>apply-bids</c> can override it per call.
    ///
    /// It has been three things. First 7 days, which was far too tight — an elevator that posts a
    /// new-crop bid and leaves it for weeks is behaving normally, and the delivery month already tells
    /// the user which period the bid covers. Then the vendor's <c>mode</c> flag, on the belief that
    /// <c>d</c> marked a dead record. **That was wrong.** BarChart's getQuote documentation defines mode
    /// as the quote *type* — real-time (<c>R</c>), delayed (<c>I</c>) or end-of-day (<c>D</c>). An
    /// end-of-day quote is a perfectly good price, so filtering on it suppressed real bids: measured on
    /// the live feed, 1,126 quotes under 90 days old were being hidden purely for arriving as end-of-day.
    ///
    /// Worse, mode is also a *request* parameter, so a setting on the pipeline side or a vendor default
    /// change could return <c>d</c> for everything and blank the entire Bid Sheet at a stroke. Age is a
    /// property of the bid itself and cannot fail that way.
    ///
    /// 90 days is deliberately generous. On the live feed it is indistinguishable from the old mode rule
    /// for linked locations — everything publishing is under 30 days old and everything it blocks is over
    /// 330 — while no longer depending on a vendor field whose meaning is outside our control.
    /// </summary>
    public const int MaxQuoteAgeDays = 90;

    /// <summary>
    /// How long a bid may go untouched by the elevator before the sheet stops showing its number. Past
    /// this the UI prints "--" with the elevator's last-update date instead, and the feed may no longer
    /// take back a cell a user has typed over (see <c>ApplyBidsToBidSheetAsync</c>: newest wins).
    ///
    /// Distinct from <see cref="MaxQuoteAgeDays"/> on purpose. That is the PUBLISH window -- what the
    /// bridge writes and keeps -- and it stays generous so a frozen cell survives with its date intact;
    /// this is the TRUST window, and it is tight because BarChart keeps serving the last price for a
    /// delivery period an elevator has stopped posting (Goodland's October corn sat frozen for two weeks
    /// while its December moved nightly, 2026-10). Configurable per environment as
    /// <c>Barchart:StaleAfterDays</c>; the client reads the effective value from the coverage endpoint.
    /// </summary>
    public const int StaleAfterDays = 10;

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
