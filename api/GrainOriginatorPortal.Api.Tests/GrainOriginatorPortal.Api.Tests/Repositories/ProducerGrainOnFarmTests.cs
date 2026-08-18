// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Exercises the grain-on-farm replace-on-upsert + compose-on-read added to
/// <see cref="ProducerDetailsRepository"/>, against an InMemory database.
/// </summary>
public class ProducerGrainOnFarmTests
{
    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"grainonfarm-{Guid.NewGuid()}")
            .Options);
        // ProducerDetails has a required FK to Customer; seed the producer (id 100) so GetAsync's
        // Include(Customer) has a principal to join.
        db.Customers.Add(new Customer { Id = 100, Name = "Smith Farm", ScoularId = "S1" });
        db.SaveChanges();
        return db;
    }

    private static ProducerDetailsRepository Repo(ApplicationDbContext db) =>
        new(db, NullLogger<ProducerDetailsRepository>.Instance);

    private static GrainOnFarmEntry Entry(string group, decimal? onHand, decimal? target) =>
        new() { CommodityGroup = group, BushelsOnHand = onHand, TargetBushels = target };

    private static ProducerDetailsUpsertArgs Args(IReadOnlyList<GrainOnFarmEntry> grain) =>
        new() { CustomerId = 100, ScoularId = "S1", CustomerName = "Smith Farm", GrainOnFarm = grain };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_PersistsGrainRows_AndGetComposesGroups()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("Corn", 80_000, 100_000), Entry("Soybeans", 40_000, 50_000) }),
            "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.NotNull(pd);
        var corn = Assert.Single(pd!.GrainOnFarm, g => g.CommodityGroup == "Corn");
        Assert.Equal(80_000, corn.BushelsOnHand);
        Assert.Equal(100_000, corn.TargetBushels);
        Assert.Equal(2, pd.GrainOnFarm.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_ReplacesPriorGrainSet()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("Corn", 80_000, 100_000), Entry("Soybeans", 40_000, null) }),
            "tuser", CancellationToken.None);
        // Re-save with only corn → soybeans row should be gone.
        await repo.UpsertAsync(Args(new[] { Entry("Corn", 90_000, 110_000) }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        var only = Assert.Single(pd!.GrainOnFarm);
        Assert.Equal("Corn", only.CommodityGroup);
        Assert.Equal(90_000, only.BushelsOnHand);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_DropsBlankGroups()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("Corn", 10, 20), Entry("  ", 99, 99) }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Single(pd!.GrainOnFarm);
        Assert.Equal("Corn", pd.GrainOnFarm[0].CommodityGroup);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_EmptyList_ClearsGrainRows()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("Corn", 10, 20) }), "tuser", CancellationToken.None);
        await repo.UpsertAsync(Args(Array.Empty<GrainOnFarmEntry>()), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Empty(pd!.GrainOnFarm);
    }
}
