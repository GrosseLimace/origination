// Microsoft namespaces
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// CustomerService differs from Ticket/Contract in one deliberate way: Customer is an app-owned
/// table, so there is NO schema-drift excuse. Every SqlException is transient and becomes a 503,
/// including 207/208. These pin that, the null-vs-mapped single reads, and the audit stamp on the
/// two trade-unit writes (the only place the acting user is attached).
/// </summary>
public class CustomerServiceTests
{
    private const string CurrentUser = "cegr@scoular.com";

    private readonly Mock<ICustomerRepository> _repositoryMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly CustomerService _sut;

    public CustomerServiceTests()
    {
        _requestContextMock.Setup(r => r.GetCurrentUser()).Returns(CurrentUser);
        _sut = new CustomerService(_repositoryMock.Object, _requestContextMock.Object, new Mock<ILogger<CustomerService>>().Object);
    }

    [Fact]
    public async Task GetAllAsync_ForwardsTradeUnitsAndMapsCustomersIncludingCoordinates()
    {
        var tradeUnits = new List<string> { "2090" };
        _repositoryMock
            .Setup(r => r.GetAsync(tradeUnits, It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new Customer { Id = 1, ScoularId = "SC-1", Name = "Located Farms", Coordinates = new Coordinates { Lat = 41.25, Lng = -95.93 }, ESignEnabled = true, IsManual = true },
                new Customer { Id = 2, ScoularId = "SC-2", Name = "Unlocated Farms", Coordinates = null },
            ]);

        var result = await _sut.GetAllAsync(tradeUnits, CancellationToken.None);

        Assert.Equal(2, result.Count);
        Assert.Equal("SC-1", result[0].ScoularId);
        Assert.NotNull(result[0].Coordinates);
        Assert.Equal(41.25, result[0].Coordinates!.Lat);
        Assert.Equal(-95.93, result[0].Coordinates!.Lng);
        Assert.True(result[0].ESignEnabled);
        Assert.True(result[0].IsManual);
        Assert.Null(result[1].Coordinates); // no coordinates stays null, not (0,0), which would pin the marker off Africa
    }

    [Fact]
    public async Task GetAllAsync_WhenTheDatabaseIsUnavailable_SurfacesARetryable503WithTheCauseAttached()
    {
        var sqlException = SqlExceptionDoubles.Transient();
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(sqlException);

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetAllAsync(null, CancellationToken.None));

