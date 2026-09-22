// Microsoft namespaces
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The value in ContractService is the SafeContractsAsync error split: SQL 207/208 (a mapped column
/// or the view itself is missing, i.e. permanent schema drift) degrades to [], while a timeout or
/// connection failure surfaces as a retryable 503. Collapsing the two made "producers with active
/// contracts" render "No Producers Found" during a 300s timeout with nothing to tell the client
/// apart from a genuine zero-match. These pin that split and the argument forwarding around it.
/// </summary>
public class ContractServiceTests
{
    private readonly Mock<IContractRepository> _repositoryMock = new();
    private readonly ContractService _sut;

    public ContractServiceTests()
    {
        _sut = new ContractService(_repositoryMock.Object, new Mock<ILogger<ContractService>>().Object);
    }

    [Fact]
    public async Task GetAllAsync_ForwardsTheTradeUnitsAndMapsContracts()
    {
        var tradeUnits = new List<string> { "2090", "2291" };
        _repositoryMock
            .Setup(r => r.GetAsync(tradeUnits, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new Contract
            {
                Id = 11, CustomerId = 5, CtrmCustomerId = "C-5", SourceContractId = "P123456", ContractNumber = "123456",
                ContractPrefixType = "P", CommodityCode = "YC", TradeUnit = "2090", Quantity = 5_000m, OpenBalanceQuantity = 1_200m,
                PriceTypeCode = "U", CropYear = 2026, DeliveryEnd = new DateTime(2026, 12, 31),
            }]);

        var result = await _sut.GetAllAsync(tradeUnits, CancellationToken.None);

        var row = Assert.Single(result);
        Assert.Equal(11, row.Id);
        Assert.Equal(5, row.CustomerId);
        Assert.Equal("C-5", row.CtrmCustomerId);
        Assert.Equal("P123456", row.SourceContractId);
        Assert.Equal("P", row.ContractPrefixType);
        Assert.Equal("YC", row.CommodityCode);
        Assert.Equal(5_000m, row.Quantity);
        Assert.Equal(1_200m, row.OpenBalanceQuantity);
        Assert.Equal("U", row.PriceTypeCode);
        Assert.Equal(2026, row.CropYear);
        Assert.Equal(new DateTime(2026, 12, 31), row.DeliveryEnd);
    }

    [Theory]
    [InlineData(207)] // invalid column name
    [InlineData(208)] // invalid object name
    public async Task GetAllAsync_WhenTheViewIsMissingAMappedColumnOrObject_DegradesToEmpty(int sqlErrorNumber)
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(SqlExceptionDoubles.WithNumber(sqlErrorNumber));

        var result = await _sut.GetAllAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetAllAsync_WhenTheDatabaseTimesOut_SurfacesARetryable503WithTheCauseAttached()
    {
        var sqlException = SqlExceptionDoubles.Transient();
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(sqlException);

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetAllAsync(null, CancellationToken.None));

        Assert.Equal("CONTRACTS_DB_UNAVAILABLE", ex.ErrorCode);
        Assert.Equal(503, ex.HttpStatusCode);
        Assert.Same(sqlException, ex.InnerException);
    }

    // EF Core frequently wraps the provider exception; the filter must look one level down.
    [Fact]
    public async Task GetAllAsync_WhenEfCoreWrapsTheSqlException_StillSurfacesA503()
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("An error occurred while reading", SqlExceptionDoubles.Transient()));

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetAllAsync(null, CancellationToken.None));

        Assert.Equal("CONTRACTS_DB_UNAVAILABLE", ex.ErrorCode);
    }

    // The filter is deliberately narrow: a programming error is not a "data source unavailable".
    [Fact]
    public async Task GetAllAsync_WhenANonSqlExceptionIsThrown_PropagatesItUnchanged()
    {
        _repositoryMock
            .Setup(r => r.GetAsync(It.IsAny<List<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ArgumentException("bad filter"));

        await Assert.ThrowsAsync<ArgumentException>(() => _sut.GetAllAsync(null, CancellationToken.None));
    }

    [Fact]
    public async Task SafeWrappers_ForwardTheirArgumentsToTheRepository()
    {
        var tradeUnits = new List<string> { "2090" };
        _repositoryMock.Setup(r => r.GetByCustomerAsync(42L, "SC-42", It.IsAny<CancellationToken>())).ReturnsAsync([new Contract { Id = 1 }]);
        _repositoryMock.Setup(r => r.GetHistoricalForPacingAsync(42L, It.IsAny<CancellationToken>())).ReturnsAsync([new Contract { Id = 2 }]);
        _repositoryMock.Setup(r => r.GetByCropYearAsync(2026, tradeUnits, It.IsAny<CancellationToken>())).ReturnsAsync([new Contract { Id = 3 }]);

        var byCustomer = await _sut.GetByCustomerAsync(42L, "SC-42", CancellationToken.None);
        var pacing = await _sut.GetHistoricalForPacingAsync(42L, CancellationToken.None);
        var byCropYear = await _sut.GetByCropYearAsync(2026, tradeUnits, CancellationToken.None);

        Assert.Equal(1, Assert.Single(byCustomer).Id);
        Assert.Equal(2, Assert.Single(pacing).Id);
        Assert.Equal(3, Assert.Single(byCropYear).Id);
    }

    // Documents (does not endorse) that GetByFarmAsync is the one contract read outside the
    // SafeContractsAsync wrapper: a SqlException propagates raw instead of becoming a 503 or [].
    // If it is brought in line with its siblings, update this test in the same change.
    [Fact]
    public async Task GetByFarmAsync_IsNotWrapped_SoASqlExceptionPropagatesRaw()
    {
        _repositoryMock
            .Setup(r => r.GetByFarmAsync("farm-1", It.IsAny<CancellationToken>()))
            .ThrowsAsync(SqlExceptionDoubles.Transient());

        await Assert.ThrowsAsync<SqlException>(() => _sut.GetByFarmAsync("farm-1", CancellationToken.None));
    }

    [Fact]
    public async Task GetPricingLinesAsync_MapsLinesIncludingTheComputedPricedQtyAndCashPrice()
    {
        _repositoryMock
            .Setup(r => r.GetPricingLinesAsync("P123456", It.IsAny<CancellationToken>()))
            .ReturnsAsync([new ContractPricingLine
            {
                ContractId = "P123456", PriceSequence = 1, PriceQuantity = 2_500m, FlatPrice = 4.85m,
                BasisPrice = -0.35m, ConfirmationStatus = "PRICED",
            }]);

        var result = await _sut.GetPricingLinesAsync("P123456", CancellationToken.None);

        var line = Assert.Single(result);
        Assert.Equal("P123456", line.ContractId);
        Assert.Equal(1, line.PriceSequence);
        Assert.Equal(2_500m, line.PricedQty);  // computed alias of PriceQuantity
        Assert.Equal(4.85m, line.CashPrice);   // computed alias of FlatPrice
        Assert.Equal(-0.35m, line.BasisPrice);
        Assert.Equal("PRICED", line.ConfirmationStatus);
    }

    // vw_ContractPricing is optional per environment; ANY failure reading it must not break the
    // contract detail page, so these two degrade to [] on every exception type.
    [Fact]
    public async Task GetPricingLines_WhenTheViewIsUnavailable_DegradeToEmptyOnAnyException()
    {
        _repositoryMock
            .Setup(r => r.GetPricingLinesAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(SqlExceptionDoubles.Transient());
        _repositoryMock
            .Setup(r => r.GetPricingLinesByCustomerAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("mapping mismatch"));

        var byContract = await _sut.GetPricingLinesAsync("P123456", CancellationToken.None);
        var byCustomer = await _sut.GetPricingLinesByCustomerAsync("SC-42", CancellationToken.None);

        Assert.Empty(byContract);
        Assert.Empty(byCustomer);
    }
}
