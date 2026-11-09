// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Extensions;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The customer names read other modules use to label what people worked on, such as the usage dashboard's recent
/// activity. Against InMemory contexts.
/// </summary>
public class CustomerRepositoryNamesTests
{
    private static CustomerRepository Build(out ApplicationDbContext app)
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"names-ods-{Guid.NewGuid()}").Options);
        app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"names-app-{Guid.NewGuid()}").Options);

        // Strict: naming customers must not read contracts or tickets.
        return new CustomerRepository(ods, app,
            new Mock<ICustomerActivitySource>(MockBehavior.Strict).Object,
            new Mock<ILogger<CustomerRepository>>().Object, new ConfigurationBuilder().Build());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetNamesAsync_NamesActiveAndInactiveCustomers_AndLeavesOutUnknownIds()
    {
        // A report about past activity still names a customer who has since been deactivated.
        var sut = Build(out var app);
        app.Customers.AddRange(
            new Customer { Id = 1, Name = "Smith Farm", ScoularId = "SMITH", IsActive = true },
            new Customer { Id = 2, Name = "Manual Farm", ScoularId = null, IsActive = false });
        await app.SaveChangesAsync();

        Assert.Empty(await sut.GetNamesAsync([], CancellationToken.None));
        var names = await sut.GetNamesAsync([1, 2, 99], CancellationToken.None);

        Assert.Equal(2, names.Count);
        Assert.Equal(("Smith Farm", "SMITH"), names[1]);
        Assert.Equal(("Manual Farm", (string?)null), names[2]);
    }
}
