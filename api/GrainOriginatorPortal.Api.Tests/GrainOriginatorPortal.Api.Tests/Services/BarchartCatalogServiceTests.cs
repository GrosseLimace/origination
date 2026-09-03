// Third-party namespaces
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class BarchartCatalogServiceTests
{
    private readonly IBarchartCatalogRepository _catalog = Substitute.For<IBarchartCatalogRepository>();
    private readonly IBarchartIngestRepository _ingest = Substitute.For<IBarchartIngestRepository>();
    private readonly IBidSheetRepository _bidSheet = Substitute.For<IBidSheetRepository>();
    private readonly IUserEntitlementService _entitlements = Substitute.For<IUserEntitlementService>();
    private readonly BarchartCatalogService _sut;

    public BarchartCatalogServiceTests()
    {
        _catalog.GetPlacementsAsync(Arg.Any<IReadOnlyCollection<string>>(), Arg.Any<CancellationToken>())
            .Returns([]);
        _sut = new BarchartCatalogService(
            _catalog, _ingest, _bidSheet, _entitlements, NullLogger<BarchartCatalogService>.Instance);
    }

    private static BarchartLocationSummary Summary(string key, double? lat = null, double? lng = null) => new()
    {
        LocationKey = key,
        Elevator = $"Elevator {key}",
        Latitude = lat,
        Longitude = lng,
        ActiveInstrumentCount = 4,
        CommodityCount = 2
    };

    // -------------------------------------------------------------------------
    // A plain text search must not invent a distance — the UI shows the distance column only when
    // the search was geographic, and a zero would read as "right here".
    [Fact]
    public async Task SearchLocationsAsync_WithoutCoordinates_ReturnsNoDistanceAndNoBoundingBox()
    {
        _catalog.SearchLocationsAsync(
                "muscatine", null, null, null, 50, Arg.Any<CancellationToken>())
            .Returns([Summary("82259", 41.42, -91.04)]);

        var results = await _sut.SearchLocationsAsync(
            new BarchartLocationSearchRequest { Search = "muscatine" }, CancellationToken.None);

        var only = Assert.Single(results);
        Assert.Null(only.DistanceMiles);
        Assert.Equal("82259", only.LocationKey);
    }

    // -------------------------------------------------------------------------
    // The bounding box over-selects at the corners, so the exact-distance pass has to drop anything
    // outside the requested radius. Without it a "within 25 miles" search returns 35-mile results.
    [Fact]
    public async Task SearchLocationsAsync_Geographic_DropsLocationsOutsideRadius()
    {
        // ~14 miles north of the centre, and ~1.4 degrees (~95 miles) east of it.
        _catalog.SearchLocationsAsync(
                null, null, null, Arg.Any<(double, double, double, double)?>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns([Summary("near", 41.62, -91.04), Summary("far", 41.42, -89.60)]);

        var results = await _sut.SearchLocationsAsync(
            new BarchartLocationSearchRequest { Latitude = 41.42, Longitude = -91.04, RadiusMiles = 25 },
            CancellationToken.None);

        var only = Assert.Single(results);
        Assert.Equal("near", only.LocationKey);
        Assert.NotNull(only.DistanceMiles);
    }

    // -------------------------------------------------------------------------
    // The bounding-box pre-fetch asks for Take * 4 rows (over-selecting to cover the box's corners,
    // trimmed back to Take by the exact-distance pass above). That multiplier used to be capped at
    // 1000 regardless of what Take was, sized for the picker's old 200-row ceiling -- so once the bid
    // sheet map's catalog layer could ask for up to 5,000, a wide zoom-out would silently come back
    // short: capped at the intermediate fetch, not at the row count the caller actually asked for.
    [Fact]
    public async Task SearchLocationsAsync_Geographic_ScalesTheIntermediateFetchWithTake()
    {
        var passedTake = -1;
        _catalog.SearchLocationsAsync(
                null, null, null, Arg.Any<(double, double, double, double)?>(), Arg.Do<int>(t => passedTake = t), Arg.Any<CancellationToken>())
            .Returns([]);

        await _sut.SearchLocationsAsync(
            new BarchartLocationSearchRequest { Latitude = 41.42, Longitude = -91.04, RadiusMiles = 100, Take = 5000 },
            CancellationToken.None);

        // 5000 * 4 = 20000 -- if this were still capped at the old 1000, a catalog-wide zoom-out would
        // silently return at most 250 real (post-distance-filter) results no matter what Take asked for.
        Assert.Equal(20000, passedTake);
    }

    // -------------------------------------------------------------------------
    // Nearest first: an originator scanning a map expects the closest competitor at the top.
    [Fact]
    public async Task SearchLocationsAsync_Geographic_SortsNearestFirst()
    {
        _catalog.SearchLocationsAsync(
                null, null, null, Arg.Any<(double, double, double, double)?>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns([Summary("farther", 41.90, -91.04), Summary("closer", 41.50, -91.04)]);

        var results = await _sut.SearchLocationsAsync(
            new BarchartLocationSearchRequest { Latitude = 41.42, Longitude = -91.04 }, CancellationToken.None);

        Assert.Equal(["closer", "farther"], results.Select(r => r.LocationKey));
    }

    // -------------------------------------------------------------------------
    // Existing placements come back attached, so the picker can show a location as already added
    // instead of letting the user create a duplicate and hit a 400.
    [Fact]
    public async Task SearchLocationsAsync_AttachesExistingPlacements()
    {
        _catalog.SearchLocationsAsync(
                null, null, null, null, 50, Arg.Any<CancellationToken>())
            .Returns([Summary("82259")]);
        _catalog.GetPlacementsAsync(Arg.Any<IReadOnlyCollection<string>>(), Arg.Any<CancellationToken>())
            .Returns([new BarchartLocationPlacement
            {
                LocationKey = "82259", LocationId = 12, TradeUnitCode = "2190", Name = "GPC Muscatine"
            }]);

        var results = await _sut.SearchLocationsAsync(new BarchartLocationSearchRequest(), CancellationToken.None);

        var placement = Assert.Single(Assert.Single(results).Placements);
        Assert.Equal(12, placement.LocationId);
        Assert.Equal("2190", placement.TradeUnitCode);
    }

    // -------------------------------------------------------------------------
    // An unknown or deactivated key is a 404 at the controller, not an empty shell of a location.
    [Fact]
    public async Task GetLocationAsync_UnknownKey_ReturnsNull()
    {
        _catalog.GetLocationAsync("nope", Arg.Any<CancellationToken>()).Returns((BarchartLocationSummary?)null);

        var result = await _sut.GetLocationAsync("nope", null, CancellationToken.None);

        Assert.Null(result);
        await _catalog.DidNotReceive().GetBidPreviewAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // -------------------------------------------------------------------------
    // Unmapped bids are surfaced, not hidden: they're the reason a location can look like it has
    // bids in the vendor's data but land nothing on the Bid Sheet.
    [Fact]
    public async Task GetLocationAsync_CountsUnmappedBids()
    {
        _catalog.GetLocationAsync("82259", Arg.Any<CancellationToken>()).Returns(Summary("82259"));
        _catalog.GetBidPreviewAsync("82259", "bidCash", Arg.Any<CancellationToken>())
            .Returns([
                new BarchartBidPreview { VendorCommodity = "Corn (#2 Yellow)", CommodityCode = "CORN", IsMapped = true },
                new BarchartBidPreview { VendorCommodity = "Rye", IsMapped = false }
            ]);

        var result = await _sut.GetLocationAsync("82259", null, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(2, result!.Bids.Count);
        Assert.Equal(1, result.UnmappedBidCount);
    }

    // -------------------------------------------------------------------------
    // Refresh targets a Bid Sheet row, so a missing id must be a 404 — and must not run the bridge
    // with a null location filter, which would republish every linked location in the database.
    [Fact]
    public async Task RefreshBidsAsync_UnknownLocation_ReturnsNullWithoutRunningBridge()
    {
        _bidSheet.GetLocationCreatedByAsync(99, Arg.Any<CancellationToken>()).Returns((string?)null);

        var result = await _sut.RefreshBidsAsync(99, CancellationToken.None);

        Assert.Null(result);
        await _ingest.DidNotReceive().ApplyBidsToBidSheetAsync(
            Arg.Any<int?>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    // -------------------------------------------------------------------------
    // The bridge must be scoped to the one location. It used to also validate the row's trade unit,
    // which stopped meaning anything when locations became company-wide -- and re-publishing the
    // vendor's own prices is not destructive, so it is open to any signed-in user now. What still
    // matters is that a real row was found and the bridge was not handed a null filter.
    [Fact]
    public async Task RefreshBidsAsync_ScopesBridgeToTheLocation_WithoutTradeUnitEntitlement()
    {
        _bidSheet.GetLocationCreatedByAsync(12, Arg.Any<CancellationToken>()).Returns("someone@scoular.com");
        _ingest.ApplyBidsToBidSheetAsync(12, "bidCash", "barchart-feed", Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(6);

        var result = await _sut.RefreshBidsAsync(12, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(6, result!.RowsAffected);
        Assert.Equal(12, result.LocationId);
        // Not the caller's row, and still allowed -- the point of the change.
        await _entitlements.DidNotReceive().ValidateTradeUnitsOrThrowAsync(
            Arg.Any<IReadOnlyCollection<string>>(), Arg.Any<CancellationToken>());
    }

    // -------------------------------------------------------------------------
    // Coverage is what turns an empty search into an explainable answer, so it must pass through.
    [Fact]
    public async Task GetCoverageAsync_ReturnsCatalogTotalsAndStates()
    {
        _catalog.GetCoverageAsync(Arg.Any<CancellationToken>()).Returns(new BarchartCoverage
        {
            LocationCount = 2894,
            LastRefreshedUtc = new DateTime(2026, 8, 18, 11, 0, 0, DateTimeKind.Utc),
            States = [new BarchartStateCoverage { State = "IA", LocationCount = 412 }]
        });

        var result = await _sut.GetCoverageAsync(CancellationToken.None);

        Assert.Equal(2894, result.LocationCount);
        Assert.Equal("IA", Assert.Single(result.States).State);
    }
}
