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
/// Direct coverage of the parts of <see cref="StoredGrainRepository"/> that sit in front of its raw
/// SQL: the trade-unit → producer scope resolution that decides whether the ODS is queried at all,
/// the customer-code lookup for the per-producer read, and the catch-all that turns any read failure
/// into an empty list plus an error log rather than a 500.
/// </summary>
/// <remarks>
/// Deliberately NOT tested here: the <c>ctrm.vw_GNTA39D1</c> / <c>vw_GNP026</c> query itself
/// (<c>SqlQueryRaw</c>, ROW_NUMBER dedupe, latest-snapshot filter) and the CustomerId enrichment
/// that follows it. On the InMemory provider that statement throws, which is exactly what the
/// error-path tests below rely on; the query's own semantics need the real-SQL harness.
/// </remarks>
public class StoredGrainRepositoryTests
{
    private static (StoredGrainRepository Sut, ApplicationDbContext App, Mock<ILogger<StoredGrainRepository>> Logger) Build()
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"storedgrain-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"storedgrain-app-{Guid.NewGuid()}").Options);
        var logger = new Mock<ILogger<StoredGrainRepository>>();
        return (new StoredGrainRepository(ods, app, logger.Object), app, logger);
    }

    private static void AssertLoggedError(Mock<ILogger<StoredGrainRepository>> logger, Times times) =>
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
            new Customer { Id = 2, ScoularId = null, Name = "No code", IsActive = true },
            new Customer { Id = 3, ScoularId = "C", Name = "Other TU", IsActive = true });
        app.CustomerTradeUnits.AddRange(
            new CustomerTradeUnit { Id = 1, CustomerId = 1, TradeUnit = "4056", IsActive = true },
            new CustomerTradeUnit { Id = 2, CustomerId = 2, TradeUnit = "4056", IsActive = true },
            new CustomerTradeUnit { Id = 3, CustomerId = 3, TradeUnit = "9999", IsActive = true });
        await app.SaveChangesAsync();

        var rows = await sut.GetAsync(["4056"], CancellationToken.None);

        Assert.Empty(rows);
        AssertLoggedError(logger, Times.Never());      // a clean empty scope, not a swallowed failure
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAsync_ProducersInScope_ReadFailure_IsLoggedAndReturnsEmpty()
    {
        var (sut, app, logger) = Build();
        app.Customers.Add(new Customer { Id = 1, ScoularId = "A", Name = "Live", IsActive = true });
        app.CustomerTradeUnits.Add(new CustomerTradeUnit { Id = 1, CustomerId = 1, TradeUnit = "4056", IsActive = true });
        await app.SaveChangesAsync();

        var rows = await sut.GetAsync(["4056"], CancellationToken.None);   // the raw ODS read cannot run here

        Assert.Empty(rows);
        AssertLoggedError(logger, Times.Once());
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(true)]   // null trade units
    [InlineData(false)]  // empty list
    public async Task GetAsync_NoTradeUnits_GoesStraightToOds_AndFailsSoft(bool useNull)
    {
        var (sut, _, logger) = Build();

        var rows = await sut.GetAsync(useNull ? null : [], CancellationToken.None);

        Assert.Empty(rows);
        AssertLoggedError(logger, Times.Once());
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(99L)]   // unknown customer
    [InlineData(2L)]    // known customer with no code
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
