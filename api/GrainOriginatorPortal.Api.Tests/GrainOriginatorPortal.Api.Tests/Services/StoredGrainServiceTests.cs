// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// StoredGrainService.GetAllAsync duplicates DpContractService.GetAllAsync's entitlement scoping
/// line for line, but only the DP copy was pinned by tests — so a refactor that dropped the
/// allowedCustomerIds filter here would have shipped a cross-trade-unit leak with nothing to catch
/// it. These mirror DpContractServiceTests deliberately; if you change one, change both.
/// </summary>
public class StoredGrainServiceTests
{
    private readonly Mock<IStoredGrainRepository> _repositoryMock = new();
    private readonly Mock<ICustomerRepository> _customerRepositoryMock = new();
    private readonly Mock<IUserEntitlementService> _entitlementMock = new();
    private readonly StoredGrainService _sut;

    public StoredGrainServiceTests()
    {
        _entitlementMock.SetupGet(e => e.EntitlementsAvailable).Returns(true);
        _entitlementMock
            .Setup(e => e.GetAllowedTradeUnitCodesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string> { "2115" });
        _sut = new StoredGrainService(
            _repositoryMock.Object, _customerRepositoryMock.Object, _entitlementMock.Object);
    }

    [Fact]
    public async Task GetAllAsync_NarrowsToProducersInEntitledTradeUnits()
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<IEnumerable<string>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new StoredGrain { Id = "entitled", CustomerId = 1 },
                new StoredGrain { Id = "not-entitled", CustomerId = 2 },
            ]);
        _customerRepositoryMock
            .Setup(c => c.GetActiveCustomerIdsInTradeUnitsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([1L]);

        var result = await _sut.GetAllAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal("entitled", result[0].Id);
    }

    // CWE-285: an entitlements outage must refuse the request rather than return rows we can't
    // authorize. Mirrors DpContractService and EnforceTradeUnitAccessAttribute.
    [Fact]
    public async Task GetAllAsync_WhenEntitlementsUnavailable_FailsClosedWith503()
    {
        _entitlementMock.SetupGet(e => e.EntitlementsAvailable).Returns(false);
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<IEnumerable<string>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new StoredGrain { Id = "any", CustomerId = 1 }]);

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetAllAsync(null, CancellationToken.None));

        Assert.Equal("ENTITLEMENTS_DB_UNAVAILABLE", ex.ErrorCode);
        Assert.Equal(503, ex.HttpStatusCode);
    }

    // An empty allow-list must return nothing, not everything — the inverse of the filter being
    // skipped altogether.
    [Fact]
    public async Task GetAllAsync_WhenNoProducersAreEntitled_ReturnsEmpty()
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<IEnumerable<string>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new StoredGrain { Id = "any", CustomerId = 1 }]);
        _customerRepositoryMock
            .Setup(c => c.GetActiveCustomerIdsInTradeUnitsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        var result = await _sut.GetAllAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    // Per-producer reads are deliberately NOT entitlement-scoped — trade-unit entitlements are a UX
    // default, not an access boundary (AR-02; same rule as DP contracts).
    [Fact]
    public async Task GetByCustomerAsync_DoesNotApplyEntitlementScoping()
    {
        _repositoryMock
            .Setup(r => r.GetByCustomerAsync(99L, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new StoredGrain { Id = "any-tu", CustomerId = 99 }]);

        var result = await _sut.GetByCustomerAsync(99L, CancellationToken.None);

        Assert.Single(result);
        _entitlementMock.Verify(
            e => e.GetAllowedTradeUnitCodesAsync(It.IsAny<CancellationToken>()), Times.Never);
        _customerRepositoryMock.Verify(
            c => c.GetActiveCustomerIdsInTradeUnitsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }
}
