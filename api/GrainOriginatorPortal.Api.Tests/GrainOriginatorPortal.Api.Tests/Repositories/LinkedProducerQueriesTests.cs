// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Repositories;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The two linked-producer queries on <see cref="ProducerDetailsRepository"/>: who links to a producer, and
/// each linking customer's acres and outgoing links. S2 and S3 link to S1; S3 also links to S2.
/// </summary>
public class LinkedProducerQueriesTests
{
    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"linkedproducers-{Guid.NewGuid()}")
            .Options);
        db.Customers.AddRange(
            new Customer { Id = 1, Name = "One", ScoularId = "S1", IsActive = true },
            new Customer { Id = 2, Name = "Two", ScoularId = "S2", IsActive = true },
            new Customer { Id = 3, Name = "Three", ScoularId = "S3", IsActive = true });
        db.CustomerLinks.AddRange(
            new CustomerLink { FromCustomerId = 2, ToCustomerId = 1 },
            new CustomerLink { FromCustomerId = 3, ToCustomerId = 1 },
            new CustomerLink { FromCustomerId = 3, ToCustomerId = 2 });
        db.ProducerDetails.Add(new ProducerDetails { CustomerId = 2, TotalAcres = 1200.6m, CreatedBy = "tester" });
        db.SaveChanges();
        return db;
    }

    private static ProducerDetailsRepository Repo(ApplicationDbContext db) =>
        new(db, NullLogger<ProducerDetailsRepository>.Instance);

    [Fact]
    public async Task GetCustomerIdsLinkingToAsync_IsEveryCustomerWithALinkToThatCode()
    {
        using var db = NewContext();

        Assert.Equal([2L, 3L], (await Repo(db).GetCustomerIdsLinkingToAsync("S1", default)).Order());
        Assert.Empty(await Repo(db).GetCustomerIdsLinkingToAsync("NOPE", default));
        Assert.Empty(await Repo(db).GetCustomerIdsLinkingToAsync(" ", default));
    }

    [Fact]
    public async Task GetLinkFieldsAsync_GivesAcresWhereKnown_AndEveryOutgoingLinkAsACode()
    {
        using var db = NewContext();

        var fields = await Repo(db).GetLinkFieldsAsync([2, 3], default);

        // Acres are whole numbers on the customer, as before the move.
        Assert.Equal(1200, fields[2].TotalAcres);
        Assert.Equal(["S1"], fields[2].LinkedProducerIds);
        Assert.Null(fields[3].TotalAcres);
        Assert.Equal(["S1", "S2"], fields[3].LinkedProducerIds.Order());
        Assert.False(fields.ContainsKey(1));
    }
}
