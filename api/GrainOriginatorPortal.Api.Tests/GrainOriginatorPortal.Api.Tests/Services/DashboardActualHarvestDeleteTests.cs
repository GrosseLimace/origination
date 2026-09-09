// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// H-061 (CWE-639). DELETE actualharvest/{id} carries no trade-unit value, so
/// [EnforceTradeUnitAccess] cannot evaluate it — the guard has to resolve the row's own
/// TradeUnitKey. These tests pin that guard: without it, any authenticated user could walk
/// sequential ids and destroy another trade unit's hand-entered market-share baselines, which have
/// no upstream system of record to restore from.
/// </summary>
public class DashboardActualHarvestDeleteTests
{
    private const int EntitledRowId = 41;
    private const int ForeignRowId = 42;
    private const int MissingRowId = 999;

    private readonly Mock<IDashboardRepository> _repositoryMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly Mock<IUserEntitlementService> _entitlementMock = new();
    private readonly DashboardService _sut;

    public DashboardActualHarvestDeleteTests()
    {
        _entitlementMock.SetupGet(e => e.EntitlementsAvailable).Returns(true);
        _entitlementMock
            .Setup(e => e.GetAllowedTradeUnitCodesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string> { "2090" });
        // Mirror the real service: only the caller's own trade units pass.
        _entitlementMock
            .Setup(e => e.ValidateTradeUnitsOrThrowAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .Returns((IEnumerable<string> codes, CancellationToken _) =>
                codes.All(c => c == "2090")
                    ? Task.CompletedTask
                    : throw new ForbiddenException("Access denied: you are not authorized for trade unit(s)."));

        _repositoryMock
            .Setup(r => r.GetActualHarvestTradeUnitKeyAsync(EntitledRowId, It.IsAny<CancellationToken>()))
            .ReturnsAsync("2090");
        _repositoryMock
            .Setup(r => r.GetActualHarvestTradeUnitKeyAsync(ForeignRowId, It.IsAny<CancellationToken>()))
            .ReturnsAsync("2291");
        _repositoryMock
            .Setup(r => r.GetActualHarvestTradeUnitKeyAsync(MissingRowId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);

        _sut = new DashboardService(_repositoryMock.Object, _requestContextMock.Object, _entitlementMock.Object);
    }

    [Fact]
    public async Task DeleteActualHarvestAsync_WhenRowIsInAnEntitledTradeUnit_DeletesIt()
    {
        var result = await _sut.DeleteActualHarvestAsync(EntitledRowId, CancellationToken.None);

        Assert.Equal("2090", result);
        _repositoryMock.Verify(r => r.DeleteActualHarvestAsync(EntitledRowId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task DeleteActualHarvestAsync_WhenRowBelongsToAnotherTradeUnit_ThrowsAndDeletesNothing()
    {
        await Assert.ThrowsAsync<ForbiddenException>(
            () => _sut.DeleteActualHarvestAsync(ForeignRowId, CancellationToken.None));

        // The assertion that matters: the row must still be there.
        _repositoryMock.Verify(r => r.DeleteActualHarvestAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // The pre-fix behaviour for an unknown id was a silent no-op returning 204. Keep it: a 403 here
    // would make the route an existence oracle for other trade units' row ids.
    [Fact]
    public async Task DeleteActualHarvestAsync_WhenRowDoesNotExist_IsANoOpAndDoesNotThrow()
    {
        var result = await _sut.DeleteActualHarvestAsync(MissingRowId, CancellationToken.None);

        Assert.Null(result);
        _repositoryMock.Verify(r => r.DeleteActualHarvestAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
        _entitlementMock.Verify(
            e => e.ValidateTradeUnitsOrThrowAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    // CWE-285: an entitlements outage must refuse a destructive call rather than delete a row it
    // cannot authorize. Mirrors DpContractService and EnforceTradeUnitAccessAttribute.
    [Fact]
    public async Task DeleteActualHarvestAsync_WhenEntitlementsUnavailable_FailsClosedWith503()
    {
        _entitlementMock.SetupGet(e => e.EntitlementsAvailable).Returns(false);

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.DeleteActualHarvestAsync(EntitledRowId, CancellationToken.None));

        Assert.Equal("ENTITLEMENTS_DB_UNAVAILABLE", ex.ErrorCode);
        _repositoryMock.Verify(r => r.DeleteActualHarvestAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // Guards the ordering the fix depends on: the trade unit must be resolved BEFORE the delete,
    // never after. Reversing them would authorize a row that is already gone.
    [Fact]
    public async Task DeleteActualHarvestAsync_ResolvesTheTradeUnitBeforeDeleting()
    {
        var sequence = new List<string>();
        _repositoryMock
            .Setup(r => r.GetActualHarvestTradeUnitKeyAsync(EntitledRowId, It.IsAny<CancellationToken>()))
            .ReturnsAsync("2090")
            .Callback(() => sequence.Add("resolve"));
        _repositoryMock
            .Setup(r => r.DeleteActualHarvestAsync(EntitledRowId, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask)
            .Callback(() => sequence.Add("delete"));

        await _sut.DeleteActualHarvestAsync(EntitledRowId, CancellationToken.None);

        Assert.Equal(["resolve", "delete"], sequence);
    }
}
