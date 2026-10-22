using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>
/// Query for the "Add from BarChart" picker. Every filter is optional; supplying none returns the
/// busiest listings, which is what the picker shows before the user types anything.
/// </summary>
public record BarchartLocationSearchRequest
{
    /// <summary>Free text matched against elevator name, site name, and city.</summary>
    [MaxLength(200)]
    public string? Search { get; init; }

    /// <summary>Two-letter state code.</summary>
    [MaxLength(10)]
    public string? State { get; init; }

    /// <summary>Scoular commodity code — keeps the results to locations that publish that crop.</summary>
    [MaxLength(50)]
    public string? CommodityCode { get; init; }

    /// <summary>
    /// Delivery year/month to price CommodityCode against. Only meaningful together with
    /// CommodityCode and each other; supplied alone, they're ignored. When all three are given, each
    /// result that publishes a matching bid carries it as <see cref="Responses.BarchartCatalogLocationResponse.MatchedBidPrice"/>
    /// -- the bid sheet map's catalog layer uses this to show a real price pill instead of a plain dot
    /// once the map's own crop/year/month filters are in play.
    /// </summary>
    public int? CropYear { get; init; }

    /// <summary>Delivery month, 1-12. See <see cref="CropYear"/>.</summary>
    [Range(1, 12)]
    public int? Month { get; init; }

    /// <summary>
    /// Which vendor price type MatchedBidPrice should read -- "bidCash" or "bidBasis". Cash and basis
    /// are separate BarChart instruments with their own independent quotes, not one price under two
    /// labels, so this has to be an explicit choice: defaults to cash when the caller doesn't send
    /// one (same default the single-location detail endpoint uses), matching the bid sheet's existing
    /// "both" price mode convention of resolving to cash for anything that shows one number.
    /// </summary>
    [MaxLength(20)]
    public string? InstrumentType { get; init; }

    /// <summary>Map-centre latitude. Requires <see cref="Longitude"/>; pairs with <see cref="RadiusMiles"/>.</summary>
    [Range(-90, 90)]
    public double? Latitude { get; init; }

    /// <summary>Map-centre longitude. Requires <see cref="Latitude"/>.</summary>
    [Range(-180, 180)]
    public double? Longitude { get; init; }

    /// <summary>Search radius in miles around the map centre. Defaults to 100 when a centre is given.</summary>
    [Range(1, 500)]
    public double? RadiusMiles { get; init; }

    /// <summary>
    /// Row cap. Kept small by default (the picker's list view) -- the bid sheet map's catalog layer
    /// asks for far more so a wide zoom-out can return most of what BarChart publishes (~4,000
    /// listings) in one request rather than paginating.
    /// </summary>
    [Range(1, 5000)]
    public int Take { get; init; } = 50;
}
