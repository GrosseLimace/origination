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
    private readonly BidSheetService _sut;

    public BidSheetServiceTests()
    {
        _requestContext.Setup(r => r.GetCurrentUser()).Returns("user@x.com");
        _sut = new BidSheetService(_repo.Object, _requestContext.Object, _entitlementService.Object);
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
}
