// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of the parts of <see cref="DpContractRepository"/> that sit in front of its raw
/// SQL: the trade-unit → producer scope resolution that decides whether the ODS is queried at all,
/// the customer-code lookup for the per-producer read, and the catch-all that turns any read failure
/// into an empty list plus an error log rather than a 500.
/// </summary>
/// <remarks>
/// Deliberately NOT tested here: the <c>ctrm.vw_GNTA70D1</c> query (<c>SqlQueryRaw</c> with the
/// charge-period-aware ROW_NUMBER dedupe), the CustomerId enrichment and the bushel conversion that
/// follow it. On the InMemory provider that statement throws, which is what the error-path tests
/// below rely on; the query's own semantics need the real-SQL harness. (The conversion rules have
/// their own pure-function tests via <c>DpBushelConversion</c>.)
/// </remarks>
public class DpContractRepositoryTests
{
    private static (DpContractRepository Sut, ApplicationDbContext App, Mock<ILogger<DpContractRepository>> Logger) Build()
    {
        var ods = new DpOdsDbContext(new DbContextOptionsBuilder<DpOdsDbContext>()
            .UseInMemoryDatabase($"dp-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"dp-app-{Guid.NewGuid()}").Options);
        var logger = new Mock<ILogger<DpContractRepository>>();
        return (new DpContractRepository(ods, app, logger.Object), app, logger);
    }

    private static void AssertLoggedError(Mock<ILogger<DpContractRepository>> logger, Times times) =>
        logger.Verify(l => l.Log(
            LogLevel.Error, It.IsAny<EventId>(), It.Is<It.IsAnyType>((_, _) => true),
            It.IsAny<Exception>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), times);

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAsync_TradeUnitsWithNoActiveProducers_ReturnsEmptyWithoutQueryingOds()
    {
        var (sut, app, logger) = Build();
        app.Customers.AddRange(
            new Customer { Id = 1, ScoularId = "A", Name = "Inactive", IsActive = false },
            new Customer { Id = 2, ScoularId = "B", Name = "Membership off", IsActive = true });
        app.CustomerTradeUnits.AddRange(
            new CustomerTradeUnit { Id = 1, CustomerId = 1, TradeUnit = "4056", IsActive = true },
            new CustomerTradeUnit { Id = 2, CustomerId = 2, TradeUnit = "4056", IsActive = false });
        await app.SaveChangesAsync();

        var rows = await sut.GetAsync(["4056"], CancellationToken.None);

        Assert.Empty(rows);
        AssertLoggedError(logger, Times.Never());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAsync_ProducersInScope_ReadFailure_IsLoggedAndReturnsEmpty()
    {
        var (sut, app, logger) = Build();
        app.Customers.Add(new Customer { Id = 1, ScoularId = "A", Name = "Live", IsActive = true });
        app.CustomerTradeUnits.Add(new CustomerTradeUnit { Id = 1, CustomerId = 1, TradeUnit = "4056", IsActive = true });
        await app.SaveChangesAsync();

        var rows = await sut.GetAsync(["4056"], CancellationToken.None);

        Assert.Empty(rows);
        AssertLoggedError(logger, Times.Once());
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task GetAsync_NoTradeUnits_GoesStraightToOds_AndFailsSoft(bool useNull)
    {
        var (sut, _, logger) = Build();

        var rows = await sut.GetAsync(useNull ? null : [], CancellationToken.None);

        Assert.Empty(rows);
        AssertLoggedError(logger, Times.Once());
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(99L)]
    [InlineData(2L)]
    public async Task GetByCustomerAsync_CustomerWithoutCode_ReturnsEmptyWithoutQueryingOds(long customerId)
    {
        var (sut, app, logger) = Build();
        app.Customers.Add(new Customer { Id = 2, ScoularId = null, Name = "No code", IsActive = true });
        await app.SaveChangesAsync();

        var rows = await sut.GetByCustomerAsync(customerId, CancellationToken.None);

        Assert.Empty(rows);
        AssertLoggedError(logger, Times.Never());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByCustomerAsync_CustomerWithCode_ReadFailure_IsLoggedAndReturnsEmpty()
    {
        var (sut, app, logger) = Build();
        app.Customers.Add(new Customer { Id = 1, ScoularId = "A", Name = "Live", IsActive = true });
        await app.SaveChangesAsync();

        var rows = await sut.GetByCustomerAsync(1, CancellationToken.None);

        Assert.Empty(rows);
        AssertLoggedError(logger, Times.Once());
    }
}
