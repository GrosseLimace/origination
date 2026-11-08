// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.Contracts.Services;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// What other modules ask the Contracts module about contracts, answered from the ODS repository whatever
/// <c>Ctrm:Source</c> says, because the ids are ODS ids. Against InMemory contexts.
/// </summary>
public class ContractLookupTests
{
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetNamesAsync_IsEachContractsNumberAndCommodity_AndLeavesOutUnknownIds()
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"contract-names-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"contract-names-app-{Guid.NewGuid()}").Options);
        ods.Contracts.AddRange(
            new Contract { Id = 10, ContractNumber = "P1", CommodityCode = "YC" },
            new Contract { Id = 11, ContractNumber = "P2", CommodityCode = null });
        await ods.SaveChangesAsync();
        var sut = new ContractLookup(new ContractRepository(ods, app, new Mock<ILogger<ContractRepository>>().Object));

        Assert.Empty(await sut.GetNamesAsync([], CancellationToken.None));
        var names = await sut.GetNamesAsync([10, 11, 99], CancellationToken.None);

        Assert.Equal(2, names.Count);
        Assert.Equal(new ContractName("P1", "YC"), names[10]);
        Assert.Equal(new ContractName("P2", null), names[11]);
    }
}
