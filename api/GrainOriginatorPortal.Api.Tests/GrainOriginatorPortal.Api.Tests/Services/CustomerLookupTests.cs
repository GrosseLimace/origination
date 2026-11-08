// Third-party namespaces
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Interfaces;
using GrainOriginatorPortal.Api.Modules.Customers.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>What other modules ask the Customers module, answered from the Customers repository.</summary>
public class CustomerLookupTests
{
    private readonly Mock<ICustomerRepository> _repositoryMock = new();
    private readonly CustomerLookup _sut;

    public CustomerLookupTests()
    {
        _sut = new CustomerLookup(_repositoryMock.Object, NullLogger<CustomerLookup>.Instance);
    }

    [Fact]
    public async Task GetNameAsync_IsTheCustomersNameAndCode_OrNullWhenThereIsNone()
    {
        _repositoryMock.Setup(r => r.GetByIdAsync(41, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Customer { Id = 41, Name = "Sample Farms", ScoularId = "SAMPFRM" });

        Assert.Equal(new CustomerName("Sample Farms", "SAMPFRM"), await _sut.GetNameAsync(41, CancellationToken.None));
        Assert.Null(await _sut.GetNameAsync(42, CancellationToken.None));
    }

    [Fact]
    public async Task GetNamesAsync_MapsTheRepositorysNamesAndCodes()
    {
        _repositoryMock.Setup(r => r.GetNamesAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, (string Name, string? ScoularId)> { [1] = ("Smith Farm", "SMITH"), [2] = ("Manual Farm", null) });

        var names = await _sut.GetNamesAsync([1, 2], CancellationToken.None);

        Assert.Equal(new CustomerName("Smith Farm", "SMITH"), names[1]);
        Assert.Equal(new CustomerName("Manual Farm", null), names[2]);
    }

    [Fact]
    public async Task GetActiveAsync_MapsTheRepositorysCustomers_AndSkipsTheQueryForNoIds()
    {
        _repositoryMock.Setup(r => r.GetActiveByIdsAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new Customer { Id = 2, Name = "Two" }]);

        Assert.Equal("Two", Assert.Single(await _sut.GetActiveAsync([2], CancellationToken.None)).Name);
        Assert.Empty(await _sut.GetActiveAsync([], CancellationToken.None));
        _repositoryMock.Verify(r => r.GetActiveByIdsAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GetActiveAsync_ADatabaseOutage_IsARetryable503()
    {
        _repositoryMock.Setup(r => r.GetActiveByIdsAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(SqlExceptionDoubles.Transient());

        var ex = await Assert.ThrowsAsync<InfrastructureException>(() => _sut.GetActiveAsync([2], CancellationToken.None));

        Assert.Equal(("CUSTOMERS_DB_UNAVAILABLE", 503), (ex.ErrorCode, ex.HttpStatusCode));
    }
}
