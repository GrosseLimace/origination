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

    /// <summary>Map-centre latitude. Requires <see cref="Longitude"/>; pairs with <see cref="RadiusMiles"/>.</summary>
    [Range(-90, 90)]
    public double? Latitude { get; init; }

    /// <summary>Map-centre longitude. Requires <see cref="Latitude"/>.</summary>
    [Range(-180, 180)]
    public double? Longitude { get; init; }

    /// <summary>Search radius in miles around the map centre. Defaults to 100 when a centre is given.</summary>
    [Range(1, 500)]
    public double? RadiusMiles { get; init; }

    /// <summary>Row cap. Kept small by default — the catalog holds thousands of listings.</summary>
    [Range(1, 200)]
    public int Take { get; init; } = 50;
}
