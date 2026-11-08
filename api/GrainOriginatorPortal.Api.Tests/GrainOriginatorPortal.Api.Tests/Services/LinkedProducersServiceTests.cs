// Third-party namespaces
using Microsoft.Extensions.Logging;
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Modules.Producers.Services;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Interfaces;
using GrainOriginatorPortal.Api.Modules.Customers.Models.Responses;
using GrainOriginatorPortal.Api.Modules.Customers.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Incoming linked producers: Producers finds who links to a producer, the Customers module fills those
/// customers in, and the producer fields (acres, outgoing links) go on top.
/// </summary>
public class LinkedProducersServiceTests
{
    private readonly Mock<IProducerDetailsRepository> _repositoryMock = new();
    private readonly Mock<ICustomerLookup> _customersMock = new();
    private readonly ProducerDetailsService _sut;

    public LinkedProducersServiceTests()
    {
        _sut = new ProducerDetailsService(
            _repositoryMock.Object,
            _customersMock.Object,
            Mock.Of<IUserEntitlementService>(),
            Mock.Of<IDisplayNameLookupRepository>(),
            Mock.Of<IRequestContextService>(),
            Mock.Of<ILogger<ProducerDetailsService>>());
    }

    [Fact]
    public async Task GetLinkedToAsync_PutsEachCustomersAcresAndLinksOnWhatTheCustomersModuleReturns()
    {
        _repositoryMock.Setup(r => r.GetCustomerIdsLinkingToAsync("S1", It.IsAny<CancellationToken>())).ReturnsAsync([2, 3, 4]);
        // Customer 4 is inactive, so the Customers module leaves it out.
        _customersMock
            .Setup(c => c.GetActiveAsync(It.Is<IReadOnlyCollection<long>>(ids => ids.Order().SequenceEqual(new long[] { 2, 3, 4 })), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new CustomerResponse { Id = 2, Name = "Two" }, new CustomerResponse { Id = 3, Name = "Three" }]);
        _repositoryMock
            .Setup(r => r.GetLinkFieldsAsync(It.Is<IReadOnlyCollection<long>>(ids => ids.Order().SequenceEqual(new long[] { 2, 3 })), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, ProducerLinkFields> { [2] = new(1200, ["S1", "S9"]) });

        var linked = await _sut.GetLinkedToAsync("S1", CancellationToken.None);

        Assert.Equal([2L, 3L], linked.Select(c => c.Id));
        Assert.Equal(1200, linked[0].TotalAcres);
        Assert.Equal(["S1", "S9"], linked[0].LinkedProducerIds);
        Assert.Equal(0, linked[1].TotalAcres);
        Assert.Empty(linked[1].LinkedProducerIds);
        Assert.Equal("Two", linked[0].Name);
    }

    [Fact]
    public async Task GetLinkedToAsync_WithNoIncomingLinks_IsEmpty_WithoutAskingForCustomers()
    {
        _repositoryMock.Setup(r => r.GetCustomerIdsLinkingToAsync("S1", It.IsAny<CancellationToken>())).ReturnsAsync([]);

        Assert.Empty(await _sut.GetLinkedToAsync("S1", CancellationToken.None));
        _customersMock.Verify(c => c.GetActiveAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task GetLinkedToAsync_ADatabaseOutage_IsTheSameRetryable503AsBefore()
    {
        _repositoryMock.Setup(r => r.GetCustomerIdsLinkingToAsync("S1", It.IsAny<CancellationToken>()))
            .ThrowsAsync(SqlExceptionDoubles.Transient());

        var ex = await Assert.ThrowsAsync<InfrastructureException>(() => _sut.GetLinkedToAsync("S1", CancellationToken.None));

        Assert.Equal(("CUSTOMERS_DB_UNAVAILABLE", 503), (ex.ErrorCode, ex.HttpStatusCode));
    }
}
