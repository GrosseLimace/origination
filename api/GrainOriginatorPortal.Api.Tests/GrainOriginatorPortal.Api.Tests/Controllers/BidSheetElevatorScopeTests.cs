// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// H-066 (2026-09-14). GET /api/bidsheet/elevators used to accept an optional tradeUnitCode and
/// return every elevator across every trade unit when it was omitted. AR-05 covered that, but its
/// justification — the bid-sheet map needs all LOCATIONS — never applied to elevators, and nothing
/// in the client calls this route.
///
/// The blank case is the one worth pinning: ValidateTradeUnitsOrThrowAsync filters blanks and
/// returns early on an empty set, so `?tradeUnitCode=` would sail through the entitlement check and
/// fall into the unscoped repository path. The controller must reject blank BEFORE validating.
/// </summary>
public class BidSheetElevatorScopeTests
{
    private readonly Mock<IBidSheetService> _serviceMock = new();
    private readonly Mock<IUserEntitlementService> _entitlementMock = new();
    private readonly BidSheetController _sut;

    public BidSheetElevatorScopeTests()
    {
        _entitlementMock
            .Setup(e => e.ValidateTradeUnitsOrThrowAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .Returns((IEnumerable<string> codes, CancellationToken _) =>
                codes.All(c => c == "2090")
                    ? Task.CompletedTask
                    : throw new ForbiddenException("Access denied: you are not authorized for trade unit(s)."));

        _serviceMock
            .Setup(s => s.GetElevatorsAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        _sut = new BidSheetController(_serviceMock.Object, _entitlementMock.Object);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task GetElevators_WithoutATradeUnitCode_IsRejected(string? tradeUnitCode)
    {
        await Assert.ThrowsAsync<ValidationException>(
            () => _sut.GetElevators(tradeUnitCode!, CancellationToken.None));

        // The point of the fix: no unscoped read reaches the service.
        _serviceMock.Verify(
            s => s.GetElevatorsAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task GetElevators_WithAnUnentitledTradeUnit_IsRejected()
    {
        await Assert.ThrowsAsync<ForbiddenException>(
            () => _sut.GetElevators("2291", CancellationToken.None));

        _serviceMock.Verify(
            s => s.GetElevatorsAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task GetElevators_WithAnEntitledTradeUnit_Succeeds()
    {
        var result = await _sut.GetElevators("2090", CancellationToken.None);

        Assert.NotNull(result);
        _serviceMock.Verify(s => s.GetElevatorsAsync("2090", It.IsAny<CancellationToken>()), Times.Once);
    }
}
