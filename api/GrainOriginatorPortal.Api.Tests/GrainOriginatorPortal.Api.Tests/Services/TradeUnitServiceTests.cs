// Microsoft namespaces
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The onboarding TU picker reads the entitlements catalog (one row per user x trade unit) and
/// collapses it to distinct codes; when that DB is down it falls back to the codes already present
/// on dbo.CustomerTradeUnit. These pin the collapse rules and the fallback boundary.
/// </summary>
public class TradeUnitServiceTests
{
    private readonly Mock<IEntitlementsRepository> _entitlementsMock = new();
    private readonly Mock<ICustomerRepository> _customerRepositoryMock = new();
    private readonly TradeUnitService _sut;

    public TradeUnitServiceTests()
    {
        _sut = new TradeUnitService(_entitlementsMock.Object, _customerRepositoryMock.Object, new Mock<ILogger<TradeUnitService>>().Object);
    }

    [Fact]
    public async Task GetAllAsync_CollapsesUserRowsToDistinctCodes_CaseInsensitively_SortedByCode()
    {
        _entitlementsMock
            .Setup(e => e.GetAllAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                Row("user-a", "2115", "Salina"),
                Row("user-b", "2090", "Omaha"),
                Row("user-c", "2115", "Salina"),
                Row("user-d", "ab12", "Lower-case code"),
                Row("user-e", "AB12", "Upper-case code"),
            ]);

        var result = await _sut.GetAllAsync(CancellationToken.None);

        Assert.Equal(["2090", "2115", "ab12"], result.Select(o => o.Code));
        _customerRepositoryMock.Verify(c => c.GetAllActiveTradeUnitCodesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    // Descriptions are per-row and often blank on the entitlement side; take the first real one
    // rather than whichever row happened to sort first.
    [Fact]
    public async Task GetAllAsync_UsesTheFirstNonBlankDescriptionForACode()
    {
        _entitlementsMock
            .Setup(e => e.GetAllAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                Row("user-a", "2090", null),
                Row("user-b", "2090", "   "),
                Row("user-c", "2090", "Omaha"),
                Row("user-d", "2090", "Omaha (old)"),
            ]);

        var result = await _sut.GetAllAsync(CancellationToken.None);

        var option = Assert.Single(result);
        Assert.Equal("Omaha", option.Description);
    }

    [Fact]
    public async Task GetAllAsync_WhenNoRowHasADescription_LeavesItNullRatherThanBlank()
    {
        _entitlementsMock
            .Setup(e => e.GetAllAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([Row("user-a", "2090", null), Row("user-b", "2090", "")]);

        var result = await _sut.GetAllAsync(CancellationToken.None);

        Assert.Null(Assert.Single(result).Description);
    }

    // An empty catalog is a legitimate answer, not an outage: no fallback.
    [Fact]
    public async Task GetAllAsync_WhenTheCatalogIsEmpty_ReturnsEmptyWithoutFallingBack()
    {
        _entitlementsMock.Setup(e => e.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync([]);

        var result = await _sut.GetAllAsync(CancellationToken.None);

        Assert.Empty(result);
        _customerRepositoryMock.Verify(c => c.GetAllActiveTradeUnitCodesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task GetAllAsync_WhenTheCatalogIsUnavailable_FallsBackToActiveCustomerTradeUnitCodes()
    {
        _entitlementsMock
            .Setup(e => e.GetAllAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("entitlements DB unreachable"));
        _customerRepositoryMock
            .Setup(c => c.GetAllActiveTradeUnitCodesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(["2291", "2090"]);

        var result = await _sut.GetAllAsync(CancellationToken.None);

        // Fallback rows carry no description and keep the repository order (it owns the sort).
        Assert.Equal(["2291", "2090"], result.Select(o => o.Code));
        Assert.All(result, o => Assert.Null(o.Description));
    }

    // Fail loudly when both sources are down. A silent [] would let onboarding proceed with an
    // empty picker and no explanation.
    [Fact]
    public async Task GetAllAsync_WhenBothSourcesFail_PropagatesTheFallbackFailure()
    {
        _entitlementsMock
            .Setup(e => e.GetAllAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("entitlements DB unreachable"));
        _customerRepositoryMock
            .Setup(c => c.GetAllActiveTradeUnitCodesAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new TimeoutException("app DB unreachable"));

        await Assert.ThrowsAsync<TimeoutException>(() => _sut.GetAllAsync(CancellationToken.None));
    }

    private static UserTradeUnitPreference Row(string userId, string code, string? description) =>
        new() { UserId = userId, DisplayName = userId, TradeUnitCode = code, Description = description };
}
