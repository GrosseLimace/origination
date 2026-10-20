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
        //
        // The 1000 ceiling this used to have was sized for the picker's old 200-row Take max
        // (200 * 4 = 800, rounds up to 1000 with room). Take now goes up to 5000 for the bid sheet
        // map's catalog layer, so the ceiling has to scale with it -- otherwise a wide zoom-out asking
        // for thousands of results would silently come back short, truncated at the intermediate
        // bounding-box fetch rather than at the row cap the caller actually asked for.
        var box = isGeographic
            ? BoundingBox(request.Latitude!.Value, request.Longitude!.Value, radius)
            : ((double MinLat, double MaxLat, double MinLng, double MaxLng)?)null;
        var take = isGeographic ? Math.Min(request.Take * 4, 20000) : request.Take;

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

        // Priced AFTER the geographic re-sort/take, not before: this only needs to cover the page
        // actually being returned, not the over-selected intermediate set the bounding box asked for.
        if (!string.IsNullOrWhiteSpace(request.CommodityCode) && request.CropYear.HasValue && request.Month.HasValue)
        {
            var prices = await _catalog.GetMatchedBidPricesAsync(
                results.Select(r => r.LocationKey).ToList(),
                request.CommodityCode, request.CropYear.Value, request.Month.Value,
                request.InstrumentType ?? DefaultInstrumentType, cancellationToken);
            if (prices.Count > 0)
            {
                for (var i = 0; i < results.Count; i++)
                {
                    if (prices.TryGetValue(results[i].LocationKey, out var matched))
                    {
                        results[i] = results[i] with
                        {
                            MatchedBidPrice = matched.Price,
                            MatchedBidBoard = matched.UnderlyingFuture
                        };
                    }
                }
            }
        }

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

        // No default here, unlike the search above. The search prices one instrument at a time, so it
        // has to pick a type; this is the detail table behind the map popup, which shows a listing's
        // whole book and has to answer a Cash/Basis/Both toggle. Defaulting to cash meant the popup
        // never received a single basis row -- switching the toggle to Basis emptied it, while the map
        // pin beside it showed a basis price quite happily, because the pin comes from the search.
        // A caller that does want one type still says so and still gets it.
        var bids = await _catalog.GetBidPreviewAsync(locationKey, instrumentType, cancellationToken);

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
        // Open to any signed-in user, like the other non-destructive bid sheet operations. This used to
        // authorize against the location's persisted trade unit, which stopped meaning anything when
        // locations became company-wide. Re-publishing the vendor's own prices onto a shared row is not
        // destructive: it is idempotent, it writes only what the feed already says, and the nightly run
        // does the same thing unattended. Still returns null for a location that is not there.
        var createdBy = await _bidSheet.GetLocationCreatedByAsync(locationId, cancellationToken);
        if (string.IsNullOrEmpty(createdBy)) return null;

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
