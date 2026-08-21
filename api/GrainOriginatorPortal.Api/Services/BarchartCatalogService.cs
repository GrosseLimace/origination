using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class BarchartCatalogService : IBarchartCatalogService
{
    private readonly IBarchartCatalogRepository _catalog;
    private readonly IBarchartIngestRepository _ingest;
    private readonly IBidSheetRepository _bidSheet;
    private readonly IUserEntitlementService _entitlementService;
    private readonly ILogger<BarchartCatalogService> _logger;

    private const string DefaultInstrumentType = BarchartFeedDefaults.InstrumentType;
    private const string FeedActor = BarchartFeedDefaults.Actor;

    /// <summary>Applied when a geographic search gives a centre but no radius.</summary>
    private const double DefaultRadiusMiles = 100;

    private const double EarthRadiusMiles = 3958.7613;

    public BarchartCatalogService(
        IBarchartCatalogRepository catalog,
        IBarchartIngestRepository ingest,
        IBidSheetRepository bidSheet,
        IUserEntitlementService entitlementService,
        ILogger<BarchartCatalogService> logger)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        _ingest = ingest ?? throw new ArgumentNullException(nameof(ingest));
        _bidSheet = bidSheet ?? throw new ArgumentNullException(nameof(bidSheet));
        _entitlementService = entitlementService ?? throw new ArgumentNullException(nameof(entitlementService));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <inheritdoc />
    public async Task<List<BarchartCatalogLocationResponse>> SearchLocationsAsync(
        BarchartLocationSearchRequest request, CancellationToken cancellationToken = default)
    {
        var isGeographic = request.Latitude.HasValue && request.Longitude.HasValue;
        var radius = request.RadiusMiles ?? DefaultRadiusMiles;

        // A bounding box only pre-filters — it over-selects at the corners, so ask for extra rows and let
        // the exact distance pass below trim back to Take.
        var box = isGeographic
            ? BoundingBox(request.Latitude!.Value, request.Longitude!.Value, radius)
            : ((double MinLat, double MaxLat, double MinLng, double MaxLng)?)null;
        var take = isGeographic ? Math.Min(request.Take * 4, 1000) : request.Take;

        var summaries = await _catalog.SearchLocationsAsync(
            request.Search, request.State, request.CommodityCode, box, take, cancellationToken);

        var results = new List<BarchartCatalogLocationResponse>(summaries.Count);
        foreach (var summary in summaries)
        {
            double? distance = null;
            if (isGeographic)
            {
                // Lat/long are non-null here: the bounding-box filter required them.
                distance = DistanceMiles(
                    request.Latitude!.Value, request.Longitude!.Value, summary.Latitude!.Value, summary.Longitude!.Value);
                if (distance > radius) continue;
            }

            results.Add(summary.ToResponse(distance));
        }

        if (isGeographic)
        {
            results = results
                .OrderBy(r => r.DistanceMiles)
                .Take(request.Take)
                .ToList();
        }

        await AttachPlacementsAsync(results, cancellationToken);

        // Zero-result searches tell us which coverage users actually want, which is the input to widening
        // the vendor pull. Logged as a plain metric; the search term is user-typed text, not sensitive.
        if (results.Count == 0)
        {
            _logger.LogInformation(
                "BarChart catalog search returned no locations for search={Search} state={State} commodity={CommodityCode} geographic={IsGeographic}",
                request.Search, request.State, request.CommodityCode, isGeographic);
        }

        return results;
    }

    /// <inheritdoc />
    public async Task<BarchartCatalogLocationDetailResponse?> GetLocationAsync(
        string locationKey, string? instrumentType, CancellationToken cancellationToken = default)
    {
        var summary = await _catalog.GetLocationAsync(locationKey, cancellationToken);
        if (summary is null) return null;

        var bids = await _catalog.GetBidPreviewAsync(
            locationKey, instrumentType ?? DefaultInstrumentType, cancellationToken);

        var location = summary.ToResponse(null);
        var wrapper = new List<BarchartCatalogLocationResponse> { location };
        await AttachPlacementsAsync(wrapper, cancellationToken);

        return new BarchartCatalogLocationDetailResponse
        {
            Location = wrapper[0],
            Bids = bids.Select(b => b.ToResponse()).ToList(),
            UnmappedBidCount = bids.Count(b => !b.IsMapped)
        };
    }

    /// <inheritdoc />
    public async Task<BarchartCoverageResponse> GetCoverageAsync(CancellationToken cancellationToken = default)
        => (await _catalog.GetCoverageAsync(cancellationToken)).ToResponse();

    /// <inheritdoc />
    public async Task<BarchartRefreshBidsResponse?> RefreshBidsAsync(
        int locationId, CancellationToken cancellationToken = default)
    {
        // Authorize against the location's PERSISTED trade unit, never a client-supplied one — same rule
        // as every other Bid Sheet mutation (AR-05).
        var storedTradeUnit = await _bidSheet.GetLocationTradeUnitCodeAsync(locationId, cancellationToken);
        if (string.IsNullOrEmpty(storedTradeUnit)) return null;
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([storedTradeUnit], cancellationToken);

        var rows = await _ingest.ApplyBidsToBidSheetAsync(
            locationId, DefaultInstrumentType, FeedActor, cancellationToken: cancellationToken);

        _logger.LogInformation(
            "BarChart bids refreshed for location {LocationId}: {RowsAffected} cells [DataMutation]",
            locationId, rows);

        return new BarchartRefreshBidsResponse { LocationId = locationId, RowsAffected = rows };
    }

    /// <summary>
    /// Fills in each listing's existing Bid Sheet placements with a single batched lookup, so the picker
    /// can show where a location is already used without a query per row.
    /// </summary>
    private async Task AttachPlacementsAsync(
        List<BarchartCatalogLocationResponse> locations, CancellationToken cancellationToken)
    {
        if (locations.Count == 0) return;

        var keys = locations.Select(l => l.LocationKey).Distinct().ToList();
        var placements = await _catalog.GetPlacementsAsync(keys, cancellationToken);
        if (placements.Count == 0) return;

        var byKey = placements
            .GroupBy(p => p.LocationKey)
            .ToDictionary(g => g.Key, g => g.Select(p => p.ToResponse()).ToList());

        for (var i = 0; i < locations.Count; i++)
        {
            if (byKey.TryGetValue(locations[i].LocationKey, out var forKey))
                locations[i] = locations[i] with { Placements = forKey };
        }
    }

    /// <summary>
    /// Latitude/longitude window that fully contains a radius around a point. Index-friendly, and only
    /// ever a pre-filter — the exact haversine distance decides what the caller keeps.
    /// </summary>
    private static (double MinLat, double MaxLat, double MinLng, double MaxLng) BoundingBox(
        double latitude, double longitude, double radiusMiles)
    {
        var latDelta = radiusMiles / 69.0;

        // A degree of longitude narrows toward the poles. Clamp the cosine so a near-polar point cannot
        // divide by nearly zero and produce a window spanning the globe.
        var cos = Math.Max(Math.Cos(latitude * Math.PI / 180), 0.01);
        var lngDelta = radiusMiles / (69.0 * cos);

        return (latitude - latDelta, latitude + latDelta, longitude - lngDelta, longitude + lngDelta);
    }

    /// <summary>Great-circle distance in miles; SQL Server has no cheap equivalent for this query shape.</summary>
    private static double DistanceMiles(double lat1, double lng1, double lat2, double lng2)
    {
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
              + Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180)
              * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return EarthRadiusMiles * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }
}
