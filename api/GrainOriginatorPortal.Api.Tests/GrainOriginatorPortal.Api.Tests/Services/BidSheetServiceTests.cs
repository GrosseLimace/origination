// Third-party namespaces
using Microsoft.Extensions.Logging.Abstractions;

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
    private readonly Mock<IEntitlementsRepository> _entitlements = new();
    private readonly BidSheetService _sut;

    public BidSheetServiceTests()
    {
        _requestContext.Setup(r => r.GetCurrentUser()).Returns("user@x.com");
        _sut = new BidSheetService(
            _repo.Object, _requestContext.Object, _entitlementService.Object,
            _barchartCatalog.Object, _barchartIngest.Object,
            _entitlements.Object, NullLogger<BidSheetService>.Instance);
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
        _repo.Setup(r => r.LocationNameExistsAsync("Kansas West", It.IsAny<CancellationToken>()))
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
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
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
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.BarchartLocationLinkedAsync("82259", It.IsAny<CancellationToken>()))
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
            7, "bidCash", "barchart-feed", It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    // Values the caller did send win over the catalog — an originator who corrected an address
    // shouldn't have the vendor's version silently substituted.
    [Fact]
    public async Task CreateLocationAsync_WithBarchartKeyAndSuppliedFields_KeepsSuppliedValues()
    {
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.BarchartLocationLinkedAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
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
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.BarchartLocationLinkedAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
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
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.BarchartLocationLinkedAsync("82259", It.IsAny<CancellationToken>()))
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
        _repo.Setup(r => r.LocationNameExistsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.CreateLocationAsync(It.IsAny<BidSheetLocation>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((BidSheetLocation loc, CancellationToken _) => loc);

        await _sut.CreateLocationAsync(Request(), CancellationToken.None);

        _barchartCatalog.Verify(c => c.GetLocationAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _barchartIngest.Verify(i => i.ApplyBidsToBidSheetAsync(
            It.IsAny<int?>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }
    // ── who may destroy a shared location ────────────────────────────────────────────────────────
    // Locations are company-wide now, so a delete takes the elevator and its whole bid history off
    // EVERY sheet at once. The old guard checked the row's trade unit, which no longer means anything.
    // Only the creator or an Admin may destroy; everything non-destructive stays open.

    [Fact]
    public async Task DeleteLocationAsync_CreatorMayDelete()
    {
        _repo.Setup(r => r.GetLocationCreatedByAsync(7, It.IsAny<CancellationToken>()))
             .ReturnsAsync("user@x.com");

        await _sut.DeleteLocationAsync(7, CancellationToken.None);

        _repo.Verify(r => r.DeleteLocationAsync(7, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task DeleteLocationAsync_AdminMayDeleteSomeoneElsesLocation()
    {
        _repo.Setup(r => r.GetLocationCreatedByAsync(7, It.IsAny<CancellationToken>()))
             .ReturnsAsync("someone.else@x.com");
        _requestContext.Setup(r => r.IsAdmin()).Returns(true);

        await _sut.DeleteLocationAsync(7, CancellationToken.None);

        _repo.Verify(r => r.DeleteLocationAsync(7, It.IsAny<CancellationToken>()), Times.Once);
    }

    // A real 403, not the 404 the old predicate-based style produced -- the row plainly exists, and
    // telling the user "it vanished" would send them looking for a bug that is not there.
    [Fact]
    public async Task DeleteLocationAsync_SomeoneElsesLocation_ThrowsForbiddenAndDeletesNothing()
    {
        _repo.Setup(r => r.GetLocationCreatedByAsync(7, It.IsAny<CancellationToken>()))
             .ReturnsAsync("someone.else@x.com");

        await Assert.ThrowsAsync<ForbiddenException>(
            () => _sut.DeleteLocationAsync(7, CancellationToken.None));

        _repo.Verify(r => r.DeleteLocationAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DeleteLocationAsync_MissingLocation_NoOpsWithoutThrowing()
    {
        _repo.Setup(r => r.GetLocationCreatedByAsync(99, It.IsAny<CancellationToken>()))
             .ReturnsAsync((string?)null);

        await _sut.DeleteLocationAsync(99, CancellationToken.None);

        _repo.Verify(r => r.DeleteLocationAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // Wiping every bid for a commodity is destructive on the same shared row, so it is gated the same.
    [Fact]
    public async Task DeleteBidsAsync_SomeoneElsesLocation_ThrowsForbidden()
    {
        _repo.Setup(r => r.GetLocationCreatedByAsync(7, It.IsAny<CancellationToken>()))
             .ReturnsAsync("someone.else@x.com");

        await Assert.ThrowsAsync<ForbiddenException>(
            () => _sut.DeleteBidsAsync(7, "YC", null, CancellationToken.None));

        _repo.Verify(r => r.DeleteBidsAsync(
            It.IsAny<int>(), It.IsAny<string>(), It.IsAny<int?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // Renaming and re-siting are shared-record edits, not destruction. Anyone signed in may do it --
    // including on a row somebody else created -- and no trade-unit entitlement is consulted.
    [Fact]
    public async Task UpdateLocationAsync_SomeoneElsesLocation_IsAllowed()
    {
        _repo.Setup(r => r.UpdateLocationAsync(7, It.IsAny<BidSheetLocation>(), It.IsAny<CancellationToken>()))
             .ReturnsAsync(new BidSheetLocation { Id = 7, Name = "Renamed", CreatedBy = "someone.else@x.com" });

        var result = await _sut.UpdateLocationAsync(7, Request("Renamed"), CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("Renamed", result!.Name);
        _entitlementService.Verify(e => e.ValidateTradeUnitsOrThrowAsync(
            It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
