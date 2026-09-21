// Third-party namespaces
using Microsoft.Extensions.Logging;
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// H-062 (CWE-639). The producer-details DELETE carries no trade-unit value,
/// so [EnforceTradeUnitAccess] could not guard it even if the controller applied the filter — the
/// check has to resolve the customer's own entitlement. These tests pin that guard.
///
/// Why this delete and not the sibling PUT: the delete has no client caller, it hand-cascades to
/// ProducerContacts and ProducerGrainOnFarm, and those rows are hand-entered with no upstream
/// system of record — unlike contracts and tickets, they cannot be re-synced from ODS.
/// </summary>
public class ProducerDetailsDeleteTests
{
    private const long EntitledCustomerId = 41;
    private const long ForeignCustomerId = 42;

    private readonly Mock<IProducerDetailsRepository> _repositoryMock = new();
    private readonly Mock<ICustomerRepository> _customerRepositoryMock = new();
    private readonly Mock<IUserEntitlementService> _entitlementMock = new();
    private readonly Mock<IDisplayNameLookupRepository> _displayNameMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly ProducerDetailsService _sut;

    public ProducerDetailsDeleteTests()
    {
        _entitlementMock.SetupGet(e => e.EntitlementsAvailable).Returns(true);
        _entitlementMock
            .Setup(e => e.GetAllowedTradeUnitCodesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string> { "2090" });

        // Only the entitled customer is a member of the caller's trade units.
        _customerRepositoryMock
            .Setup(c => c.GetActiveCustomerIdsInTradeUnitsAsync(
                It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<long> { EntitledCustomerId });

        _requestContextMock.Setup(r => r.GetCurrentUser()).Returns("tester");

        _repositoryMock
            .Setup(r => r.DeleteAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        _sut = new ProducerDetailsService(
            _repositoryMock.Object,
            _customerRepositoryMock.Object,
            _entitlementMock.Object,
            _displayNameMock.Object,
            _requestContextMock.Object,
            Mock.Of<ILogger<ProducerDetailsService>>());
    }

    [Fact]
    public async Task DeleteAsync_WhenCustomerIsInAnEntitledTradeUnit_Deletes()
    {
        var result = await _sut.DeleteAsync(EntitledCustomerId, CancellationToken.None);

        Assert.True(result);
        _repositoryMock.Verify(r => r.DeleteAsync(EntitledCustomerId, It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task DeleteAsync_WhenCustomerIsOutsideEntitlements_ThrowsAndDeletesNothing()
    {
        await Assert.ThrowsAsync<ForbiddenException>(
            () => _sut.DeleteAsync(ForeignCustomerId, CancellationToken.None));

        // The assertion that matters: the producer's details and child rows must still be there.
        _repositoryMock.Verify(
            r => r.DeleteAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // An entitled customer with no details row is a no-op, not an error — the route stays
    // idempotent and returns 204, matching its pre-fix behaviour.
    [Fact]
    public async Task DeleteAsync_WhenNoDetailsRowExists_ReturnsFalseWithoutThrowing()
    {
        _repositoryMock
            .Setup(r => r.DeleteAsync(EntitledCustomerId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var result = await _sut.DeleteAsync(EntitledCustomerId, CancellationToken.None);

        Assert.False(result);
    }

    // CWE-285: an entitlements outage must refuse a destructive call rather than delete rows it
    // cannot authorize. Mirrors GetAllAsync in the same service, and DpContractService.
    [Fact]
    public async Task DeleteAsync_WhenEntitlementsUnavailable_FailsClosedWith503()
    {
        _entitlementMock.SetupGet(e => e.EntitlementsAvailable).Returns(false);

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.DeleteAsync(EntitledCustomerId, CancellationToken.None));

        Assert.Equal("ENTITLEMENTS_DB_UNAVAILABLE", ex.ErrorCode);
        _repositoryMock.Verify(
            r => r.DeleteAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---- GET is deliberately NOT scoped. Three tests here asserted a trade-unit check on the
    // read between 2026-09-14 and 2026-09-21; they were removed with the check.
    //
    // Trade units are self-assigned through the Trade Unit Preferences app, so a trade-unit test on
    // a read refuses nobody — it only adds a detour. Worse, ODS onboarding candidates carry a real
    // CustomerId with NO CustomerTradeUnit row, so the check refused them and silently blanked the
    // profile. This test pins the behaviour that regression broke.

    [Fact]
    public async Task GetByCustomerAsync_ForAProducerOutsideTheCallersTradeUnits_StillReturns()
    {
        // ForeignCustomerId is absent from GetActiveCustomerIdsInTradeUnitsAsync — an onboarding
        // candidate or another desk's producer. The read must still serve it.
        _repositoryMock
            .Setup(r => r.GetAsync(ForeignCustomerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((ProducerDetails?)null);

        var result = await _sut.GetByCustomerAsync(ForeignCustomerId, CancellationToken.None);

        Assert.Equal(ForeignCustomerId, result.CustomerId);
        // And it must not have consulted entitlements at all on this path.
        _entitlementMock.Verify(
            e => e.GetAllowedTradeUnitCodesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    // Guards the ordering the fix depends on: entitlement must resolve BEFORE the delete, never
    // after. Reversing them would authorize rows that are already gone.
    [Fact]
    public async Task DeleteAsync_ResolvesEntitlementBeforeDeleting()
    {
        var sequence = new List<string>();
        _customerRepositoryMock
            .Setup(c => c.GetActiveCustomerIdsInTradeUnitsAsync(
                It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<long> { EntitledCustomerId })
            .Callback(() => sequence.Add("resolve"));
        _repositoryMock
            .Setup(r => r.DeleteAsync(EntitledCustomerId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true)
            .Callback(() => sequence.Add("delete"));

        await _sut.DeleteAsync(EntitledCustomerId, CancellationToken.None);

        Assert.Equal(["resolve", "delete"], sequence);
    }
}