        Assert.Equal("CUSTOMERS_DB_UNAVAILABLE", ex.ErrorCode);
        Assert.Equal(503, ex.HttpStatusCode);
        Assert.Same(sqlException, ex.InnerException);
    }

    [Fact]
    public async Task GetAllAsync_WhenEfCoreWrapsTheSqlException_StillSurfacesA503()
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("An error occurred while reading", SqlExceptionDoubles.Transient()));

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetAllAsync(null, CancellationToken.None));

        Assert.Equal("CUSTOMERS_DB_UNAVAILABLE", ex.ErrorCode);
    }

    // The contrast with Ticket/ContractService: a missing column on an app-owned table is a broken
    // deployment, not tolerated drift, so it must NOT quietly become an empty producer list.
    [Theory]
    [InlineData(207)]
    [InlineData(208)]
    public async Task GetAllAsync_DoesNotSwallowMissingColumnErrorsLikeTheOdsServicesDo(int sqlErrorNumber)
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(SqlExceptionDoubles.WithNumber(sqlErrorNumber));

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetAllAsync(null, CancellationToken.None));

        Assert.Equal("CUSTOMERS_DB_UNAVAILABLE", ex.ErrorCode);
    }

    [Fact]
    public async Task GetAllAsync_WhenANonSqlExceptionIsThrown_PropagatesItUnchanged()
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ArgumentException("bad filter"));

        await Assert.ThrowsAsync<ArgumentException>(() => _sut.GetAllAsync(null, CancellationToken.None));
    }

    [Fact]
    public async Task SafeListWrappers_ForwardTheirArgumentsToTheRepository()
    {
        var tradeUnits = new List<string> { "2090" };
        _repositoryMock.Setup(r => r.SearchAsync("smith", tradeUnits, It.IsAny<CancellationToken>())).ReturnsAsync([new Customer { Id = 1 }]);
        _repositoryMock.Setup(r => r.SearchOdsAsync("smith", It.IsAny<CancellationToken>())).ReturnsAsync([new Customer { Id = 2 }]);
        _repositoryMock.Setup(r => r.GetLinkedToAsync("SC-9", It.IsAny<CancellationToken>())).ReturnsAsync([new Customer { Id = 3 }]);

        var search = await _sut.SearchAsync("smith", tradeUnits, CancellationToken.None);
        var ods = await _sut.SearchOdsAsync("smith", CancellationToken.None);
        var linked = await _sut.GetLinkedToAsync("SC-9", CancellationToken.None);

        Assert.Equal(1, Assert.Single(search).Id);
        Assert.Equal(2, Assert.Single(ods).Id);
        Assert.Equal(3, Assert.Single(linked).Id);
    }

    [Fact]
    public async Task GetByIdAsync_AndGetByScoularIdAsync_ReturnNullWhenTheCustomerIsMissing()
    {
        _repositoryMock.Setup(r => r.GetByIdAsync(404L, It.IsAny<CancellationToken>())).ReturnsAsync((Customer?)null);
        _repositoryMock.Setup(r => r.GetByScoularIdAsync("nope", It.IsAny<CancellationToken>())).ReturnsAsync((Customer?)null);

        Assert.Null(await _sut.GetByIdAsync(404L, CancellationToken.None));
        Assert.Null(await _sut.GetByScoularIdAsync("nope", CancellationToken.None));
    }

    [Fact]
    public async Task GetByScoularIdAsync_MapsTheCustomerWhenFound()
    {
        _repositoryMock
            .Setup(r => r.GetByScoularIdAsync("SC-7", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Customer { Id = 7, ScoularId = "SC-7", CustomerCode = "C7", Name = "Seven Farms", Phone = "402-555-0100", AchEnabled = true });

        var result = await _sut.GetByScoularIdAsync("SC-7", CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(7, result.Id);
        Assert.Equal("C7", result.CustomerCode);
        Assert.Equal("Seven Farms", result.Name);
        Assert.Equal("402-555-0100", result.Phone);
        Assert.True(result.AchEnabled);
    }

    [Fact]
    public async Task GetTradeUnitsAsync_MapsEveryMembershipFlag()
    {
        _repositoryMock
            .Setup(r => r.GetTradeUnitsAsync(7L, It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new CustomerTradeUnitMembership { TradeUnit = "2090", IsManual = false, HasOpenActivity = true, IsActive = true },
                new CustomerTradeUnitMembership { TradeUnit = "2291", IsManual = true, HasOpenActivity = false, IsActive = false },
            ]);

        var result = await _sut.GetTradeUnitsAsync(7L, CancellationToken.None);

        Assert.Equal(2, result.Count);
        Assert.Equal(("2090", false, true, true), (result[0].TradeUnit, result[0].IsManual, result[0].HasOpenActivity, result[0].IsActive));
        Assert.Equal(("2291", true, false, false), (result[1].TradeUnit, result[1].IsManual, result[1].HasOpenActivity, result[1].IsActive));
    }

    [Fact]
    public async Task GetTradeUnitMembershipsAsync_UsesTheActivityFreeRead()
    {
        _repositoryMock
            .Setup(r => r.GetTradeUnitMembershipsAsync(7L, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new CustomerTradeUnitMembership { TradeUnit = "2090", IsManual = false, IsActive = true }]);

        var result = await _sut.GetTradeUnitMembershipsAsync(7L, CancellationToken.None);

        Assert.Equal("2090", Assert.Single(result).TradeUnit);
        _repositoryMock.Verify(r => r.GetTradeUnitsAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task TradeUnitWrites_StampTheCurrentUserAndReturnTheRepositoryVerdict()
    {
        var codes = new List<string> { "2090", "2291" };
        _repositoryMock
            .Setup(r => r.AssignTradeUnitsAsync(7L, codes, CurrentUser, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AssignTradeUnitsOutcome.Ok(7L));
        _repositoryMock
            .Setup(r => r.DeactivateDormantTradeUnitAsync(7L, "2090", CurrentUser, It.IsAny<CancellationToken>()))
            .ReturnsAsync(DeactivateTradeUnitResult.StillActive);

        var assigned = await _sut.AssignTradeUnitsAsync(7L, codes, CancellationToken.None);
        var deactivated = await _sut.DeactivateDormantTradeUnitAsync(7L, "2090", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsOutcome.Ok(7L), assigned);
        Assert.Equal(DeactivateTradeUnitResult.StillActive, deactivated);
        // The strict-argument setups above only match when the acting user is passed through; make
        // the negative explicit so a dropped stamp reads as "wrong user", not "no setup matched".
        _repositoryMock.Verify(r => r.AssignTradeUnitsAsync(It.IsAny<long>(), It.IsAny<List<string>>(), It.Is<string>(u => u != CurrentUser), It.IsAny<CancellationToken>()), Times.Never);
        _repositoryMock.Verify(r => r.DeactivateDormantTradeUnitAsync(It.IsAny<long>(), It.IsAny<string>(), It.Is<string>(u => u != CurrentUser), It.IsAny<CancellationToken>()), Times.Never);
    }
}
