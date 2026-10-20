using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Backs the "Add from BarChart" picker: searching the vendor catalog, previewing what a location
/// publishes, and refreshing a linked location's fed bids on demand.
/// </summary>
public interface IBarchartCatalogService
{
    /// <summary>Finds catalog listings, annotated with where each one already sits on the Bid Sheet.</summary>
    Task<List<BarchartCatalogLocationResponse>> SearchLocationsAsync(
        BarchartLocationSearchRequest request, CancellationToken cancellationToken = default);

    /// <summary>One listing plus the bids it publishes, or null if the key is unknown or inactive.</summary>
    Task<BarchartCatalogLocationDetailResponse?> GetLocationAsync(
        string locationKey, string? instrumentType, CancellationToken cancellationToken = default);

    /// <summary>What the catalog currently holds, by state.</summary>
    Task<BarchartCoverageResponse> GetCoverageAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Re-runs the feed bridge for one linked Bid Sheet location. Returns null when the location doesn't
    /// exist; throws if the caller isn't entitled to the location's trade unit.
    /// </summary>
    Task<BarchartRefreshBidsResponse?> RefreshBidsAsync(int locationId, CancellationToken cancellationToken = default);
}
