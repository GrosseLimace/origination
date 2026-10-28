namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// BarChart instrument catalog — one row per <em>bid</em> the vendor publishes, which is a specific
/// elevator listing × commodity × delivery window. A single elevator therefore owns many rows
/// (each commodity, each delivery month, and split half-month windows separately).
///
/// Loaded from the vendor's <c>getGrainInstruments</c> payload, which the integration side POSTs to
/// <c>api/barchart-ingest/instruments</c> verbatim; the load SQL whitelist-extracts fields and
/// upserts on <see cref="Symbol"/>. See docs/application-context/Barchart Bid Feed - Database Plan.md.
///
/// Rows are never deleted — vendor symbols that stop appearing are flagged
/// <see cref="IsActive"/> = false by a deliberate follow-up step, so a partial or failed vendor pull
/// can never strip the catalog out from under a linked Bid Sheet location.
/// </summary>
public class BarchartInstrument
{
    /// <summary>
    /// Vendor's unique instrument id and our primary key, e.g. <c>ZCPQ26-27300-6916.CM</c>.
    /// Anatomy (vendor-confirmed): {root}{P=cash|B=basis}{monthCode}{yy}[F|L]-{locationId}-{internalMapId}.CM
    /// </summary>
    public string Symbol { get; set; } = string.Empty;

    /// <summary>
    /// Elevator-listing id parsed from the middle symbol segment (e.g. <c>27300</c>) — the key that
    /// groups all of one elevator's instruments together, and what a Bid Sheet location links to.
    /// Null when the symbol doesn't match the expected shape (counted as a data-quality signal).
    /// </summary>
    public string? LocationKey { get; set; }

    /// <summary>Commodity root parsed from the symbol (e.g. <c>ZC</c> for corn). Cannot distinguish #2 Yellow from NonGMO — that's what <see cref="Commodity"/> is for.</summary>
    public string? Root { get; set; }

    /// <summary>Parsed from the symbol's price-type letter: <c>bidCash</c> (P, flat posted bid) or <c>bidBasis</c> (B).</summary>
    public string? InstrumentType { get; set; }

    /// <summary><c>F</c> or <c>L</c> when the vendor splits a month into first/last-half bids; null for a whole-month bid.</summary>
    public string? DeliveryWindowFlag { get; set; }

    public string? SymbolDescription { get; set; }

    /// <summary>Publishing company, e.g. "Grain Processing Corporation". Several companies may publish the same physical destination as separate symbols — never dedupe on address.</summary>
    public string? Elevator { get; set; }

    /// <summary>Site name as the vendor reports it, e.g. "GPC-MUSCATINE".</summary>
    public string? LocationName { get; set; }

    /// <summary>Country Elevator / River Terminal / Ethanol-Bio-Fuel / Feed Mill / Direct Ship…</summary>
    public string? FacilityType { get; set; }

    /// <summary>Vendor commodity display name, e.g. "Corn (#2 Yellow)". <c>BarchartCommodityMap</c> keys off this string.</summary>
    public string? Commodity { get; set; }

    /// <summary>Futures contract the cash bid references, e.g. <c>ZCU26</c>.</summary>
    public string? UnderlyingFuture { get; set; }

    /// <summary>Start of the delivery window, stored UTC (vendor sends an offset; the load converts).</summary>
    public DateTime? DeliveryStart { get; set; }

    /// <summary>End of the delivery window, stored UTC.</summary>
    public DateTime? DeliveryEnd { get; set; }

    /// <summary>Street address; embedded line breaks from the vendor are normalized to ", " on load.</summary>
    public string? Address { get; set; }

    public string? City { get; set; }
    public string? State { get; set; }

    /// <summary>Kept as character data so leading zeros survive.</summary>
    public string? ZipCode { get; set; }

    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    public string? County { get; set; }

    /// <summary>State FIPS code — character data, preserves leading zeros.</summary>
    public string? StateFips { get; set; }

    /// <summary>County FIPS code — character data, preserves leading zeros.</summary>
    public string? CountyFips { get; set; }

    public string? Phone { get; set; }
    public string? Website { get; set; }

    /// <summary>
    /// True for vendor test data (the live feed has carried an "AgVance Bid Sync Test" company
    /// mirroring real cooperative locations). Test rows are ingested but excluded from every
    /// app-facing read, so they can never reach an originator's screen.
    /// </summary>
    public bool IsTest { get; set; }

    /// <summary>False once a deliberate post-sweep step observes the symbol has stopped appearing. Never deleted.</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>When the catalog first saw this symbol.</summary>
    public DateTime FirstSeenUtc { get; set; }

    /// <summary>When the catalog last saw this symbol — drives deactivation and freshness reporting.</summary>
    public DateTime LastSeenUtc { get; set; }
}
