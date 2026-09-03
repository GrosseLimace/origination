using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Read access to the BarChart catalog for the "Add from BarChart" picker.
///
/// Reads are intentionally not trade-unit scoped: the catalog is global vendor data containing no
/// Scoular customer information. Trade units only matter for reporting where a location is already
/// placed, and for the write that creates a placement.
/// </summary>
public interface IBarchartCatalogRepository
{
    /// <summary>
    /// Finds elevator listings. All filters are optional and combine with AND.
    /// </summary>
    /// <param name="search">Matches elevator name, site name, or city.</param>
    /// <param name="state">Two-letter state filter.</param>
    /// <param name="commodityCode">Only locations publishing a bid that maps to this Scoular code.</param>
    /// <param name="boundingBox">
    /// Optional pre-filter for a radius search — a cheap, index-friendly latitude/longitude window.
    /// Exact distance is computed by the caller, since SQL Server has no cheap great-circle function here.
    /// </param>
    /// <param name="take">Row cap. Callers should keep this modest; the catalog holds thousands of locations.</param>
    Task<List<BarchartLocationSummary>> SearchLocationsAsync(
        string? search,
        string? state,
        string? commodityCode,
        (double MinLat, double MaxLat, double MinLng, double MaxLng)? boundingBox,
        int take,
        CancellationToken cancellationToken = default);

    /// <summary>A single elevator listing, or null if the key is unknown or the listing is inactive.</summary>
    Task<BarchartLocationSummary?> GetLocationAsync(string locationKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// The price each of the given locations publishes for one exact commodity/delivery period AND
    /// vendor price type, for locations that have one -- a location with nothing for that period is
    /// simply absent from the result, not present with a null. Cash and basis are separate BarChart
    /// instruments with independent quotes (<see cref="BarchartFeedDefaults.InstrumentType"/> /
    /// <see cref="BarchartFeedDefaults.BasisInstrumentType"/>), not one price under two labels, so
    /// instrumentType is not optional here the way it is on <see cref="GetBidPreviewAsync"/> -- a
    /// caller pricing a map's crop/year/month filter always means one specific type or the other.
    ///
    /// Batched by design: the bid sheet map's catalog layer needs this for every pin in view once a
    /// crop/year/month filter is active, and a per-pin round trip for that would be the O(pins) cost
    /// the map's other perf work went to some effort to avoid.
    /// </summary>
    Task<Dictionary<string, decimal>> GetMatchedBidPricesAsync(
        IReadOnlyCollection<string> locationKeys, string commodityCode, int cropYear, int month, string instrumentType,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// What this location currently publishes, newest delivery first — including bids whose commodity
    /// has no mapping, flagged as unmapped so the picker can show the gap rather than hide it.
    /// </summary>
    Task<List<BarchartBidPreview>> GetBidPreviewAsync(
        string locationKey, string? instrumentType, CancellationToken cancellationToken = default);

    /// <summary>Existing Bid Sheet placements for the given location keys, across all trade units.</summary>
    Task<List<BarchartLocationPlacement>> GetPlacementsAsync(
        IReadOnlyCollection<string> locationKeys, CancellationToken cancellationToken = default);

    /// <summary>True when the location key exists and is active — used to reject bad links on create.</summary>
    Task<bool> LocationExistsAsync(string locationKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// Catalog totals and per-state counts, so the picker can state its coverage instead of leaving a
    /// user to guess why a location isn't listed.
    /// </summary>
    Task<BarchartCoverage> GetCoverageAsync(CancellationToken cancellationToken = default);
}
