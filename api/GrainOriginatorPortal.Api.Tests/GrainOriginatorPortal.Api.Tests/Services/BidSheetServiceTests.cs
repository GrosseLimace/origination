// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class BidSheetServiceTests
{
    private readonly Mock<IBidSheetRepository> _repo = new();
    private readonly Mock<IRequestContextService> _requestContext = new();
    private readonly Mock<IUserEntitlementService> _entitlementService = new();
    private readonly Mock<IBarchartCatalogRepository> _barchartCatalog = new();
    private readonly Mock<IBarchartIngestRepository> _barchartIngest = new();
    private readonly BidSheetService _sut;

    public BidSheetServiceTests()
    {
        _requestContext.Setup(r => r.GetCurrentUser()).Returns("user@x.com");
        _sut = new BidSheetService(
            _repo.Object, _requestContext.Object, _entitlementService.Object,
            _barchartCatalog.Object, _barchartIngest.Object);
    }

    private static CreateBidSheetLocationRequest Request(string name = "Kansas West", string tu = "TU1") => new()
    {
        Name = name,
        TradeUnitCode = tu,
        Latitude = 38.5,
        Longitude = -98.0,
        IsScoularFacility = true,
        Bids = []
    };

    // -------------------------------------------------------------------------
    // A location name that already exists in the same trade unit must surface a friendly
    // ValidationException (→ 400) instead of letting the DB unique index blow up as a 500 —
    // and it must NOT attempt the insert.
    [Fact]
    public async Task CreateLocationAsync_DuplicateNameInTradeUnit_ThrowsValidation_AndDoesNotInsert()
    {
        _repo.Setup(r => r.LocationNameExistsAsync("Kansas West", "TU1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var ex = await Assert.ThrowsAsync<ValidationException>(() =>
            _sut.CreateLocationAsync(Request(), CancellationToken.None));

        Assert.True(ex.Errors.ContainsKey("name"));
        Assert.Contains("already exists", ex.Message);
        _repo.Verify(r => r.CreateLocationAsync(It.IsAny<BidSheetLocation>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    // A unique name persists normally — the new quick-add flow creates a location with no bids
    // (bids are entered later in the grid), the server-derived creator is stamped, and the
    // Scoular flag is carried through.
    [Fact]
    public async Task CreateLocationAsync_NewName_CreatesLocationWithNoBids()
    {
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        BidSheetLocation? captured = null;
        _repo.Setup(r => r.CreateLocationAsync(It.IsAny<BidSheetLocation>(), It.IsAny<CancellationToken>()))
            .Callback<BidSheetLocation, CancellationToken>((loc, _) => captured = loc)
            .ReturnsAsync((BidSheetLocation loc, CancellationToken _) => loc);

        var result = await _sut.CreateLocationAsync(Request("New Loc", "TU2"), CancellationToken.None);

        Assert.NotNull(captured);
        Assert.Equal("New Loc", captured!.Name);
        Assert.Equal("TU2", captured.TradeUnitCode);
        Assert.True(captured.IsScoularFacility);
        Assert.Empty(captured.Bids);
        Assert.Equal("user@x.com", captured.CreatedBy);
        Assert.Equal("New Loc", result.Name);
        _repo.Verify(r => r.CreateLocationAsync(It.IsAny<BidSheetLocation>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    // Linking to a BarChart location fills in whatever the picker didn't send from the catalog,
    // stores the canonical key, and publishes the feed's prices immediately so the row isn't blank.
    [Fact]
    public async Task CreateLocationAsync_WithBarchartKey_PrefillsFromCatalogAndAppliesBids()
    {
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.BarchartLocationLinkedAsync("82259", "TU1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _barchartCatalog.Setup(c => c.GetLocationAsync("82259", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BarchartLocationSummary
            {
                LocationKey = "82259",
                Address = "1 Mill Rd",
                City = "Muscatine",
                State = "IA",
                Latitude = 41.42,
                Longitude = -91.04
            });
        BidSheetLocation? captured = null;
        _repo.Setup(r => r.CreateLocationAsync(It.IsAny<BidSheetLocation>(), It.IsAny<CancellationToken>()))
            .Callback<BidSheetLocation, CancellationToken>((loc, _) => { captured = loc; loc.Id = 7; })
            .ReturnsAsync((BidSheetLocation loc, CancellationToken _) => loc);
        _repo.Setup(r => r.GetLocationAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((BidSheetLocation?)null);

        var request = Request("GPC Muscatine") with { BarchartLocationKey = " 82259 ", Latitude = null, Longitude = null };
        await _sut.CreateLocationAsync(request, CancellationToken.None);

        Assert.NotNull(captured);
        Assert.Equal("82259", captured!.BarchartLocationKey);
        Assert.Equal("Muscatine", captured.City);
        Assert.Equal("IA", captured.State);
        Assert.Equal(41.42, captured.Latitude);
        _barchartIngest.Verify(i => i.ApplyBidsToBidSheetAsync(
            7, "bidCash", "barchart-feed", It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    // Values the caller did send win over the catalog — an originator who corrected an address
    // shouldn't have the vendor's version silently substituted.
    [Fact]
    public async Task CreateLocationAsync_WithBarchartKeyAndSuppliedFields_KeepsSuppliedValues()
    {
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.BarchartLocationLinkedAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _barchartCatalog.Setup(c => c.GetLocationAsync("82259", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BarchartLocationSummary { LocationKey = "82259", City = "Muscatine", State = "IA" });
        BidSheetLocation? captured = null;
        _repo.Setup(r => r.CreateLocationAsync(It.IsAny<BidSheetLocation>(), It.IsAny<CancellationToken>()))
            .Callback<BidSheetLocation, CancellationToken>((loc, _) => captured = loc)
            .ReturnsAsync((BidSheetLocation loc, CancellationToken _) => loc);

        var request = Request() with { BarchartLocationKey = "82259", City = "Wilton" };
        await _sut.CreateLocationAsync(request, CancellationToken.None);

        Assert.Equal("Wilton", captured!.City);
        Assert.Equal("IA", captured.State);
    }

    // -------------------------------------------------------------------------
    // A key the catalog doesn't hold (deactivated, or a stale picker result) must be a 400, with
    // nothing written — otherwise we'd persist a link that can never produce a bid.
    [Fact]
    public async Task CreateLocationAsync_UnknownBarchartKey_ThrowsValidation_AndDoesNotInsert()
    {
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.BarchartLocationLinkedAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _barchartCatalog.Setup(c => c.GetLocationAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((BarchartLocationSummary?)null);

        var ex = await Assert.ThrowsAsync<ValidationException>(() =>
            _sut.CreateLocationAsync(Request() with { BarchartLocationKey = "99999" }, CancellationToken.None));

        Assert.True(ex.Errors.ContainsKey("barchartLocationKey"));
        _repo.Verify(r => r.CreateLocationAsync(It.IsAny<BidSheetLocation>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    // The same feed location added twice to one trade unit would double every fed bid on the sheet.
    [Fact]
    public async Task CreateLocationAsync_BarchartKeyAlreadyLinkedInTradeUnit_ThrowsValidation()
    {
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.BarchartLocationLinkedAsync("82259", "TU1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var ex = await Assert.ThrowsAsync<ValidationException>(() =>
            _sut.CreateLocationAsync(Request() with { BarchartLocationKey = "82259" }, CancellationToken.None));

        Assert.True(ex.Errors.ContainsKey("barchartLocationKey"));
        _repo.Verify(r => r.CreateLocationAsync(It.IsAny<BidSheetLocation>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    // No key means no feed involvement at all — the manual path must not touch the catalog or bridge.
    [Fact]
    public async Task CreateLocationAsync_WithoutBarchartKey_DoesNotTouchFeed()
    {
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.CreateLocationAsync(It.IsAny<BidSheetLocation>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((BidSheetLocation loc, CancellationToken _) => loc);

        await _sut.CreateLocationAsync(Request(), CancellationToken.None);

        _barchartCatalog.Verify(c => c.GetLocationAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _barchartIngest.Verify(i => i.ApplyBidsToBidSheetAsync(
            It.IsAny<int?>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
