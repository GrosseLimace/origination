// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The customer list carries each producer's active trade units so the planting-intention dialog can
/// offer them without a request of its own. That request used to queue for 30s or more behind slow CTRM
/// reads, because the browser only opens a handful of connections to the API.
/// </summary>
public class CustomerRepositoryTradeUnitsTests
{
    private static CustomerRepository Build(out ApplicationDbContext app)
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"tu-ods-{Guid.NewGuid()}").Options);
        app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"tu-app-{Guid.NewGuid()}").Options);

        app.Customers.AddRange(
            new Customer { Id = 1, ScoularId = "TWOTU", Name = "Two Trade Units Farm", IsActive = true },
            new Customer { Id = 2, ScoularId = "ONETU", Name = "One Trade Unit Farm", IsActive = true });
        app.CustomerTradeUnits.AddRange(
            // Padded, as sync rows can be. Kept off the filtered code: SQL Server ignores trailing spaces
            // in the filter's comparison, the in-memory provider does not.
            new CustomerTradeUnit { CustomerId = 1, TradeUnit = "2210 ", IsActive = true },
            new CustomerTradeUnit { CustomerId = 1, TradeUnit = "2190", IsActive = true },
            new CustomerTradeUnit { CustomerId = 1, TradeUnit = "3000", IsActive = false },  // removed: not offered
            new CustomerTradeUnit { CustomerId = 2, TradeUnit = "2190", IsActive = true });
        app.SaveChanges();

        // Strict: listing customers must not read contracts or tickets.
        return new CustomerRepository(ods, app,
            new Mock<ITicketRepository>(MockBehavior.Strict).Object,
            new Mock<IContractRepository>(MockBehavior.Strict).Object,
            new Mock<ILogger<CustomerRepository>>().Object);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheListCarriesEachProducersActiveTradeUnits_IncludingOnesOutsideTheFilter()
    {
        // Filtered to 2190, but the two-trade-unit producer must still show 2210: the planting dialog
        // offers every one of the producer's trade units, not only the ones in the header.
        var sut = Build(out _);

        var customers = await sut.GetAsync(["2190"], CancellationToken.None);

        Assert.Equal(["2190", "2210"], customers.Single(c => c.Id == 1).ActiveTradeUnits);
        Assert.Equal(["2190"], customers.Single(c => c.Id == 2).ActiveTradeUnits);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AProducerWithNoActiveTradeUnitsGetsAnEmptyList()
    {
        var sut = Build(out var app);
        app.Customers.Add(new Customer { Id = 3, ScoularId = "NOTU", Name = "Unassigned Farm", IsActive = true });
        app.SaveChanges();

        var customers = await sut.GetAsync(null, CancellationToken.None);

        Assert.Empty(customers.Single(c => c.Id == 3).ActiveTradeUnits);
    }
}
