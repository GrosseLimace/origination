namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// One BarChart elevator listing, as the "Add from BarChart" picker sees it — a read model over
/// <c>dbo.vw_BarchartLocation</c>.
///
/// The catalog stores one row per <em>bid</em> (elevator × commodity × delivery window), so a single
/// elevator is many rows; the view collapses them by
/// <see cref="BarchartInstrument.LocationKey"/> so the picker can present one entry per physical site.
/// Vendor test rows and deactivated instruments are excluded by the view itself.
///
/// Keyless: this is a projection, never written to.
/// </summary>
public class BarchartLocationSummary
{
    /// <summary>The listing id shared by all of this site's instruments; what a Bid Sheet location links to.</summary>
    public string LocationKey { get; set; } = string.Empty;

    /// <summary>Publishing company, e.g. "Grain Processing Corporation".</summary>
    public string? Elevator { get; set; }

    /// <summary>Site name as the vendor reports it, e.g. "GPC-MUSCATINE".</summary>
    public string? LocationName { get; set; }

    /// <summary>Country Elevator / River Terminal / Ethanol-Bio-Fuel / Feed Mill / Direct Ship…</summary>
    public string? FacilityType { get; set; }

    public string? Address { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? ZipCode { get; set; }

    /// <summary>Averaged across the site's instruments; every location in the live feed carries coordinates.</summary>
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    public string? Phone { get; set; }
    public string? Website { get; set; }

    /// <summary>How many active bids this site publishes — a rough measure of how much it trades.</summary>
    public long ActiveInstrumentCount { get; set; }

    /// <summary>Distinct commodities offered here.</summary>
    public long CommodityCount { get; set; }

    public DateTime? EarliestDeliveryStart { get; set; }
    public DateTime? LatestDeliveryEnd { get; set; }

    /// <summary>When the catalog last saw this site.</summary>
    public DateTime LastSeenUtc { get; set; }

    /// <summary>Freshest elevator-updated bid time across the site — the "as of" shown to a user.</summary>
    public DateTime? LatestQuoteTimestamp { get; set; }
}
